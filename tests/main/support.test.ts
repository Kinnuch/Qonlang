import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountClient } from '../../src/main/account'
import { supportOrder } from '../../src/main/support-validation'
import { SupportJournal } from '../../src/main/support-journal'

const directories: string[] = []
const user = { id: 'supporter-a', username: 'supporter', nickname: 'Reader' }
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s.split('').reverse().join('')),
  decryptString: (b: Buffer) => b.toString().split('').reverse().join('')
}
const response = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status })
const authenticated = (identity = user): Response =>
  response({
    user: identity,
    token: 'opaque-fixture-token-long-enough',
    expiresAt: Date.now() + 60000
  })
const order = (amountFen = 123): Record<string, unknown> => ({
  id: '12345678-1234-4234-8234-123456789012',
  amountFen,
  currency: 'CNY',
  status: 'pending',
  createdAt: Date.now(),
  payment: {
    provider: 'yungouos',
    method: 'wechat',
    state: 'pending',
    qrCodeUrl: 'weixin://wxpay/bizpayurl?pr=fixture_123',
    expiresAt: Date.now() + 600000
  }
})
async function setup(timeoutMs = 12000): Promise<{
  client: AccountClient
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>
  dir: string
}> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'qonlang-support-'))
  directories.push(dir)
  const fetch = vi.fn<typeof globalThis.fetch>()
  return {
    dir,
    fetch,
    client: new AccountClient({
      version: '1.0.0-beta.3',
      userData: dir,
      packaged: false,
      apiBase: 'http://127.0.0.1:19005/v1',
      secureStorage: storage,
      fetch,
      timeoutMs
    })
  }
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})
describe('Qonlang support trust and recovery', () => {
  it('does not overwrite a second instance journal and refuses an actively held file lock', async () => {
    const { dir } = await setup()
    const path = join(dir, 'support-pending.json'),
      first = new SupportJournal(path),
      second = new SupportJournal(path)
    expect(await first.pending(user.id, 'https://pinned.example/v1')).toEqual([])
    const saved = await second.reserve(user.id, 'https://pinned.example/v1', 'create', {
      amountFen: 123
    })
    await expect(
      first.reserve(user.id, 'https://pinned.example/v1', 'create', { amountFen: 456 })
    ).rejects.toThrow('SUPPORT_REQUEST_PENDING')
    expect((await first.pending(user.id, 'https://pinned.example/v1'))[0].requestId).toBe(
      saved.requestId
    )
    await fs.writeFile(path + '.lock', String(process.pid))
    await expect(second.settled(saved.requestId)).rejects.toThrow('STORAGE_FAILURE')
    expect(JSON.parse(await fs.readFile(path, 'utf8')).entries).toHaveLength(1)
  })
  it('rejects unauthenticated support and arbitrary payment fields before sending', async () => {
    const { client, fetch } = await setup()
    expect((await client.support('status')).error).toBe('UNAUTHORIZED')
    for (const input of [
      { amountFen: 0 },
      { amountFen: 1.2 },
      { amountFen: 60001 },
      { amountFen: 1, token: 'secret' },
      { amountFen: 1, requestId: 'renderer-id' }
    ])
      expect((await client.support('create', input)).ok).toBe(false)
    expect((await client.support('refresh', { orderId: '../account' })).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('uses app version and product headers, excludes bearer credentials from public authentication', async () => {
    const { client, fetch } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    fetch.mockResolvedValueOnce(response({ error: { code: 'INVALID_CREDENTIALS' } }, 401))
    expect(
      (await client.handle('login', { username: 'supporter', password: 'wrong-password' })).state
        .user
    ).toEqual(user)
    const headers = fetch.mock.calls[1][1]!.headers as Record<string, string>
    expect(headers).toMatchObject({ 'X-Qon-App': 'qonlang', 'X-Qon-Version': '1.0.0-beta.3' })
    expect(headers.Authorization).toBeUndefined()
    fetch.mockResolvedValueOnce(
      response({
        enabled: true,
        provider: 'yungouos',
        currency: 'CNY',
        minAmountFen: 1,
        maxAmountFen: 60000,
        secret: 'excluded'
      })
    )
    expect(await client.support('status')).toMatchObject({
      ok: true,
      capability: { enabled: true, minAmountFen: 1, maxAmountFen: 60000 }
    })
    expect(fetch.mock.calls[2][1]?.headers).toMatchObject({
      'X-Qon-Payment-Protocol': 'qonlang-support-v1',
      Authorization: 'Bearer opaque-fixture-token-long-enough'
    })
  })
  it('does not substitute another identity from an authenticated profile response', async () => {
    const { client, fetch } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    fetch.mockResolvedValueOnce(response({ user: { ...user, id: 'different-user' } }))
    const result = await client.handle('profile', { nickname: 'Updated' })
    expect(result.error).toBe('INVALID_RESPONSE')
    expect(result.state.user?.id).toBe(user.id)
  })
  it('persists the request before POST and retries the same amount with the same UUID across restart', async () => {
    const { client, fetch, dir } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    let requestId = ''
    fetch.mockImplementationOnce(async (_url, init) => {
      const journal = JSON.parse(await fs.readFile(join(dir, 'support-pending.json'), 'utf8'))
      requestId = JSON.parse(init!.body as string).requestId
      expect(journal.entries[0]).toMatchObject({ userId: user.id, requestId, amountFen: 123 })
      throw Error('network interruption after send')
    })
    expect((await client.support('create', { amountFen: 123 })).error).toBe('OFFLINE')
    expect((await client.support('create', { amountFen: 456 })).error).toBe(
      'SUPPORT_REQUEST_PENDING'
    )
    const restored = new AccountClient({
      version: '1.0.0-beta.3',
      userData: dir,
      packaged: false,
      apiBase: client.base,
      secureStorage: storage,
      fetch
    })
    fetch.mockResolvedValueOnce(response({ order: { ...order(), token: 'must-not-escape' } }))
    const result = await restored.support('create', { amountFen: 123 })
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('must-not-escape')
    expect(JSON.parse(fetch.mock.calls[2][1]!.body as string).requestId).toBe(requestId)
    expect(
      JSON.parse(await fs.readFile(join(dir, 'support-pending.json'), 'utf8')).entries
    ).toEqual([])
  })
  it('persists closing UUID and leaves uncertain close recoverable without creating another order', async () => {
    const { client, fetch, dir } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    fetch.mockRejectedValueOnce(Error('offline'))
    expect((await client.support('close', { orderId: order().id })).retryable).toBe(true)
    const first = JSON.parse(fetch.mock.calls[1][1]!.body as string)
    const closed = {
      ...order(),
      status: 'closed',
      payment: { provider: 'yungouos', method: 'wechat', state: 'closed' }
    }
    fetch.mockResolvedValueOnce(response({ order: closed }))
    expect((await client.support('close', { orderId: order().id })).ok).toBe(true)
    expect(JSON.parse(fetch.mock.calls[2][1]!.body as string)).toEqual(first)
    expect(fetch.mock.calls[2][0]).toContain('/qonlang/support/orders/' + order().id + '/close')
    expect(
      JSON.parse(await fs.readFile(join(dir, 'support-pending.json'), 'utf8')).entries
    ).toEqual([])
  })
  it('drops a late order response on account switch and does not replay one user journal for another', async () => {
    const { client, fetch, dir } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    let finish!: (r: Response) => void
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const creating = client.support('create', { amountFen: 123 })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fetch.mockResolvedValueOnce(
      authenticated({ id: 'supporter-b', username: 'second', nickname: 'Second' })
    )
    const switching = client.handle('login', { username: 'second', password: 'fixture-password' })
    finish(response({ order: order() }))
    const late = await creating
    expect(late.error).toBe('AUTH_CHANGED')
    expect(late.order).toBeUndefined()
    await switching
    fetch.mockResolvedValueOnce(response({ order: order(456) }))
    expect((await client.support('create', { amountFen: 456 })).ok).toBe(true)
    const pending = JSON.parse(await fs.readFile(join(dir, 'support-pending.json'), 'utf8')).entries
    expect(pending).toHaveLength(1)
    expect(pending[0].userId).toBe('supporter-a')
  })
  it('does not POST if durable journal is unreadable', async () => {
    const { client, fetch, dir } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    await fs.writeFile(join(dir, 'support-pending.json'), 'broken')
    expect((await client.support('create', { amountFen: 1 })).error).toBe('STORAGE_FAILURE')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('recovers an authorized unknown create by its original ID before listing orders', async () => {
    const { client, fetch, dir } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    fetch.mockRejectedValueOnce(Error('lost response'))
    await client.support('create', { amountFen: 123 })
    const payload = JSON.parse(fetch.mock.calls[1][1]!.body as string)
    fetch
      .mockResolvedValueOnce(response({ order: order() }))
      .mockResolvedValueOnce(response({ orders: [order()] }))
    expect((await client.support('orders')).orders).toHaveLength(1)
    expect(JSON.parse(fetch.mock.calls[2][1]!.body as string)).toEqual(payload)
    expect(
      JSON.parse(await fs.readFile(join(dir, 'support-pending.json'), 'utf8')).entries
    ).toEqual([])
    fetch.mockResolvedValueOnce(response({ order: order(456) }))
    expect((await client.support('create', { amountFen: 456 })).ok).toBe(true)
  })
  it('preserves unknown request IDs after rate limits and unauthorized sessions', async () => {
    const { client, fetch, dir } = await setup()
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    fetch.mockResolvedValueOnce(response({ error: { code: 'RATE_LIMITED' } }, 429))
    await client.support('create', { amountFen: 123 })
    const journal = JSON.parse(await fs.readFile(join(dir, 'support-pending.json'), 'utf8'))
    fetch.mockResolvedValueOnce(response({ error: { code: 'UNAUTHORIZED' } }, 401))
    expect((await client.support('create', { amountFen: 123 })).state.user).toBeNull()
    expect(JSON.parse(await fs.readFile(join(dir, 'support-pending.json'), 'utf8'))).toEqual(
      journal
    )
  })
  it('rejects response body overflow while streaming and an indefinitely delayed response', async () => {
    const { client, fetch } = await setup(30)
    fetch.mockResolvedValueOnce(authenticated())
    await client.handle('login', { username: 'supporter', password: 'fixture-password' })
    fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(512 * 1024 + 1))
            controller.close()
          }
        })
      )
    )
    expect((await client.support('orders')).error).toBe('INVALID_RESPONSE')
    fetch.mockImplementationOnce(() => new Promise(() => {}))
    expect((await client.support('orders')).error).toBe('OFFLINE')
  })
  it('rejects arbitrary QR URLs, mismatched status, invalid prices and strips private response fields', () => {
    for (const qrCodeUrl of [
      'https://attacker.invalid/pay',
      'javascript:alert(1)',
      'weixin://wxpay/bizpayurl?pr=ok&secret=1'
    ])
      expect(() =>
        supportOrder({ ...order(), payment: { ...(order().payment as object), qrCodeUrl } })
      ).toThrow('INVALID_RESPONSE')
    expect(() => supportOrder({ ...order(), status: 'paid' })).toThrow('INVALID_RESPONSE')
    expect(() => supportOrder({ ...order(), amountFen: 0 })).toThrow('INVALID_RESPONSE')
    expect(JSON.stringify(supportOrder({ ...order(), merchantKey: 'private' }))).not.toContain(
      'private'
    )
  })
})
