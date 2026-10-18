/**
 * Paper mode scratch — pure helpers for the `scratch` tool and the TTL cleanup.
 *
 * Scratch directories live under the OS temp directory and are named
 *   paper-<YYMMDD>-<project-code>-<session-short>
 * so ownership is obvious and cleanup can stay scoped to our own namespace.
 * Nothing here imports dsh packages; `scratch-tool.js` and
 * `scratch-cleanup.js` only add the session plumbing and timers.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { deriveProjectCode, normalizeProjectCode, dateStamp } from './save-core.js'

export const SCRATCH_PREFIX = 'paper-'
export const SCRATCH_NAME_RE = /^paper-\d{6}-[A-Za-z][A-Za-z0-9]{1,5}-[0-9a-f]{4}$/
export const SCRATCH_METADATA = '.paper-scratch.json'
export const DEFAULT_RETENTION_DAYS = 7
export const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000

function sanitizeLabel(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return ''
  return String(raw)
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => part.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-'))
    .filter(Boolean)
    .join(sep)
}

/** Four hex chars derived from the session id, so concurrent sessions on the
 *  same day and project never share a directory. */
export function sessionShort(sessionId) {
  return createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 4)
}

/**
 * Compute (and create) the scratch directory for one session.
 * @param {object} options
 * @param {string} options.workspaceRoot - workspace directory of the session.
 * @param {string} options.sessionId - owning session id.
 * @param {string} [options.projectCode] - override; derived from the workspace name otherwise.
 * @param {string} [options.label] - optional relative subdirectory.
 * @param {string} [options.tmpRoot] - OS temp root (defaults to os.tmpdir()).
 * @param {Date} [options.now] - injectable clock.
 * @returns {{ dir: string, root: string, session: string, projectCode: string }}
 */
export function ensureScratchDir(options) {
  const { workspaceRoot, sessionId } = options
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new Error('scratch requires the owning session workspace directory')
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('scratch requires the owning session id')
  }
  const tmpRoot = options.tmpRoot ?? process.env.TMPDIR ?? '/tmp'
  const projectCode = options.projectCode === undefined || options.projectCode === null || String(options.projectCode).trim() === ''
    ? deriveProjectCode(workspaceRoot)
    : normalizeProjectCode(options.projectCode)
  const stamp = dateStamp(options.now ?? new Date())
  const short = sessionShort(sessionId)
  const root = join(tmpRoot, `${SCRATCH_PREFIX}${stamp}-${projectCode}-${short}`)
  const label = sanitizeLabel(options.label)
  const dir = label === '' ? root : join(root, label)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!existsSync(join(root, SCRATCH_METADATA))) {
    writeFileSync(
      join(root, SCRATCH_METADATA),
      JSON.stringify({ version: 1, sessionId, workspaceRoot, createdAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 },
    )
  }
  return { dir, root, session: short, projectCode }
}


/** Newest modification time inside a scratch tree (depth-bounded). */
function latestMtimeMs(root, depth = 0) {
  let latest = 0
  try {
    latest = statSync(root).mtimeMs
    if (depth >= 4) return latest
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const child = join(root, entry.name)
      const childLatest = entry.isDirectory() ? latestMtimeMs(child, depth + 1) : statSync(child).mtimeMs
      if (childLatest > latest) latest = childLatest
    }
  } catch {
    /* ignore unreadable entries */
  }
  return latest
}

/**
 * Delete our scratch directories older than the retention window. Active
 * sessions are skipped by the caller-supplied predicate.
 * @param {object} options
 * @param {string} [options.tmpRoot] - OS temp root.
 * @param {number} [options.retentionDays]
 * @param {Date} [options.now]
 * @param {(sessionId: string) => boolean} [options.isSessionActive]
 * @returns {{ removed: string[], kept: string[], failed: { path: string, error: string }[] }}
 */
export function sweepScratchDirs(options = {}) {
  const tmpRoot = options.tmpRoot ?? process.env.TMPDIR ?? '/tmp'
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS
  const now = (options.now ?? new Date()).getTime()
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000
  const isSessionActive = options.isSessionActive ?? (() => false)
  const removed = []
  const kept = []
  const failed = []

  let entries
  try {
    entries = readdirSync(tmpRoot, { withFileTypes: true })
  } catch (error) {
    return { removed, kept, failed: [{ path: tmpRoot, error: String(error) }] }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!SCRATCH_NAME_RE.test(entry.name)) continue
    const path = join(tmpRoot, entry.name)
    try {
      if (now - latestMtimeMs(path) < retentionMs) {
        kept.push(path)
        continue
      }
      let meta
      try {
        meta = JSON.parse(readFileSync(join(path, SCRATCH_METADATA), 'utf8'))
      } catch {
        meta = undefined
      }
      const sessionId = meta?.sessionId
      if (typeof sessionId === 'string' && isSessionActive(sessionId)) {
        kept.push(path)
        continue
      }
      rmSync(path, { recursive: true, force: true })
      removed.push(path)
    } catch (error) {
      failed.push({ path, error: String(error) })
    }
  }
  return { removed, kept, failed }
}
