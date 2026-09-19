/**
 * 主进程里的 MCP 服务本体，只管协议这一层：收 JSON-RPC、认令牌、把 tools/call 转出去。
 *
 * 工具清单和真正的执行都由调用方注入（干活的在渲染层），这里不认识任何一个具体工具——
 * 加工具、换工具都不用动这个文件。传输用 MCP 的 Streamable HTTP，但只做「一问一答」的
 * POST，不做服务端推送（SSE）：千语集的工具都是立刻有结果的调用，没有服务端主动通知。
 * 只用 node:http，不为一个本地小服务多背一份依赖。
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { timingSafeEqual } from 'node:crypto'

export interface McpTool {
  name: string
  description: string
  /** JSON Schema（object 类型），给 tools/list 用 */
  inputSchema: Record<string, unknown>
}

export interface McpServerOptions {
  /** 监听端口；0 表示随便挑一个空闲端口 */
  port?: number
  /** 访问令牌；请求头 Authorization: Bearer <token> 或 ?token= 都要认 */
  token: string
  /** 报给客户端的服务版本号（serverInfo.version），没给就写 '0' */
  version?: string
  /** 有哪些工具（每次 tools/list 都问一次，插件可能加新工具） */
  listTools: () => Promise<McpTool[]> | McpTool[]
  /** 真正执行工具：交给渲染层做，返回结构化结果或抛错 */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** 出错时记一笔（主进程的日志） */
  onError?: (e: unknown) => void
}

export interface McpServerHandle {
  port: number
  url: string
  close: () => Promise<void>
}

/** 报给客户端的协议版本 */
const PROTOCOL_VERSION = '2025-06-18'
/** 单个请求体上限，超了回 413 */
const MAX_BODY = 4 * 1024 * 1024
/** 请求体超限的哨兵，跟「正常读到的空串」区分开 */
const TOO_LARGE = Symbol('too-large')

type JsonRpcId = string | number | null

interface JsonRpcMessage {
  jsonrpc?: unknown
  id?: JsonRpcId
  method?: unknown
  params?: unknown
}

/** JSON-RPC 的错误信封；HTTP 状态码另外给，两者不一定一致（401 里也是这个 body） */
function rpcError(id: JsonRpcId, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function rpcResult(id: JsonRpcId, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  return typeof e === 'string' ? e : JSON.stringify(e) || String(e)
}

/**
 * 统一发响应。body 传 null 表示不带 body（204 预检、202 通知）。
 * CORS 一律放开：本地服务只认令牌，不靠来源判断谁能用（浏览器端的客户端会先打预检）。
 */
function send(res: ServerResponse, status: number, body: unknown): void {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store'
  }
  if (body === null) {
    res.writeHead(status, headers)
    res.end()
    return
  }
  const text = JSON.stringify(body) ?? 'null'
  headers['Content-Type'] = 'application/json; charset=utf-8'
  headers['Content-Length'] = String(Buffer.byteLength(text))
  res.writeHead(status, headers)
  res.end(text)
}

/** 长度不同就直接不等，免得 timingSafeEqual 抛错 */
function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

function tokenOf(req: IncomingMessage, url: URL): string {
  const auth = req.headers['authorization']
  const header = Array.isArray(auth) ? auth[0] : auth
  const m = /^Bearer\s+(.+)$/i.exec((header ?? '').trim())
  if (m) return m[1].trim()
  return url.searchParams.get('token') ?? ''
}

/**
 * 读完请求体。超过上限就立刻回哨兵，但照收剩下的字节丢掉——
 * 直接 destroy 的话 413 还没发出去连接就断了，客户端只会看到「连接被重置」。
 */
function readBody(req: IncomingMessage): Promise<string | typeof TOO_LARGE> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    req.on('data', (c: Buffer) => {
      if (done) return
      size += c.length
      if (size > MAX_BODY) {
        done = true
        resolve(TOO_LARGE)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (done) return
      done = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (e) => {
      if (done) return
      done = true
      reject(e)
    })
  })
}

/** 没这个方法，回 -32601 */
class UnknownMethod extends Error {
  constructor(method: string) {
    super(`未知方法：${method}`)
  }
}

/** 参数不对，回 -32602 */
class BadParams extends Error {}

/** 一条 JSON-RPC 请求要回什么 result；抛出来的错由外面包成 JSON-RPC error */
async function dispatch(
  method: string,
  params: Record<string, unknown>,
  opts: McpServerOptions
): Promise<unknown> {
  if (method === 'initialize')
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'qonlang', version: opts.version ?? '0' }
    }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: await opts.listTools() }
  if (method === 'tools/call') {
    const name = params['name']
    if (typeof name !== 'string' || !name) throw new BadParams('tools/call 缺少工具名')
    const raw = params['arguments']
    const args =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    try {
      const out = await opts.callTool(name, args)
      // 工具本身的失败按 MCP 的规矩走 result.isError，不是 JSON-RPC error：
      // JSON-RPC error 表示「这次调用没发生」，模型看不到失败原因也就没法改。
      return {
        content: [{ type: 'text', text: out === undefined ? '' : (JSON.stringify(out) ?? '') }],
        ...(out === undefined ? {} : { structuredContent: out })
      }
    } catch (e) {
      opts.onError?.(e)
      return { content: [{ type: 'text', text: errText(e) }], isError: true }
    }
  }
  throw new UnknownMethod(method)
}

export function startMcpServer(opts: McpServerOptions): Promise<McpServerHandle> {
  const fail = (e: unknown): void => {
    try {
      opts.onError?.(e)
    } catch {
      // 记日志本身出错就算了，不能因此拖垮请求
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      fail(e)
      if (!res.headersSent) send(res, 500, rpcError(null, -32603, errText(e)))
      else res.end()
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    // 预检带不了 Authorization，只能放过；真正的请求下面照样要认令牌，绕不过去
    if (req.method === 'OPTIONS') return send(res, 204, null)
    if (path !== '/mcp') {
      req.resume()
      return send(res, 404, rpcError(null, -32601, '只有 /mcp'))
    }
    if (req.method !== 'POST') {
      // 不做服务端推送，所以没有 GET 的 SSE 通道
      req.resume()
      res.setHeader('Allow', 'POST, OPTIONS')
      return send(res, 405, rpcError(null, -32601, '只收 POST'))
    }
    if (!sameToken(tokenOf(req, url), opts.token)) {
      req.resume()
      return send(res, 401, rpcError(null, -32600, '令牌不对'))
    }

    const body = await readBody(req)
    if (body === TOO_LARGE) return send(res, 413, rpcError(null, -32600, '请求体太大'))

    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(body) as JsonRpcMessage
    } catch {
      return send(res, 400, rpcError(null, -32700, '解析不了的 JSON'))
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string')
      return send(res, 400, rpcError(null, -32600, '不是一条 JSON-RPC 请求'))

    const method = msg.method
    // 没有 id 的是通知（notifications/initialized 这类），照 JSON-RPC 不回 body
    if (msg.id === undefined || method.startsWith('notifications/')) return send(res, 202, null)
    const id: JsonRpcId = msg.id
    const p = msg.params
    const params =
      p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {}

    try {
      return send(res, 200, rpcResult(id, await dispatch(method, params, opts)))
    } catch (e) {
      if (e instanceof UnknownMethod) return send(res, 200, rpcError(id, -32601, e.message))
      if (e instanceof BadParams) return send(res, 200, rpcError(id, -32602, e.message))
      fail(e)
      return send(res, 200, rpcError(id, -32603, errText(e)))
    }
  }

  // 半开连接、客户端中途断线这类不该让主进程炸掉，记一笔就行
  server.on('clientError', (e, socket) => {
    fail(e)
    socket.destroy()
  })

  return new Promise<McpServerHandle>((resolve, reject) => {
    const onListenError = (e: NodeJS.ErrnoException): void => {
      server.close()
      const port = opts.port ?? 0
      reject(
        e.code === 'EADDRINUSE'
          ? new Error(`MCP 服务起不来：端口 ${port} 被占用（EADDRINUSE）`, { cause: e })
          : new Error(`MCP 服务起不来：${errText(e)}`, { cause: e })
      )
    }
    server.once('error', onListenError)
    // 只听 127.0.0.1：这个口子等于本机上任何程序都能读写项目，绝不能让它露到局域网
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', onListenError)
      server.on('error', fail)
      const port = (server.address() as AddressInfo).port
      resolve({
        port,
        url: `http://127.0.0.1:${port}/mcp`,
        close: () =>
          new Promise<void>((done, bad) => {
            if (!server.listening) return done()
            server.close((e) => (e ? bad(e) : done()))
            // keep-alive 的连接不主动掐断的话 close 会一直等着
            server.closeAllConnections()
          })
      })
    })
  })
}
