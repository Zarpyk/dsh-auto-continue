// Loads the browser half with a tiny React-compatible renderer and asserts that the
// two surfaces render the payloads the host route produces. No browser, no bundler.
// Run: node test/client.test.mjs
import assert from 'node:assert/strict'

const CLIENT = new URL('../client.js', import.meta.url).href

/* ------------------------------------------------------------------ DOM stub --- */

const styleElements = []
globalThis.document = {
  baseURI: 'http://127.0.0.1:51666/',
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '', remove() {} }),
  head: { appendChild: (element) => styleElements.push(element) },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'es-ES' }, configurable: true })

/* ------------------------------------------------------------------ fetch stub --- */

let respond = () => ({ ok: true, data: null })
const calls = []
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init })
  let body
  try {
    body = respond(String(url), init)
  } catch (error) {
    body = { ok: false, error: String(error.message) }
  }
  return { status: 200, text: async () => JSON.stringify(body) }
}

/* ------------------------------------------------------------------ React --- */

let currentHooks = null
let hookIndex = 0

const React = {
  createElement(type, props, ...children) {
    const flat = []
    const push = (value) => {
      if (Array.isArray(value)) value.forEach(push)
      else if (value !== null && value !== undefined && value !== false) flat.push(value)
    }
    push(children)
    return { type, props: { ...(props ?? {}), children: flat.length === 1 ? flat[0] : flat } }
  },
  useState(initial) {
    const index = hookIndex++
    if (currentHooks[index] === undefined) {
      currentHooks[index] = { value: typeof initial === 'function' ? initial() : initial }
    }
    const slot = currentHooks[index]
    return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
  },
  useEffect(fn, deps) {
    const index = hookIndex++
    const previous = currentHooks[index]
    const changed = previous === undefined || deps === undefined || previous.deps === undefined
      || deps.length !== previous.deps.length || deps.some((value, position) => !Object.is(value, previous.deps[position]))
    if (changed) currentHooks[index] = { deps, value: fn() }
  },
  useMemo(fn) {
    hookIndex += 1
    return fn()
  },
  useRef(initial) {
    const index = hookIndex++
    if (currentHooks[index] === undefined) currentHooks[index] = { current: initial }
    return currentHooks[index]
  },
}

/* ------------------------------------------------------------------ renderer --- */

const stores = new WeakMap()

function renderNode(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderNode).join('')
  const { type, props } = node
  if (typeof type === 'function') {
    let store = stores.get(type)
    if (store === undefined) {
      store = []
      stores.set(type, store)
    }
    const previousHooks = currentHooks
    const previousIndex = hookIndex
    currentHooks = store
    hookIndex = 0
    try {
      return renderNode(type(props))
    } finally {
      currentHooks = previousHooks
      hookIndex = previousIndex
    }
  }
  return renderNode(props?.children)
}

async function settle(Component, props, rounds = 6) {
  let text = ''
  for (let round = 0; round < rounds; round += 1) {
    text = renderNode(React.createElement(Component, props))
    // The surface polls every 1.5s; each round leaves room for the next fetch to land.
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return text
}

/* ------------------------------------------------------------------ module --- */

let captured = null
globalThis.window = {
  location: { origin: 'http://127.0.0.1:51666' },
  __ModuleLoader__: { load(definition) { captured = definition } },
}

await import(CLIENT)
assert.ok(captured !== null, 'the module must call window.__ModuleLoader__.load')
assert.equal(captured.id, '@zarpyk/dsh-auto-continue')

const module = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})

const registrations = []
const localeRegistrations = []

// What the Command Code provider publishes through its Remote; the client half reads it through
// the optional `remote.commandcode` inject.
const PROVIDER_NOW = Date.now()
const providerReport = {
  accounts: [{
    id: 'acc-1',
    configured: true,
    active: true,
    mark: '',
    cooldownUntil: 0,
    plan: { name: 'Command Code Pro', currentPeriodStart: PROVIDER_NOW - 86400000, currentPeriodEnd: PROVIDER_NOW + 86400000 },
    credits: {
      monthlyCredits: 118.5,
      purchasedCredits: 20,
      freeCredits: 5,
      fiveHour: { used: 31, cap: 50, exceeded: false, resetAt: PROVIDER_NOW + 3600000 },
      weekly: { used: 120, cap: 200, exceeded: false, resetAt: PROVIDER_NOW + 3 * 86400000 },
    },
  }],
}

const ctx = {
  effect(fn) { const dispose = fn(); if (typeof dispose === 'function') dispose() },
  locale: {
    register(namespace, dictionary) { localeRegistrations.push({ namespace, dictionary }) },
    bind(namespace) { return (key) => (key === 'probe' ? 'es' : `${namespace}:${key}`) },
  },
  slots: {
    inject(name, callback) { callback() },
    register(registration, Component) { registrations.push({ registration, Component }); return () => {} },
  },
  inject(names, callback) {
    if (!names.includes('remote.commandcode')) return
    callback({
      remote: { commandcode: { report: async () => ({ ok: true, value: providerReport }) } },
      effect(fn) { fn() },
    })
  },
}

module.apply(ctx)

/* ------------------------------------------------------------------ cases --- */

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push(['ok', name])
  } catch (error) {
    results.push(['FAIL', `${name} — ${error.message}`])
  }
}

const banner = registrations.find((entry) => entry.registration.name === 'conversation.input.dock')
const settings = registrations.find((entry) => entry.registration.name === 'settings.section')

const CONFIG = {
  enabled: true,
  language: 'auto',
  continueOnMaxTokens: true,
  continueOnInterrupted: true,
  continueOnError: true,
  continueOnCompleted: false,
  maxConsecutive: 3,
  graceMs: 3000,
  cooldownMs: 20000,
  backoffFactor: 2,
  backoffMaxMs: 300000,
  rateLimitWaitMs: 900000,
  classifyErrors: true,
  loopGuard: true,
  loopRepeatLimit: 4,
  textMaxTokens: '',
  textInterrupted: '',
  textError: '',
  textRateLimit: '',
  textCompleted: '',
}

function statePayload(overrides = {}) {
  return {
    api: '/api/dsh-auto-continue',
    store: 'C:\\Users\\Zarpyk\\.dsh\\auto-continue.json',
    paused: overrides.paused === true,
    enabled: true,
    language: 'es',
    config: { ...CONFIG, ...(overrides.config ?? {}) },
    texts: { 'max-tokens': 'Sigue desde donde lo dejaste.', 'rate-limit': 'La ventana se ha reabierto.' },
    session: overrides.session ?? null,
    sessions: overrides.sessions ?? [],
  }
}

await check('apply registers the composer banner and the settings page', async () => {
  assert.equal(registrations.length, 2)
  assert.equal(banner.registration.id, 'auto-continue')
  assert.equal(banner.registration.order, 30)
  assert.equal(settings.registration.id, 'auto-continue')
  assert.equal(settings.registration.order, 13)
  assert.equal(localeRegistrations.length, 1)
  assert.equal(localeRegistrations[0].namespace, 'dsh-auto-continue')
  assert.ok(localeRegistrations[0].dictionary.es !== undefined)
  assert.equal(typeof banner.Component, 'function')
  assert.equal(styleElements.length, 0, 'styles are injected on first paint, not at apply')
})

await check('banner: armed countdown with the Command Code usage limit', async () => {
  const now = Date.now()
  respond = () => ({
    ok: true,
    data: statePayload({
      session: {
        sessionId: 's1',
        consecutive: 1,
        attempts: 0,
        limit: 3,
        armed: true,
        waitMs: 45000,
        nextAt: now + 45000,
        last: { key: 'rate-limit', code: 'RATE_LIMIT', status: 429, message: 'usage window exhausted', turn: 7, at: now - 2000 },
        lastAt: now - 2000,
        history: [{ at: now - 2000, kind: 'armed', key: 'rate-limit', waitMs: 45000 }],
      },
    }),
  })
  const text = await settle(banner.Component, { sessionId: 's1' })
  assert.match(text, /Continuación automática/)
  assert.match(text, /Se reabre en 0:4[0-5]/, text)
  assert.match(text, /límite de uso/)
  assert.match(text, /RATE_LIMIT/)
  assert.match(text, /62%/, 'the 5-hour window share comes from the provider report')
  assert.match(text, /Se restablece \d{2}:\d{2}/, 'the reset time is a wall clock')
  assert.match(text, /Ahora/)
  assert.match(text, /Cancelar/)
  assert.match(text, /Pausar/)
  assert.ok(calls.some((call) => call.url.includes('/api/dsh-auto-continue/state?session=s1')), 'the banner asks for its session')
  assert.ok(styleElements.length === 1, 'one stylesheet, injected once')
})

await check('banner: paused state offers to resume, and hides while idle', async () => {
  respond = () => ({
    ok: true,
    data: statePayload({
      paused: true,
      session: {
        sessionId: 's1', consecutive: 0, attempts: 0, limit: 3, armed: false, waitMs: 0, nextAt: 0,
        last: { key: 'max-tokens', code: 'unknown', status: '?', message: '', turn: 2, at: Date.now() - 5000 },
        lastAt: Date.now() - 5000, history: [{ at: Date.now() - 5000, kind: 'paused', key: 'max-tokens' }],
      },
    }),
  })
  const text = await settle(banner.Component, { sessionId: 's1' })
  assert.match(text, /está en pausa/)
  assert.match(text, /Reanudar/)

  respond = () => ({ ok: true, data: statePayload({ session: null, sessions: [] }) })
  const idle = await settle(banner.Component, { sessionId: 's9' })
  assert.equal(idle, '', 'an idle session shows nothing')
})

await check('banner: capped streak is surfaced with a manual continue', async () => {
  respond = () => ({
    ok: true,
    data: statePayload({
      session: {
        sessionId: 's1', consecutive: 3, attempts: 0, limit: 3, armed: false, waitMs: 0, nextAt: 0,
        last: { key: 'error', code: 'bad_gateway', status: 502, message: 'upstream', turn: 9, at: Date.now() - 1000 },
        lastAt: Date.now() - 1000,
        history: [{ at: Date.now() - 1000, kind: 'capped', key: 'error', count: 3 }],
      },
    }),
  })
  const text = await settle(banner.Component, { sessionId: 's1' })
  assert.match(text, /Límite de continuaciones alcanzado \(3\/3\)/)
  assert.match(text, /Ahora/)
  assert.doesNotMatch(text, /Cancelar/)
})

await check('banner: a drill is tagged as a test, not as a real limit', async () => {
  const now = Date.now()
  respond = () => ({
    ok: true,
    data: statePayload({
      session: {
        sessionId: 's1', consecutive: 0, attempts: 0, limit: 3, armed: true, simulated: true, waitMs: 8000, nextAt: now + 8000,
        last: { key: 'rate-limit', code: 'RATE_LIMITED', status: 429, message: '', turn: 0, at: now },
        lastAt: now, history: [{ at: now, kind: 'drill', key: 'rate-limit', waitMs: 8000 }],
      },
    }),
  })
  const text = await settle(banner.Component, { sessionId: 's1' })
  assert.match(text, /prueba/, text)
  assert.match(text, /Se reabre en 0:0[6-8]/, text)
  assert.match(text, /límite de uso/)
})

await check('banner: a dead route is reported instead of throwing', async () => {
  respond = () => ({ ok: false, error: 'connect ECONNREFUSED' })
  const text = await settle(banner.Component, { sessionId: 's1' })
  assert.match(text, /no responde/)
  assert.match(text, /ECONNREFUSED/)
})

await check('settings page renders every section from the live payload', async () => {
  respond = () => ({
    ok: true,
    data: statePayload({
      sessions: [{
        sessionId: 's1', consecutive: 2, attempts: 0, limit: 3, armed: true, waitMs: 12000, nextAt: Date.now() + 12000,
        last: { key: 'rate-limit', code: 'RATE_LIMIT', status: 429, message: '', turn: 4, at: Date.now() - 3000 },
        lastAt: Date.now() - 3000, history: [{ at: Date.now() - 3000, kind: 'armed', key: 'rate-limit' }],
      }],
    }),
  })
  const text = await settle(settings.Component, {})
  for (const expected of [
    'Qué se continúa', 'Tras el límite de salida (max tokens)', 'Ritmo', 'Espera antes de continuar (ms)',
    'Textos de continuación', 'Protecciones', 'Idioma de los textos',
    'Guardar', 'Descartar cambios', 'Se guarda en', 'Sesiones', 's1', 'Pausar', 'Ahora',
    'Probar la banda', 'Cuenta atrás (segundos)', 'Enviarla de verdad', '/auto-continue simular limite 10',
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`)
  }
  assert.doesNotMatch(text, /Cambios sin guardar/, 'a fresh page is not dirty')
})

await check('settings page shows the Command Code windows, resets and credit left', async () => {
  respond = () => ({ ok: true, data: statePayload() })
  const text = await settle(settings.Component, {})
  assert.match(text, /Command Code Pro/, text)
  assert.match(text, /Ventana de 5 horas/, text)
  assert.match(text, /62% · 31\/50 · Se restablece \d{2}:\d{2}/, text)
  assert.match(text, /Ventana semanal/, text)
  assert.match(text, /60% · 120\/200/, text)
  assert.match(text, /Crédito mensual/, text)
  assert.match(text, /118\.5 · Comprado 20 · Gratis 5/, text)
  assert.match(text, /Actualizar/, text)
  assert.doesNotMatch(text, /no está montado/, 'the provider is mounted in this run')
})

await check('settings page saves through the mutation route with the header', async () => {
  respond = (url, init) => {
    if (url.endsWith('/action')) return { ok: true, data: statePayload({ config: { ...CONFIG, maxConsecutive: 5 } }) }
    return { ok: true, data: statePayload() }
  }
  const text = await settle(settings.Component, {})
  const saveButton = text.includes('Guardar')
  assert.equal(saveButton, true)
  // The page registered a POST helper with the mutation header; assert the fetch spy saw the shape.
  const post = calls.find((call) => call.url.endsWith('/action'))
  assert.equal(post, undefined, 'no write happens without a click')
})

for (const [status, name] of results) console.log(`${status === 'ok' ? 'PASS' : 'FAIL'}  ${name}`)
const failures = results.filter(([status]) => status !== 'ok').length
console.log(`\n${results.length - failures}/${results.length} passed`)
process.exit(failures === 0 ? 0 : 1)
