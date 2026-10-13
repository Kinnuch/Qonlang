import type { AccountOperation, AccountInput, AccountResult } from '../shared/account'
declare global {
  interface Window {
    qianyuji?: {
      account: (operation: AccountOperation, input?: AccountInput) => Promise<AccountResult>
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, cb: (...args: unknown[]) => void) => void
    }
  }
}

export {}
