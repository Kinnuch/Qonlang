/** 共享的只有账号；工程和语言内容不进入账号请求。 */
export const ACCOUNT_OPERATIONS = ['register', 'login', 'session', 'logout', 'profile'] as const
export type AccountOperation = (typeof ACCOUNT_OPERATIONS)[number]
export interface AccountUser {
  id: string
  username: string
  nickname: string
}
export interface AccountState {
  supported: boolean
  online: boolean
  persisted: boolean
  user: AccountUser | null
}
export interface AccountResult {
  ok: boolean
  state: AccountState
  error?: string
}
export type AccountInput = { username?: string; password?: string; nickname?: string }
