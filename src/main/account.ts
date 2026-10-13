import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AccountInput, AccountResult, AccountState, AccountUser } from '../shared/account'
import { ACCOUNT_OPERATIONS, type AccountOperation } from '../shared/account'

interface SecureStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}
interface AccountOptions {
  userData: string
  packaged: boolean
  secureStorage: SecureStorage
  apiBase?: string
  fetch?: typeof globalThis.fetch
}
interface Session {
  token: string
  expiresAt: number
  user: AccountUser
}
const PRODUCTION_BASE = 'https://kinnuch.cn/qon-api/v1'
const ERRORS = new Set([
  'INVALID_CREDENTIALS',
  'USERNAME_TAKEN',
  'RATE_LIMITED',
  'INVALID_INPUT',
  'INVALID_USERNAME',
  'INVALID_PASSWORD',
  'INVALID_NICKNAME',
  'UNAUTHORIZED',
  'SESSION_EXPIRED'
])

/** 正式版不接受环境配置；开发测试也只允许环回地址，不向任意主机转发令牌。 */
export function accountApiBase(packaged: boolean, override?: string): string {
  if (packaged || !override) return PRODUCTION_BASE
  const url = new URL(override)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, '') !== '/v1'
  )
    throw new Error('Invalid account test API')
  return url.href.replace(/\/$/, '')
}
function userFrom(value: unknown): AccountUser {
  if (!value || typeof value !== 'object') throw new Error('SERVICE_UNAVAILABLE')
  const user = value as Record<string, unknown>
  if (
    typeof user.id !== 'string' ||
    typeof user.username !== 'string' ||
    typeof user.nickname !== 'string'
  )
    throw new Error('SERVICE_UNAVAILABLE')
  return { id: user.id, username: user.username, nickname: user.nickname }
}
function credentials(operation: AccountOperation, value: unknown): AccountInput {
  const input = value ?? {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_INPUT')
  const body = input as Record<string, unknown>
  const keys =
    operation === 'register'
      ? ['username', 'password', 'nickname']
      : operation === 'login'
        ? ['username', 'password']
        : operation === 'profile'
          ? ['nickname']
          : []
  if (Object.keys(body).some((key) => !keys.includes(key))) throw new Error('INVALID_INPUT')
  if (operation === 'login' || operation === 'register') {
    if (typeof body.username !== 'string' || !/^[a-z0-9_]{3,32}$/i.test(body.username.trim()))
      throw new Error('INVALID_USERNAME')
    if (
      typeof body.password !== 'string' ||
      body.password.length < 10 ||
      body.password.length > 128
    )
      throw new Error('INVALID_PASSWORD')
  }
  if (
    body.nickname !== undefined &&
    (typeof body.nickname !== 'string' || !body.nickname.trim() || body.nickname.trim().length > 40)
  )
    throw new Error('INVALID_NICKNAME')
  if (operation === 'profile' && body.nickname === undefined) throw new Error('INVALID_NICKNAME')
  return {
    ...(typeof body.username === 'string' ? { username: body.username.trim().toLowerCase() } : {}),
    ...(typeof body.password === 'string' ? { password: body.password } : {}),
    ...(typeof body.nickname === 'string' ? { nickname: body.nickname.trim() } : {})
  }
}

/** 所有账号操作串行；网络返回和注销、账号文件写盘不能互相覆盖。 */
export class AccountClient {
  readonly file: string
  readonly base: string
  #session: Session | null = null
  #loaded = false
  #online = true
  #persisted = false
  #tail: Promise<unknown> = Promise.resolve()
  constructor(private options: AccountOptions) {
    this.file = join(options.userData, 'account-session.enc')
    this.base = accountApiBase(options.packaged, options.apiBase)
  }
  #canPersist(): boolean {
    return (
      this.options.secureStorage.isEncryptionAvailable() &&
      this.options.secureStorage.getSelectedStorageBackend?.() !== 'basic_text'
    )
  }
  #state(): AccountState {
    return {
      supported: true,
      online: this.#online,
      persisted: this.#persisted,
      user: this.#session?.user ?? null
    }
  }
  async #load(): Promise<void> {
    if (this.#loaded) return
    this.#loaded = true
    if (!this.#canPersist()) return
    try {
      const raw = await fs.readFile(this.file)
      const parsed = JSON.parse(this.options.secureStorage.decryptString(raw)) as Session
      if (
        typeof parsed.token !== 'string' ||
        parsed.token.length < 16 ||
        !Number.isFinite(parsed.expiresAt) ||
        parsed.expiresAt <= Date.now()
      ) {
        await fs.rm(this.file, { force: true })
        return
      }
      this.#session = {
        token: parsed.token,
        expiresAt: parsed.expiresAt,
        user: userFrom(parsed.user)
      }
      this.#persisted = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        await fs.rm(this.file, { force: true }).catch(() => {})
    }
  }
  async #save(): Promise<void> {
    if (!this.#session || !this.#canPersist()) {
      this.#persisted = false
      return
    }
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(this.options.userData, { recursive: true })
      await fs.writeFile(
        temporary,
        this.options.secureStorage.encryptString(JSON.stringify(this.#session)),
        { mode: 0o600 }
      )
      await fs.chmod(temporary, 0o600)
      await fs.rename(temporary, this.file)
      this.#persisted = true
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw new Error('STORAGE_FAILURE')
    }
  }
  async #clear(): Promise<void> {
    this.#session = null
    this.#persisted = false
    await fs.rm(this.file, { force: true })
  }
  async #request(
    path: string,
    method: string,
    body?: AccountInput
  ): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(this.base + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        headers: {
          'Content-Type': 'application/json',
          'X-Qon-App': 'qonlang',
          ...(this.#session ? { Authorization: `Bearer ${this.#session.token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
    } catch {
      this.#online = false
      throw new Error('OFFLINE')
    }
    this.#online = true
    const text = await response.text()
    if (text.length > 512000) throw new Error('SERVICE_UNAVAILABLE')
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('SERVICE_UNAVAILABLE')
    }
    if (!response.ok) {
      const code = (data.error as { code?: unknown } | undefined)?.code
      if (response.status === 401 && this.#session) await this.#clear()
      throw new Error(
        typeof code === 'string' && ERRORS.has(code)
          ? code
          : response.status === 429
            ? 'RATE_LIMITED'
            : 'SERVICE_UNAVAILABLE'
      )
    }
    return data
  }
  handle(operation: unknown, input?: unknown): Promise<AccountResult> {
    const run = this.#tail.then(async (): Promise<AccountResult> => {
      try {
        if (
          typeof operation !== 'string' ||
          !(ACCOUNT_OPERATIONS as readonly string[]).includes(operation)
        )
          throw new Error('INVALID_INPUT')
        await this.#load()
        const op = operation as AccountOperation
        const body = credentials(op, input)
        if (op === 'logout') {
          let error: string | undefined
          try {
            if (this.#session) await this.#request('/auth/logout', 'POST', {})
          } catch (e) {
            error = (e as Error).message
          }
          await this.#clear()
          return { ok: true, state: this.#state(), ...(error ? { error: 'LOGOUT_OFFLINE' } : {}) }
        }
        if (op === 'session') {
          if (!this.#session) return { ok: true, state: this.#state() }
          if (this.#session.expiresAt <= Date.now()) {
            await this.#clear()
            throw new Error('SESSION_EXPIRED')
          }
          const result = await this.#request('/auth/me', 'GET')
          this.#session.user = userFrom(result.user)
          await this.#save()
        } else if (op === 'profile') {
          if (!this.#session) throw new Error('UNAUTHORIZED')
          const result = await this.#request('/auth/me', 'PATCH', body)
          this.#session.user = userFrom(result.user)
          await this.#save()
        } else {
          const result = await this.#request(`/auth/${op}`, 'POST', body)
          if (
            typeof result.token !== 'string' ||
            result.token.length < 16 ||
            typeof result.expiresAt !== 'number' ||
            result.expiresAt <= Date.now()
          )
            throw new Error('SERVICE_UNAVAILABLE')
          this.#session = {
            token: result.token,
            expiresAt: result.expiresAt,
            user: userFrom(result.user)
          }
          await this.#save()
        }
        return { ok: true, state: this.#state() }
      } catch (error) {
        const message = (error as Error).message
        return {
          ok: false,
          state: this.#state(),
          error:
            ERRORS.has(message) ||
            ['OFFLINE', 'STORAGE_FAILURE', 'SERVICE_UNAVAILABLE'].includes(message)
              ? message
              : 'SERVICE_UNAVAILABLE'
        }
      }
    })
    this.#tail = run.catch(() => {})
    return run
  }
}
