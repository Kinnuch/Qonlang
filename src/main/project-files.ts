/** 工程保存与备份：同一真实路径跨窗口串行，备份按路径分组。 */
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import lockfile from 'proper-lockfile'

export const projectContentHash = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex')

const identityOf = (path: string): string =>
  process.platform === 'win32' ? path.toLowerCase() : path

/** 已有符号链接沿用目标文件；损坏的链接不当成新文件覆盖。 */
async function projectPath(file: string): Promise<{ target: string; identity: string }> {
  let target: string
  try {
    target = await fs.realpath(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const entry = await fs.lstat(file).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'ENOENT') throw cause
      return null
    })
    if (entry?.isSymbolicLink()) throw error
    const absolute = resolve(file)
    target = join(await fs.realpath(dirname(absolute)), basename(absolute))
  }
  return { target, identity: identityOf(target) }
}

/** 每次写入自己的临时文件；失败时不留下会被其他实例误用的 .tmp。 */
export async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = join(dirname(file), `.qonlang-${process.pid}-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

export interface ProjectWriteOptions {
  /** 最后一次读入或保存成功的内容摘要；另存为由用户确认覆盖。 */
  expectedHash?: string
  force?: boolean
  backupDirectory: string
  backupCount: number
  /** 正常运行用同一个 OS 临时目录；测试可以提供自己的目录。 */
  lockDirectory?: string
}

async function currentContent(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function keepBackups(directory: string, count: number): Promise<void> {
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /@\d{4}-.*-[a-f0-9-]{36}\.laim\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  for (const name of entries.slice(0, Math.max(0, entries.length - count)))
    await fs.unlink(join(directory, name)).catch(() => {})
}

export async function writeProjectFile(
  file: string,
  content: string,
  options: ProjectWriteOptions
): Promise<{ ok: true } | { conflict: true }> {
  const selected = await projectPath(file)
  const key = projectContentHash(selected.identity)
  const lockDirectory = options.lockDirectory ?? join(tmpdir(), 'qonlang-project-locks-v1')
  await fs.mkdir(lockDirectory, { recursive: true, mode: 0o700 })
  let compromised: Error | null = null
  const release = await lockfile.lock(join(lockDirectory, key), {
    realpath: false,
    stale: 30000,
    update: 5000,
    retries: { retries: 100, minTimeout: 50, maxTimeout: 200, factor: 1.2, randomize: false },
    onCompromised: (error) => {
      compromised = error
    }
  })
  let temporary: string | null = null
  try {
    // 等锁时目标链接也可能改变；不把旧目标的内容写到新目标上。
    if ((await projectPath(file)).identity !== selected.identity) return { conflict: true }
    const original = await currentContent(selected.target)
    const originalHash = original === null ? null : projectContentHash(original)
    if (
      !options.force &&
      options.expectedHash &&
      originalHash !== null &&
      originalHash !== options.expectedHash
    )
      return { conflict: true }
    const count =
      Number.isSafeInteger(options.backupCount) && options.backupCount > 0 ? options.backupCount : 0
    let group: string | null = null
    if (original !== null && count > 0) {
      group = join(options.backupDirectory, key)
      await fs.mkdir(group, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await fs.writeFile(join(group, `backup@${stamp}-${randomUUID()}.laim.json`), original, {
        flag: 'wx'
      })
    }
    temporary = join(dirname(selected.target), `.qonlang-${process.pid}-${randomUUID()}.tmp`)
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    const current = await currentContent(selected.target)
    // 外部编辑器不参加我们的锁：提交前再比一次；即使强制覆盖，也不吞掉保存过程中新来的改动。
    if (
      (current === null ? null : projectContentHash(current)) !== originalHash ||
      (await projectPath(file)).identity !== selected.identity
    )
      return { conflict: true }
    if (compromised) throw compromised
    await fs.rename(temporary, selected.target)
    temporary = null
    // 只清理这个真实路径的新分组；旧版根目录备份全部留在原处。
    if (group) await keepBackups(group, count).catch(() => {})
    return { ok: true }
  } finally {
    if (temporary) await fs.rm(temporary, { force: true }).catch(() => {})
    // 释放失败不改变已经确定的保存/冲突结果；遗留目录由锁的过期机制回收。
    await release().catch(() => {})
  }
}
