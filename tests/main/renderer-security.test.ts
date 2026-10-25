import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  guardIpcHandlers,
  rendererEntryUrl,
  safeExternalUrl,
  secureRendererContents,
  trustedIpcSender,
  trustedRendererUrl
} from '../../src/main/renderer-security'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '../../src/shared/ipc-security'
import { mdToHtml } from '../../src/renderer/src/lib/core/markdown'

const entry = 'file:///C:/app/renderer/index.html'
function sender(url = entry): { contents: WebContents; event: IpcMainInvokeEvent } {
  const frame = { url }
  const contents = { mainFrame: frame, isDestroyed: () => false } as unknown as WebContents
  return {
    contents,
    event: { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  }
}
describe('renderer and payment IPC trust boundary', () => {
  it('uses only the pinned renderer entry, with hash navigation but no query/path/origin substitutes', () => {
    expect(rendererEntryUrl(entry)).toBe(entry)
    expect(rendererEntryUrl(entry, 'http://localhost:5173')).toBe('http://localhost:5173/')
    for (const url of [
      'https://attacker.test/',
      'http://localhost:5173/?src=remote',
      'http://user:password@localhost:5173'
    ])
      expect(() => rendererEntryUrl(entry, url)).toThrow()
    expect(trustedRendererUrl(entry + '#support', entry)).toBe(true)
    for (const url of [
      entry + '?payment=true',
      'https://attacker.test/index.html',
      'file:///C:/app/renderer/another.html'
    ])
      expect(trustedRendererUrl(url, entry)).toBe(false)
  })
  it('rejects subframes, other windows and a main frame that navigated to a remote URL', () => {
    const { contents, event } = sender()
    expect(trustedIpcSender(event, contents, entry)).toBe(true)
    expect(
      trustedIpcSender(
        { ...event, senderFrame: { url: entry } } as IpcMainInvokeEvent,
        contents,
        entry
      )
    ).toBe(false)
    expect(trustedIpcSender(sender().event, contents, entry)).toBe(false)
    ;(event.senderFrame as unknown as { url: string }).url = 'https://attacker.test/'
    expect(trustedIpcSender(event, contents, entry)).toBe(false)
  })
  it('rechecks trust after an await, before exposing a token-protected order result', async () => {
    const { contents, event } = sender()
    const handlers = new Map<string, (event: IpcMainInvokeEvent) => Promise<unknown>>()
    const ipc = {
      handle: (channel: string, listener: (event: IpcMainInvokeEvent) => Promise<unknown>) => {
        handlers.set(channel, listener)
      }
    }
    guardIpcHandlers(ipc as Pick<IpcMain, 'handle'>, () => contents, entry)
    let finish!: (value: unknown) => void
    ipc.handle(
      'support:request',
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const result = handlers.get('support:request')!(event)
    ;(event.senderFrame as unknown as { url: string }).url = 'https://attacker.test/'
    finish({ order: { sensitive: true } })
    await expect(result).rejects.toThrow('UNTRUSTED_IPC_SENDER')
    expect(() => ipc.handle('arbitrary:execute', async () => null)).toThrow('INVALID_IPC_CHANNEL')
  })
  it('blocks webviews, remote navigation and unsafe external schemes while preserving browser links', () => {
    const handlers = new Map<
      string,
      (event: { url?: string; isMainFrame?: boolean; preventDefault: () => void }) => void
    >()
    let open!: (input: { url: string }) => { action: string }
    const external = vi.fn(async () => {})
    const contents = {
      on: (name: string, cb: (event: never) => void) => {
        handlers.set(name, cb)
      },
      setWindowOpenHandler: (cb: typeof open) => {
        open = cb
      }
    }
    secureRendererContents(contents as unknown as WebContents, entry, external)
    for (const [name, values] of [
      ['will-navigate', { url: 'https://attacker.test' }],
      ['will-redirect', { url: 'https://attacker.test' }],
      ['will-frame-navigate', { url: entry, isMainFrame: false }],
      ['will-attach-webview', {}]
    ] as const) {
      const preventDefault = vi.fn()
      handlers.get(name)!({ ...values, preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
    }
    expect(open({ url: 'file:///C:/private' }).action).toBe('deny')
    expect(open({ url: 'weixin://wxpay/bizpayurl?pr=fixture' }).action).toBe('deny')
    expect(external).not.toHaveBeenCalled()
    open({ url: 'https://github.com/Kinnuch/Qonlang' })
    expect(external).toHaveBeenCalledOnce()
    for (const value of [
      'javascript:alert(1)',
      'file:///C:/Windows',
      'https://user:password@example.org',
      'https://example.org/\n'
    ])
      expect(safeExternalUrl(value)).toBeNull()
  })
  it('keeps all existing file, font, plugin and MCP channels explicitly allowed', () => {
    const source = readFileSync(resolve('src/main/index.ts'), 'utf8')
    const registered = [...source.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map(
      (match) => match[1]
    )
    for (const channel of registered) expect(IPC_INVOKE_CHANNELS.has(channel), channel).toBe(true)
    for (const channel of [
      'plugins:list',
      'plugins:dir',
      'plugins:openFolder',
      'mcp:reply',
      'study:save',
      'support:request'
    ])
      expect(IPC_INVOKE_CHANNELS.has(channel)).toBe(true)
    for (const channel of ['mcp:request', 'fonts:progress', 'menu', 'app:save-and-close'])
      expect(IPC_EVENT_CHANNELS.has(channel)).toBe(true)
    expect(source).toContain("scheme: 'qnlplugin'")
  })
  it('does not let Markdown links terminate href attributes or inject an image handler', () => {
    const html = mdToHtml('[open](https://example.org/"onclick="location.href=evil)')
    expect(html).toContain('&quot;onclick=&quot;')
    expect(html).not.toContain('"onclick="')
    expect(mdToHtml('[text](https://example.org/"><img/src=x/onerror=evil>)')).not.toContain('<img')
    expect(mdToHtml('[guide](https://kinnuch.github.io/cerf/qonlang/)')).toContain(
      'href="https://kinnuch.github.io/cerf/qonlang/"'
    )
  })
})
