import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountClient, accountApiBase } from '../../src/main/account'

const user = { id: 'account-1', username: 'learner', nickname: 'Reader' }
const token = 'token-secret-opaque-session-43-characters-1234'
const directories: string[] = []
const secureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'keychain',
  encryptString: (value: string) =>
    Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
  decryptString: (value: Buffer) => Buffer.from(value.toString().slice(10), 'base64').toString()
}
function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
async function setup(storage = secureStorage): Promise<{
  client: AccountClient
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>
  dir: string
}> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'qonlang-account-test-'))
  directories.push(dir)
  const fetch = vi.fn<typeof globalThis.fetch>()
  return {
    client: new AccountClient({
      version: '1.0.0-beta.3',
      userData: dir,
      packaged: false,
      apiBase: 'http://127.0.0.1:19005/v1',
      secureStorage: storage,
      fetch
    }),
    fetch,
    dir
  }
}
function authenticated(): Response {
  return response({
    token,
    expiresAt: Date.now() + 86400000,
    user,
    snapshot: { private: 'must-not-return' }
  })
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

describe('Qonlang controlled shared account', () => {
  it('pins production HTTPS and allows only explicit unpackaged loopback test endpoints', () => {
    expect(accountApiBase(true, 'https://attacker.test/v1')).toBe('https://kinnuch.cn/qon-api/v1')
    expect(accountApiBase(false)).toBe('https://kinnuch.cn/qon-api/v1')
    for (const url of [
      'http://localhost:8080/v1',
      'https://kinnuch.cn/evil',
      'http://127.0.0.1:8080/v1?host=x',
      'http://user:pass@127.0.0.1:8080/v1',
      'http://127.0.0.1:8080/project'
    ])
      expect(() => accountApiBase(false, url)).toThrow('Invalid account test API')
  })
  it('encrypts credentials, returns only public account fields and restores a valid session', async () => {
    const { client, fetch, dir } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    const result = await client.handle('register', {
      username: 'Learner',
      password: 'password12345',
      nickname: 'Reader'
    })
    expect(result).toEqual({
      ok: true,
      state: { supported: true, online: true, persisted: true, user }
    })
    expect(JSON.stringify(result)).not.toContain(token)
    expect(JSON.stringify(result)).not.toContain('must-not-return')
    expect(await fs.readFile(client.file, 'utf8')).not.toContain(token)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:19005/v1/auth/register')
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'X-Qon-App': 'qonlang' }
    })
    expect(JSON.parse(init!.body as string).username).toBe('learner')
    const restored = new AccountClient({
      version: '1.0.0-beta.3',
      userData: dir,
      packaged: false,
      apiBase: client.base,
      secureStorage,
      fetch
    })
    fetch.mockResolvedValueOnce(response({ user }))
    expect((await restored.handle('session')).state.user).toEqual(user)
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ Authorization: `Bearer ${token}` })
  })
  it('rejects unknown operations, arbitrary URL payloads, project content and unsupported profile fields before network access', async () => {
    const { client, fetch } = await setup()
    for (const [op, input] of [
      ['upload', { content: 'private project' }],
      ['login', { username: 'learner', password: 'password12345', url: 'https://x.test' }],
      ['profile', { nickname: 'Reader', project: { lexemes: [] } }],
      ['session', { token }]
    ]) {
      expect((await client.handle(op, input)).ok).toBe(false)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps cached account identity offline, while local sign-out removes saved credentials', async () => {
    const { client, fetch } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'learner', password: 'password12345' })
    fetch.mockRejectedValueOnce(Error('network contains secret token'))
    expect(await client.handle('session')).toEqual({
      ok: false,
      error: 'OFFLINE',
      state: { supported: true, online: false, persisted: true, user }
    })
    fetch.mockRejectedValueOnce(Error('offline'))
    const signedOut = await client.handle('logout')
    expect(signedOut.state.user).toBeNull()
    expect(signedOut.error).toBe('LOGOUT_OFFLINE')
    await expect(fs.access(client.file)).rejects.toThrow()
  })
  it('does not persist tokens in unavailable or basic_text security backends', async () => {
    const { client, fetch } = await setup({
      ...secureStorage,
      getSelectedStorageBackend: () => 'basic_text'
    })
    fetch.mockResolvedValueOnce(authenticated())
    expect(
      (await client.handle('login', { username: 'learner', password: 'password12345' })).state
        .persisted
    ).toBe(false)
    await expect(fs.access(client.file)).rejects.toThrow()
  })
  it('maps errors without exposing arbitrary server messages and clears a revoked token', async () => {
    const { client, fetch } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'learner', password: 'password12345' })
    fetch.mockResolvedValueOnce(response({ error: { code: 'UNAUTHORIZED', message: token } }, 401))
    const result = await client.handle('session')
    expect(result.error).toBe('UNAUTHORIZED')
    expect(result.state.user).toBeNull()
    expect(JSON.stringify(result)).not.toContain(token)
  })
  it('serializes an in-flight session check followed by sign-out, so late data cannot restore login', async () => {
    const { client, fetch } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'learner', password: 'password12345' })
    let finish!: (response: Response) => void
    fetch
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      .mockResolvedValueOnce(response({ ok: true }))
    const checking = client.handle('session')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const signingOut = client.handle('logout')
    finish(response({ user: { ...user, nickname: 'Updated' } }))
    await checking
    expect((await signingOut).state.user).toBeNull()
    expect((await client.handle('session')).state.user).toBeNull()
  })
})
