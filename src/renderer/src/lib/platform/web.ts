/**
 * 网页版平台实现。
 * 首选 File System Access API（Chromium 系）；不支持时退化为 <input type=file> + 下载。
 * 文件句柄与快照存在 IndexedDB，偏好与最近列表存在 localStorage。
 */
import type { OpenResult, PlatformAPI, Prefs, RecentEntry, SaveTarget } from './types'
import { DEFAULT_PREFS } from './types'

const DB_NAME = 'qianyuji'
const STORE = 'kv'
const LS_PREFS = 'qianyuji.prefs'
const LS_RECENT = 'qianyuji.recent'
const SNAPSHOT_KEY = 'snapshot'

declare global {
  interface Window {
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>
    showDirectoryPicker?: (opts?: unknown) => Promise<FileSystemDirectoryHandle>
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      if (value === null || value === undefined) tx.objectStore(STORE).delete(key)
      else tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* 隐私模式等场景下静默失败 */
  }
}

const pickerTypes = [{ description: 'Qonlang project', accept: { 'application/json': ['.json'] } }]

async function ensurePermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite'
): Promise<boolean> {
  const h = handle as unknown as {
    queryPermission?: (o: { mode: string }) => Promise<string>
    requestPermission?: (o: { mode: string }) => Promise<string>
  }
  if (!h.queryPermission) return true
  if ((await h.queryPermission({ mode })) === 'granted') return true
  return (await h.requestPermission?.({ mode })) === 'granted'
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const t = localStorage.getItem(key)
    return t ? (JSON.parse(t) as T) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

function download(name: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function pickViaInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

let saveAndCloseCb: (() => Promise<void>) | null = null
let dirtyFlag = false

window.addEventListener('beforeunload', (e) => {
  if (dirtyFlag) {
    e.preventDefault()
    e.returnValue = ''
  }
})

export const webPlatform: PlatformAPI = {
  kind: 'web',

  async info() {
    return { version: __APP_VERSION__, platform: 'web', userDataPath: null }
  },

  async openProject() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: pickerTypes, multiple: false })
        const file = await handle.getFile()
        const key = `handle:${crypto.randomUUID()}`
        await kvSet(key, handle)
        return {
          target: { path: null, handleKey: key, name: file.name },
          content: await file.text()
        } satisfies OpenResult
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return null
        throw e
      }
    }
    const file = await pickViaInput()
    if (!file) return null
    return { target: { path: null, handleKey: null, name: file.name }, content: await file.text() }
  },

  async openRecent(entry) {
    if (!entry.handleKey) return null
    const handle = await kvGet<FileSystemFileHandle>(entry.handleKey)
    if (!handle) return null
    if (!(await ensurePermission(handle, 'read'))) return null
    try {
      const file = await handle.getFile()
      return {
        target: { path: null, handleKey: entry.handleKey, name: file.name },
        content: await file.text()
      }
    } catch {
      return null
    }
  },

  async saveProject(target, content, suggestedName) {
    if (window.showSaveFilePicker) {
      let handle: FileSystemFileHandle | undefined
      let key = target?.handleKey ?? null
      if (key) handle = await kvGet<FileSystemFileHandle>(key)
      if (!handle) {
        try {
          handle = await window.showSaveFilePicker({ suggestedName, types: pickerTypes })
        } catch (e) {
          if ((e as DOMException).name === 'AbortError') return null
          throw e
        }
        key = `handle:${crypto.randomUUID()}`
        await kvSet(key, handle)
      }
      if (!(await ensurePermission(handle, 'readwrite'))) return null
      const w = await handle.createWritable()
      await w.write(content)
      await w.close()
      return { path: null, handleKey: key, name: handle.name } satisfies SaveTarget
    }
    download(suggestedName, content)
    return { path: null, handleKey: null, name: suggestedName }
  },

  async exportFolder(files, suggestedName) {
    if (window.showDirectoryPicker) {
      let dir: FileSystemDirectoryHandle
      try {
        dir = await window.showDirectoryPicker({ mode: 'readwrite' })
      } catch {
        return false
      }
      for (const [rel, content] of Object.entries(files)) {
        const parts = rel.split('/')
        let cur = dir
        for (const p of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(p, { create: true })
        const fh = await cur.getFileHandle(parts[parts.length - 1], { create: true })
        const w = await fh.createWritable()
        await w.write(content)
        await w.close()
      }
      return true
    }
    // 退化：把所有文件打成一个 JSON 下载
    download(suggestedName + '.folder.json', JSON.stringify(files, null, 2))
    return true
  },

  async readTextFiles(opts) {
    const files = await new Promise<File[]>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = opts.multiple
      input.accept = opts.extensions.map((e) => '.' + e).join(',')
      input.onchange = () => resolve(Array.from(input.files ?? []))
      input.oncancel = () => resolve([])
      input.click()
    })
    return Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() })))
  },
  async readBinaryFiles(opts) {
    const files = await new Promise<File[]>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = opts.multiple
      input.accept = opts.extensions.map((e) => '.' + e).join(',')
      input.onchange = () => resolve(Array.from(input.files ?? []))
      input.oncancel = () => resolve([])
      input.click()
    })
    return Promise.all(
      files.map(async (f) => {
        const buf = new Uint8Array(await f.arrayBuffer())
        let bin = ''
        for (let i = 0; i < buf.length; i += 0x8000)
          bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        return { name: f.name, base64: btoa(bin) }
      })
    )
  },
  async listFonts() {
    return (await kvGet<{ file: string; size: number }[]>('fonts:index')) ?? []
  },
  async readFont(file) {
    return (await kvGet<string>('font:' + file)) ?? null
  },
  async saveFont(file, base64) {
    const idx = ((await kvGet<{ file: string; size: number }[]>('fonts:index')) ?? []).filter(
      (f) => f.file !== file
    )
    idx.push({ file, size: Math.floor((base64.length * 3) / 4) })
    await kvSet('font:' + file, base64)
    await kvSet('fonts:index', idx)
    return true
  },
  async deleteFont(file) {
    const idx = ((await kvGet<{ file: string; size: number }[]>('fonts:index')) ?? []).filter(
      (f) => f.file !== file
    )
    await kvSet('font:' + file, null)
    await kvSet('fonts:index', idx)
  },
  async downloadFont(url, file) {
    try {
      const res = await fetch(url)
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const buf = new Uint8Array(await res.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000)
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      await this.saveFont(file, btoa(bin))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  },
  onFontProgress() {
    /* 浏览器版不报进度 */
  },
  onMenu() {
    /* 网页版没有应用菜单 */
  },
  async exportPdf(html) {
    const w = window.open('', '_blank')
    if (!w) return false
    w.document.open()
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 300)
    return true
  },
  async saveTextFile(suggestedName, content) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName })
        const w = await handle.createWritable()
        await w.write(content)
        await w.close()
        return true
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return false
        throw e
      }
    }
    download(suggestedName, content)
    return true
  },

  async getRecent() {
    return lsGet<RecentEntry[]>(LS_RECENT, [])
  },
  async addRecent(entry) {
    const list = lsGet<RecentEntry[]>(LS_RECENT, []).filter(
      (r) => !(r.handleKey && r.handleKey === entry.handleKey) && r.name !== entry.name
    )
    list.unshift(entry)
    lsSet(LS_RECENT, list.slice(0, 10))
  },
  async clearRecent() {
    lsSet(LS_RECENT, [])
  },

  async getPrefs() {
    return { ...DEFAULT_PREFS, ...lsGet<Partial<Prefs>>(LS_PREFS, {}) }
  },
  async setPrefs(p) {
    lsSet(LS_PREFS, p)
  },

  async loadSnapshot() {
    return (await kvGet<string>(SNAPSHOT_KEY)) ?? null
  },
  async saveSnapshot(content) {
    await kvSet(SNAPSHOT_KEY, content)
  },

  setDirty(d) {
    dirtyFlag = d
  },
  onSaveAndClose(cb) {
    saveAndCloseCb = cb
  },
  closeNow() {
    dirtyFlag = false
  },

  async showInFolder() {
    /* 网页版无此能力 */
  },
  async openExternal(url) {
    window.open(url, '_blank', 'noopener')
  }
}

// 让 lint 不抱怨未使用
void saveAndCloseCb
