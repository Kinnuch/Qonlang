declare global {
  interface Window {
    qianyuji?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, cb: (...args: unknown[]) => void) => void
    }
  }
}

export {}
