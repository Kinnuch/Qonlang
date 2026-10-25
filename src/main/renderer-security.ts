import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { IPC_INVOKE_CHANNELS } from '../shared/ipc-security'

/** 开发服务器也只能是本机入口；正式版由调用者传入固定的 file URL。 */
export function rendererEntryUrl(fileUrl: string, developmentUrl?: string): string {
  const url = new URL(developmentUrl ?? fileUrl)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (developmentUrl
      ? url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      : url.protocol !== 'file:')
  )
    throw new Error('INVALID_RENDERER_ENTRY')
  return url.href
}

/** hash 用来在应用里跳转；路径、查询串和来源必须仍然是同一个入口。 */
export function trustedRendererUrl(value: string, entryUrl: string): boolean {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href === entryUrl
  } catch {
    return false
  }
}

/** 只把普通网页交给系统浏览器，不把不受信参数交给任意系统协议。 */
export function safeExternalUrl(value: string): string | null {
  try {
    if (
      typeof value !== 'string' ||
      value.length > 4096 ||
      [...value].some(
        (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
      )
    )
      return null
    const url = new URL(value)
    if (url.username || url.password) return null
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) return url.href
    return null
  } catch {
    return null
  }
}

export function trustedIpcSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  contents: WebContents | null,
  entryUrl: string
): boolean {
  try {
    return (
      !!contents &&
      !contents.isDestroyed() &&
      event.sender === contents &&
      !!event.senderFrame &&
      event.senderFrame === contents.mainFrame &&
      trustedRendererUrl(event.senderFrame.url, entryUrl)
    )
  } catch {
    return false
  }
}

/** 所有模块注册 handle 前安装，避免某个账号、文件或更新入口漏掉发送者检查。 */
export function guardIpcHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  current: () => WebContents | null,
  entryUrl: string
): void {
  const register = ipc.handle.bind(ipc)
  ipc.handle = (channel, listener): void => {
    if (!IPC_INVOKE_CHANNELS.has(channel)) throw new Error('INVALID_IPC_CHANNEL')
    register(channel, async (event, ...args) => {
      if (!trustedIpcSender(event, current(), entryUrl)) throw new Error('UNTRUSTED_IPC_SENDER')
      const result = await listener(event, ...args)
      if (!trustedIpcSender(event, current(), entryUrl)) throw new Error('UNTRUSTED_IPC_SENDER')
      return result
    })
  }
}

export function secureRendererContents(
  contents: WebContents,
  entryUrl: string,
  openExternal: (url: string) => Promise<unknown>
): void {
  contents.on('will-navigate', (event) => {
    if (!trustedRendererUrl(event.url, entryUrl)) event.preventDefault()
  })
  contents.on('will-redirect', (event) => {
    if (!trustedRendererUrl(event.url, entryUrl)) event.preventDefault()
  })
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !trustedRendererUrl(event.url, entryUrl)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url)
    if (safe) void openExternal(safe).catch(() => {})
    return { action: 'deny' }
  })
}
