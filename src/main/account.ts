import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AccountInput, AccountResult, AccountState, AccountUser } from '../shared/account'
import { ACCOUNT_OPERATIONS, type AccountOperation } from '../shared/account'
import { SUPPORT_OPERATIONS, type SupportOperation, type SupportResult } from '../shared/support'
import { supportInput, supportCapability, supportOrder } from './support-validation'
import { SupportJournal } from './support-journal'

interface SecureStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}
interface AccountOptions {
  version: string
  userData: string
  packaged: boolean
  secureStorage: SecureStorage
  apiBase?: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
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
  'SESSION_EXPIRED',
  'OFFLINE',
  'STORAGE_FAILURE',
  'SERVICE_UNAVAILABLE',
  'INVALID_RESPONSE',
  'AUTH_CHANGED',
  'INVALID_AMOUNT',
  'SUPPORT_REQUEST_PENDING',
  'SUPPORT_ORDER_PENDING',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_FIELDS',
  'PAYMENT_CLIENT_UPDATE_REQUIRED',
  'PAYMENTS_DISABLED',
  'ORDER_NOT_FOUND',
  'ORDER_MODE_MISMATCH',
  'PAYMENT_NOT_CONFIRMED',
  'PAYMENT_CHECK_BUSY',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'PAYMENT_PROVIDER_INVALID',
  'PAYMENT_ORDER_MISMATCH',
  'PAYMENT_REFERENCE_MISMATCH',
  'CLIENT_APP_MISMATCH',
  'CLIENT_ROUTE_UNAVAILABLE'
])
class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}
const definitiveRequestFailure = (error: unknown): error is RequestError =>
  error instanceof RequestError &&
  [400, 403, 404, 409, 422].includes(error.status) &&
  [
    'INVALID_INPUT',
    'INVALID_FIELDS',
    'INVALID_AMOUNT',
    'SUPPORT_ORDER_PENDING',
    'IDEMPOTENCY_CONFLICT',
    'PAYMENT_CLIENT_UPDATE_REQUIRED',
    'PAYMENTS_DISABLED',
    'ORDER_NOT_FOUND',
    'ORDER_MODE_MISMATCH',
    'PAYMENT_NOT_CONFIRMED',
    'CLIENT_APP_MISMATCH',
    'CLIENT_ROUTE_UNAVAILABLE'
  ].includes(error.message)
const publicError = (error: unknown): string =>
  error instanceof Error && ERRORS.has(error.message) ? error.message : 'SERVICE_UNAVAILABLE'

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
    typeof user.nickname !== 'string' ||
    !user.id ||
    user.id.length > 256 ||
    !user.username ||
    user.username.length > 32 ||
    !user.nickname ||
    user.nickname.length > 40
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
  #generation = 0
  #journal: SupportJournal
  constructor(private options: AccountOptions) {
    this.file = join(options.userData, 'account-session.enc')
    this.base = accountApiBase(options.packaged, options.apiBase)
    this.#journal = new SupportJournal(join(options.userData, 'support-pending.json'))
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version))
      throw new Error('INVALID_CLIENT_VERSION')
  }
  #canPersist(): boolean {
    try {
      return (
        this.options.secureStorage.isEncryptionAvailable() &&
        this.options.secureStorage.getSelectedStorageBackend?.() !== 'basic_text'
      )
    } catch {
      return false
    }
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
    body?: unknown,
    generation = this.#generation
  ): Promise<Record<string, unknown>> {
    let active = true
    const current = (): void => {
      if (generation !== this.#generation) throw new Error('AUTH_CHANGED')
      if (!active) throw new Error('OFFLINE')
    }
    current()
    const publicRequest = path === '/auth/login' || path === '/auth/register'
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const work = async (): Promise<Record<string, unknown>> => {
      let response: Response
      try {
        response = await (this.options.fetch ?? globalThis.fetch)(this.base + path, {
          method,
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-Qon-App': 'qonlang',
            'X-Qon-Version': this.options.version,
            ...(path.startsWith('/qonlang/support')
              ? { 'X-Qon-Payment-Protocol': 'qonlang-support-v1' }
              : {}),
            ...(this.#session && !publicRequest
              ? { Authorization: `Bearer ${this.#session.token}` }
              : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {})
        })
      } catch {
        current()
        this.#online = false
        throw new Error('OFFLINE')
      }
      current()
      const reader = response.body?.getReader(),
        chunks: Uint8Array[] = []
      let size = 0
      try {
        if (reader)
          for (;;) {
            const next = await reader.read()
            current()
            if (next.done) break
            size += next.value.byteLength
            if (size > 512 * 1024) {
              void reader.cancel().catch(() => {})
              throw new Error('INVALID_RESPONSE')
            }
            chunks.push(next.value)
          }
      } catch (error) {
        current()
        this.#online = false
        throw new Error(
          error instanceof Error && error.message === 'INVALID_RESPONSE'
            ? 'INVALID_RESPONSE'
            : 'OFFLINE'
        )
      }
      let data: Record<string, unknown>
      try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new Error('INVALID_RESPONSE')
      } catch {
        this.#online = false
        throw new Error('INVALID_RESPONSE')
      }
      current()
      this.#online = true
      if (!response.ok) {
        const code = (data.error as { code?: unknown } | undefined)?.code
        if (response.status === 401 && !publicRequest && this.#session) await this.#clear()
        current()
        throw new RequestError(
          typeof code === 'string' && ERRORS.has(code)
            ? code
            : response.status === 429
              ? 'RATE_LIMITED'
              : 'SERVICE_UNAVAILABLE',
          response.status
        )
      }
      return data
    }
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        active = false
        controller.abort()
        if (generation === this.#generation) this.#online = false
        reject(new Error(generation === this.#generation ? 'OFFLINE' : 'AUTH_CHANGED'))
      }, this.options.timeoutMs ?? 12000)
    })
    try {
      return await Promise.race([work(), deadline])
    } finally {
      active = false
      if (timer) clearTimeout(timer)
    }
  }
  handle(operation: unknown, input?: unknown): Promise<AccountResult> {
    if (operation === 'login' || operation === 'register' || operation === 'logout')
      this.#generation++
    const generation = this.#generation
    const run = this.#tail.then(async (): Promise<AccountResult> => {
      try {
        if (
          typeof operation !== 'string' ||
          !(ACCOUNT_OPERATIONS as readonly string[]).includes(operation)
        )
          throw new Error('INVALID_INPUT')
        await this.#load()
        if (generation !== this.#generation) throw new Error('AUTH_CHANGED')
        const op = operation as AccountOperation
        const body = credentials(op, input)
        if (op === 'logout') {
          let error: string | undefined
          try {
            if (this.#session) await this.#request('/auth/logout', 'POST', {}, generation)
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
          const result = await this.#request('/auth/me', 'GET', undefined, generation)
          const refreshed = userFrom(result.user)
          if (refreshed.id !== this.#session.user.id) throw new Error('INVALID_RESPONSE')
          this.#session.user = refreshed
          await this.#save()
        } else if (op === 'profile') {
          if (!this.#session) throw new Error('UNAUTHORIZED')
          const result = await this.#request('/auth/me', 'PATCH', body, generation)
          const refreshed = userFrom(result.user)
          if (refreshed.id !== this.#session.user.id) throw new Error('INVALID_RESPONSE')
          this.#session.user = refreshed
          await this.#save()
        } else {
          const result = await this.#request(`/auth/${op}`, 'POST', body, generation)
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
          error: publicError(new Error(message))
        }
      }
    })
    this.#tail = run.catch(() => {})
    return run
  }
  support(operation: unknown, input?: unknown): Promise<SupportResult> {
    const generation = this.#generation
    const run = this.#tail.then(async (): Promise<SupportResult> => {
      let requestId: string | undefined
      try {
        if (
          typeof operation !== 'string' ||
          !(SUPPORT_OPERATIONS as readonly string[]).includes(operation)
        )
          throw new Error('INVALID_INPUT')
        const op = operation as SupportOperation,
          body = supportInput(op, input)
        await this.#load()
        if (generation !== this.#generation) throw new Error('AUTH_CHANGED')
        if (!this.#session) throw new Error('UNAUTHORIZED')
        if (this.#session.expiresAt <= Date.now()) {
          await this.#clear()
          throw new Error('SESSION_EXPIRED')
        }
        const owner = this.#session.user.id,
          prefix = '/qonlang/support'
        if (op === 'status') {
          const result = await this.#request(prefix, 'GET', undefined, generation)
          return { ok: true, state: this.#state(), capability: supportCapability(result) }
        }
        if (op === 'orders') {
          // 只恢复当前账号以前已经确认过的请求；不换号、不按新金额重建。
          for (const pending of await this.#journal.pending(owner, this.base)) {
            try {
              const recovering = await this.#request(
                prefix +
                  '/orders' +
                  (pending.operation === 'create' ? '' : '/' + pending.orderId + '/close'),
                'POST',
                pending.operation === 'create'
                  ? { requestId: pending.requestId, amountFen: pending.amountFen }
                  : { requestId: pending.requestId },
                generation
              )
              const recovered = supportOrder(recovering.order)
              if (
                pending.operation === 'create'
                  ? recovered.amountFen !== pending.amountFen
                  : recovered.id !== pending.orderId
              )
                throw new Error('INVALID_RESPONSE')
              await this.#journal.settled(pending.requestId)
            } catch (error) {
              if (definitiveRequestFailure(error)) await this.#journal.settled(pending.requestId)
              else throw error
            }
          }
          const result = await this.#request(prefix + '/orders', 'GET', undefined, generation)
          if (!Array.isArray(result.orders) || result.orders.length > 100)
            throw new Error('INVALID_RESPONSE')
          return { ok: true, state: this.#state(), orders: result.orders.map(supportOrder) }
        }
        if (op === 'create' || op === 'close') {
          const entry = await this.#journal.reserve(owner, this.base, op, body)
          requestId = entry.requestId
        }
        const path = prefix + '/orders' + (op === 'create' ? '' : '/' + body.orderId + '/' + op)
        const payload =
          op === 'create'
            ? { requestId, amountFen: body.amountFen }
            : op === 'close'
              ? { requestId }
              : {}
        const result = await this.#request(path, 'POST', payload, generation),
          order = supportOrder(result.order)
        if (
          (op !== 'create' && order.id !== body.orderId) ||
          (op === 'create' && order.amountFen !== body.amountFen)
        )
          throw new Error('INVALID_RESPONSE')
        if (requestId) await this.#journal.settled(requestId)
        if (generation !== this.#generation || owner !== this.#session?.user.id)
          throw new Error('AUTH_CHANGED')
        return { ok: true, state: this.#state(), order }
      } catch (error) {
        let failure = error
        // 明确的业务拒绝可撤销本次请求记录；401、限流与未知结果仍须用原请求号恢复。
        if (requestId && definitiveRequestFailure(error)) {
          try {
            await this.#journal.settled(requestId)
          } catch {
            failure = new Error('STORAGE_FAILURE')
          }
        }
        const code = publicError(failure)
        return {
          ok: false,
          state: this.#state(),
          error: code,
          retryable: [
            'OFFLINE',
            'SERVICE_UNAVAILABLE',
            'INVALID_RESPONSE',
            'PAYMENT_CHECK_BUSY',
            'PAYMENT_PROVIDER_UNAVAILABLE',
            'STORAGE_FAILURE',
            'RATE_LIMITED'
          ].includes(code)
        }
      }
    })
    this.#tail = run.catch(() => {})
    return run
  }
}
