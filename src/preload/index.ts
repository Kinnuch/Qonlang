import { contextBridge, ipcRenderer } from 'electron'

/** 渲染层只拿到这两个入口；具体通道见 src/main/index.ts */
const bridge = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void): void => {
    ipcRenderer.on(channel, (_e, ...args) => cb(...args))
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('qianyuji', bridge)
} else {
  // @ts-ignore 非隔离模式（仅开发）
  window.qianyuji = bridge
}
