import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { SUPPORT_ID } from './support-validation'

interface Entry {
  userId: string
  base: string
  operation: 'create' | 'close'
  requestId: string
  amountFen?: number
  orderId?: string
}
/** 尚未确定结果的请求跨重启保留；退出账号不等于渠道关单。 */
export class SupportJournal {
  #entries: Entry[] | null = null
  constructor(readonly file: string) {}
  /** 同一数据目录可以开两个实例；请求记录的读改写不能互相覆盖。 */
  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const lock = this.file + '.lock'
    try {
      await fs.mkdir(dirname(this.file), { recursive: true })
    } catch {
      throw new Error('STORAGE_FAILURE')
    }
    let handle: Awaited<ReturnType<typeof fs.open>>
    try {
      handle = await fs.open(lock, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('STORAGE_FAILURE')
      // 只回收已经不存在的进程留下的锁；不抢另一个仍在运行的实例。
      const recovery = lock + '.recover'
      let recovering = false
      try {
        await fs.mkdir(recovery)
        recovering = true
        const pid = Number(await fs.readFile(lock, 'utf8'))
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('STORAGE_FAILURE')
        try {
          process.kill(pid, 0)
          throw new Error('STORAGE_FAILURE')
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('STORAGE_FAILURE')
        }
        await fs.rm(lock)
        handle = await fs.open(lock, 'wx', 0o600)
      } catch {
        throw new Error('STORAGE_FAILURE')
      } finally {
        if (recovering) await fs.rmdir(recovery).catch(() => {})
      }
    }
    try {
      await handle.writeFile(String(process.pid))
      this.#entries = null
      return await work()
    } finally {
      await handle.close().catch(() => {})
      await fs.rm(lock, { force: true }).catch(() => {})
    }
  }
  async #load(): Promise<Entry[]> {
    if (this.#entries) return this.#entries
    try {
      const bytes = await fs.readFile(this.file)
      if (bytes.length > 256 * 1024) throw new Error('STORAGE_FAILURE')
      const data = JSON.parse(bytes.toString('utf8'))
      if (
        !data ||
        data.version !== 1 ||
        !Array.isArray(data.entries) ||
        data.entries.length > 1000 ||
        data.entries.some(
          (e: Entry) =>
            !e ||
            typeof e.userId !== 'string' ||
            !e.userId ||
            typeof e.base !== 'string' ||
            !SUPPORT_ID.test(e.requestId) ||
            !['create', 'close'].includes(e.operation) ||
            (e.operation === 'create'
              ? !Number.isSafeInteger(e.amountFen) ||
                e.amountFen! < 1 ||
                e.amountFen! > 60000 ||
                e.orderId !== undefined
              : typeof e.orderId !== 'string' ||
                !SUPPORT_ID.test(e.orderId) ||
                e.amountFen !== undefined)
        )
      )
        throw new Error('STORAGE_FAILURE')
      this.#entries = data.entries
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.#entries = []
      else throw new Error('STORAGE_FAILURE')
    }
    return this.#entries!
  }
  async #save(entries: Entry[]): Promise<void> {
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(dirname(this.file), { recursive: true })
      await fs.writeFile(temporary, JSON.stringify({ version: 1, entries }), { mode: 0o600 })
      await fs.chmod(temporary, 0o600)
      await fs.rename(temporary, this.file)
      this.#entries = entries
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw new Error('STORAGE_FAILURE')
    }
  }
  async reserve(
    userId: string,
    base: string,
    operation: Entry['operation'],
    input: { amountFen?: number; orderId?: string }
  ): Promise<Entry> {
    return this.#exclusive(async () => {
      const entries = await this.#load()
      const existing = entries.find(
        (e) =>
          e.userId === userId &&
          e.base === base &&
          e.operation === operation &&
          (operation === 'create' || e.orderId === input.orderId)
      )
      if (existing) {
        if (existing.amountFen !== input.amountFen || existing.orderId !== input.orderId)
          throw new Error('SUPPORT_REQUEST_PENDING')
        return existing
      }
      if (
        entries.length >= 1000 ||
        entries.filter((e) => e.userId === userId && e.base === base).length >= 4
      )
        throw new Error('STORAGE_FAILURE')
      const entry: Entry = { userId, base, operation, requestId: randomUUID(), ...input }
      await this.#save([...entries, entry])
      return entry
    })
  }
  async settled(requestId: string): Promise<void> {
    return this.#exclusive(async () => {
      const entries = await this.#load()
      await this.#save(entries.filter((e) => e.requestId !== requestId))
    })
  }
  async pending(userId: string, base: string): Promise<Entry[]> {
    return this.#exclusive(async () => {
      const entries = (await this.#load()).filter((e) => e.userId === userId && e.base === base)
      if (entries.length > 4) throw new Error('STORAGE_FAILURE')
      return entries
    })
  }
}
