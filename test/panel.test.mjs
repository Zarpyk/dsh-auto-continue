// Rate-limit handling, the runtime store, and the panel HTTP API.
// Run: node test/panel.test.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A throwaway HOME, so a run never touches the real $DSH_HOME.
const HOME = mkdtempSync(join(tmpdir(), 'auto-continue-panel-'))
process.env.DSH_HOME = HOME

const pluginPath = new URL('../index.js', import.meta.url).href
const plugin = await import(pluginPath)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeHost() {
  const listeners = { 'session/event': [], 'session/disposed': [] }
  const agents = new Map()
  const sessions = new Map()
  const sent = []
  const routes = new Map()
  const disposers = []
  const ctx = {
    on(name, cb) { listeners[name].push(cb) },
    effect(fn) { disposers.push(fn()) },
    inject(names, callback) {
      if (names.every((name) => ctx[name] !== undefined)) callback(ctx)
    },
    logger: () => ({ info() {}, warn() {} }),
    agents: { get(id) { return agents.get(id) ?? undefined } },
    sessions: {
      get(id) { return sessions.get(id) ?? undefined },
      list() { return [...sessions.values()] },
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
    },
    webServer: {
      register(definition) {
        routes.set(`prefix:${definition.path}`, definition)
        return () => routes.delete(`prefix:${definition.path}`)
      },
    },
  }
  ctx.__dispose = () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        /* a carrier that refuses to close must not hide the others */
      }
    }
  }
  function addSession(id) {
    const session = { id, header: { id } }
    sessions.set(id, session)
    agents.set(id, { followup(message) { sent.push({ id, message }) } })
    return session
  }
  function emit(session, event) {
    for (const cb of listeners['session/event']) cb(session, event)
  }
  return { ctx, emit, addSession, sent, routes }
}

function turnEnd(turn, reason) {
  return { type: 'turn/end', seq: 1, time: Date.now(), data: { turn, reason } }
}

async function getState(routes, session = 's1') {
  const route = routes.get('/api/dsh-auto-continue/state')
  const response = await route.fetch(new Request(`http://127.0.0.1:1/api/dsh-auto-continue/state?session=${session}`, { method: 'GET' }))
  return response.json()
}

async function action(routes, body, header = '1') {
  const route = routes.get('/api/dsh-auto-continue/action')
  const response = await route.fetch(new Request('http://127.0.0.1:1/api/dsh-auto-continue/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-auto-continue': header },
    body: JSON.stringify(body),
  }))
  return { status: response.status, body: await response.json() }
}

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push(['ok', name])
  } catch (error) {
    results.push(['FAIL', `${name} — ${error.message}`])
  }
}

const commandCodeLimit = {
  message: 'llm-commandcode: all 2 Command Code account(s) have exhausted their usage window; the earliest window resets at 2026-11-03T16:00:00.000Z — requests will succeed again after the reset',
  code: 'RATE_LIMIT',
  status: 429,
  providerRetryAfterMs: 5000,
}

// 1. Command Code usage window → its own decision, armed for the published reset
await check('Command Code usage window → rate-limit armed at the published reset', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  const session = host.addSession('s1')
  host.emit(session, turnEnd(3, { kind: 'error', error: commandCodeLimit }))
  const { data } = await getState(host.routes)
  assert.equal(data.session.last.key, 'rate-limit')
  assert.equal(data.session.last.code, 'RATE_LIMIT')
  assert.equal(data.session.armed, true)
  assert.ok(data.session.waitMs > 4000 && data.session.waitMs <= 5000, `wait ${data.session.waitMs}`)
  host.ctx.__dispose?.()
})

// 2. A reset further away than the configured cap is still capped
await check('rate limit wait is capped by rateLimitWaitMs', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, rateLimitWaitMs: 1000 })
  const session = host.addSession('s1')
  host.emit(session, turnEnd(3, { kind: 'error', error: { ...commandCodeLimit, providerRetryAfterMs: 600000 } }))
  const { data } = await getState(host.routes)
  assert.equal(data.session.armed, true)
  assert.ok(data.session.waitMs <= 1000, `wait ${data.session.waitMs}`)
  host.ctx.__dispose?.()
})

// 3. A plain "usage limit" message with no code and no status is still a window, not a fault
await check('usage limit message without a code → rate-limit', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'es', graceMs: 0, cooldownMs: 60000 })
  const session = host.addSession('s1')
  host.emit(session, turnEnd(2, { kind: 'error', error: { message: 'usage limit for your plan reached' } }))
  const { data } = await getState(host.routes)
  assert.equal(data.session.last.key, 'rate-limit')
  // The backoff (60s) is used because the provider published no reset.
  assert.ok(data.session.waitMs > 50000, `wait ${data.session.waitMs}`)
  host.ctx.__dispose?.()
})

// 4. Pause is honoured at the next turn end and survives a restart through the store
await check('pause blocks continuations and persists in the store', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  const session = host.addSession('s1')
  const paused = await action(host.routes, { action: 'pause', session: 's1' })
  assert.equal(paused.status, 200)
  assert.equal(paused.body.data.paused, true)

  host.emit(session, turnEnd(4, { kind: 'max-tokens' }))
  const { data } = await getState(host.routes)
  assert.equal(data.session.armed, false)
  assert.equal(data.session.history[0].kind, 'paused')

  const stored = JSON.parse(readFileSync(join(HOME, 'auto-continue.json'), 'utf8'))
  assert.equal(stored.paused, true)
  assert.equal(stored.version, 1)
  host.ctx.__dispose?.()

  const again = makeHost()
  plugin.apply(again.ctx, { language: 'en', graceMs: 0 })
  const resumed = await getState(again.routes)
  assert.equal(resumed.data.paused, true, 'the store must restore the pause')
  again.ctx.__dispose?.()
})

// 5. Settings saved from the page clamp, persist, and win over the patch row on the next boot
await check('save clamps, persists, and outranks the patch row', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  const saved = await action(host.routes, { action: 'save', config: { maxConsecutive: 900, language: 'es', graceMs: -20 } })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.data.config.maxConsecutive, 100)
  assert.equal(saved.body.data.config.graceMs, 0)
  assert.equal(saved.body.data.language, 'es')
  host.ctx.__dispose?.()

  const again = makeHost()
  plugin.apply(again.ctx, { language: 'en', maxConsecutive: 1 })
  const { data } = await getState(again.routes)
  assert.equal(data.config.maxConsecutive, 100, 'the stored value must win')
  assert.equal(data.language, 'es')
  again.ctx.__dispose?.()
  // Later cases start from the patch row again: the store is what outranks it, by design.
  rmSync(join(HOME, 'auto-continue.json'), { force: true })
})

// 6. "Continue now" fires immediately, even when the consecutive cap is reached
await check('continue-now forces a manual continuation past the cap', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 60000, maxConsecutive: 0 })
  const session = host.addSession('s1')
  host.emit(session, turnEnd(5, { kind: 'max-tokens' }))
  const before = await getState(host.routes)
  assert.equal(before.data.session.armed, false)

  const fired = await action(host.routes, { action: 'continue-now', session: 's1' })
  assert.equal(fired.status, 200)
  assert.equal(host.sent.length, 1)
  const text = host.sent[0].message.content[0].text
  assert.match(text, /pending part of the task/)
  assert.equal(host.sent[0].message.source.kind, 'user')
  host.ctx.__dispose?.()
})

// 7. Cancel disarms without sending
await check('cancel disarms the pending continuation', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 60000 })
  const session = host.addSession('s1')
  host.emit(session, turnEnd(6, { kind: 'max-tokens' }))
  const armed = await getState(host.routes)
  assert.equal(armed.data.session.armed, true)

  const cancelled = await action(host.routes, { action: 'cancel', session: 's1' })
  assert.equal(cancelled.body.data.session.armed, false)
  assert.equal(host.sent.length, 0)
  host.ctx.__dispose?.()
})

// 8. The mutation header is required, and unknown actions are refused
await check('action endpoint refuses a missing header and an unknown action', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, {})
  const forbidden = await action(host.routes, { action: 'pause' }, '0')
  assert.equal(forbidden.status, 403)
  const unknown = await action(host.routes, { action: 'nope' })
  assert.equal(unknown.status, 400)
  host.ctx.__dispose?.()
})

// 9. No HTTP carrier: activation still works and nothing throws
await check('no HTTP carrier → engine still applies', async () => {
  const listeners = []
  const ctx = {
    on(name, cb) { listeners.push([name, cb]) },
    effect(fn) { ctx.__dispose = fn() },
    inject(names, callback) {
      if (names.every((name) => ctx[name] !== undefined)) callback(ctx)
    },
    logger: () => ({ info() {}, warn() {} }),
  }
  plugin.apply(ctx, {})
  assert.equal(listeners.length, 2)
  ctx.__dispose?.()
})

// 10. The drill arms the banner without sending anything
await check('drill arms the banner and stands down without sending', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, maxConsecutive: 0 })
  const session = host.addSession('s1')
  host.emit(session, turnEnd(1, { kind: 'aborted', reason: { kind: 'user' } }))
  const armed = await action(host.routes, { action: 'simulate', session: 's1', reason: 'rate-limit', delayMs: 60 })
  assert.equal(armed.status, 200)
  assert.equal(armed.body.data.session.armed, true)
  assert.equal(armed.body.data.session.simulated, true)
  assert.equal(armed.body.data.session.last.key, 'rate-limit')
  assert.equal(armed.body.data.session.last.code, 'RATE_LIMITED')
  assert.equal(armed.body.data.session.history[0].kind, 'drill')

  await sleep(160)
  const after = await getState(host.routes)
  assert.equal(after.data.session.armed, false)
  assert.equal(host.sent.length, 0, 'a dry run must not send')
  assert.equal(after.data.session.history[0].kind, 'drill-end')
  host.ctx.__dispose?.()
})

// 11. The drill can deliver for real, past the consecutive cap, so the whole path is exercised
await check('drill with deliver sends one real continuation', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'es', graceMs: 0, maxConsecutive: 0 })
  const session = host.addSession('s1')
  const armed = await action(host.routes, { action: 'simulate', session: 's1', reason: 'error', delayMs: 20, deliver: true })
  assert.equal(armed.body.data.session.simulated, true)
  await sleep(120)
  assert.equal(host.sent.length, 1)
  assert.equal(host.sent[0].message.source.kind, 'user')
  assert.match(host.sent[0].message.content[0].text, /error recuperable|recoverable/i)
  host.ctx.__dispose?.()
})

// 12. Without a session the drill picks the newest live one, so the settings page needs no id
await check('drill without a session targets the newest live session', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  host.addSession('old').header.createdAt = 1000
  host.addSession('new').header.createdAt = 2000
  const armed = await action(host.routes, { action: 'simulate', reason: 'max-tokens', delayMs: 5000 })
  assert.equal(armed.status, 200)
  assert.equal(armed.body.data.session.sessionId, 'new')
  assert.equal(armed.body.data.session.armed, true)
  host.ctx.__dispose?.()
})

// 13. Reason aliases and junk resolve to something usable
await check('drill normalizes aliases and unknown reasons', async () => {
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  host.addSession('s1')
  const alias = await action(host.routes, { action: 'simulate', session: 's1', reason: 'limite', delayMs: 5000 })
  assert.equal(alias.body.data.session.last.key, 'rate-limit')
  const junk = await action(host.routes, { action: 'simulate', session: 's1', reason: 'klingon', delayMs: 5000 })
  assert.equal(junk.body.data.session.last.key, 'max-tokens')
  host.ctx.__dispose?.()
})

// 14. The slash command drives the same engine: drill, state, pause, and an unknown verb
await check('the /auto-continue command drives the engine', async () => {
  const host = makeHost()
  const registry = new Map()
  host.ctx.commands = {
    register(definition) {
      registry.set(definition.name, definition)
      return () => registry.delete(definition.name)
    },
  }
  plugin.apply(host.ctx, { language: 'es', graceMs: 0 })
  host.addSession('s1').header.createdAt = 5
  const command = registry.get('auto-continue')
  assert.ok(command, 'the command must be registered')
  const run = (line) => command.handler({ agent: { id: 's1' }, rawInput: line, attachments: [], commandId: 'c1' })

  const drilled = await run('simular limite 7')
  assert.equal(drilled.kind, 'success')
  assert.match(drilled.text, /Prueba armada/)
  const state = await getState(host.routes)
  assert.equal(state.data.session.last.key, 'rate-limit')
  assert.equal(state.data.session.simulated, true)

  const status = await run('estado')
  assert.match(status.text, /Estado: racha/)

  const paused = await run('pausar')
  assert.match(paused.text, /pausa/)
  assert.equal((await getState(host.routes)).data.paused, true)

  const unknown = await run('bailar')
  assert.equal(unknown.kind, 'error')
  const help = await run('')
  assert.match(help.text, /\/auto-continue simular/)
  host.ctx.__dispose?.()
  assert.equal(registry.size, 0, 'the command must be unregistered with the plugin')
})

for (const [status, name] of results) console.log(`${status === 'ok' ? 'PASS' : 'FAIL'}  ${name}`)
const failures = results.filter(([status]) => status !== 'ok').length
console.log(`\n${results.length - failures}/${results.length} passed`)
process.exit(failures === 0 ? 0 : 1)
