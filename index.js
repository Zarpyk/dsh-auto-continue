/**
 * dsh-auto-continue — bilingual (English / Spanish) auto-continue for the DeepSeek Harness.
 *
 * A turn can end without finishing the job:
 *   - `max-tokens`  the model hit its output limit,
 *   - `error`       the provider returned a recoverable failure (rate limit, 5xx, timeout),
 *   - `interrupted` a turn was orphaned by a restart and closed on resume,
 *   - `completed`   the model stopped although the task was not done (opt-in).
 *
 * This plugin watches the committed session log, decides whether that ending is recoverable,
 * and — after a grace period — appends a continuation prompt as a normal user message through
 * the agent's own inbox, so the work resumes exactly where it stopped.
 *
 * Design constraints, all taken from the Harness contracts:
 *   - Everything is driven by durable `turn/end` events; there is no polling and no new session
 *     event type (a Session refuses to reopen on an unknown non-ignorable event).
 *   - The continuation is a plain `user` message built in-process, delivered with
 *     `agent.followup()`, which is exactly what `prompt(..., mode: 'queue')` does.
 *   - Subagent sessions are never continued, a manual stop (`aborted` by the user) is never
 *     overridden, and the number of consecutive continuations is capped.
 *   - Timers are owned by the plugin effect and cleared when the Session is disposed.
 *
 * The only state this plugin keeps is a runtime hint: how many continuations are outstanding.
 * The session log stays the source of truth.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-auto-continue'
export const inject = ['agents', 'sessions']

/**
 * Optional service access. Cordis refuses `ctx.<name>` for anything not declared in `inject`,
 * and a missing *required* service only parks the plugin ("pending"), so the HTTP carriers and
 * the logger are read through `ctx.get()`, which returns `undefined` when nobody provides them.
 */
function optionalService(ctx, name) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(name)
    return ctx[name]
  } catch {
    return undefined
  }
}

/** Message sent back into the session. `{name}` placeholders are documented in the README. */
const BUILTIN_TEXTS = {
  es: {
    'max-tokens': 'Continúa exactamente donde te quedaste, sin repetir lo que ya está hecho.',
    interrupted: 'Retoma la tarea interrumpida y continúa desde el último paso completado.',
    error: 'El intento anterior falló por un error recuperable ({code}). Reintenta el último paso y continúa la tarea.',
    'rate-limit': 'La petición anterior chocó con el límite de uso del proveedor ({code}). La ventana ya se ha reabierto: retoma la tarea exactamente donde se quedó.',
    manual: 'Continúa con la parte pendiente de la tarea.',
    completed: 'Continúa con el siguiente paso pendiente de la tarea.',
  },
  en: {
    'max-tokens': 'Continue exactly where you left off, without repeating work that is already done.',
    interrupted: 'Resume the interrupted task and continue from the last completed step.',
    error: 'The previous attempt failed with a recoverable error ({code}). Retry the last step and continue the task.',
    'rate-limit': 'The previous request hit the provider usage limit ({code}). The window is open again: resume the task exactly where it stopped.',
    manual: 'Continue with the pending part of the task.',
    completed: 'Continue with the next pending step of the task.',
  },
}

/**
 * Failure text that means "asking again cannot help". Matched case-insensitively against the
 * failure code and message. An HTTP status of 401/403 is always treated as permanent.
 */
const PERMANENT_ERROR_PATTERNS = [
  'auth', 'credential', 'api key', 'api-key', 'api_key', 'apikey', 'bearer',
  'unauthorized', 'forbidden', 'permission denied', 'access denied',
  'balance', 'insufficient', 'quota exceeded', 'out of quota', 'out of credits', 'billing', 'payment', 'subscription',
  'unknown model', 'model not found', 'model does not exist', 'invalid model',
  'context length', 'context_length', 'context window', 'maximum context', 'too many tokens',
  'content filter', 'content_filter', 'invalid request', 'bad request',
]

/** How the reason maps to a configurable prompt. */
const REASON_TEXT_FIELD = {
  'max-tokens': 'textMaxTokens',
  interrupted: 'textInterrupted',
  error: 'textError',
  'rate-limit': 'textRateLimit',
  completed: 'textCompleted',
}

/**
 * Failure text that means "a provider window is closed, not that the request was wrong". A closed
 * window reopens on its own, so these are waits; everything else in the permanent list is a stop.
 */
const RATE_LIMIT_CODES = ['rate_limit', 'rate-limit', 'rate limited', 'rate_limited', 'throttled', 'too_many_requests', 'overloaded']

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The description rows of each setting, in the compact `{ uid, refs, dict }` dialect the
 * Harness's config-inspection tooling reads. No settings form is generated from this for a
 * third-party bundle — a plugin page is a separate client contribution — so the real contract
 * callers rely on is `resolveConfig()`: it re-applies every default in code, which makes a
 * hand-written patch row exactly as safe as a validated one.
 */
const FIELD_ROWS = {
  enabled: {
    type: 'boolean',
    meta: { default: true, description: 'Continue turns automatically. Turn this off to keep the plugin installed but idle.' },
  },
  language: {
    type: 'string',
    meta: {
      default: 'auto',
      description: 'Language of the built-in continuation prompts: auto, es or en. "auto" follows the system locale and falls back to English.',
    },
  },
  continueOnMaxTokens: {
    type: 'boolean',
    meta: { default: true, description: 'Continue when the model hits its output limit (turn end reason: max-tokens).' },
  },
  continueOnInterrupted: {
    type: 'boolean',
    meta: { default: true, description: 'Continue when a turn was orphaned by a restart and closed on resume (turn end reason: interrupted).' },
  },
  continueOnError: {
    type: 'boolean',
    meta: { default: true, description: 'Continue after a recoverable provider error (turn end reason: error).' },
  },
  continueOnCompleted: {
    type: 'boolean',
    meta: { default: false, description: 'Continue after a normal completion, which turns the session into an autonomous loop. Off by default.' },
  },
  textMaxTokens: {
    type: 'string',
    meta: { default: '', description: 'Custom prompt for max-tokens. Empty uses the built-in text for the selected language.' },
  },
  textInterrupted: {
    type: 'string',
    meta: { default: '', description: 'Custom prompt for interrupted turns. Empty uses the built-in text.' },
  },
  textError: {
    type: 'string',
    meta: { default: '', description: 'Custom prompt for recoverable errors. Empty uses the built-in text.' },
  },
  textCompleted: {
    type: 'string',
    meta: { default: '', description: 'Custom prompt for completed turns. Empty uses the built-in text.' },
  },
  textRateLimit: {
    type: 'string',
    meta: { default: '', description: 'Custom prompt for a provider usage limit. Empty uses the built-in text for the selected language.' },
  },
  rateLimitWaitMs: {
    type: 'number',
    meta: { default: 900000, description: 'Longest wait armed for a rate limit, in milliseconds (default 15 minutes, the reset horizon providers publish). The countdown is always shown.' },
  },
  graceMs: {
    type: 'number',
    meta: { default: 3000, description: 'Milliseconds to wait before continuing, so a person can take over. Cancelled by new input.' },
  },
  cooldownMs: {
    type: 'number',
    meta: { default: 20000, description: 'Base delay before retrying after an error. Doubles with each consecutive failure.' },
  },
  backoffFactor: {
    type: 'number',
    meta: { default: 2, description: 'Multiplier applied to cooldownMs for each consecutive failure.' },
  },
  backoffMaxMs: {
    type: 'number',
    meta: { default: 300000, description: 'Upper bound for the error backoff delay, in milliseconds.' },
  },
  maxConsecutive: {
    type: 'number',
    meta: { default: 3, description: 'Maximum continuations in a row without new input from you. 0 disables the plugin for practical purposes.' },
  },
  classifyErrors: {
    type: 'boolean',
    meta: { default: true, description: 'Stop instead of retrying when the error is permanent: auth, quota, balance, unknown model, context overflow.' },
  },
  loopGuard: {
    type: 'boolean',
    meta: { default: true, description: 'Stop when the assistant repeats the same answer several turns in a row.' },
  },
  loopRepeatLimit: {
    type: 'number',
    meta: { default: 4, description: 'How many identical assistant answers in a row count as a loop.' },
  },
  verbose: {
    type: 'boolean',
    meta: { default: false, description: 'Write every decision to the host log. Useful while tuning, noisy otherwise.' },
  },
}

/** `{uid, refs, dict}` — the projected shape Settings reads through `Config.toJSON()`. */
const CONFIG_SCHEMA = (() => {
  const refs = {}
  const dict = {}
  let id = 1
  for (const [key, node] of Object.entries(FIELD_ROWS)) {
    refs[id] = node
    dict[key] = id
    id += 1
  }
  const rootId = id
  refs[rootId] = { type: 'object', meta: { default: {} }, dict }
  return { uid: rootId, refs }
})()

/**
 * Exported as the row's Config so Settings can render the fields. Validation never throws: an
 * unreadable value falls back to its default instead of failing the startup entry.
 */
export const Config = {
  ...CONFIG_SCHEMA,
  type: 'object',
  dict: FIELD_ROWS,
  meta: { default: {} },
  toJSON() {
    return CONFIG_SCHEMA
  },
  '~standard': {
    version: 1,
    vendor: 'dsh-auto-continue',
    validate(value) {
      return { value: resolveConfig(value) }
    },
  },
}

const LANGUAGE_VALUES = new Set(['auto', 'es', 'en'])

/** Apply defaults, coerce the obvious mismatches, and clamp the numbers into a usable range. */
function resolveConfig(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const config = {}
  for (const [key, node] of Object.entries(FIELD_ROWS)) {
    config[key] = coerceField(source[key], node.meta.default)
  }
  if (!LANGUAGE_VALUES.has(config.language)) config.language = 'auto'
  config.graceMs = clamp(config.graceMs, 0, 600000, 3000)
  config.cooldownMs = clamp(config.cooldownMs, 0, 3600000, 20000)
  config.backoffFactor = clamp(config.backoffFactor, 1, 10, 2)
  config.backoffMaxMs = clamp(config.backoffMaxMs, 0, 86400000, 300000)
  config.maxConsecutive = clamp(config.maxConsecutive, 0, 100, 3)
  config.loopRepeatLimit = clamp(config.loopRepeatLimit, 2, 50, 4)
  config.rateLimitWaitMs = clamp(config.rateLimitWaitMs, 0, 21600000, 900000)
  return config
}

function coerceField(raw, fallback) {
  if (raw === undefined || raw === null) return fallback
  if (typeof fallback === 'boolean') return typeof raw === 'boolean' ? raw : fallback
  if (typeof fallback === 'number') {
    const value = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof fallback === 'string') return typeof raw === 'string' ? raw : fallback
  return raw
}

function clamp(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/* -------------------------------------------------------------------------- */
/* Runtime store                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Choices made from the panel live here — pause state and the settings the page edits — so they
 * survive a restart without the profile patch being rewritten. The patch row stays the defaults.
 */
const STORE_VERSION = 1
const STORE_NAME = 'auto-continue.json'

function storeFile() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, STORE_NAME)
}

function readStore(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

/** Write through a temporary file so a crash mid-write cannot leave a truncated store. */
function writeStore(file, payload) {
  const text = JSON.stringify(payload, null, 2)
  const temporary = `${file}.tmp-${process.pid}`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(temporary, text, { encoding: 'utf8' })
  renameSync(temporary, file)
}

/** The persisted shape still goes through `resolveConfig`, so a stale store cannot inject junk. */
function mergeStored(base, overrides) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) return base
  return resolveConfig({ ...base, ...overrides })
}

/* -------------------------------------------------------------------------- */
/* HTTP helpers                                                               */
/* -------------------------------------------------------------------------- */

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Adapter for the `ctx.webServer` fallback carrier: it speaks Node's `(request, response)`, while
 * `ctx.connection.fetch` speaks `Request`/`Response`. Both end up in the same route table.
 */
function adaptNodeRequest(routes, request, response, maxBody) {
  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size <= maxBody) chunks.push(chunk)
  })
  request.on('end', async () => {
    const host = request.headers?.host ?? '127.0.0.1'
    const proto = String(request.headers?.['x-forwarded-proto'] ?? 'http').split(',')[0].trim()
    let url
    try {
      url = new URL(request.url ?? '/', `${proto}://${host}`)
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    const send = (result) => {
      response.writeHead(result.status, Object.fromEntries(result.headers))
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      result.text().then((text) => response.end(text)).catch(() => response.end())
    }
    const route = routes.find((item) => item.path === url.pathname)
    if (route === undefined) {
      send(jsonResponse(404, { ok: false, error: 'not found' }))
      return
    }
    if (!route.methods.includes(request.method ?? 'GET')) {
      send(jsonResponse(405, { ok: false, error: 'method not allowed' }))
      return
    }
    try {
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers ?? {})) {
        if (Array.isArray(value)) headers.set(key, value.join(', '))
        else if (value !== undefined) headers.set(key, String(value))
      }
      const body = ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : Buffer.concat(chunks)
      send(await route.fetch(new Request(url.toString(), { method: request.method, headers, body })))
    } catch (error) {
      send(jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }))
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Language                                                                   */
/* -------------------------------------------------------------------------- */

/** `auto` looks at the host locale; anything Spanish-speaking selects the Spanish prompts. */
function detectLanguage() {
  const candidates = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG, safeSystemLocale()]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    return candidate.toLowerCase().startsWith('es') ? 'es' : 'en'
  }
  return 'en'
}

function safeSystemLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

function resolveLanguage(configured) {
  return configured === 'es' || configured === 'en' ? configured : detectLanguage()
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return value
}

/** One `user` message, built exactly like `createUserMessage({ content, source })`. */
function createContinuationMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/** Replace `{name}` placeholders, leaving unknown names untouched. */
function renderText(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  )
}

function pickTemplate(config, language, reasonKey) {
  const field = REASON_TEXT_FIELD[reasonKey]
  const custom = field ? config[field] : undefined
  if (typeof custom === 'string' && custom.trim() !== '') return custom
  return BUILTIN_TEXTS[language][reasonKey] ?? BUILTIN_TEXTS.en[reasonKey] ?? ''
}

function errorLabel(reason) {
  const failure = reason?.error
  const code = typeof failure?.code === 'string' && failure.code.trim() !== '' ? failure.code : undefined
  const status = typeof failure?.status === 'number' ? `HTTP ${failure.status}` : undefined
  return code ?? status ?? 'unknown'
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Map a turn ending to a continuation intent.
 * @returns {{ continue: boolean, key?: string, delayMs?: number, note?: string, limit?: boolean }}
 */
function decide(reason, config, state) {
  const kind = reason?.kind

  switch (kind) {
    case 'max-tokens':
      return config.continueOnMaxTokens
        ? { continue: true, key: 'max-tokens', delayMs: config.graceMs }
        : { continue: false, note: 'max-tokens continuation is disabled' }

    case 'interrupted':
      return config.continueOnInterrupted
        ? { continue: true, key: 'interrupted', delayMs: config.graceMs }
        : { continue: false, note: 'interrupted continuation is disabled' }

    case 'error': {
      if (!config.continueOnError) return { continue: false, note: 'error continuation is disabled' }
      const failure = reason.error
      const retryAfter = Number.isFinite(failure?.providerRetryAfterMs)
        ? Math.max(0, failure.providerRetryAfterMs)
        : 0
      if (isRateLimitSignal(failure)) {
        // A closed provider window is a wait, not a failure: honour the published reset, else back off.
        const exponent = Math.max(0, state.attempts)
        const grown = config.cooldownMs * Math.pow(config.backoffFactor, Math.min(exponent, 16))
        const backoff = Math.min(grown, config.backoffMaxMs)
        const target = retryAfter > 0 ? retryAfter : backoff
        const wait = Math.min(target, config.rateLimitWaitMs)
        return { continue: true, key: 'rate-limit', delayMs: Math.max(config.graceMs, wait), waitMs: wait }
      }
      if (config.classifyErrors && isPermanentError(failure)) {
        return { continue: false, note: `permanent error: ${errorLabel(reason)}` }
      }
      const exponent = Math.max(0, state.attempts)
      const grown = config.cooldownMs * Math.pow(config.backoffFactor, Math.min(exponent, 16))
      const backoff = Math.min(grown, config.backoffMaxMs)
      const delayMs = Math.max(config.graceMs, backoff, retryAfter)
      return { continue: true, key: 'error', delayMs }
    }

    case 'completed':
      return config.continueOnCompleted
        ? { continue: true, key: 'completed', delayMs: config.graceMs }
        : { continue: false, reset: true, note: 'turn completed' }

    case 'aborted': {
      const cause = reason?.reason?.kind
      if (cause === 'user') return { continue: false, reset: true, note: 'stopped by the user' }
      return { continue: false, reset: true, note: `cancelled (${cause ?? 'unknown'})` }
    }

    case 'blocked':
      return { continue: false, reset: true, note: 'blocked by a pre-step hook' }

    case 'forked':
      return { continue: false, reset: true, note: 'turn forked into another session' }

    default:
      return { continue: false, note: `unknown turn end reason: ${String(kind)}` }
  }
}

function isPermanentError(failure) {
  if (isRateLimitSignal(failure)) return false
  if (failure?.status === 401 || failure?.status === 403) return true
  const haystack = `${failure?.code ?? ''} ${failure?.message ?? ''}`.toLowerCase()
  if (haystack.trim() === '') return false
  return PERMANENT_ERROR_PATTERNS.some((pattern) => haystack.includes(pattern))
}

/** A provider usage window (Command Code, Claude, any OpenAI-compatible gateway) rather than a fault. */
function isRateLimitSignal(failure) {
  if (failure === null || typeof failure !== 'object') return false
  if (failure.status === 429) return true
  const code = typeof failure.code === 'string' ? failure.code.toLowerCase() : ''
  if (code !== '' && RATE_LIMIT_CODES.some((token) => code.includes(token))) return true
  const message = typeof failure.message === 'string' ? failure.message.toLowerCase() : ''
  if (message === '') return false
  return message.includes('429')
    || message.includes('rate limit')
    || message.includes('usage limit')
    || message.includes('usage window')
    || message.includes('too many requests')
}

/* -------------------------------------------------------------------------- */
/* Drills                                                                     */
/* -------------------------------------------------------------------------- */

/** Endings a drill can imitate, so the banner can be seen without spending a real limit. */
const DRILL_REASONS = ['max-tokens', 'rate-limit', 'error', 'interrupted', 'completed', 'manual']

const DRILL_ALIASES = {
  'max-tokens': 'max-tokens',
  tokens: 'max-tokens',
  max_tokens: 'max-tokens',
  'rate-limit': 'rate-limit',
  rate_limit: 'rate-limit',
  limit: 'rate-limit',
  limite: 'rate-limit',
  'límite': 'rate-limit',
  error: 'error',
  fallo: 'error',
  interrupted: 'interrupted',
  interrumpido: 'interrupted',
  completed: 'completed',
  completado: 'completed',
  manual: 'manual',
}

/** A plausible failure per drilled reason, so the panel shows what a real one would. */
const DRILL_FAILURES = {
  'max-tokens': { code: 'max_tokens', status: '?', message: '' },
  'rate-limit': { code: 'RATE_LIMITED', status: 429, message: 'all Command Code account(s) have exhausted their usage window (drill)' },
  error: { code: 'server_error', status: 503, message: 'upstream is unavailable (drill)' },
  interrupted: { code: 'interrupted', status: '?', message: 'turn was orphaned by a restart (drill)' },
  completed: { code: 'completed', status: '?', message: '' },
  manual: { code: 'manual', status: '?', message: '' },
}

/** Long enough to read the banner, short enough not to wait. */
const DRILL_DELAY_MS = 8000

/** The assistant keeps saying the same thing: continuing would spin. */
function isRepeating(state, limit) {
  const texts = state.lastTexts
  if (texts.length < limit) return false
  const tail = texts.slice(-limit)
  const first = tail[0]
  return first !== '' && tail.every((text) => text === first)
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

export function apply(ctx, rawConfig) {
  const storePath = storeFile()
  const stored = readStore(storePath)
  let config = mergeStored(resolveConfig(rawConfig), stored.overrides)
  let language = resolveLanguage(config.language)
  /** Paused by the user from the panel: evaluated at every turn end, never persisted in the log. */
  let paused = stored.paused === true

  let logger = null
  try {
    const factory = optionalService(ctx, 'logger')
    logger = typeof factory === 'function' ? factory(name) : null
  } catch {
    logger = null
  }
  const log = (message) => {
    if (!config.verbose) return
    try {
      if (logger?.info) logger.info(message)
      else console.log(`[${name}] ${message}`)
    } catch {
      /* logging must never break the engine */
    }
  }
  const warn = (message) => {
    try {
      if (logger?.warn) logger.warn(message)
      else console.warn(`[${name}] ${message}`)
    } catch {
      /* ignore */
    }
  }

  /** sessionId -> runtime hint. Rebuilt from incoming events; never persisted. */
  const states = new Map()
  const timers = new Set()

  function stateOf(sessionId) {
    let state = states.get(sessionId)
    if (state === undefined) {
      state = {
        timer: null,
        consecutive: 0,
        attempts: 0,
        ours: new Set(),
        lastTexts: [],
        firstAt: 0,
        /** When the armed continuation fires — the panel counts down to this. */
        pendingAt: 0,
        /** What will be sent: `{ decision, meta }`, kept so the panel can fire it early. */
        pending: null,
        /** The last ending as seen by the engine, for the panel's status line. */
        last: { key: '', code: '', status: '?', message: '', turn: 0, at: 0 },
        /** Newest last, capped: a short trail of why the engine acted or stood down. */
        history: [],
      }
      states.set(sessionId, state)
    }
    return state
  }

  /** Append one line to the panel's trail. Bounded so a long session cannot grow without limit. */
  function record(state, entry) {
    state.history.push({ at: Date.now(), ...entry })
    if (state.history.length > 24) state.history.shift()
  }

  function clearTimer(state) {
    if (state?.timer == null) return
    clearTimeout(state.timer)
    timers.delete(state.timer)
    state.timer = null
  }

  function forget(sessionId) {
    const state = states.get(sessionId)
    if (state === undefined) return
    clearTimer(state)
    states.delete(sessionId)
  }

  function onEvent(session, event) {
    if (session === null || event === null || typeof event !== 'object') return
    const sessionId = session.id

    switch (event.type) {
      case 'turn/start': {
        // Anything that starts a turn — including our own continuation — retires a pending timer.
        const state = states.get(sessionId)
        if (state !== undefined) clearTimer(state)
        return
      }

      case 'user/message': {
        const state = stateOf(sessionId)
        const message = event.data
        const messageId = message?.id
        if (typeof messageId === 'string' && state.ours.has(messageId)) {
          // Our own continuation reached the log: keep the streak, it is not new input.
          state.ours.delete(messageId)
          return
        }
        // Real input from a person: the streak is over and any pending timer is obsolete.
        state.consecutive = 0
        state.attempts = 0
        state.firstAt = 0
        state.lastTexts = []
        clearTimer(state)
        return
      }

      case 'assistant/message': {
        const state = stateOf(sessionId)
        const text = assistantText(event.data?.message)
        if (text === '') return
        state.lastTexts.push(text)
        if (state.lastTexts.length > 12) state.lastTexts.shift()
        return
      }

      case 'turn/end':
        handleTurnEnd(session, event, stateOf(sessionId))
        return

      default:
        return
    }
  }

  function handleTurnEnd(session, event, state) {
    if (!config.enabled) return
    if (session.header?.origin === 'subagent') return
    // A turn ended: whatever was queued for an earlier ending is stale.
    clearTimer(state)
    state.pendingAt = 0
    state.pending = null

    const reason = event.data?.reason
    const decision = decide(reason, config, state)
    const meta = {
      turn: event.data?.turn,
      code: errorLabel(reason),
      status: typeof reason?.error?.status === 'number' ? reason.error.status : '?',
      message: typeof reason?.error?.message === 'string' ? reason.error.message : '',
    }
    state.last = {
      key: decision.key ?? String(reason?.kind ?? 'unknown'),
      code: meta.code,
      status: meta.status,
      message: meta.message,
      turn: typeof meta.turn === 'number' ? meta.turn : 0,
      at: Date.now(),
    }

    if (paused) {
      record(state, { kind: 'paused', key: state.last.key })
      log(`session ${session.id}: paused by the user, ${state.last.key} left alone`)
      return
    }

    if (!decision.continue) {
      if (decision.reset === true) {
        state.consecutive = 0
        state.attempts = 0
        state.firstAt = 0
      }
      record(state, { kind: 'stand-down', key: state.last.key, note: decision.note ?? '' })
      if (decision.note !== undefined) log(`session ${session.id}: ${decision.note}`)
      return
    }

    if (state.consecutive >= config.maxConsecutive) {
      record(state, { kind: 'capped', key: state.last.key, count: state.consecutive })
      log(`session ${session.id}: consecutive limit reached (${state.consecutive}/${config.maxConsecutive})`)
      return
    }

    if (config.loopGuard && isRepeating(state, config.loopRepeatLimit)) {
      record(state, { kind: 'loop-guard', key: state.last.key })
      warn(`session ${session.id}: loop guard stopped the continuation — the assistant repeated itself ${config.loopRepeatLimit} times`)
      return
    }

    const sessionId = session.id
    const delayMs = Math.max(0, Number(decision.delayMs) || 0)
    clearTimer(state)
    record(state, { kind: 'armed', key: decision.key, waitMs: delayMs })
    log(`session ${sessionId}: continuing after ${decision.key} in ${delayMs}ms`)

    state.pending = { decision, meta }
    state.pendingAt = Date.now() + delayMs

    const timer = setTimeout(() => {
      timers.delete(timer)
      state.timer = null
      send(sessionId, decision, meta)
    }, delayMs)
    if (typeof timer.unref === 'function') timer.unref()
    state.timer = timer
    timers.add(timer)
  }

  function send(sessionId, decision, meta, force = false) {
    const state = states.get(sessionId)
    if (state === undefined) return
    state.pendingAt = 0
    state.pending = null
    if (!force && state.consecutive >= config.maxConsecutive) return

    // The session must still be live: a disposed session has no agent to wake.
    let session = null
    try {
      session = ctx.sessions.get(sessionId) ?? null
    } catch {
      session = null
    }
    if (session === null) {
      record(state, { kind: 'dropped', key: decision.key, note: 'session closed' })
      log(`session ${sessionId}: no longer live, continuation dropped`)
      forget(sessionId)
      return
    }

    let agent = null
    try {
      agent = ctx.agents.get(sessionId) ?? null
    } catch {
      agent = null
    }
    if (agent === null || typeof agent.followup !== 'function') {
      record(state, { kind: 'dropped', key: decision.key, note: 'no agent' })
      warn(`session ${sessionId}: the agent is not available, continuation dropped`)
      return
    }

    const reason = decision.key
    const template = pickTemplate(config, language, reason)
    const text = renderText(template, {
      reason,
      code: meta.code,
      status: meta.status,
      message: meta.message,
      turn: meta.turn ?? '?',
      count: state.consecutive + 1,
      limit: config.maxConsecutive,
      elapsed: state.firstAt === 0 ? 0 : Math.round((Date.now() - state.firstAt) / 1000),
    })

    const message = createContinuationMessage(text)
    try {
      agent.followup(message)
    } catch (error) {
      record(state, { kind: 'rejected', key: decision.key, note: String(error?.message ?? error) })
      warn(`session ${sessionId}: the continuation was rejected — ${String(error?.message ?? error)}`)
      return
    }

    state.ours.add(message.id)
    if (state.ours.size > 32) {
      const oldest = state.ours.values().next().value
      if (oldest !== undefined) state.ours.delete(oldest)
    }
    state.consecutive += 1
    // Only error retries grow the backoff; any other continuation proves the provider is back.
    state.attempts = reason === 'error' ? state.attempts + 1 : 0
    if (state.firstAt === 0) state.firstAt = Date.now()
    record(state, { kind: 'sent', key: reason, count: state.consecutive })
    log(`session ${sessionId}: sent continuation #${state.consecutive} (${reason})`)
  }

  function assistantText(message) {
    const content = message?.content
    if (!Array.isArray(content)) return ''
    let text = ''
    for (const block of content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        text += block.text
      }
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, 200)
  }

  /* ------------------------------------------------------------------------ */
  /* Panel API                                                                */
  /* ------------------------------------------------------------------------ */

  const API_PREFIX = '/api/dsh-auto-continue'
  const MUTATION_HEADER = 'x-dsh-auto-continue'
  const MAX_BODY = 64 * 1024

  /** Everything the settings page and the composer banner need, and nothing the log does not have. */
  function publicConfig() {
    const out = {}
    for (const key of Object.keys(FIELD_ROWS)) out[key] = config[key]
    return out
  }

  function persistStore() {
    try {
      writeStore(storePath, { version: STORE_VERSION, paused, overrides: publicConfig() })
      return true
    } catch (error) {
      warn(`panel settings could not be written to ${storePath} — ${String(error?.message ?? error)}`)
      return false
    }
  }

  function snapshotOf(sessionId, state, now) {
    return {
      sessionId,
      consecutive: state.consecutive,
      attempts: state.attempts,
      limit: config.maxConsecutive,
      armed: state.pendingAt > now && state.pending !== null,
      /** True while the armed continuation came from a drill, not from a real turn ending. */
      simulated: state.pending?.simulated === true,
      waitMs: state.pendingAt > now ? state.pendingAt - now : 0,
      nextAt: state.pendingAt > 0 ? state.pendingAt : 0,
      last: state.last,
      lastAt: state.last.at,
      history: state.history.slice(-8).reverse(),
    }
  }

  function describe(sessionId) {
    const now = Date.now()
    const sessions = []
    for (const [id, state] of states) sessions.push(snapshotOf(id, state, now))
    sessions.sort((left, right) => right.lastAt - left.lastAt)
    const current = typeof sessionId === 'string' && sessionId !== ''
      ? sessions.find((entry) => entry.sessionId === sessionId) ?? null
      : sessions[0] ?? null
    return {
      api: API_PREFIX,
      store: storePath,
      paused,
      enabled: config.enabled,
      language,
      config: publicConfig(),
      texts: BUILTIN_TEXTS[language],
      session: current,
      sessions: sessions.slice(0, 10),
    }
  }

  function sessionEntry(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      return null
    }
    return states.get(sessionId) ?? stateOf(sessionId)
  }

  function cancelPending(sessionId) {
    const state = sessionEntry(sessionId)
    if (state === null) return
    clearTimer(state)
    state.pendingAt = 0
    state.pending = null
    record(state, { kind: 'cancelled', key: state.last.key })
  }

  function continueNow(sessionId) {
    const state = sessionEntry(sessionId)
    if (state === null) return false
    const meta = {
      turn: state.last.turn,
      code: state.last.code,
      status: state.last.status,
      message: state.last.message,
    }
    const pending = state.pending?.decision
    const decision = pending ?? { continue: true, key: 'manual', delayMs: 0 }
    clearTimer(state)
    send(sessionId, decision, meta, true)
    return true
  }

  /** Newest live session that is not a subagent: the drill needs a real session to point at. */
  function newestSessionId() {
    try {
      const list = ctx.sessions.list()
      let best = null
      for (const session of list) {
        if (session?.header?.origin === 'subagent') continue
        const createdAt = Number(session?.header?.createdAt) || 0
        if (best === null || createdAt >= best.createdAt) best = { id: session.id, createdAt }
      }
      return best === null ? '' : best.id
    } catch {
      return ''
    }
  }

  /**
   * Arms a continuation the engine did not decide on its own, so the banner can be tried out
   * without waiting for a real limit. `deliver: true` really sends it; the default is a dry run
   * that only shows the countdown and then stands down.
   */
  function simulate(sessionId, options) {
    const target = typeof sessionId === 'string' && sessionId !== '' ? sessionId : newestSessionId()
    if (target === '') {
      throw Object.assign(new Error('no session to drill on'), { statusCode: 409 })
    }
    const state = stateOf(target)
    const requested = typeof options?.reason === 'string' ? options.reason.toLowerCase() : 'max-tokens'
    const reason = DRILL_ALIASES[requested] ?? (DRILL_REASONS.includes(requested) ? requested : 'max-tokens')
    const rawDelay = Number(options?.delayMs)
    const delayMs = clamp(Number.isFinite(rawDelay) && rawDelay >= 0 ? rawDelay : DRILL_DELAY_MS, 0, 600000)
    const deliver = options?.deliver === true

    clearTimer(state)
    const decision = { continue: true, key: reason, delayMs, waitMs: delayMs }
    const meta = { turn: state.last.turn, ...DRILL_FAILURES[reason] }
    state.last = {
      key: reason,
      code: meta.code,
      status: meta.status,
      message: meta.message,
      turn: state.last.turn,
      at: Date.now(),
    }
    state.pending = { decision, meta, simulated: true }
    state.pendingAt = Date.now() + delayMs
    record(state, { kind: 'drill', key: reason, waitMs: delayMs, note: deliver ? 'delivers' : 'dry run' })
    log(`session ${target}: drill armed (${reason}) in ${delayMs}ms${deliver ? ', will deliver' : ', dry run'}`)

    const timer = setTimeout(() => {
      timers.delete(timer)
      state.timer = null
      if (deliver) {
        send(target, decision, meta, true)
        return
      }
      state.pendingAt = 0
      state.pending = null
      record(state, { kind: 'drill-end', key: reason, note: 'dry run finished' })
    }, delayMs)
    if (typeof timer.unref === 'function') timer.unref()
    state.timer = timer
    timers.add(timer)

    return describe(target)
  }

  async function handleAction(request) {
    return runTask(async () => {
      if (request.headers.get(MUTATION_HEADER) !== '1') {
        throw Object.assign(new Error('forbidden mutation request'), { statusCode: 403 })
      }
      const raw = await request.text()
      if (raw.length > MAX_BODY) throw Object.assign(new Error('request body is too large'), { statusCode: 413 })
      let body
      try {
        body = raw === '' ? {} : JSON.parse(raw)
      } catch {
        throw Object.assign(new Error('request body is not valid JSON'), { statusCode: 400 })
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw Object.assign(new Error('request body must be an object'), { statusCode: 400 })
      }
      const action = typeof body.action === 'string' ? body.action : ''
      const sessionId = typeof body.session === 'string' ? body.session : ''

      switch (action) {
        case 'pause':
          paused = true
          persistStore()
          return describe(sessionId)

        case 'resume':
          paused = false
          persistStore()
          return describe(sessionId)

        case 'continue-now':
          continueNow(sessionId)
          return describe(sessionId)

        case 'simulate':
          return simulate(sessionId, {
            reason: body.reason,
            delayMs: body.delayMs,
            deliver: body.deliver === true,
          })

        case 'cancel':
          cancelPending(sessionId)
          return describe(sessionId)

        case 'reset':
          if (sessionId !== '') forget(sessionId)
          return describe(sessionId)

        case 'save': {
          const patch = body.config
          if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
            throw Object.assign(new Error('config must be an object'), { statusCode: 400 })
          }
          config = resolveConfig({ ...config, ...patch })
          language = resolveLanguage(config.language)
          persistStore()
          return describe(sessionId)
        }

        default:
          throw Object.assign(new Error(`unknown action: ${action}`), { statusCode: 400 })
      }
    })
  }

  async function runTask(task) {
    try {
      return jsonResponse(200, { ok: true, data: await task() })
    } catch (error) {
      const status = typeof error?.statusCode === 'number' ? error.statusCode : 500
      return jsonResponse(status, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: error?.code,
      })
    }
  }

  /**
   * Panel routes. `connection` and `webServer` matter only to the panel, so they are waited on
   * through nested fibers: cordis refuses a read of a service the plugin did not inject, and a
   * profile without an HTTP carrier must never park the engine itself.
   */
  const routes = [
    {
      path: `${API_PREFIX}/state`,
      methods: ['GET', 'HEAD'],
      fetch: (request) =>
        runTask(() => {
          let session = ''
          try {
            session = new URL(request.url).searchParams.get('session') ?? ''
          } catch {
            session = ''
          }
          return Promise.resolve(describe(session))
        }),
    },
    {
      path: `${API_PREFIX}/action`,
      methods: ['POST'],
      fetch: (request) => handleAction(request),
    },
  ]

  /**
   * Set once a carrier has taken the routes. Both carriers answer under the same prefix, so only
   * one of them may be wired: the fetch carrier wins, the prefix route is the fallback.
   */
  ctx.inject(['connection', 'webServer'], (scoped) => {
    scoped.effect(() => {
      const disposers = []
      let webFallback

      const carrier = scoped.connection
      const registerFetch = carrier?.fetch?.register
      if (typeof registerFetch === 'function') {
        for (const route of routes) {
          try {
            disposers.push(registerFetch.call(carrier.fetch, { ...route, requestBody: 'buffered' }))
          } catch (error) {
            warn(`could not register ${route.path} — ${String(error?.message ?? error)}`)
          }
        }
      }

      if (disposers.length === 0) {
        const server = scoped.webServer
        if (typeof server?.register === 'function') {
          try {
            webFallback = server.register({
              kind: 'prefix',
              path: API_PREFIX,
              handler: (request, response) => adaptNodeRequest(routes, request, response, MAX_BODY),
            })
          } catch (error) {
            warn(`could not register the fallback web route — ${String(error?.message ?? error)}`)
          }
        }
      }

      if (disposers.length > 0) {
        console.log(`[${name}] panel ready — ${String(disposers.length)} route(s) on ${API_PREFIX}`)
      } else if (typeof webFallback === 'function') {
        console.log(`[${name}] panel ready — web server fallback on ${API_PREFIX}`)
      } else {
        warn(`panel routes are unavailable — the engine keeps running without them`)
      }

      return () => {
        for (const dispose of [...disposers, webFallback]) {
          try {
            if (typeof dispose === 'function') dispose()
          } catch {
            /* a carrier that refuses to close must not block the others */
          }
        }
      }
    })
  })

  /**
   * The command surface. Registering a command is the only way to reach the engine from the
   * composer without spending a real limit, so `/auto-continue simular` is the documented drill.
   */
  ctx.inject(['commands'], (scoped) => {
    scoped.effect(() => {
      const dispose = scoped.commands.register({
        name: 'auto-continue',
        description: 'Drive the auto-continue engine: drill the banner, inspect state, pause or resume.',
        input: { hint: 'simular [motivo] [segundos] [enviar] | estado | ahora | pausar | reanudar | cancelar | reiniciar' },
        recordInput: true,
        handler: (invocation) => {
          const say = (es, en) => ({ kind: 'success', text: language === 'es' ? es : en })
          const fail = (es, en) => ({ kind: 'error', text: language === 'es' ? es : en })
          const words = String(invocation?.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
          const verb = (words[0] ?? '').toLowerCase()
          const sessionId = typeof invocation?.agent?.id === 'string' ? invocation.agent.id : ''

          if (verb === '' || verb === 'help' || verb === 'ayuda') {
            return say(
              'Continuación automática.\n'
                + '  /auto-continue simular [tokens|limite|error|interrumpido|completado] [segundos] [enviar]\n'
                + '      Arma una continuación de prueba y la enseña en la banda. Sin «enviar» no manda nada.\n'
                + '  /auto-continue estado · ahora · pausar · reanudar · cancelar · reiniciar',
              'Auto-continue.\n'
                + '  /auto-continue drill [max-tokens|rate-limit|error|interrupted|completed] [seconds] [send]\n'
                + '      Arms a test continuation and shows it in the banner. Without "send" nothing is sent.\n'
                + '  /auto-continue state · now · pause · resume · cancel · reset',
            )
          }

          if (verb === 'simular' || verb === 'simulate' || verb === 'drill' || verb === 'prueba' || verb === 'probar' || verb === 'test') {
            const rest = words.slice(1)
            const deliver = rest.some((word) => ['enviar', 'send', 'real', 'de verdad'].includes(word.toLowerCase()))
            let seconds = null
            let reasonWord = ''
            for (const word of rest) {
              const value = Number(word)
              if (Number.isFinite(value) && value > 0) seconds = value
              else if (reasonWord === '' && !['enviar', 'send', 'real'].includes(word.toLowerCase())) reasonWord = word
            }
            const delayMs = seconds === null ? DRILL_DELAY_MS : Math.round(seconds * 1000)
            try {
              const snapshot = simulate(sessionId, { reason: reasonWord, delayMs, deliver })
              const wait = Math.round((snapshot?.session?.waitMs ?? delayMs) / 1000)
              const who = snapshot?.session?.sessionId ?? ''
              return say(
                `Prueba armada (${reasonWord === '' ? 'tokens' : reasonWord}) — la banda aparece en ${String(wait)} s`
                  + (deliver ? ' y se enviará de verdad.' : ', sin enviar nada.')
                  + (who === '' ? '' : `\nSesión: ${who}`),
                `Drill armed (${reasonWord === '' ? 'max-tokens' : reasonWord}) — the banner shows up in ${String(wait)} s`
                  + (deliver ? ' and really sends.' : ', nothing is sent.')
                  + (who === '' ? '' : `\nSession: ${who}`),
              )
            } catch (error) {
              return fail(
                `No se pudo armar la prueba: ${String(error?.message ?? error)}`,
                `Could not arm the drill: ${String(error?.message ?? error)}`,
              )
            }
          }

          if (verb === 'estado' || verb === 'state' || verb === 'status') {
            const target = sessionId !== '' ? sessionId : newestSessionId()
            const state = target === '' ? undefined : states.get(target)
            const snapshot = state === undefined ? null : snapshotOf(target, state, Date.now())
            if (snapshot === null) {
              return say('Sin actividad todavía en esta sesión.', 'No activity in this session yet.')
            }
            const suffix = snapshot.armed
              ? (snapshot.simulated ? ' · prueba armada' : ' · continuación armada')
              : ''
            return say(
              `Estado: racha ${String(snapshot.consecutive)}/${String(snapshot.limit)} · última parada ${snapshot.last.key || '—'}${suffix}${paused ? ' · en pausa' : ''}`,
              `State: streak ${String(snapshot.consecutive)}/${String(snapshot.limit)} · last stop ${snapshot.last.key || '—'}${suffix}${paused ? ' · paused' : ''}`,
            )
          }

          if (verb === 'ahora' || verb === 'now') {
            const target = sessionId !== '' ? sessionId : newestSessionId()
            if (target === '') return fail('No hay sesión que continuar.', 'There is no session to continue.')
            continueNow(target)
            return say('Continuación enviada.', 'Continuation sent.')
          }

          if (verb === 'pausar' || verb === 'pause') {
            paused = true
            persistStore()
            return say('Continuación automática en pausa.', 'Auto-continue is paused.')
          }

          if (verb === 'reanudar' || verb === 'resume') {
            paused = false
            persistStore()
            return say('Continuación automática activa.', 'Auto-continue is on.')
          }

          if (verb === 'cancelar' || verb === 'cancel') {
            const target = sessionId !== '' ? sessionId : newestSessionId()
            if (target !== '') cancelPending(target)
            return say('Continuación pendiente cancelada.', 'Pending continuation cancelled.')
          }

          if (verb === 'reiniciar' || verb === 'reset' || verb === 'limpiar') {
            const target = sessionId !== '' ? sessionId : newestSessionId()
            if (target !== '') forget(target)
            return say('Estado de la sesión limpiado.', 'Session state cleared.')
          }

          return fail(
            `Orden desconocida: ${verb}. Usa /auto-continue para ver la ayuda.`,
            `Unknown command: ${verb}. Run /auto-continue for help.`,
          )
        },
      })
      console.log(`[${name}] command ready — /auto-continue`)
      return dispose
    })
  })

  ctx.on('session/event', onEvent)
  ctx.on('session/disposed', (session) => {
    if (session === null || typeof session.id !== 'string') return
    forget(session.id)
  })

  ctx.effect(() => () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    for (const state of states.values()) state.timer = null
    states.clear()
  })

  // Activation states the effective configuration once: the panel shows it live, but a boot line
  // in the host log is still the fastest way to see what the patch row resolved to.
  try {
    const active = []
    if (config.continueOnMaxTokens) active.push('max-tokens')
    if (config.continueOnInterrupted) active.push('interrupted')
    if (config.continueOnError) active.push('error + rate-limit')
    if (config.continueOnCompleted) active.push('completed')
    const ready = `ready${paused ? ' (paused)' : ''} — language: ${language}, continuing after: ${active.join(', ') || 'nothing'}, `
      + `max consecutive: ${config.maxConsecutive}, grace: ${config.graceMs}ms, cooldown: ${config.cooldownMs}ms`
    if (logger?.info) logger.info(ready)
    else console.log(`[${name}] ${ready}`)
  } catch {
    /* activation logging must never break the engine */
  }
}
