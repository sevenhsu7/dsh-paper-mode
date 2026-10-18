/**
 * Paper mode save — pure core for the `cowork_save` tool.
 *
 * Enforces the Paper mode contract at the filesystem boundary:
 *   - archive folder at the workspace root: `AI-Cooperate/` (an existing
 *     `AI-CoWork/`, `AI-Corporate/` or `ai-corporate/` is used as-is;
 *     multiple candidates refuse instead of guessing);
 *   - file name `YYMMDD-<project-code>-<name>.<ext>`, with the real local date
 *     taken from the system clock and a deterministic project code;
 *   - name sanitizing, `-2`/`-3` de-duplication and never overwriting.
 *
 * No imports from dsh packages here so the logic is unit-testable with plain
 * Node; `save-tool.js` registers it as the `cowork_save` tool, building the
 * definition by hand because a linked bundle cannot import `@deepseek-ai/*`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const toolName = 'cowork_save'

export const toolDescription =
  'Save a deliverable into the workspace Paper archive with the enforced naming scheme. ' +
  'In Paper mode, write EVERY new file through this tool instead of `write`: it resolves the archive folder ' +
  '(`AI-Cooperate/`, or an existing `AI-CoWork/`/`AI-Corporate/` variant), stamps `YYMMDD-<project-code>-`, ' +
  'sanitizes the name, de-duplicates with -2/-3 and never overwrites. ' +
  'In a git repository it also adds the archive folder to .git/info/exclude (local-only; the tracked .gitignore is untouched). ' +
  'Use `edit`/`write` only for in-place edits of files that already exist.'

/** Model-facing parameter schema: plain JSON Schema, since the tool is
 *  registered without `defineTool` (see save-tool.js). */
export const parametersSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    filename: {
      type: 'string',
      description:
        'Intended file name including its extension, e.g. "竞品调研.md". Do not include the date/project prefix or any directory.',
    },
    content: {
      type: 'string',
      description: 'UTF-8 text content to write. Provide this or source_path.',
    },
    source_path: {
      type: 'string',
      description: 'Absolute path of an existing file to copy (for binary files such as images). Provide this or content.',
    },
    project_code: {
      type: 'string',
      description:
        'Optional 2-6 character project code, letter first (e.g. "AoC"). Derived from the workspace folder name when omitted. Keep it constant for the whole session.',
    },
    subdir: {
      type: 'string',
      description: 'Optional relative subfolder inside the archive folder, e.g. "reports/2026-10".',
    },
  },
  required: ['filename'],
}

export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    folder: { type: 'string' },
    bytes: { type: 'integer' },
    project_code: { type: 'string' },
    gitignored: { type: 'string', enum: ['exclude', 'already', 'not-a-repo', 'failed'] },
  },
  required: ['path', 'folder', 'bytes', 'project_code', 'gitignored'],
}

export function render(_args, value) {
  const suffix =
    value.gitignored === 'exclude'
      ? ' (added to .git/info/exclude)'
      : value.gitignored === 'already'
        ? ' (already git-ignored)'
        : value.gitignored === 'failed'
          ? ' (warning: could not update .git/info/exclude)'
          : ''
  return [{ type: 'text', text: `Saved ${value.path} (${value.bytes} bytes, project code ${value.project_code})${suffix}` }]
}

const ARCHIVE_NAMES = ['AI-Cooperate', 'AI-CoWork', 'AI-Corporate', 'ai-corporate']
/** Case-insensitive identity of the archive folder names, so a case-insensitive
 *  volume (`AI-Corporate` and `ai-corporate` are the same directory on APFS)
 *  is not mistaken for two candidates. */
const ARCHIVE_KEYS = new Set(ARCHIVE_NAMES.map((name) => name.toLowerCase()))
const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f]/g

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Local-date stamp, e.g. 2026-10-18 -> "261018". */
export function dateStamp(now = new Date()) {
  return `${pad2(now.getFullYear() % 100)}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
}


/** Walk up from the workspace root to the nearest git repository. */
function findGitDir(workspaceRoot) {
  let dir = resolve(workspaceRoot)
  for (;;) {
    const dotGit = join(dir, '.git')
    try {
      const stats = statSync(dotGit)
      if (stats.isDirectory()) return { gitDir: dotGit }
      if (stats.isFile()) {
        const content = readFileSync(dotGit, 'utf8')
        const match = /^gitdir:\s*(.+)$/m.exec(content)
        if (match === null) return { error: 'unreadable .git file' }
        let gitDir = resolve(dir, match[1].trim())
        // Linked worktrees keep `info/exclude` in the common git dir.
        const commonDirFile = join(gitDir, 'commondir')
        if (existsSync(commonDirFile)) {
          gitDir = resolve(gitDir, readFileSync(commonDirFile, 'utf8').trim())
        }
        return { gitDir }
      }
    } catch {
      /* keep walking */
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Silence `git status` for the archive folder by adding a local-only pattern to
 * `.git/info/exclude`. The tracked `.gitignore` is never touched.
 * @param workspaceRoot - workspace directory the folder lives in.
 * @param folderName - archive folder name (e.g. `AI-Cooperate`).
 * @returns `{ status: 'exclude' | 'already' | 'not-a-repo' | 'failed', path?, error? }`
 */
export function ensureArchiveIgnored(workspaceRoot, folderName = 'AI-Cooperate') {
  const found = findGitDir(workspaceRoot)
  if (found === undefined) return { status: 'not-a-repo' }
  if (found.error !== undefined) return { status: 'failed', error: found.error }
  const infoDir = join(found.gitDir, 'info')
  const excludePath = join(infoDir, 'exclude')
  const pattern = `${folderName}/`
  let existing = ''
  try {
    if (existsSync(excludePath)) existing = readFileSync(excludePath, 'utf8')
  } catch (error) {
    return { status: 'failed', error: String(error) }
  }
  const lines = existing.split(/\r?\n/).map((line) => line.trim())
  if (lines.includes(pattern) || lines.includes(folderName) || lines.includes(`/${pattern}`)) {
    return { status: 'already', path: excludePath }
  }
  try {
    mkdirSync(infoDir, { recursive: true })
    const needsNewline = existing.length > 0 && !existing.endsWith('\n')
    const markerPresent = lines.includes('# Paper mode archive (local only)')
    const marker = markerPresent ? '' : '# Paper mode archive (local only)\n'
    writeFileSync(excludePath, `${existing}${needsNewline ? '\n' : ''}${marker}${pattern}\n`)
    return { status: 'exclude', path: excludePath }
  } catch (error) {
    return { status: 'failed', error: String(error) }
  }
}

/** Resolve the archive folder; throws when the workspace holds several candidates. */
export function resolveArchiveFolder(workspaceRoot) {
  let entries = []
  try {
    entries = readdirSync(workspaceRoot, { withFileTypes: true })
  } catch {
    /* A missing/unreadable root has no archive folder yet; create the default. */
  }
  const existing = entries
    .filter((entry) => entry.isDirectory() && ARCHIVE_KEYS.has(entry.name.toLowerCase()))
    .map((entry) => ({ name: entry.name, path: join(workspaceRoot, entry.name) }))
  if (existing.length > 1) {
    throw new Error(
      `Multiple collaboration folders found: ${existing.map((entry) => entry.name).join(', ')}. ` +
        'Ask the user whether to merge them and which one to use before saving anything.',
    )
  }
  if (existing.length === 1) return existing[0]
  return { name: ARCHIVE_NAMES[0], path: join(workspaceRoot, ARCHIVE_NAMES[0]) }
}

/** Deterministic 2-6 char code derived from the workspace folder name. */
export function deriveProjectCode(workspaceRoot) {
  const raw = basename(workspaceRoot)
  const tokens = raw.split(/[^A-Za-z0-9]+/).filter(Boolean)
  let code
  if (tokens.length >= 2) {
    code = tokens
      .slice(0, 3)
      .map((token) => token[0])
      .join('')
  } else {
    code = (tokens[0] ?? '').slice(0, 3)
  }
  if (code.length < 2) code = `${code}o`
  code = code.slice(0, 6)
  const letters = code.replace(/[^A-Za-z0-9]/g, '')
  if (letters.length === 0) return 'Wrk'
  return letters[0].toUpperCase() + letters.slice(1)
}

export function normalizeProjectCode(raw) {
  const cleaned = String(raw).trim()
  if (!/^[A-Za-z][A-Za-z0-9]{1,5}$/.test(cleaned)) {
    throw new Error('project_code must be 2-6 letters/digits and start with a letter, e.g. "AoC"')
  }
  return cleaned[0].toUpperCase() + cleaned.slice(1)
}

/** Sanitize the user-facing file name (keeps the extension). */
export function sanitizeFileName(raw) {
  let name = String(raw).trim()
  name = name.replace(/^\d{6,8}[-_ ]+/, '') // drop a date prefix the model may have added
  name = name.replace(FORBIDDEN, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  name = name.replace(/\.{2,}/g, '.')
  if (name.length === 0) throw new Error('filename must contain visible characters')
  return name
}

function sanitizeSubdir(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return ''
  return String(raw)
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => part.replace(FORBIDDEN, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-'))
    .filter(Boolean)
    .join(sep)
}

function assertInside(folder, target) {
  const rel = relative(resolve(folder), resolve(target))
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('resolved path escapes the archive folder')
}

/** Validate model-supplied arguments before touching the filesystem. */
function validateArgs(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('cowork_save arguments must be an object')
  }
  if (typeof args.filename !== 'string' || args.filename.trim() === '') {
    throw new Error('filename is required and must be a non-empty string')
  }
  for (const key of ['content', 'source_path', 'project_code', 'subdir']) {
    const value = args[key]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new Error(`${key} must be a string when provided`)
    }
  }
  if (typeof args.content !== 'string' && typeof args.source_path !== 'string') {
    throw new Error('Provide `content` (UTF-8 text) or `source_path` (absolute path of a file to copy)')
  }
}

/**
 * @param args - model-supplied arguments matching {@link parametersSchema}.
 * @param workspaceRoot - the owning session's workspace directory, resolved by
 *   the caller from the Host `sessions` service (tool execution exposes only
 *   the agent id).
 * @returns the canonical result value declared by {@link outputSchema}.
 */
export function execute(args, workspaceRoot) {
  validateArgs(args)
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new Error('cowork_save requires the owning session workspace directory')
  }
  const { path: folderPath, name: folderName } = resolveArchiveFolder(workspaceRoot)
  const gitignored = ensureArchiveIgnored(workspaceRoot, folderName).status
  const projectCode = args.project_code === undefined || args.project_code === null || String(args.project_code).trim() === ''
    ? deriveProjectCode(workspaceRoot)
    : normalizeProjectCode(args.project_code)
  const subdir = sanitizeSubdir(args.subdir)
  const targetDir = subdir === '' ? folderPath : join(folderPath, subdir)
  assertInside(folderPath, targetDir)
  mkdirSync(targetDir, { recursive: true })

  const clean = sanitizeFileName(args.filename)
  const ext = extname(clean)
  const stem = clean.slice(0, clean.length - ext.length)
  const stamp = dateStamp()
  const makeName = (n) => `${stamp}-${projectCode}-${stem}${n === 1 ? '' : `-${n}`}${ext}`

  let n = 1
  while (existsSync(join(targetDir, makeName(n)))) n += 1
  const dest = join(targetDir, makeName(n))
  assertInside(folderPath, dest)

  if (typeof args.source_path === 'string' && args.source_path.length > 0) {
    if (!isAbsolute(args.source_path)) throw new Error('source_path must be an absolute path')
    if (!existsSync(args.source_path)) throw new Error(`source_path does not exist: ${args.source_path}`)
    copyFileSync(args.source_path, dest)
  } else if (typeof args.content === 'string') {
    writeFileSync(dest, args.content, 'utf8')
  } else {
    throw new Error('Provide `content` (text) or `source_path` (existing file to copy)')
  }

  return {
    path: dest,
    folder: folderName,
    bytes: statSync(dest).size,
    project_code: projectCode,
    gitignored,
  }
}
