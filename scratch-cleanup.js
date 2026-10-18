/**
 * Paper mode scratch cleanup — host plugin with a six-hour TTL sweep.
 *
 * Every scratch directory this bundle creates matches
 * `paper-<YYMMDD>-<project-code>-<session-short>`. The sweep deletes only that
 * namespace, only when the directory is older than seven days, and skips
 * directories whose owning session is still live.
 */
import { CLEANUP_INTERVAL_MS, DEFAULT_RETENTION_DAYS, sweepScratchDirs } from './scratch-core.js'

export const name = 'paper-scratch-cleanup'

export function apply(ctx) {
  let disposed = false

  const isSessionActive = (sessionId) => {
    try {
      const sessions = ctx.get('sessions')
      return sessions?.get?.(sessionId) !== undefined
    } catch {
      return false
    }
  }

  const sweep = () => {
    if (disposed) return
    try {
      const report = sweepScratchDirs({ retentionDays: DEFAULT_RETENTION_DAYS, isSessionActive })
      for (const path of report.removed) console.info(`[paper-scratch-cleanup] removed ${path}`)
      for (const failure of report.failed) {
        console.error(`[paper-scratch-cleanup] failed ${failure.path}: ${failure.error}`)
      }
    } catch (error) {
      console.error('[paper-scratch-cleanup] sweep failed:', error)
    }
  }

  const initial = setTimeout(sweep, 10_000)
  if (typeof initial.unref === 'function') initial.unref()
  const timer = setInterval(sweep, CLEANUP_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()

  ctx.effect(
    () => () => {
      disposed = true
      clearTimeout(initial)
      clearInterval(timer)
    },
    'paper-scratch-cleanup.dispose',
  )
}
