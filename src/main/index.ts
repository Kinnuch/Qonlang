import { app, shell, BrowserWindow, ipcMain, dialog, net } from 'electron'
import { join, basename, dirname } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const APP_ID = 'io.github.kinnuch.qonlang'
const RECENT_MAX = 10

interface Prefs {
  locale: string
  theme: 'system' | 'light' | 'dark'
  autosaveSeconds: number
  backupCount: number
  reopenLast: boolean
  inspectorWidth: number
  recentSymbols: string[]
  savedSymbols: string[]
  csvPresets: unknown[]
  dismissedHints: string[]
  skin: unknown
}
const DEFAULT_PREFS: Prefs = {
  locale: 'zh',
  theme: 'system',
  autosaveSeconds: 30,
  backupCount: 20,
  reopenLast: true,
  inspectorWidth: 360,
  recentSymbols: [],
  savedSymbols: [],
  csvPresets: [],
  dismissedHints: [],
  skin: { preset: 'default', light: {}, dark: {}, fonts: { ui: '', data: '', mono: '', corpusText: '', corpusTr: '', gloss: '', script: '' }, mirror: '' }
}

interface RecentEntry {
  name: string
  path: string | null
  handleKey: string | null
  openedAt: string
}

const userData = (): string => app.getPath('userData')
const prefsFile = (): string => join(userData(), 'prefs.json')
const recentFile = (): string => join(userData(), 'recent.json')
const snapshotFile = (): string => join(userData(), 'snapshot.laim.json')
const backupsDir = (): string => join(userData(), 'Backups')
const fontsDir = (): string => join(userData(), 'fonts')

/** 跟随重定向的下载，带进度回调 */
function downloadTo(url: string, dest: string, onProgress: (received: number, total: number) => void, hops = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (hops > 8) return reject(new Error('too many redirects'))
    const req = net.request({ url, redirect: 'manual' })
    req.on('redirect', (_status, _method, redirectUrl) => {
      req.abort()
      downloadTo(redirectUrl, dest, onProgress, hops + 1).then(resolve, reject)
    })
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) return
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const total = Number(res.headers['content-length'] ?? 0)
      const chunks: Buffer[] = []
      let received = 0
      res.on('data', (c: Buffer) => {
        chunks.push(c)
        received += c.length
        onProgress(received, total)
      })
      res.on('end', () => {
        fs.writeFile(dest, Buffer.concat(chunks)).then(resolve, reject)
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, v: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(v, null, 2), 'utf8')
}

async function getPrefs(): Promise<Prefs> {
  return { ...DEFAULT_PREFS, ...(await readJson<Partial<Prefs>>(prefsFile(), {})) }
}

/** 原子写入：先写临时文件再改名 */
async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, file)
}

async function backup(file: string): Promise<void> {
  try {
    await fs.access(file)
  } catch {
    return
  }
  const prefs = await getPrefs()
  if (prefs.backupCount <= 0) return
  await fs.mkdir(backupsDir(), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const base = basename(file).replace(/\.laim\.json$|\.json$/, '')
  await fs.copyFile(file, join(backupsDir(), `${base}@${stamp}.laim.json`))
  // 只保留同名项目的最近 N 份
  const entries = (await fs.readdir(backupsDir())).filter((f) => f.startsWith(base + '@')).sort()
  for (const old of entries.slice(0, Math.max(0, entries.length - prefs.backupCount))) {
    await fs.unlink(join(backupsDir(), old)).catch(() => {})
  }
}

let dirty = false
let forceClose = false
let mainWindow: BrowserWindow | null = null

const dialogText = {
  zh: { title: '有未保存的改动', body: '要在关闭前保存吗？', save: '保存并关闭', discard: '不保存', cancel: '取消' },
  en: { title: 'Unsaved changes', body: 'Save before closing?', save: 'Save and close', discard: "Don't save", cancel: 'Cancel' }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: '千语集',
    backgroundColor: '#fafaf7',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (e) => {
    if (!dirty || forceClose) return
    e.preventDefault()
    void (async () => {
      const prefs = await getPrefs()
      const tx = dialogText[prefs.locale.startsWith('zh') ? 'zh' : 'en']
      const r = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        title: tx.title,
        message: tx.body,
        buttons: [tx.save, tx.discard, tx.cancel],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      if (r.response === 0) mainWindow?.webContents.send('app:save-and-close')
      else if (r.response === 1) {
        forceClose = true
        mainWindow?.close()
      }
    })()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: 'electron',
    userDataPath: userData(),
    initialSection: process.env['QIANYUJI_SECTION'] ?? null
  }))
  ipcMain.handle('app:setDirty', (_e, d: boolean) => {
    dirty = d
  })
  ipcMain.handle('app:closeNow', () => {
    forceClose = true
    dirty = false
    mainWindow?.close()
  })

  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'Qonlang project', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const path = r.filePaths[0]
    return { path, content: await fs.readFile(path, 'utf8') }
  })

  ipcMain.handle('project:read', async (_e, path: string) => {
    try {
      return { content: await fs.readFile(path, 'utf8') }
    } catch {
      return null
    }
  })

  ipcMain.handle('project:saveAs', async (_e, suggestedName: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: join(app.getPath('documents'), suggestedName),
      filters: [{ name: 'Qonlang project', extensions: ['json'] }]
    })
    return r.canceled || !r.filePath ? null : r.filePath
  })

  ipcMain.handle('project:write', async (_e, path: string, content: string) => {
    await backup(path)
    await atomicWrite(path, content)
  })

  ipcMain.handle('project:exportFolder', async (_e, files: Record<string, string>) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('documents')
    })
    if (r.canceled || !r.filePaths[0]) return false
    const root = r.filePaths[0]
    for (const [rel, content] of Object.entries(files)) {
      const target = join(root, ...rel.split('/'))
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, content, 'utf8')
    }
    return true
  })

  ipcMain.handle('file:readText', async (_e, opts: { multiple: boolean; extensions: string[] }) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [
        { name: 'Text', extensions: opts.extensions.length ? opts.extensions : ['*'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (r.canceled) return []
    const out: { name: string; content: string }[] = []
    for (const p of r.filePaths) out.push({ name: basename(p), content: await fs.readFile(p, 'utf8') })
    return out
  })

  ipcMain.handle('file:readBinary', async (_e, opts: { multiple: boolean; extensions: string[] }) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [
        { name: 'Files', extensions: opts.extensions.length ? opts.extensions : ['*'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (r.canceled) return []
    const out: { name: string; base64: string }[] = []
    for (const p of r.filePaths) out.push({ name: basename(p), base64: (await fs.readFile(p)).toString('base64') })
    return out
  })

  ipcMain.handle('file:saveText', async (_e, suggestedName: string, content: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: join(app.getPath('documents'), suggestedName) })
    if (r.canceled || !r.filePath) return false
    await fs.writeFile(r.filePath, content, 'utf8')
    return true
  })

  ipcMain.handle('recent:get', async () => {
    const list = await readJson<RecentEntry[]>(recentFile(), [])
    const alive: RecentEntry[] = []
    for (const r of list) {
      if (!r.path) continue
      try {
        await fs.access(r.path)
        alive.push(r)
      } catch {
        /* 文件已不存在，丢弃 */
      }
    }
    return alive
  })
  ipcMain.handle('recent:add', async (_e, entry: RecentEntry) => {
    const list = (await readJson<RecentEntry[]>(recentFile(), [])).filter((r) => r.path !== entry.path)
    list.unshift(entry)
    await writeJson(recentFile(), list.slice(0, RECENT_MAX))
  })
  ipcMain.handle('recent:clear', async () => writeJson(recentFile(), []))

  ipcMain.handle('fonts:list', async () => {
    await fs.mkdir(fontsDir(), { recursive: true })
    const names = await fs.readdir(fontsDir())
    const out: { file: string; size: number }[] = []
    for (const n of names) {
      if (!/\.(ttf|otf|woff2?|ttc)$/i.test(n)) continue
      const st = await fs.stat(join(fontsDir(), n))
      out.push({ file: n, size: st.size })
    }
    return out
  })
  ipcMain.handle('fonts:read', async (_e, file: string) => {
    try {
      return (await fs.readFile(join(fontsDir(), basename(file)))).toString('base64')
    } catch {
      return null
    }
  })
  ipcMain.handle('fonts:save', async (_e, file: string, base64: string) => {
    await fs.mkdir(fontsDir(), { recursive: true })
    await fs.writeFile(join(fontsDir(), basename(file)), Buffer.from(base64, 'base64'))
    return true
  })
  ipcMain.handle('fonts:delete', async (_e, file: string) => {
    await fs.rm(join(fontsDir(), basename(file)), { force: true })
  })
  ipcMain.handle('fonts:download', async (_e, url: string, file: string) => {
    await fs.mkdir(fontsDir(), { recursive: true })
    const dest = join(fontsDir(), basename(file))
    try {
      await downloadTo(url, dest + '.part', (received, total) => mainWindow?.webContents.send('fonts:progress', { file, received, total }))
      await fs.rename(dest + '.part', dest)
      return { ok: true }
    } catch (e) {
      await fs.rm(dest + '.part', { force: true })
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('prefs:get', () => getPrefs())
  ipcMain.handle('prefs:set', (_e, p: Prefs) => writeJson(prefsFile(), p))

  ipcMain.handle('snapshot:load', async () => {
    try {
      return await fs.readFile(snapshotFile(), 'utf8')
    } catch {
      return null
    }
  })
  ipcMain.handle('snapshot:save', async (_e, content: string | null) => {
    if (content == null) await fs.unlink(snapshotFile()).catch(() => {})
    else await atomicWrite(snapshotFile(), content)
  })

  ipcMain.handle('shell:showInFolder', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID)
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
