/**
 * Paper mode title badge (host plugin).
 *
 * Prefixes `📑 ` on the durable session title of every session running the
 * Paper mode agent preset, so Paper sessions stand out in the sidebar.
 *
 * How it works: the deployment's session-title service appends
 * `session/title` events (fallback -> optional LLM provider -> explicit user
 * rename, last one wins). This plugin observes those events for sessions
 * whose agent preset is `cowork` (internal id) and rewrites the accepted title through
 * `sessionTitle.rename()`.
 *
 * - Provider titles (normal path) are decorated as soon as they land.
 * - Fallback titles are decorated after a grace period, only when no provider
 *   title arrived, so the nicer LLM title is never replaced by a fallback.
 * - User renames are left alone (the user is always right).
 */
export const name = 'cowork-title-badge'  // internal id, kept for compatibility

const PREFIX = '📑 '
/** Session titles are capped at 80 UTF-8 bytes by the shipped title service.
 *  "📑 " is 5 bytes, so keep the decorated title body within 75 bytes. */
const MAX_TITLE_BODY_BYTES = 75
/** Wait this long for the async LLM title before decorating a fallback. */
const FALLBACK_GRACE_MS = 20_000

const encoder = new TextEncoder()

function utf8Bytes(text) {
  return encoder.encode(text).length
}

/** Truncate to a byte budget without splitting a Unicode code point. */
function truncateUtf8(text, maxBytes) {
  if (utf8Bytes(text) <= maxBytes) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const size = utf8Bytes(ch)
    if (used + size > maxBytes) break
    out += ch
    used += size
  }
  return out.trimEnd()
}

export function apply(ctx) {
  /** Session ids currently running the Paper preset (internal id "cowork"). */
  const paperSessions = new Set()
  /** session id -> pending fallback-decoration timer. */
  const timers = new Map()
  /** session id -> source kind of the latest title event. */
  const lastSource = new Map()
  let disposed = false

  const titleService = () => ctx.get('sessionTitle')

  const decorate = (session) => {
    if (disposed || !paperSessions.has(session?.id)) return
    const service = titleService()
    if (service === undefined || service === null) return
    let current
    try {
      // SessionTitleService.get() returns a SessionTitleSnapshot, not a string.
      current = service.get(session)?.title
    } catch {
      return
    }
    if (typeof current !== 'string' || current.length === 0) return
    if (current.startsWith('📑') || current.startsWith('📄') || current.startsWith('💻')) return
    const next = PREFIX + truncateUtf8(current, MAX_TITLE_BODY_BYTES)
    if (next === current) return
    try {
      service.rename(session, next)
    } catch {
      /* session disposed between event and decoration */
    }
  }

  const clearTimer = (id) => {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  ctx.on('session/created', (session) => {
    if (session?.header?.agentPreset === 'cowork') paperSessions.add(session.id)
  }, { global: true })

  ctx.on('session/event', (session, event) => {
    if (disposed) return
    const id = session?.id
    if (id === undefined) return

    // Keep the paper-session set in sync with preset selection (the preset is
    // chosen on a blank session before its first turn).
    if (event?.type === 'agent-preset/selected') {
      if (event.data?.agentPreset === 'cowork') {
        paperSessions.add(id)
      } else {
        paperSessions.delete(id)
        clearTimer(id)
      }
      return
    }

    if (event?.type !== 'session/title') return
    if (!paperSessions.has(id)) return

    const source = event.data?.source?.kind
    lastSource.set(id, source)

    if (source === 'user') {
      clearTimer(id)
      return
    }

    if (source === 'provider') {
      clearTimer(id)
      queueMicrotask(() => decorate(session))
      return
    }

    if (source === 'fallback') {
      clearTimer(id)
      const timer = setTimeout(() => {
        timers.delete(id)
        if (lastSource.get(id) !== 'provider') decorate(session)
      }, FALLBACK_GRACE_MS)
      if (typeof timer.unref === 'function') timer.unref()
      timers.set(id, timer)
    }
  }, { global: true })

  ctx.effect(() => () => {
    disposed = true
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }, 'cowork-title-badge.dispose')
}
