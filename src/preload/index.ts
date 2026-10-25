import { contextBridge, ipcRenderer } from 'electron'
import type { AccountOperation, AccountInput, AccountResult } from '../shared/account'
import type { SupportOperation, SupportInput, SupportResult } from '../shared/support'
import { IPC_INVOKE_CHANNELS, IPC_EVENT_CHANNELS } from '../shared/ipc-security'

/** 渲染层只拿到这两个入口；具体通道见 src/main/index.ts */
const bridge = {
  account: (operation: AccountOperation, input?: AccountInput): Promise<AccountResult> =>
    ipcRenderer.invoke('account:request', operation, input),
  support: (operation: SupportOperation, input?: SupportInput): Promise<SupportResult> =>
    ipcRenderer.invoke('support:request', operation, input),
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    IPC_INVOKE_CHANNELS.has(channel)
      ? ipcRenderer.invoke(channel, ...args)
      : Promise.reject(new Error('INVALID_IPC_CHANNEL')),
  on: (channel: string, cb: (...args: unknown[]) => void): void => {
    if (!IPC_EVENT_CHANNELS.has(channel)) throw new Error('INVALID_IPC_CHANNEL')
    ipcRenderer.on(channel, (_e, ...args) => cb(...args))
  }
}

if (process.isMainFrame && process.contextIsolated) {
  contextBridge.exposeInMainWorld('qianyuji', bridge)
}
