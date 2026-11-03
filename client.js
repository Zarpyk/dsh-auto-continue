/**
 * dsh-auto-continue — browser half.
 *
 * Two surfaces, both fed by the host routes under `/api/dsh-auto-continue`:
 *   - a banner above the composer (`conversation.input.dock`) that appears only when the engine is
 *     about to send a continuation, has been paused, or stood down for a reason worth showing;
 *   - a settings page (`settings.section`) with the switches, timings and prompt texts.
 *
 * Written as plain ESM for `window.__ModuleLoader__`, no bundler: the module returns the Harness
 * plugin shape and registers both slots from `apply`.
 */
window.__ModuleLoader__.load({
  id: '@zarpyk/dsh-auto-continue',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-auto-continue'
    const API = '/api/dsh-auto-continue'
    const MUTATION_HEADER = 'x-dsh-auto-continue'
    const POLL_MS = 1500

    const DICT = {
      en: {
        probe: 'en',
        title: 'Auto-Continue',
        subtitle: 'Resumes a turn that stopped early: max tokens, a recoverable provider error, a usage window, or an interrupted turn.',
        armed: 'Auto-continue in',
        armedShort: 'continuing',
        sending: 'Sending the continuation…',
        paused: 'Auto-continue is paused',
        capped: 'Consecutive limit reached',
        loopGuard: 'Loop guard stopped it',
        idle: 'Idle',
        now: 'Now',
        cancel: 'Cancel',
        pause: 'Pause',
        resume: 'Resume',
        details: 'Details',
        hide: 'Hide',
        status: 'Status',
        enabled: 'Enabled',
        behaviour: 'What gets continued',
        maxTokens: 'After the output limit (max tokens)',
        maxTokensHint: 'The model hit its cap mid-answer; the turn continues where it stopped.',
        interrupted: 'After an interrupted turn',
        interruptedHint: 'A turn was orphaned by a restart and closed on resume.',
        errors: 'After a recoverable provider error',
        errorsHint: '5xx, timeouts and other transient failures. Includes provider usage limits.',
        completed: 'After a normal completion',
        completedHint: 'Opt-in: continues even when the model considers the turn done. Useful for long autonomous runs.',
        timing: 'Timing',
        graceMs: 'Grace before continuing (ms)',
        graceHint: 'A stop button always wins: a message or a manual stop inside this window cancels it.',
        cooldownMs: 'First retry delay (ms)',
        backoff: 'Backoff factor',
        backoffMax: 'Maximum backoff (ms)',
        consecutive: 'Consecutive continuations allowed',
        rateLimitWait: 'Longest usage-limit wait (ms)',
        rateLimitHint: 'Providers publish the reset of an exhausted window; time is spent waiting for it, not retrying.',
        texts: 'Prompt texts',
        textsHint: 'Leave a field empty to use the built-in text for the selected language. {code} {status} {message} {turn} {count} {limit} {elapsed} are replaced.',
        language: 'Prompt language',
        auto: 'Follow the interface',
        spanish: 'Spanish',
        english: 'English',
        textMaxTokens: 'Max tokens',
        textInterrupted: 'Interrupted',
        textError: 'Provider error',
        textRateLimit: 'Usage limit',
        textCompleted: 'Completed',
        guard: 'Guards',
        classify: 'Skip errors that cannot be retried',
        classifyHint: 'Auth, balance and unknown-model errors stop the engine instead of burning attempts.',
        loopGuardToggle: 'Stop on repeated answers',
        loopRepeatLimit: 'Identical answers before stopping',
        save: 'Save',
        saving: 'Saving…',
        revert: 'Discard changes',
        saved: 'Saved',
        dirty: 'Unsaved changes',
        store: 'Saved in',
        sessions: 'Sessions',
        noSessions: 'No session has ended a turn yet.',
        failed: 'The engine route is not answering',
        attempt: 'attempt',
        last: 'Last stop',
        streak: 'Streak',
        turns: 'turns',
        turn: 'turn',
        error_http: 'HTTP',
        fresh: 'Live',
        drill: 'Try the banner',
        drillHint: 'Arms a continuation the engine did not decide on its own, so the banner can be seen without waiting for a real limit. Same as the /auto-continue command.',
        drillSend: 'Send it for real',
        drillSeconds: 'Countdown (seconds)',
        drillArmed: 'Drill armed — the banner appears above the composer',
        drillCommand: 'In the composer: /auto-continue simular limite 10',
        drillMaxTokens: 'Max tokens',
        drillRateLimit: 'Usage limit',
        drillError: 'Error',
        drillInterrupted: 'Interrupted',
        simulated: 'test',
        provider: 'Command Code',
        providerHint: 'Read straight from the provider: the usage windows, when they reset, and the credit that is left.',
        providerUnavailable: 'The Command Code provider is not mounted, so there is nothing to read. Enable it and the windows appear here.',
        providerLoading: 'Asking Command Code…',
        providerRefresh: 'Refresh',
        providerStale: 'read {ago} ago',
        providerNoUsage: 'The provider answered without usage windows for this account.',
        fiveHour: '5-hour window',
        weekly: 'Weekly window',
        monthlyLeft: 'Monthly credit',
        purchased: 'Purchased',
        freeCredit: 'Free',
        resets: 'Resets',
        exceeded: 'Exceeded',
        reopens: 'Reopens in',
      },
      es: {
        probe: 'es',
        title: 'Continuación automática',
        subtitle: 'Retoma un turno que se quedó a medias: límite de tokens, error recuperable del proveedor, ventana de uso agotada o turno interrumpido.',
        armed: 'Continuará en',
        armedShort: 'continuando',
        sending: 'Enviando la continuación…',
        paused: 'La continuación automática está en pausa',
        capped: 'Límite de continuaciones alcanzado',
        loopGuard: 'El guardián de bucles la detuvo',
        idle: 'Inactivo',
        now: 'Ahora',
        cancel: 'Cancelar',
        pause: 'Pausar',
        resume: 'Reanudar',
        details: 'Detalles',
        hide: 'Ocultar',
        status: 'Estado',
        enabled: 'Activado',
        behaviour: 'Qué se continúa',
        maxTokens: 'Tras el límite de salida (max tokens)',
        maxTokensHint: 'El modelo llegó a su tope con la respuesta a medias; el turno sigue donde se quedó.',
        interrupted: 'Tras un turno interrumpido',
        interruptedHint: 'Un turno quedó huérfano por un reinicio y se cerró al reanudar.',
        errors: 'Tras un error recuperable del proveedor',
        errorsHint: '5xx, tiempos de espera y fallos transitorios. Incluye los límites de uso.',
        completed: 'Tras un turno completado',
        completedHint: 'Opcional: continúa aunque el modelo dé el turno por terminado. Útil en ejecuciones autónomas largas.',
        timing: 'Ritmo',
        graceMs: 'Espera antes de continuar (ms)',
        graceHint: 'Parar siempre gana: un mensaje o una parada manual dentro de esta ventana la cancela.',
        cooldownMs: 'Primer reintento (ms)',
        backoff: 'Factor de espera creciente',
        backoffMax: 'Espera máxima (ms)',
        consecutive: 'Continuaciones seguidas permitidas',
        rateLimitWait: 'Espera máxima por límite de uso (ms)',
        rateLimitHint: 'El proveedor publica cuándo se restablece la ventana; se espera en vez de reintentar a ciegas.',
        texts: 'Textos de continuación',
        textsHint: 'Deja un campo vacío para usar el texto integrado del idioma elegido. Se sustituyen {code} {status} {message} {turn} {count} {limit} {elapsed}.',
        language: 'Idioma de los textos',
        auto: 'El de la interfaz',
        spanish: 'Español',
        english: 'Inglés',
        textMaxTokens: 'Max tokens',
        textInterrupted: 'Interrumpido',
        textError: 'Error del proveedor',
        textRateLimit: 'Límite de uso',
        textCompleted: 'Completado',
        guard: 'Protecciones',
        classify: 'Omitir errores que no se pueden reintentar',
        classifyHint: 'Los errores de autenticación, saldo o modelo desconocido detienen el motor en vez de gastar intentos.',
        loopGuardToggle: 'Parar si la respuesta se repite',
        loopRepeatLimit: 'Respuestas idénticas antes de parar',
        save: 'Guardar',
        saving: 'Guardando…',
        revert: 'Descartar cambios',
        saved: 'Guardado',
        dirty: 'Cambios sin guardar',
        store: 'Se guarda en',
        sessions: 'Sesiones',
        noSessions: 'Todavía ninguna sesión ha terminado un turno.',
        failed: 'La ruta del motor no responde',
        attempt: 'intento',
        last: 'Última parada',
        streak: 'Racha',
        turns: 'turnos',
        turn: 'turno',
        error_http: 'HTTP',
        fresh: 'En vivo',
        drill: 'Probar la banda',
        drillHint: 'Arma una continuación que el motor no ha decidido por su cuenta, para ver la banda sin esperar a un límite real. Es lo mismo que la orden /auto-continue.',
        drillSend: 'Enviarla de verdad',
        drillSeconds: 'Cuenta atrás (segundos)',
        drillArmed: 'Prueba armada — la banda aparece sobre el compositor',
        drillCommand: 'En el compositor: /auto-continue simular limite 10',
        drillMaxTokens: 'Max tokens',
        drillRateLimit: 'Límite de uso',
        drillError: 'Error',
        drillInterrupted: 'Interrumpido',
        simulated: 'prueba',
        provider: 'Command Code',
        providerHint: 'Se lee del propio proveedor: las ventanas de uso, cuándo se restablecen y el crédito que queda.',
        providerUnavailable: 'El proveedor Command Code no está montado, así que no hay nada que leer. Actívalo y las ventanas aparecen aquí.',
        providerLoading: 'Preguntando a Command Code…',
        providerRefresh: 'Actualizar',
        providerStale: 'leído hace {ago}',
        providerNoUsage: 'El proveedor respondió sin ventanas de uso para esta cuenta.',
        fiveHour: 'Ventana de 5 horas',
        weekly: 'Ventana semanal',
        monthlyLeft: 'Crédito mensual',
        purchased: 'Comprado',
        freeCredit: 'Gratis',
        resets: 'Se restablece',
        exceeded: 'Agotada',
        reopens: 'Se reabre en',
      },
    }

    /* ------------------------------------------------------------------ http --- */

    function pageBaseHref() {
      const base = (typeof document !== 'undefined' && document.baseURI) || `${window.location.origin}/`
      return base.endsWith('/') ? base : `${base}/`
    }

    function resolveApiUrl(path) {
      try {
        return new URL(String(path).replace(/^\//, ''), pageBaseHref()).toString()
      } catch {
        return path
      }
    }

    async function parseJson(response) {
      const text = await response.text()
      let payload
      try {
        payload = text === '' ? {} : JSON.parse(text)
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload.data
    }

    async function apiGet(path) {
      const response = await fetch(resolveApiUrl(path), { headers: { accept: 'application/json' } })
      return parseJson(response)
    }

    async function apiPost(body) {
      const response = await fetch(resolveApiUrl(`${API}/action`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', [MUTATION_HEADER]: '1' },
        body: JSON.stringify(body ?? {}),
      })
      return parseJson(response)
    }

    /* ---------------------------------------------------------------- format --- */

    function clock(ms) {
      const total = Math.max(0, Math.round(ms / 1000))
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      return `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    function ago(at, t) {
      if (typeof at !== 'number' || at <= 0) return ''
      const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return `${minutes}m`
      return `${Math.round(minutes / 60)}h`
    }

    /** Wall clock of an instant: `HH:MM`, with a `+Nd` suffix past tomorrow. */
    function atTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
      const when = new Date(ms)
      const hh = String(when.getHours()).padStart(2, '0')
      const mm = String(when.getMinutes()).padStart(2, '0')
      const days = Math.floor((ms - Date.now()) / 86400000)
      return days >= 1 ? `${hh}:${mm} +${days}d` : `${hh}:${mm}`
    }

    /** Share of a `{ used, cap }` window, as a whole percentage. */
    function percentOf(window) {
      const cap = Number(window?.cap ?? 0)
      if (!Number.isFinite(cap) || cap <= 0) return 0
      return Math.max(0, Math.min(100, Math.round((Number(window?.used ?? 0) / cap) * 100)))
    }

    /** `62% · 3/5 · resets 18:40` — one usage window on a single line. */
    function windowLine(window, t) {
      if (window === null || window === undefined) return ''
      const parts = [`${percentOf(window)}%`]
      if (window.cap !== undefined && window.cap !== null) parts.push(`${window.used ?? 0}/${window.cap}`)
      if (window.exceeded === true) parts.push(t('exceeded'))
      if (window.resetAt) parts.push(`${t('resets')} ${atTime(window.resetAt)}`)
      return parts.join(' · ')
    }

    const REASON_LABEL = {
      'max-tokens': { en: 'max tokens', es: 'max tokens' },
      interrupted: { en: 'interrupted turn', es: 'turno interrumpido' },
      error: { en: 'provider error', es: 'error del proveedor' },
      'rate-limit': { en: 'usage limit', es: 'límite de uso' },
      completed: { en: 'completion', es: 'turno completado' },
      manual: { en: 'manual', es: 'manual' },
    }

    function reasonText(key, locale) {
      const entry = REASON_LABEL[key]
      if (entry === undefined) return key ?? ''
      return entry[locale] ?? entry.en
    }

    /* ----------------------------------------------------------------- hooks --- */

    /** Poll the engine: it is a local route, and the countdown must not drift. */
    function useEngine(sessionId) {
      const [state, setState] = React.useState({ data: null, error: '' })
      const sessionRef = React.useRef(sessionId)
      sessionRef.current = sessionId

      React.useEffect(() => {
        let alive = true
        let timer = 0
        let backoff = POLL_MS

        const tick = async () => {
          if (!alive) return
          const current = sessionRef.current
          const suffix = current ? `?session=${encodeURIComponent(current)}` : ''
          try {
            const data = await apiGet(`${API}/state${suffix}`)
            if (!alive) return
            setState({ data, error: '' })
            backoff = POLL_MS
          } catch (error) {
            if (!alive) return
            setState((previous) => ({ data: previous.data, error: String(error?.message ?? error) }))
            backoff = Math.min(15000, Math.max(POLL_MS, backoff * 2))
          }
          if (alive) timer = setTimeout(tick, backoff)
        }

        tick()
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [])

      return state
    }

    /** One render tick per second while a countdown is running. */
    function useNow(active) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return undefined
        const timer = setInterval(() => setNow(Date.now()), 500)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /* The Command Code provider publishes its usage report as a Harness Remote; the namespace only
       exists once that provider mounts, so it is captured in `apply` and cached here. The banner and
       the settings page then share one read instead of asking twice. */
    const PROVIDER = {
      namespace: null,
      state: { status: 'idle', report: null, error: '', fetchedAt: 0 },
      listeners: new Set(),
      inFlight: false,
      publish(next) {
        PROVIDER.state = { ...PROVIDER.state, ...next }
        for (const listener of PROVIDER.listeners) {
          try {
            listener()
          } catch {
            /* one broken surface must not stop the others */
          }
        }
      },
      async refresh() {
        const namespace = PROVIDER.namespace
        if (namespace === null || namespace === undefined || PROVIDER.inFlight) return
        PROVIDER.inFlight = true
        PROVIDER.publish({ status: 'loading', error: '' })
        try {
          const response = await namespace.report()
          if (response?.ok === true) {
            PROVIDER.publish({ status: 'ready', report: response.value ?? null, error: '', fetchedAt: Date.now() })
          } else {
            PROVIDER.publish({ status: 'error', error: String(response?.error?.message ?? 'no report') })
          }
        } catch (error) {
          PROVIDER.publish({ status: 'error', error: String(error?.message ?? error) })
        } finally {
          PROVIDER.inFlight = false
        }
      },
      reset() {
        PROVIDER.namespace = null
        PROVIDER.publish({ status: 'idle', report: null, error: '', fetchedAt: 0 })
      },
    }

    /** Re-render on every provider publish; poll once a minute while a surface is watching. */
    function useProvider(active) {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        const listener = () => {
          if (alive) bump((value) => value + 1)
        }
        PROVIDER.listeners.add(listener)
        if (PROVIDER.state.report === null) PROVIDER.refresh()
        const timer = active ? setInterval(() => PROVIDER.refresh(), 60000) : 0
        return () => {
          alive = false
          if (timer !== 0) clearInterval(timer)
          PROVIDER.listeners.delete(listener)
        }
      }, [active])
      return PROVIDER.state
    }

    /** The account the report leads with; `null` when the provider reported none. */
    function primaryAccount(report) {
      const accounts = Array.isArray(report?.accounts) ? report.accounts : []
      return accounts.find((account) => account?.active === true) ?? accounts[0] ?? null
    }

    /** The window that best explains a rate limit: the exhausted one, else the soonest to reset. */
    function limitingWindow(credits) {
      const windows = [credits?.fiveHour, credits?.weekly].filter((entry) => entry !== null && entry !== undefined)
      const exhausted = windows.find((entry) => entry.exceeded === true)
      if (exhausted !== undefined) return exhausted
      const timed = windows.filter((entry) => typeof entry.resetAt === 'number' && entry.resetAt > 0)
      timed.sort((left, right) => left.resetAt - right.resetAt)
      return timed[0] ?? windows[0] ?? null
    }

    const TRANSLATORS = {}
    function translatorFor(ctx, locale) {
      const key = `${NS}:${locale}`
      if (TRANSLATORS[key] !== undefined) return TRANSLATORS[key]
      const dict = DICT[locale] ?? DICT.en
      const fallback = DICT.en
      const translate = (name, values) => {
        let text = dict[name] ?? fallback[name] ?? name
        if (values !== undefined && values !== null) {
          for (const [name2, value] of Object.entries(values)) {
            text = String(text).split(`{${name2}}`).join(String(value))
          }
        }
        return text
      }
      TRANSLATORS[key] = translate
      return translate
    }

    /* ----------------------------------------------------------------- style --- */

    const CSS = `
/* The dock entry spans the whole conversation pane, while the composer card is centred and capped by
   --dsh-composer-card-max-width. Matching that cap keeps the banner in the same column as the input
   box instead of hugging the far left edge of the window. */
.aic-root { width: 100%; max-width: min(100%, var(--dsh-composer-card-max-width, calc(var(--dsh-chat-content-width, 748px) + 32px))); margin: 0 auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.aic-banner { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; min-height: 34px; padding: 6px 8px 6px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.aic-banner[data-tone="info"] { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1)); }
.aic-banner[data-tone="warn"] { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-border-l1)); }
.aic-banner[data-tone="error"] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, var(--dsw-alias-border-l1)); }
.aic-glyph { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex: none; border-radius: 50%; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.aic-banner[data-tone="warn"] .aic-glyph { color: var(--dsw-alias-state-warn-primary); }
.aic-banner[data-tone="error"] .aic-glyph { color: var(--dsw-alias-state-error-primary); }
.aic-title { font-weight: 600; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.aic-sep { color: var(--dsw-alias-border-l2); }
.aic-meta { color: var(--dsw-alias-label-secondary); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.aic-count { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.aic-banner[data-tone="warn"] .aic-count { color: var(--dsw-alias-state-warn-primary); }
.aic-banner[data-tone="error"] .aic-count { color: var(--dsw-alias-state-error-primary); }
.aic-actions { display: flex; align-items: center; gap: 5px; flex: none; margin-left: auto; }
.aic-btn { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 11.5px; font-family: inherit; cursor: pointer; white-space: nowrap; }
.aic-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.aic-btn[data-variant="primary"] { background: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }
.aic-btn[data-variant="primary"]:hover { opacity: .9; }
.aic-btn[data-variant="ghost"] { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); padding: 0 6px; }
.aic-btn[data-variant="ghost"]:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.aic-btn:disabled { opacity: .5; cursor: default; }
.aic-details { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
.aic-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.aic-row-label { color: var(--dsw-alias-label-secondary); }
.aic-trail { display: flex; flex-direction: column; gap: 4px; max-height: 190px; overflow: auto; }
.aic-trail-row { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
.aic-trail-time { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; flex: none; width: 34px; }
.aic-tag { flex: none; padding: 1px 6px; border-radius: 5px; font-size: 11px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.aic-tag[data-kind="sent"] { color: var(--dsw-alias-state-success-primary); }
.aic-tag[data-kind="armed"] { color: var(--dsw-alias-brand-primary); }
.aic-tag[data-kind="stand-down"], .aic-tag[data-kind="dropped"], .aic-tag[data-kind="rejected"] { color: var(--dsw-alias-state-warn-primary); }
.aic-tag[data-kind="capped"], .aic-tag[data-kind="loop-guard"], .aic-tag[data-kind="paused"] { color: var(--dsw-alias-state-error-primary); }
.aic-page { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 24px; max-width: 760px; color: var(--dsw-alias-label-primary); }
.aic-page h2 { margin: 0; font-size: 17px; }
.aic-page p.sub { margin: 2px 0 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.aic-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 13px 14px; display: flex; flex-direction: column; gap: 10px; }
.aic-card > h3 { margin: 0; font-size: 13px; letter-spacing: .02em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.aic-field { display: flex; flex-direction: column; gap: 3px; }
.aic-field > label { font-size: 12.5px; font-weight: 500; }
.aic-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.45; }
.aic-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 11px; }
.aic-input, .aic-select, .aic-textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12.5px; padding: 6px 8px; }
.aic-textarea { min-height: 54px; resize: vertical; line-height: 1.45; }
.aic-input:focus, .aic-select:focus, .aic-textarea:focus { outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); outline-offset: 1px; }
.aic-toggle { display: flex; align-items: flex-start; gap: 8px; padding: 2px 0; }
.aic-toggle input { margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary); }
.aic-toggle-text { display: flex; flex-direction: column; gap: 1px; }
.aic-bar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 9px; padding: 9px 0; background: linear-gradient(to top, var(--dsw-alias-bg-base) 70%, transparent); }
.aic-note { font-size: 12px; color: var(--dsw-alias-label-secondary); flex: 1; }
.aic-note[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); }
.aic-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.aic-dirty { color: var(--dsw-alias-state-warn-primary); }
.aic-pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.aic-pill[data-on="true"] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-border-l1)); }
.aic-pill[data-on="paused"] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l1)); }
.aic-sessions { display: flex; flex-direction: column; gap: 6px; }
.aic-session { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.aic-session code { font-size: 11.5px; color: var(--dsw-alias-label-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aic-spin { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); animation: aic-spin 900ms linear infinite; }
@keyframes aic-spin { to { transform: rotate(360deg); } }
`

    function useStyles() {
      React.useEffect(() => {
        const id = 'dsh-auto-continue-styles'
        if (typeof document === 'undefined') return
        if (document.getElementById(id) !== null) return
        const element = document.createElement('style')
        element.id = id
        element.textContent = CSS
        document.head.appendChild(element)
        // Deliberately not removed: a second surface may still be mounted when one unmounts.
      }, [])
    }

    /* ---------------------------------------------------------------- pieces --- */

    function Glyph(props) {
      return h(
        'span',
        { className: 'aic-glyph', 'aria-hidden': 'true' },
        h(
          'svg',
          { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' },
          h('path', { d: 'M20 12a8 8 0 1 1-2.34-5.66' }),
          h('path', { d: 'M20 4v5h-5' }),
        ),
      )
    }

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'aic-btn',
          'data-variant': props.variant ?? 'default',
          disabled: props.disabled === true,
          onClick: props.onClick,
          title: props.title,
        },
        props.children,
      )
    }

    function Toggle(props) {
      return h(
        'label',
        { className: 'aic-toggle' },
        h('input', { type: 'checkbox', checked: props.checked === true, onChange: (event) => props.onChange(event.target.checked) }),
        h(
          'span',
          { className: 'aic-toggle-text' },
          h('span', null, props.label),
          props.hint === undefined ? null : h('span', { className: 'aic-hint' }, props.hint),
        ),
      )
    }

    function NumberField(props) {
      return h(
        'div',
        { className: 'aic-field' },
        h('label', { htmlFor: props.id }, props.label),
        h('input', {
          id: props.id,
          className: 'aic-input',
          type: 'number',
          min: props.min ?? 0,
          max: props.max,
          step: props.step ?? 1,
          value: props.value,
          onChange: (event) => props.onChange(Number(event.target.value)),
        }),
        props.hint === undefined ? null : h('span', { className: 'aic-hint' }, props.hint),
      )
    }

    /* ---------------------------------------------------------------- banner --- */

    function Banner(props) {
      useStyles()
      const locale = props.locale === 'es' ? 'es' : 'en'
      const t = React.useMemo(() => translatorFor(props.ctx, locale), [locale])
      const sessionId = props.sessionId ?? props.session?.id ?? props.input?.session?.id ?? ''
      const { data, error } = useEngine(typeof sessionId === 'string' ? sessionId : '')
      const current = data?.session ?? null
      const armed = current?.armed === true
      const now = useNow(armed)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState('')
      const usage = useProvider(armed)
      const credits = primaryAccount(usage.report)?.credits ?? null
      const windows = [credits?.fiveHour, credits?.weekly].filter((window) => window !== null && window !== undefined)

      const trail = current?.history ?? []
      const last = current?.last ?? null
      const recent = trail.length > 0 && trail[0].at !== undefined && Date.now() - trail[0].at < 90000 ? trail[0] : null
      const paused = data?.paused === true
      const capped = recent?.kind === 'capped'
      const guarded = recent?.kind === 'loop-guard'

      if (data === null) {
        if (error === '') return null
        return h(
          'div',
          { className: 'aic-root' },
          h('div', { className: 'aic-banner', 'data-tone': 'error' },
            h(Glyph, null),
            h('span', { className: 'aic-title' }, t('title')),
            h('span', { className: 'aic-sep' }, '·'),
            h('span', { className: 'aic-meta' }, `${t('failed')} — ${error}`)),
        )
      }

      /* The pill is a status chip, not a log: it only exists while something is queued, paused or
         blocked. A plain stand-down (a turn that simply completed) leaves the composer clean. */
      const visible = armed || paused || capped || guarded
      if (!visible) return null

      const send = async (body, tag) => {
        setBusy(tag)
        try {
          await apiPost({ ...body, session: typeof sessionId === 'string' ? sessionId : '' })
        } catch {
          /* the next poll reports the failure */
        } finally {
          setBusy('')
        }
      }

      let tone = 'info'
      let headline = ''
      if (armed) {
        const remaining = Math.max(0, (current.nextAt || now) - now)
        /* A rate-limit wait is a window reopening, not a plain pause: saying so is the whole point
           of reading the provider's reset time. */
        const limited = last !== null && last.key === 'rate-limit'
        headline = `${limited ? t('reopens') : t('armed')} ${clock(remaining)}`
        if (remaining <= 0) headline = t('sending')
      } else if (paused) {
        tone = 'warn'
        headline = t('paused')
      } else if (capped) {
        tone = 'warn'
        headline = `${t('capped')} (${current.consecutive}/${current.limit})`
      } else if (guarded) {
        tone = 'warn'
        headline = t('loopGuard')
      } else if (last !== null) {
        tone = 'info'
        headline = t('idle')
      }

      const meta = []
      if (current !== null && current.simulated === true) meta.push(t('simulated'))
      if (armed && last !== null) meta.push(reasonText(last.key, locale))
      if (armed && windows.length > 0) {
        const window = limitingWindow(credits)
        const parts = [`${percentOf(window)}%`]
        if (window.resetAt) parts.push(`${t('resets')} ${atTime(window.resetAt)}`)
        meta.push(parts.join(' · '))
      }
      if (last !== null && last.code !== '' && last.code !== 'unknown') meta.push(last.code)
      if (last !== null && last.status !== '?' && last.status !== undefined) meta.push(`${t('error_http')} ${last.status}`)
      if (current !== null && current.consecutive > 0) meta.push(`${current.consecutive}/${current.limit}`)

      return h(
        'div',
        { className: 'aic-root' },
        h(
          'div',
          { className: 'aic-banner', 'data-tone': tone },
          h(Glyph, null),
          h('span', { className: 'aic-title' }, t('title')),
          headline === '' ? null : h('span', { className: 'aic-sep' }, '·'),
          headline === '' ? null : h('span', { className: 'aic-count' }, headline),
          meta.length === 0 ? null : h('span', { className: 'aic-sep' }, '·'),
          meta.length === 0 ? null : h('span', { className: 'aic-meta' }, meta.join(' · ')),
          h(
            'div',
            { className: 'aic-actions' },
            armed
              ? h(Button, { variant: 'primary', onClick: () => send({ action: 'continue-now' }, 'now') }, t('now'))
              : null,
            armed
              ? h(Button, { onClick: () => send({ action: 'cancel' }, 'cancel'), title: t('cancel') }, t('cancel'))
              : null,
            paused
              ? h(Button, { variant: 'primary', onClick: () => send({ action: 'resume' }, 'resume') }, t('resume'))
              : null,
            capped || guarded
              ? h(Button, { variant: 'primary', onClick: () => send({ action: 'continue-now' }, 'now') }, t('now'))
              : null,
            paused
              ? null
              : h(Button, { variant: 'ghost', onClick: () => send({ action: 'pause' }, 'pause'), title: t('pause') }, busy === 'pause' ? t('saving') : t('pause')),
            h(Button, { variant: 'ghost', onClick: () => setOpen(!open) }, open ? t('hide') : t('details')),
          ),
        ),
        open
          ? h(
            'div',
            { className: 'aic-details' },
            h('div', { className: 'aic-row' },
              h('span', { className: 'aic-row-label' }, t('last')),
              h('span', null, last === null ? '—' : `${reasonText(last.key, locale)}${last.turn ? ` · ${t('turn')} ${last.turn}` : ''}`)),
            current === null || current.consecutive === 0
              ? null
              : h('div', { className: 'aic-row' },
                h('span', { className: 'aic-row-label' }, t('streak')),
                h('span', null, `${current.consecutive}/${current.limit}`)),
            credits?.fiveHour
              ? h('div', { className: 'aic-row' },
                h('span', { className: 'aic-row-label' }, t('fiveHour')),
                h('span', { className: 'aic-meta' }, windowLine(credits.fiveHour, t)))
              : null,
            credits?.weekly
              ? h('div', { className: 'aic-row' },
                h('span', { className: 'aic-row-label' }, t('weekly')),
                h('span', { className: 'aic-meta' }, windowLine(credits.weekly, t)))
              : null,
            h('div', { className: 'aic-trail' },
              trail.length === 0
                ? h('span', { className: 'aic-hint' }, '—')
                : trail.map((entry, index) =>
                  h('div', { key: `${entry.at}-${index}`, className: 'aic-trail-row' },
                    h('span', { className: 'aic-trail-time' }, ago(entry.at, t)),
                    h('span', { className: 'aic-tag', 'data-kind': entry.kind }, entry.kind),
                    h('span', { className: 'aic-meta' }, [entry.key, entry.note].filter((value) => typeof value === 'string' && value !== '').join(' · '))))),
          )
          : null,
        error === '' || open
          ? null
          : h('div', { className: 'aic-note', 'data-tone': 'error' }, `${t('failed')} — ${error}`),
      )
    }

    /* -------------------------------------------------------------- settings --- */

    const BOOLEAN_FIELDS = [
      ['enabled', 'enabled', null],
      ['continueOnMaxTokens', 'maxTokens', 'maxTokensHint'],
      ['continueOnInterrupted', 'interrupted', 'interruptedHint'],
      ['continueOnError', 'errors', 'errorsHint'],
      ['continueOnCompleted', 'completed', 'completedHint'],
    ]

    const TEXT_FIELDS = [
      ['textMaxTokens', 'textMaxTokens'],
      ['textInterrupted', 'textInterrupted'],
      ['textError', 'textError'],
      ['textRateLimit', 'textRateLimit'],
      ['textCompleted', 'textCompleted'],
    ]

    /** One button per ending the engine can imitate, so the banner is one click away. */
    const DRILL_BUTTONS = [
      ['max-tokens', 'drillMaxTokens'],
      ['rate-limit', 'drillRateLimit'],
      ['error', 'drillError'],
      ['interrupted', 'drillInterrupted'],
    ]

    function SettingsPage(props) {
      useStyles()
      const locale = props.locale === 'es' ? 'es' : 'en'
      const t = React.useMemo(() => translatorFor(props.ctx, locale), [locale])
      const { data, error } = useEngine('')
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [note, setNote] = React.useState(null)
      const [drillSeconds, setDrillSeconds] = React.useState(10)
      const [drillSend, setDrillSend] = React.useState(false)

      React.useEffect(() => {
        if (data === null) return
        setDraft((previous) => previous ?? { ...data.config })
      }, [data])

      if (data === null) {
        return h('div', { className: 'aic-page' },
          h('h2', null, t('title')),
          h('p', { className: 'sub' }, t('subtitle')),
          h('div', { className: 'aic-card' },
            error === ''
              ? h('span', { className: 'aic-hint' }, '…')
              : h('span', { className: 'aic-note', 'data-tone': 'error' }, `${t('failed')} — ${error}`)))
      }

      const config = draft ?? data.config
      const dirty = JSON.stringify(config) !== JSON.stringify(data.config)
      const set = (key, value) => setDraft({ ...config, [key]: value })

      const run = async (body, tag, message, resetDraft = false) => {
        setBusy(tag)
        setNote(null)
        try {
          const next = await apiPost(body)
          if (resetDraft && next !== undefined && next !== null && next.config !== undefined) {
            setDraft({ ...next.config })
          }
          if (message !== undefined) setNote({ tone: 'ok', text: message })
        } catch (problem) {
          setNote({ tone: 'error', text: String(problem?.message ?? problem) })
        } finally {
          setBusy('')
        }
      }

      const sessions = data.sessions ?? []
      const usage = useProvider(true)
      const credits = primaryAccount(usage.report)?.credits ?? null
      const plan = primaryAccount(usage.report)?.plan ?? usage.report?.plan ?? null

      return h(
        'div',
        { className: 'aic-page' },
        h('div', null,
          h('h2', null, t('title')),
          h('p', { className: 'sub' }, t('subtitle'))),

        h('div', { className: 'aic-card' },
          h('div', { className: 'aic-row' },
            h('span', { className: 'aic-pill', 'data-on': data.paused ? 'paused' : String(data.enabled === true) },
              data.paused ? t('paused') : data.enabled === true ? t('fresh') : t('idle')),
            data.session === null || data.session === undefined
              ? null
              : h('span', { className: 'aic-hint' },
                `${t('sessions')}: ${data.session.consecutive}/${data.session.limit} · ${reasonText(data.session.last?.key, locale)}`)),
          h('div', { className: 'aic-row' },
            h(Button, {
              variant: data.paused ? 'primary' : 'default',
              disabled: busy !== '',
              onClick: () => run({ action: data.paused ? 'resume' : 'pause' }, 'pause'),
            }, data.paused ? t('resume') : t('pause')),
            h(Button, {
              disabled: busy !== '' || (data.session?.armed !== true),
              onClick: () => run({ action: 'continue-now' }, 'now'),
            }, t('now'))),
          h('span', { className: 'aic-hint' }, `${t('store')}: ${data.store ?? '—'}`)),

        h('div', { className: 'aic-card' },
          h('h3', null, t('provider')),
          h('span', { className: 'aic-hint' }, t('providerHint')),
          usage.status === 'loading' && usage.report === null
            ? h('span', { className: 'aic-hint' }, t('providerLoading'))
            : null,
          usage.error !== ''
            ? h('span', { className: 'aic-note', 'data-tone': 'error' }, usage.error)
            : null,
          PROVIDER.namespace === null
            ? h('span', { className: 'aic-hint' }, t('providerUnavailable'))
            : null,
          credits === null
            ? null
            : h('div', null,
              plan?.name
                ? h('div', { className: 'aic-row' },
                  h('span', { className: 'aic-row-label' }, t('status')),
                  h('span', null, String(plan.name)))
                : null,
              credits.fiveHour
                ? h('div', { className: 'aic-row' },
                  h('span', { className: 'aic-row-label' }, t('fiveHour')),
                  h('span', { className: 'aic-meta' }, windowLine(credits.fiveHour, t)))
                : null,
              credits.weekly
                ? h('div', { className: 'aic-row' },
                  h('span', { className: 'aic-row-label' }, t('weekly')),
                  h('span', { className: 'aic-meta' }, windowLine(credits.weekly, t)))
                : null,
              h('div', { className: 'aic-row' },
                h('span', { className: 'aic-row-label' }, t('monthlyLeft')),
                h('span', { className: 'aic-meta' }, [
                  credits.monthlyCredits !== undefined ? String(credits.monthlyCredits) : '',
                  credits.purchasedCredits !== undefined ? `${t('purchased')} ${credits.purchasedCredits}` : '',
                  credits.freeCredits !== undefined ? `${t('freeCredit')} ${credits.freeCredits}` : '',
                ].filter(Boolean).join(' · ')))),
          PROVIDER.namespace !== null && credits === null && usage.status === 'ready'
            ? h('span', { className: 'aic-hint' }, t('providerNoUsage'))
            : null,
          h('div', { className: 'aic-row' },
            h(Button, {
              disabled: PROVIDER.namespace === null || usage.status === 'loading',
              onClick: () => PROVIDER.refresh(),
            }, usage.status === 'loading' ? t('providerLoading') : t('providerRefresh')),
            usage.fetchedAt
              ? h('span', { className: 'aic-hint' }, t('providerStale', { ago: ago(usage.fetchedAt, t) }))
              : null)),

        h('div', { className: 'aic-card' },
          h('h3', null, t('behaviour')),
          BOOLEAN_FIELDS.map(([key, label, hint]) =>
            h('div', { key },
              h(Toggle, {
                label: t(label),
                hint: hint === null ? undefined : t(hint),
                checked: config[key] === true,
                onChange: (value) => set(key, value),
              }))),
          h('div', { className: 'aic-field' },
            h('label', { htmlFor: 'aic-language' }, t('language')),
            h('select', {
              id: 'aic-language',
              className: 'aic-select',
              value: config.language,
              onChange: (event) => set('language', event.target.value),
            },
              h('option', { value: 'auto' }, t('auto')),
              h('option', { value: 'es' }, t('spanish')),
              h('option', { value: 'en' }, t('english'))))),

        h('div', { className: 'aic-card' },
          h('h3', null, t('timing')),
          h('div', { className: 'aic-grid' },
            h(NumberField, { id: 'aic-grace', label: t('graceMs'), hint: t('graceHint'), value: config.graceMs, min: 0, step: 500, onChange: (value) => set('graceMs', value) }),
            h(NumberField, { id: 'aic-cooldown', label: t('cooldownMs'), value: config.cooldownMs, min: 0, step: 1000, onChange: (value) => set('cooldownMs', value) }),
            h(NumberField, { id: 'aic-consecutive', label: t('consecutive'), value: config.maxConsecutive, min: 0, max: 100, onChange: (value) => set('maxConsecutive', value) }),
            h(NumberField, { id: 'aic-rlwait', label: t('rateLimitWait'), hint: t('rateLimitHint'), value: config.rateLimitWaitMs, min: 0, step: 60000, onChange: (value) => set('rateLimitWaitMs', value) }),
            h(NumberField, { id: 'aic-backoff', label: t('backoff'), value: config.backoffFactor, min: 1, max: 10, step: 0.5, onChange: (value) => set('backoffFactor', value) }),
            h(NumberField, { id: 'aic-backoffmax', label: t('backoffMax'), value: config.backoffMaxMs, min: 0, step: 30000, onChange: (value) => set('backoffMaxMs', value) }))),

        h('div', { className: 'aic-card' },
          h('h3', null, t('guard')),
          h(Toggle, {
            label: t('classify'),
            hint: t('classifyHint'),
            checked: config.classifyErrors === true,
            onChange: (value) => set('classifyErrors', value),
          }),
          h(Toggle, {
            label: t('loopGuardToggle'),
            checked: config.loopGuard === true,
            onChange: (value) => set('loopGuard', value),
          }),
          h(NumberField, {
            id: 'aic-looplimit',
            label: t('loopRepeatLimit'),
            value: config.loopRepeatLimit,
            min: 2,
            max: 50,
            onChange: (value) => set('loopRepeatLimit', value),
          })),

        h('div', { className: 'aic-card' },
          h('h3', null, t('texts')),
          h('span', { className: 'aic-hint' }, t('textsHint')),
          TEXT_FIELDS.map(([key, label]) =>
            h('div', { key, className: 'aic-field' },
              h('label', { htmlFor: `aic-${key}` }, t(label)),
              h('textarea', {
                id: `aic-${key}`,
                className: 'aic-textarea',
                value: typeof config[key] === 'string' ? config[key] : '',
                placeholder: data.texts?.[key === 'textMaxTokens' ? 'max-tokens' : key === 'textInterrupted' ? 'interrupted' : key === 'textError' ? 'error' : key === 'textRateLimit' ? 'rate-limit' : 'completed'] ?? '',
                onChange: (event) => set(key, event.target.value),
              })))),

        h('div', { className: 'aic-card' },
          h('h3', null, t('drill')),
          h('span', { className: 'aic-hint' }, t('drillHint')),
          h('div', { className: 'aic-row' },
            DRILL_BUTTONS.map(([reason, label]) =>
              h(Button, {
                key: reason,
                disabled: busy !== '',
                onClick: () => run({
                  action: 'simulate',
                  reason,
                  session: data.session?.sessionId ?? '',
                  delayMs: Math.max(1, Number(drillSeconds) || 10) * 1000,
                  deliver: drillSend,
                }, 'drill', t('drillArmed')),
              }, t(label)))),
          h('div', { className: 'aic-row' },
            h(NumberField, {
              id: 'aic-drill-seconds',
              label: t('drillSeconds'),
              value: drillSeconds,
              min: 1,
              max: 600,
              onChange: setDrillSeconds,
            }),
            h(Toggle, { label: t('drillSend'), checked: drillSend, onChange: setDrillSend })),
          h('span', { className: 'aic-hint' }, t('drillCommand'))),

        sessions.length === 0
          ? null
          : h('div', { className: 'aic-card' },
            h('h3', null, t('sessions')),
            h('div', { className: 'aic-sessions' },
              sessions.map((entry) =>
                h('div', { key: entry.sessionId, className: 'aic-session' },
                  h('span', { className: 'aic-tag', 'data-kind': entry.armed ? 'armed' : entry.history?.[0]?.kind ?? '' },
                    entry.armed ? t('armedShort') : entry.history?.[0]?.kind ?? t('idle')),
                  h('code', null, entry.sessionId),
                  h('span', { className: 'aic-hint' },
                    [reasonText(entry.last?.key, locale), `${entry.consecutive}/${entry.limit}`].filter(Boolean).join(' · ')),
                  entry.armed
                    ? h(Button, { onClick: () => run({ action: 'continue-now', session: entry.sessionId }, 'now') }, t('now'))
                    : null)))),

        h('div', { className: 'aic-bar' },
          h(Button, {
            variant: 'primary',
            disabled: busy !== '' || !dirty,
            onClick: () => run({ action: 'save', config }, 'save', t('saved'), true),
          }, busy === 'save' ? t('saving') : t('save')),
          h(Button, { disabled: busy !== '' || !dirty, onClick: () => setDraft({ ...data.config }) }, t('revert')),
          h('span', { className: 'aic-note', 'data-tone': note?.tone ?? '' },
            note !== null ? note.text : dirty ? h('span', { className: 'aic-dirty' }, t('dirty')) : '')),
      )
    }

    /* ----------------------------------------------------------------- setup --- */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // The namespace is registered first, so the `probe` key can report which language the
        // interface resolved to: the dictionary is indexed by locale key with `en` as the default.
        let registered = false
        try {
          ctx.effect(() => ctx.locale.register(NS, DICT))
          registered = true
        } catch {
          /* the locale service is optional: both dictionaries ship inside this file */
        }

        let locale = 'en'
        if (registered) {
          try {
            const probe = ctx.locale.bind(NS)('probe')
            if (probe === 'es' || probe === 'en') locale = probe
          } catch {
            locale = 'en'
          }
        }
        if (locale === 'en' && registered === false && typeof navigator !== 'undefined'
          && String(navigator.language ?? '').toLowerCase().startsWith('es')) {
          locale = 'es'
        }

        const title = translatorFor(ctx, locale)('title')

        /* The Command Code namespace only exists while that provider is mounted, so it is taken
           through an optional inject: this plugin activates either way, and the settings card
           explains itself when there is nothing to read. */
        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['remote.commandcode'], (scoped) => {
              PROVIDER.namespace = scoped?.remote?.commandcode ?? null
              PROVIDER.refresh()
              if (typeof scoped.effect === 'function') scoped.effect(() => () => PROVIDER.reset())
            })
          }
        } catch {
          /* the provider half is optional */
        }

        try {
          ctx.slots.inject('conversation.input.dock', () =>
            ctx.slots.register(
              { name: 'conversation.input.dock', id: 'auto-continue', order: 30, label: title, locale: NS },
              (props) => h(Banner, { ...props, ctx, locale }),
            ))
        } catch {
          /* a shell without the composer dock still gets the settings page */
        }

        try {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'auto-continue', order: 13, label: title, locale: NS },
              (props) => h(SettingsPage, { ...props, ctx, locale }),
            ))
        } catch {
          /* nothing else to do: the engine keeps running without a page */
        }
      },
    }
  },
})
