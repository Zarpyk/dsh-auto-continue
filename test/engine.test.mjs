// Drives the host half with a fake Host context and asserts every decision it takes.
// Run: node test/engine.test.mjs
import assert from 'node:assert/strict'

const pluginPath = new URL('../index.js', import.meta.url).href
const plugin = await import(pluginPath)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeHost() {
  const listeners = { 'session/event': [], 'session/disposed': [] }
  const agents = new Map()
  const sessions = new Map()
  const sent = []
  const ctx = {
    on(name, cb) { listeners[name].push(cb) },
    effect(fn) {
      const dispose = fn()
      ctx.__dispose = dispose
    },
    inject(names, callback) {
      if (names.every((name) => ctx[name] !== undefined)) callback(ctx)
    },
    logger: () => ({ info() {}, warn() {} }),
    agents: {
      get(id) { return agents.get(id) ?? undefined },
    },
    sessions: {
      get(id) { return sessions.get(id) ?? undefined },
    },
  }
  function addSession(id, origin) {
    const session = { id, header: origin === undefined ? { id } : { id, origin } }
    sessions.set(id, session)
    agents.set(id, {
      followup(message) {
        sent.push({ id, message })
      },
    })
    return session
  }
  function emit(session, event) {
    for (const cb of listeners['session/event']) cb(session, event)
  }
  return { ctx, emit, addSession, sent, listeners }
}

function turnEnd(turn, reason) {
  return { type: 'turn/end', seq: 1, time: Date.now(), data: { turn, reason } }
}
function userMsg(id, text) {
  return { type: 'user/message', seq: 1, time: Date.now(), data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } }
}
function assistantMsg(text) {
  return { type: 'assistant/message', seq: 1, time: Date.now(), data: { turn: 1, step: 0, message: { role: 'assistant', content: [{ type: 'text', text }] } } }
}
function turnStart(turn) {
  return { type: 'turn/start', seq: 1, time: Date.now(), data: { turn } }
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push(['ok', name])
  } catch (error) {
    results.push(['FAIL', `${name} — ${error.message}`])
  }
}

// 1. Spanish text, max-tokens, continuation delivered
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'es', graceMs: 0 })
  const session = host.addSession('s1')
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  await sleep(30)
  check('max-tokens → one Spanish continuation', () => {
    assert.equal(host.sent.length, 1)
    const text = host.sent[0].message.content[0].text
    assert.match(text, /Continúa exactamente/)
    assert.deepEqual(host.sent[0].message.source, { kind: 'user' })
    assert.ok(host.sent[0].message.id.length > 10)
  })
  host.ctx.__dispose()
}

// 2. Unsupported language value falls back to "auto", which follows the system locale
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'fr', graceMs: 0 })
  const session = host.addSession('s2')
  host.emit(session, turnEnd(1, { kind: 'interrupted' }))
  await sleep(30)
  check('language "fr" → auto detection, never an empty prompt', () => {
    assert.equal(host.sent.length, 1)
    assert.match(host.sent[0].message.content[0].text, /contin/i)
  })
  host.ctx.__dispose()
}

// 2b. Explicit "en" is deterministic regardless of the system locale
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  const session = host.addSession('s2b')
  host.emit(session, turnEnd(1, { kind: 'interrupted' }))
  await sleep(30)
  check('language "en" → English built-in text', () => {
    assert.match(host.sent[0].message.content[0].text, /Resume the interrupted task/)
  })
  host.ctx.__dispose()
}

// 3. Permanent errors are not retried
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, cooldownMs: 0 })
  const session = host.addSession('s3')
  host.emit(session, turnEnd(1, { kind: 'error', error: { message: 'Incorrect API key provided', code: 'invalid_api_key', status: 401 } }))
  await sleep(30)
  check('HTTP 401 auth error → no continuation', () => assert.equal(host.sent.length, 0))
  host.emit(session, turnEnd(2, { kind: 'error', error: { message: 'insufficient balance', status: 402 } }))
  await sleep(30)
  check('balance error → no continuation', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

// 4. Recoverable error is retried
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, cooldownMs: 0 })
  const session = host.addSession('s4')
  host.emit(session, turnEnd(1, { kind: 'error', error: { message: 'upstream connect error', code: 'bad_gateway', status: 502 } }))
  await sleep(30)
  check('502 error → continuation with rendered code', () => {
    assert.equal(host.sent.length, 1)
    assert.match(host.sent[0].message.content[0].text, /bad_gateway/)
  })
  host.ctx.__dispose()
}

// 5. Manual stop and blocked turns are respected
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  const session = host.addSession('s5')
  host.emit(session, turnEnd(1, { kind: 'aborted', reason: { kind: 'user' } }))
  host.emit(session, turnEnd(2, { kind: 'blocked' }))
  host.emit(session, turnEnd(3, { kind: 'forked' }))
  await sleep(30)
  check('aborted(user)/blocked/forked → no continuation', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

// 6. Completed is opt-in
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  const session = host.addSession('s6')
  host.emit(session, turnEnd(1, { kind: 'completed' }))
  await sleep(30)
  check('completed → skipped by default', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, continueOnCompleted: true })
  const session = host.addSession('s6b')
  host.emit(session, turnEnd(1, { kind: 'completed' }))
  await sleep(30)
  check('continueOnCompleted → continuation', () => assert.equal(host.sent.length, 1))
  host.ctx.__dispose()
}

// 7. Consecutive cap
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, maxConsecutive: 2 })
  const session = host.addSession('s7')
  for (let i = 1; i <= 5; i += 1) {
    host.emit(session, turnStart(i))
    host.emit(session, turnEnd(i, { kind: 'max-tokens' }))
    await sleep(20)
  }
  check('maxConsecutive 2 caps the streak', () => assert.equal(host.sent.length, 2))
  host.ctx.__dispose()
}

// 8. Real user input resets the streak; our own continuation echo does not
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, maxConsecutive: 1 })
  const session = host.addSession('s8')
  host.emit(session, turnStart(1))
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  await sleep(20)
  assert.equal(host.sent.length, 1)
  // the host echoes our message back through the log
  host.emit(session, userMsg(host.sent[0].message.id, 'x'))
  host.emit(session, turnStart(2))
  host.emit(session, turnEnd(2, { kind: 'max-tokens' }))
  await sleep(20)
  check('echo of our own message does not reset the cap', () => assert.equal(host.sent.length, 1))
  host.emit(session, userMsg('user-real-1', 'wait, do this instead'))
  host.emit(session, turnStart(3))
  host.emit(session, turnEnd(3, { kind: 'max-tokens' }))
  await sleep(20)
  check('real user message resets the cap', () => assert.equal(host.sent.length, 2))
  host.ctx.__dispose()
}

// 9. Grace period is cancelled by new input
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 60 })
  const session = host.addSession('s9')
  host.emit(session, turnStart(1))
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  host.emit(session, userMsg('user-1', 'stop, I will handle it'))
  await sleep(120)
  check('user input during the grace period cancels the continuation', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

// 10. Subagent sessions are ignored
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, continueOnCompleted: true })
  const session = host.addSession('s10', 'subagent')
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  host.emit(session, turnEnd(2, { kind: 'completed' }))
  await sleep(30)
  check('subagent session → no continuation', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

// 11. Disabled plugin stays idle
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, enabled: false })
  const session = host.addSession('s11')
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  await sleep(30)
  check('enabled:false → idle', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

// 12. Loop guard
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, loopRepeatLimit: 3 })
  const session = host.addSession('s12')
  for (let i = 0; i < 3; i += 1) host.emit(session, assistantMsg('I am stuck on step 2.'))
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  await sleep(30)
  check('repeated answer → loop guard stops it', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

// 13. Custom text and placeholders
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'es', graceMs: 0, textMaxTokens: 'Sigue con {reason} en el turno {turn}, intento {count}/{limit}. {braces}' })
  const session = host.addSession('s13')
  host.emit(session, turnEnd(7, { kind: 'max-tokens' }))
  await sleep(30)
  check('custom template renders placeholders and keeps unknown ones', () => {
    const text = host.sent[0].message.content[0].text
    assert.equal(text, 'Sigue con max-tokens en el turno 7, intento 1/3. {braces}')
  })
  host.ctx.__dispose()
}

// 14. Disposed session drops the pending continuation
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 40 })
  const session = host.addSession('s14')
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  for (const cb of host.listeners['session/disposed']) cb(session)
  await sleep(100)
  check('disposed session → continuation dropped', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

// 15. Provider retry-after is honoured
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0, cooldownMs: 0 })
  const session = host.addSession('s15')
  const started = Date.now()
  host.emit(session, turnEnd(1, { kind: 'error', error: { message: 'rate limited', code: 'rate_limit', status: 429, providerRetryAfterMs: 120 } }))
  await sleep(60)
  const early = host.sent.length
  await sleep(140)
  check('providerRetryAfterMs delays the retry', () => {
    assert.equal(early, 0)
    assert.equal(host.sent.length, 1)
    assert.ok(Date.now() - started >= 120)
  })
  host.ctx.__dispose()
}

// 16. Config shape is readable by the settings form
{
  const json = plugin.Config.toJSON()
  check('Config.toJSON() exposes a ref table with defaults', () => {
    assert.equal(typeof json.uid, 'number')
    const root = json.refs[json.uid]
    assert.equal(root.type, 'object')
    assert.ok(root.dict.enabled)
    const enabled = json.refs[root.dict.enabled]
    assert.equal(enabled.type, 'boolean')
    assert.equal(enabled.meta.default, true)
    assert.ok(enabled.meta.description.length > 10)
    const fieldCount = Object.keys(plugin.Config.dict).length
    assert.equal(Object.keys(root.dict).length, fieldCount)
    assert.equal(Object.keys(json.refs).length, fieldCount + 1)
  })
  check('Config validation fills defaults and clamps', () => {
    const { value } = plugin.Config['~standard'].validate({ maxConsecutive: 999, graceMs: -5, language: 'klingon' })
    assert.equal(value.maxConsecutive, 100)
    assert.equal(value.graceMs, 0)
    assert.equal(value.language, 'auto')
    assert.equal(value.continueOnCompleted, false)
  })
  check('Config validation tolerates junk', () => {
    const { value } = plugin.Config['~standard'].validate(null)
    assert.equal(value.enabled, true)
    assert.equal(value.maxConsecutive, 3)
  })
}

// 17. Followup rejection is contained
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  const session = host.addSession('s17')
  host.ctx.agents.get = () => ({ followup() { throw new Error('prompt rejected') } })
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  await sleep(30)
  check('a rejected followup does not throw into the log feed', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

// 18. Missing agent is handled
{
  const host = makeHost()
  plugin.apply(host.ctx, { language: 'en', graceMs: 0 })
  const session = host.addSession('s18')
  host.ctx.agents.get = () => undefined
  host.emit(session, turnEnd(1, { kind: 'max-tokens' }))
  await sleep(30)
  check('missing agent → dropped without throwing', () => assert.equal(host.sent.length, 0))
  host.ctx.__dispose()
}

const failed = results.filter(([status]) => status !== 'ok')
for (const [status, name] of results) console.log(`${status === 'ok' ? 'PASS' : 'FAIL'}  ${name}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
