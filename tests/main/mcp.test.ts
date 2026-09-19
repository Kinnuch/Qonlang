import { afterEach, describe, expect, it } from 'vitest'
import { startMcpServer, type McpServerHandle, type McpTool } from '../../src/main/mcp'

const TOKEN = 'ce-shi-ling-pai'

const TOOLS: McpTool[] = [
  {
    name: 'lexicon.search',
    description: '按词形或释义查词条',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
  },
  {
    name: 'project.info',
    description: '当前项目的概况',
    inputSchema: { type: 'object', properties: {} }
  }
]

/** 每个用例起一台，收尾一起关掉 */
const started: McpServerHandle[] = []
const errors: unknown[] = []

async function serve(
  over: Partial<Parameters<typeof startMcpServer>[0]> = {}
): Promise<McpServerHandle> {
  const h = await startMcpServer({
    port: 0,
    token: TOKEN,
    version: '1.2.3',
    listTools: () => TOOLS,
    callTool: async (name, args) => ({ name, args }),
    onError: (e) => errors.push(e),
    ...over
  })
  started.push(h)
  return h
}

/** 打一条 JSON-RPC 过去，把 HTTP 状态和 body 一起拿回来 */
async function rpc(
  h: McpServerHandle,
  body: unknown,
  init: { token?: string | null; query?: boolean } = {}
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const token = init.token === undefined ? TOKEN : init.token
  const url = init.query && token ? `${h.url}?token=${encodeURIComponent(token)}` : h.url
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token && !init.query) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
  const text = await res.text()
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null }
}

const req = (method: string, params?: unknown, id: number = 1): unknown => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params })
})

afterEach(async () => {
  while (started.length) await started.pop()!.close()
  errors.length = 0
})

describe('起服务', () => {
  it('端口 0 挑一个空闲端口，url 指向 127.0.0.1', async () => {
    const h = await serve()
    expect(h.port).toBeGreaterThan(0)
    expect(h.url).toBe(`http://127.0.0.1:${h.port}/mcp`)
  })

  it('端口被占用时抛一个看得懂的错，不卡住', async () => {
    const first = await serve()
    await expect(serve({ port: first.port })).rejects.toThrow(/EADDRINUSE/)
  })

  it('close() 之后端口真的关了', async () => {
    const h = await serve()
    const url = h.url
    expect((await rpc(h, req('ping'))).status).toBe(200)
    await h.close()
    started.pop()
    await expect(fetch(url, { method: 'POST', body: '{}' })).rejects.toThrow()
    // 关两次不报错
    await h.close()
  })
})

describe('协议', () => {
  it('initialize 回协议版本、tools 能力与 serverInfo', async () => {
    const h = await serve()
    const { status, json } = await rpc(h, req('initialize', { protocolVersion: '2025-06-18' }))
    expect(status).toBe(200)
    expect(json).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'qonlang', version: '1.2.3' }
      }
    })
  })

  it('没给版本号就报 0', async () => {
    const h = await serve({ version: undefined })
    const { json } = await rpc(h, req('initialize'))
    expect((json?.result as { serverInfo: { version: string } }).serverInfo.version).toBe('0')
  })

  it('notifications/initialized 回 202、没有 body', async () => {
    const h = await serve()
    const res = await fetch(h.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('tools/list 列出当次问到的工具', async () => {
    let round = 0
    const h = await serve({ listTools: () => (round++ === 0 ? TOOLS : []) })
    const first = await rpc(h, req('tools/list'))
    expect((first.json?.result as { tools: McpTool[] }).tools).toEqual(TOOLS)
    // 每次都重新问一遍，插件加了工具立刻看得到
    const second = await rpc(h, req('tools/list'))
    expect((second.json?.result as { tools: McpTool[] }).tools).toEqual([])
  })

  it('tools/call 把结果同时给 structuredContent 和 text', async () => {
    const h = await serve()
    const { status, json } = await rpc(
      h,
      req('tools/call', { name: 'lexicon.search', arguments: { q: 'mara' } })
    )
    expect(status).toBe(200)
    const result = json?.result as {
      content: { type: string; text: string }[]
      structuredContent: unknown
      isError?: boolean
    }
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({ name: 'lexicon.search', args: { q: 'mara' } })
    expect(result.content[0].type).toBe('text')
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent)
  })

  it('没带 arguments 时按空对象调', async () => {
    const seen: Record<string, unknown>[] = []
    const h = await serve({
      callTool: async (_name, args) => {
        seen.push(args)
        return { ok: true }
      }
    })
    await rpc(h, req('tools/call', { name: 'project.info' }))
    expect(seen).toEqual([{}])
  })

  it('工具抛错时 isError 为 true，JSON-RPC 不算 error', async () => {
    const h = await serve({
      callTool: async () => {
        throw new Error('没有打开的项目')
      }
    })
    const { status, json } = await rpc(h, req('tools/call', { name: 'project.info' }))
    expect(status).toBe(200)
    expect(json?.error).toBeUndefined()
    const result = json?.result as { content: { text: string }[]; isError: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('没有打开的项目')
    expect(errors).toHaveLength(1)
  })

  it('tools/call 缺工具名是 -32602', async () => {
    const h = await serve()
    const { json } = await rpc(h, req('tools/call', { arguments: {} }))
    expect((json?.error as { code: number }).code).toBe(-32602)
  })

  it('未知方法回 -32601', async () => {
    const h = await serve()
    const { status, json } = await rpc(h, req('resources/list'))
    expect(status).toBe(200)
    expect(json).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32601 } })
  })

  it('解析不了的 body 回 -32700', async () => {
    const h = await serve()
    const { json } = await rpc(h, '{ 这不是 JSON')
    expect((json?.error as { code: number }).code).toBe(-32700)
    expect(json?.id).toBeNull()
  })

  it('不是 JSON-RPC 请求回 -32600', async () => {
    const h = await serve()
    expect(((await rpc(h, { hello: 1 })).json?.error as { code: number }).code).toBe(-32600)
    expect(((await rpc(h, [req('ping')])).json?.error as { code: number }).code).toBe(-32600)
  })
})

describe('鉴权', () => {
  it('Authorization: Bearer 与 ?token= 两种都认', async () => {
    const h = await serve()
    expect((await rpc(h, req('ping'))).status).toBe(200)
    expect((await rpc(h, req('ping'), { query: true })).status).toBe(200)
  })

  it('令牌不对或没带都是 401，body 是 JSON-RPC error', async () => {
    const h = await serve()
    const bad = await rpc(h, req('ping'), { token: 'bu-dui' })
    expect(bad.status).toBe(401)
    expect(bad.json?.error).toBeTruthy()
    expect((await rpc(h, req('ping'), { token: null })).status).toBe(401)
    expect((await rpc(h, req('ping'), { token: 'bu-dui', query: true })).status).toBe(401)
    // 令牌是前缀也不行
    expect((await rpc(h, req('ping'), { token: TOKEN.slice(0, -1) })).status).toBe(401)
  })

  it('带上 Origin 也不能靠 CORS 绕过鉴权', async () => {
    const h = await serve()
    const res = await fetch(h.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' },
      body: JSON.stringify(req('tools/list'))
    })
    expect(res.status).toBe(401)
  })
})

describe('HTTP 这一层', () => {
  it('OPTIONS 预检回 204 且放开 CORS', async () => {
    const h = await serve()
    const res = await fetch(h.url, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.invalid', 'Access-Control-Request-Method': 'POST' }
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-headers')).toMatch(/Authorization/i)
  })

  it('GET /mcp 回 405（不做服务端推送）', async () => {
    const h = await serve()
    const res = await fetch(h.url, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toMatch(/POST/)
  })

  it('别的路径回 404', async () => {
    const h = await serve()
    const res = await fetch(`http://127.0.0.1:${h.port}/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: '{}'
    })
    expect(res.status).toBe(404)
  })

  it('请求体超过 4 MB 回 413', async () => {
    const h = await serve()
    const big = {
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: { pad: 'x'.repeat(5 * 1024 * 1024) }
    }
    const res = await fetch(h.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(big)
    })
    expect(res.status).toBe(413)
  })

  it('4 MB 以内照常处理', async () => {
    const h = await serve()
    const { status, json } = await rpc(h, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'project.info', arguments: { pad: 'x'.repeat(1024 * 1024) } }
    })
    expect(status).toBe(200)
    expect(json?.id).toBe(7)
  })
})
