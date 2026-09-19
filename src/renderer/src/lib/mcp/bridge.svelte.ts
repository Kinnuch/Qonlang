/**
 * MCP 在渲染层这一头：主进程收到 LLM 的请求后转过来，这里拿当前项目真的去做，再回话。
 * 写操作默认先弹一个确认框（设置里可以关掉）——别人的 LLM 连上来时，改动总要过一下眼。
 */
import { platform } from '$lib/platform'
import { projectState } from '$lib/state/project.svelte'
import { ui } from '$lib/state/ui.svelte'
import { t } from '$lib/i18n/index.svelte'
import { mcpTools, type McpContext, type McpToolDef } from './tools'

interface McpRequest {
  id: number
  kind: 'list' | 'call'
  name: string
  args: Record<string, unknown>
}

/** 工具表：内置的加上插件注册的（插件可以用 qonlang.mcp.registerTool 加） */
export const pluginMcpTools = $state<{ pluginId: string; tool: McpToolDef }[]>([])

function allTools(): McpToolDef[] {
  return [...mcpTools(), ...pluginMcpTools.map((x) => x.tool)]
}

function context(): McpContext {
  return {
    project: () => {
      const p = projectState.project
      if (!p) throw new Error(t('mcp.noProject'))
      return p
    },
    edit: (fn) => {
      const p = projectState.project
      if (!p) throw new Error(t('mcp.noProject'))
      fn(p)
      projectState.touch()
    },
    currentLanguageId: () => projectState.currentLanguageId
  }
}

/** 最近的调用记录（设置页里显示，让人看得见 LLM 在做什么） */
export const mcpLog = $state<{ at: number; name: string; ok: boolean; note: string }[]>([])

function log(name: string, ok: boolean, note: string): void {
  mcpLog.unshift({ at: Date.now(), name, ok, note })
  if (mcpLog.length > 30) mcpLog.length = 30
}

async function handle(req: McpRequest): Promise<void> {
  // 过 IPC 要能结构化克隆：项目里的对象是 Svelte 的响应式代理，先转成普通对象
  const plain = (v: unknown): unknown => {
    if (v === undefined) return null
    try {
      return JSON.parse(JSON.stringify(v))
    } catch {
      return String(v)
    }
  }
  const reply = (result: unknown, error?: string): void => {
    void platform.mcpReply(req.id, plain(result), error)
  }
  try {
    if (req.kind === 'list') {
      reply(
        allTools().map((x) => ({
          name: x.name,
          description: x.description + (x.write ? t('mcp.writeSuffix') : ''),
          inputSchema: x.inputSchema
        }))
      )
      return
    }
    const tool = allTools().find((x) => x.name === req.name)
    if (!tool) throw new Error(t('mcp.unknownTool', { name: req.name }))
    // 写操作：默认问一下
    if (tool.write && ui.prefs.mcpConfirmWrites !== false) {
      const ok = await ui.confirm(
        t('mcp.confirmTitle'),
        t('mcp.confirmBody', { name: tool.name, args: JSON.stringify(req.args) })
      )
      if (!ok) {
        log(req.name, false, t('mcp.declined'))
        reply(null, t('mcp.declined'))
        return
      }
    }
    const out = await tool.run(req.args, context())
    log(req.name, true, tool.write ? t('mcp.wrote') : '')
    reply(out)
  } catch (e) {
    log(req.name || 'list', false, (e as Error).message)
    reply(null, (e as Error).message)
  }
}

let wired = false
/** 启动时接上（App.svelte 里调一次） */
export function wireMcp(): void {
  if (wired) return
  wired = true
  platform.onMcpRequest((req) => void handle(req as McpRequest))
}
