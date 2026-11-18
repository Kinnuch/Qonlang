import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fork, type ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import lockfile from 'proper-lockfile'
import { atomicWrite, projectContentHash, writeProjectFile } from '../../src/main/project-files'

const temporary: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (temporary.length) {
    const root = resolve(temporary.pop()!)
    expect(root.startsWith(join(resolve(tmpdir()), 'qonlang-files-'))).toBe(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture(): Promise<{
  root: string
  file: string
  backupDirectory: string
  lockDirectory: string
}> {
  const root = await fs.mkdtemp(join(tmpdir(), 'qonlang-files-'))
  temporary.push(root)
  const file = join(root, 'project.laim.json')
  await fs.writeFile(file, 'original')
  return { root, file, backupDirectory: join(root, 'Backups'), lockDirectory: join(root, 'locks') }
}
async function backups(root: string): Promise<string[]> {
  const groups = await fs.readdir(root)
  return (
    await Promise.all(
      groups.map(async (group) => {
        const full = join(root, group)
        if (!(await fs.stat(full)).isDirectory()) return [full]
        return (await fs.readdir(full)).map((name) => join(full, name))
      })
    )
  ).flat()
}

describe('project files across instances', () => {
  it('two independent processes with the same starting content cannot silently overwrite each other', async () => {
    const f = await fixture()
    const worker = join(f.root, 'writer.mjs')
    await fs.writeFile(
      worker,
      `
      import {writeProjectFile} from ${JSON.stringify(pathToFileURL(resolve('src/main/project-files.ts')).href)};
      process.on('message', async ({file, content, options}) => {
        try { process.send({content, result:await writeProjectFile(file, content, options)}) }
        catch(error) { process.send({error:String(error)}) }
        process.disconnect();
      });
      process.send('ready');
    `
    )
    const children: ChildProcess[] = []
    const pending = ['first saved content', 'second saved content'].map(async (content) => {
      const child = fork(worker, {
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        windowsHide: true
      })
      children.push(child)
      return new Promise<{ content: string; result: { ok?: boolean; conflict?: boolean } }>(
        (done, reject) => {
          child.once('error', reject)
          child.on('message', (message) => {
            if (message === 'ready')
              child.send({
                file: f.file,
                content,
                options: { ...f, backupCount: 20, expectedHash: projectContentHash('original') }
              })
            else {
              const result = message as {
                error?: string
                content: string
                result: { ok?: boolean; conflict?: boolean }
              }
              if (result.error) reject(Error(result.error))
              else done(result)
            }
          })
          child.once('exit', (code) => {
            if (code) reject(Error(`Worker exited ${code}`))
          })
        }
      )
    })
    try {
      const results = await Promise.all(pending)
      expect(results.filter((r) => r.result.ok)).toHaveLength(1)
      expect(results.filter((r) => r.result.conflict)).toHaveLength(1)
      expect(await fs.readFile(f.file, 'utf8')).toBe(results.find((r) => r.result.ok)!.content)
      expect((await fs.readdir(f.root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    } finally {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((done) => {
              if (child.exitCode !== null) return done()
              child.once('exit', () => done())
              child.kill()
            })
        )
      )
    }
  }, 10000)

  it('rechecks content even if an external edit preserves both size and modification time', async () => {
    const f = await fixture(),
      before = await fs.stat(f.file)
    await fs.writeFile(f.file, 'external')
    await fs.utimes(f.file, before.atime, before.mtime)
    expect(
      await writeProjectFile(f.file, 'my edits', {
        ...f,
        backupCount: 20,
        expectedHash: projectContentHash('original')
      })
    ).toEqual({ conflict: true })
    expect(await fs.readFile(f.file, 'utf8')).toBe('external')
  })

  it('detects an external write during preparation and removes only its own temporary file', async () => {
    const f = await fixture(),
      originalWrite = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      await originalWrite(...args)
      if (String(args[0]).includes('.qonlang-') && String(args[0]).endsWith('.tmp'))
        await originalWrite(f.file, 'external while saving')
    })
    expect(
      await writeProjectFile(f.file, 'my edits', {
        ...f,
        backupCount: 20,
        expectedHash: projectContentHash('original')
      })
    ).toEqual({ conflict: true })
    expect(await fs.readFile(f.file, 'utf8')).toBe('external while saving')
    expect((await fs.readdir(f.root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps same-named projects and their backup retention separate, preserving all legacy backups', async () => {
    const f = await fixture(),
      otherDirectory = join(f.root, 'other')
    await fs.mkdir(otherDirectory)
    const second = join(otherDirectory, 'project.laim.json')
    await fs.writeFile(second, 'other project')
    await fs.mkdir(f.backupDirectory)
    const legacy = join(f.backupDirectory, 'project@2026-10-01T00-00-00.laim.json')
    await fs.writeFile(legacy, 'legacy backup')
    await writeProjectFile(f.file, 'first update', { ...f, backupCount: 1 })
    await writeProjectFile(second, 'second update', { ...f, backupCount: 1 })
    await writeProjectFile(f.file, 'latest update', { ...f, backupCount: 1 })
    const files = await backups(f.backupDirectory)
    expect(files).toHaveLength(3)
    expect(await fs.readFile(legacy, 'utf8')).toBe('legacy backup')
    expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(
      expect.arrayContaining(['first update', 'other project', 'legacy backup'])
    )
  })

  it('does not overwrite another backup when multiple saves have the same timestamp', async () => {
    const f = await fixture()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-18T00:00:00Z'))
    try {
      await writeProjectFile(f.file, 'second', { ...f, backupCount: 20 })
      await writeProjectFile(f.file, 'third', { ...f, backupCount: 20 })
      expect(await backups(f.backupDirectory)).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves parent aliases and preserves a selected file symlink instead of replacing it', async (context) => {
    const f = await fixture(),
      linked = join(f.root, 'linked.laim.json')
    try {
      await fs.symlink(f.file, linked, 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip()
      throw error
    }
    expect(
      await writeProjectFile(linked, 'through link', {
        ...f,
        backupCount: 20,
        expectedHash: projectContentHash('original')
      })
    ).toEqual({ ok: true })
    expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true)
    expect(await fs.readFile(f.file, 'utf8')).toBe('through link')
    expect(
      await writeProjectFile(f.file, 'stale edit', {
        ...f,
        backupCount: 20,
        expectedHash: projectContentHash('original')
      })
    ).toEqual({ conflict: true })
  })

  it('uses the same save lock and backup group through a directory junction alias', async () => {
    const f = await fixture(),
      alias = join(f.root, 'alias')
    await fs.symlink(f.root, alias, 'junction')
    expect(
      await writeProjectFile(join(alias, 'project.laim.json'), 'alias saved', {
        ...f,
        backupCount: 20,
        expectedHash: projectContentHash('original')
      })
    ).toEqual({ ok: true })
    expect(
      await writeProjectFile(f.file, 'stale original', {
        ...f,
        backupCount: 20,
        expectedHash: projectContentHash('original')
      })
    ).toEqual({ conflict: true })
    expect(await fs.readFile(f.file, 'utf8')).toBe('alias saved')
    expect((await fs.readdir(f.backupDirectory)).length).toBe(1)
  })

  it('leaves the project intact when backup creation fails and atomic writes never use the legacy .tmp name', async () => {
    const f = await fixture()
    await fs.writeFile(f.backupDirectory, 'not a directory')
    await expect(writeProjectFile(f.file, 'new', { ...f, backupCount: 20 })).rejects.toThrow()
    expect(await fs.readFile(f.file, 'utf8')).toBe('original')
    await fs.writeFile(f.file + '.tmp', 'legacy unrelated file')
    await atomicWrite(f.file, 'atomic update')
    expect(await fs.readFile(f.file + '.tmp', 'utf8')).toBe('legacy unrelated file')
  })

  it('keeps temporary and backup names short for a long valid project file name', async () => {
    const f = await fixture(),
      longFile = join(f.root, 'a'.repeat(210) + '.laim.json')
    await fs.writeFile(longFile, 'long name original')
    expect(await writeProjectFile(longFile, 'long name saved', { ...f, backupCount: 20 })).toEqual({
      ok: true
    })
    expect(await fs.readFile(longFile, 'utf8')).toBe('long name saved')
    expect(
      (await backups(f.backupDirectory)).every((file) => file.split(/[\\/]/).at(-1)!.length < 100)
    ).toBe(true)
  })

  it('reports successful persistence even when pruning old backups fails afterwards', async () => {
    const f = await fixture()
    vi.spyOn(fs, 'readdir').mockRejectedValue(Error('backup directory temporarily unavailable'))
    expect(await writeProjectFile(f.file, 'committed', { ...f, backupCount: 20 })).toEqual({
      ok: true
    })
    expect(await fs.readFile(f.file, 'utf8')).toBe('committed')
  })

  it('does not turn a completed save into an error when releasing its lease reports a failure', async () => {
    const f = await fixture(),
      originalLock = lockfile.lock.bind(lockfile)
    vi.spyOn(lockfile, 'lock').mockImplementation(async (file, options) => {
      const release = await originalLock(file, options)
      return async () => {
        await release()
        throw Error('release failed after cleanup')
      }
    })
    expect(await writeProjectFile(f.file, 'committed', { ...f, backupCount: 20 })).toEqual({
      ok: true
    })
    expect(await fs.readFile(f.file, 'utf8')).toBe('committed')
  })
})
