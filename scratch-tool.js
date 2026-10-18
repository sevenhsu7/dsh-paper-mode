/**
 * Paper mode scratch tool — preset-scoped plugin that registers `scratch`.
 *
 * The tool names the session's scratch directory under the OS temp directory
 * and creates it. Intermediate files (temporary scripts, intermediate data,
 * screenshots) belong there, not in the workspace. `scratch-cleanup.js`
 * removes directories older than seven days.
 *
 * Like `save-tool.js`, this module imports nothing from `@deepseek-ai/*`.
 */
import * as core from './scratch-core.js'

export const name = 'paper-scratch'

export const inject = ['tools']

const toolDescription =
  'Get the scratch directory for this session and create it. Write every intermediate file ' +
  '(temporary scripts, intermediate data, process screenshots) there instead of the workspace. ' +
  'The directory lives under the system temp directory, is named paper-YYMMDD-<project-code>-<session>, ' +
  'and is deleted automatically after 7 days; copy anything worth keeping into the archive with `cowork_save`. ' +
  'Use the returned path as the working directory for commands that create files.'

export const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    project_code: {
      type: 'string',
      description: 'Optional 2-6 character project code (letter first). Derived from the workspace folder name when omitted; use the same code as `cowork_save`.',
    },
    label: {
      type: 'string',
      description: 'Optional relative subdirectory inside the scratch directory, e.g. "charts".',
    },
  },
}

export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dir: { type: 'string' },
    root: { type: 'string' },
    project_code: { type: 'string' },
    session: { type: 'string' },
    cleanup_after_days: { type: 'integer' },
  },
  required: ['dir', 'root', 'project_code', 'session', 'cleanup_after_days'],
}

export function render(_args, value) {
  return [
    {
      type: 'text',
      text: `Scratch directory: ${value.dir} (auto-deleted after ${value.cleanup_after_days} days; do not keep deliverables here)`,
    },
  ]
}

export function apply(ctx) {
  const workspaceRootOf = (exec) => {
    const sessionId = exec?.agent?.id
    if (sessionId === undefined) return undefined
    const sessions = ctx.get('sessions')
    const session = sessions?.get?.(sessionId)
    const cwd = session?.header?.cwd
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
  }

  ctx.tools.register({
    name: 'scratch',
    description: toolDescription,
    parameters,
    output: {
      schema: outputSchema,
      render,
    },
    async execute(args, exec) {
      const sessionId = exec?.agent?.id
      const workspaceRoot = workspaceRootOf(exec)
      if (workspaceRoot === undefined) {
        throw new Error('scratch requires the owning session workspace directory')
      }
      const result = core.ensureScratchDir({
        workspaceRoot,
        sessionId,
        projectCode: args?.project_code,
        label: args?.label,
      })
      return {
        dir: result.dir,
        root: result.root,
        project_code: result.projectCode,
        session: result.session,
        cleanup_after_days: core.DEFAULT_RETENTION_DAYS,
      }
    },
  })
}
