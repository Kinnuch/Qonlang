import type { AccountOperation, AccountInput, AccountResult } from '../shared/account'
import type { SupportOperation, SupportInput, SupportResult } from '../shared/support'
declare global {
  interface Window {
    qianyuji?: {
      account: (operation: AccountOperation, input?: AccountInput) => Promise<AccountResult>
      support: (operation: SupportOperation, input?: SupportInput) => Promise<SupportResult>
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, cb: (...args: unknown[]) => void) => void
    }
  }
}

export {}
