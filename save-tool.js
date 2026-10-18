/**
 * Paper mode save tool — preset-scoped plugin that registers `cowork_save`.
 * The file-system contract lives in ./save-core.js so it stays unit-testable.
 *
 * This module deliberately imports nothing from `@deepseek-ai/*`. The profile
 * resolves this bundle as a linked package, so a bare specifier inside it
 * resolves from the bundle's own directory — not from the dsh installation —
 * and an `@deepseek-ai/dsh-tools` import would fail preset activation with
 * ERR_MODULE_NOT_FOUND. The tool registry accepts a plain definition whose
 * `parameters` and `output.schema` are already JSON Schema, so the definition
 * below is built by hand and stays self-contained.
 */
import * as core from './save-core.js'

export const name = 'cowork-save'

export const inject = ['tools']

export function apply(ctx) {
  /**
   * Resolve the owning session's workspace directory. Tool execution exposes
   * only the agent id (`exec.agent.id`), so the session — and its immutable
   * creation `cwd` — comes from the Host `sessions` service.
   */
  const workspaceRootOf = (exec) => {
    const sessionId = exec?.agent?.id
    if (sessionId === undefined) return undefined
    const sessions = ctx.get('sessions')
    const session = sessions?.get?.(sessionId)
    const cwd = session?.header?.cwd
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
  }

  ctx.tools.register({
    name: core.toolName,
    description: core.toolDescription,
    parameters: core.parametersSchema,
    output: {
      schema: core.outputSchema,
      render: core.render,
    },
    async execute(args, exec) {
      return core.execute(args, workspaceRootOf(exec))
    },
  })
}
