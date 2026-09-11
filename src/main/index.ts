import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  net,
  Menu,
  clipboard,
  screen,
  type MenuItemConstructorOptions
} from 'electron'
import { join, basename, dirname } from 'path'
import { promises as fs, existsSync, readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import gilatodFont from '../../resources/fonts/Gilatod_unicode.otf?asset'

const APP_ID = 'io.github.kinnuch.qonlang'
const GUIDE_URL = 'https://kinnuch.github.io/cerf/qonlang/'
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
  skinPresets: unknown[]
  lexiconColWidths: Record<string, number>
  highlightDuplicates: boolean
  showHelpDots: boolean
  examplesPerEntry: number
  panelSizes: Record<string, number>
  showDerivedMark: boolean
  guideTourAlways: boolean
  seenTours: string[]
  checkUpdates: boolean
  skippedVersion: string
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
  skin: {
    preset: 'default',
    light: {},
    dark: {},
    fonts: { ui: '', data: '', mono: '', corpusText: '', corpusTr: '', gloss: '', script: '' },
    mirror: ''
  },
  skinPresets: [],
  lexiconColWidths: {},
  highlightDuplicates: true,
  showHelpDots: true,
  examplesPerEntry: 3,
  panelSizes: {},
  showDerivedMark: true,
  checkUpdates: true,
  skippedVersion: '',
  guideTourAlways: false,
  seenTours: []
}

interface RecentEntry {
  name: string
  path: string | null
  handleKey: string | null
  openedAt: string
}

const userData = (): string => app.getPath('userData')
const prefsFile = (): string => join(userData(), 'prefs.json')
const windowFile = (): string => join(userData(), 'window.json')
const recentFile = (): string => join(userData(), 'recent.json')
const snapshotFile = (): string => join(userData(), 'snapshot.laim.json')
const backupsDir = (): string => join(userData(), 'Backups')
const fontsDir = (): string => join(userData(), 'fonts')

/** 跟随重定向的下载，带进度回调 */
function downloadTo(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void,
  hops = 0
): Promise<void> {
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

export interface UpdateInfo {
  version: string
  url: string
  notes: string
  /** 这台机器能直接装的安装包；没有对应资产时为空，只能去下载页 */
  installer: { url: string; name: string; size: number } | null
}

/** 从 Release 资产里挑本平台的安装包：Windows 用 -setup.exe，macOS 按芯片挑 dmg，Linux 用 AppImage */
function pickInstaller(
  assets: { name?: string; browser_download_url?: string; size?: number }[]
): UpdateInfo['installer'] {
  const want = (n: string): boolean => {
    const l = n.toLowerCase()
    if (process.platform === 'win32') return l.endsWith('-setup.exe')
    if (process.platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      return l.endsWith(`-mac-${arch}.dmg`)
    }
    return l.endsWith('.appimage')
  }
  const a = assets.find((x) => x.name && x.browser_download_url && want(x.name))
  return a ? { url: a.browser_download_url!, name: a.name!, size: a.size ?? 0 } : null
}

/** 「0.6.1」这类版本号比大小；只比数字段 */
function newerThan(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => Number(x) || 0)
  const pb = b.split(/[.-]/).map((x) => Number(x) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

/** 问 GitHub 最新的 Release；离线或出错就当没有更新，不打扰用户 */
function fetchLatestRelease(): Promise<UpdateInfo | null> {
  return new Promise((resolve) => {
    const req = net.request({
      url: 'https://api.github.com/repos/Kinnuch/Qonlang/releases/latest',
      redirect: 'follow'
    })
    req.setHeader('User-Agent', 'Qonlang')
    req.setHeader('Accept', 'application/vnd.github+json')
    const timer = setTimeout(() => {
      req.abort()
      resolve(null)
    }, 8000)
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer)
        return resolve(null)
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        clearTimeout(timer)
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            tag_name?: string
            html_url?: string
            body?: string
            assets?: { name?: string; browser_download_url?: string; size?: number }[]
          }
          const version = (j.tag_name ?? '').replace(/^v/, '')
          if (!version) return resolve(null)
          resolve({
            version,
            url: j.html_url ?? 'https://github.com/Kinnuch/Qonlang/releases',
            notes: (j.body ?? '').slice(0, 1200),
            installer: pickInstaller(j.assets ?? [])
          })
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    req.end()
  })
}

/** 有比当前版本新的就返回，否则 null */
async function checkUpdate(): Promise<UpdateInfo | null> {
  const rel = await fetchLatestRelease()
  if (!rel) return null
  return newerThan(rel.version, app.getVersion()) ? rel : null
}

const updateDir = (): string => join(app.getPath('temp'), 'qonlang-update')

/** 把安装包下到临时目录；进度推给渲染层 */
async function downloadUpdate(
  url: string,
  name: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  await fs.mkdir(updateDir(), { recursive: true })
  const dest = join(updateDir(), basename(name))
  try {
    await downloadTo(url, dest + '.part', (received, total) =>
      mainWindow?.webContents.send('update:progress', { received, total })
    )
    await fs.rename(dest + '.part', dest)
    return { ok: true, path: dest }
  } catch (e) {
    await fs.rm(dest + '.part', { force: true })
    return { ok: false, error: String(e) }
  }
}

/**
 * 装下好的包再重开。
 * Windows：NSIS 静默模式（/S）沿用上次的安装目录与快捷方式选项，--force-run 装完自动拉起；
 * macOS：没有签名做不了静默替换，打开 dmg 让用户拖进 Applications；
 * Linux：打开所在目录。
 */
function installUpdate(file: string): void {
  if (process.platform === 'win32') {
    forceClose = true
    dirty = false
    // 装过的（旁边有卸载程序）才静默沿用上次的目录；解压直接运行的弹向导让用户自己选
    const installed = existsSync(join(dirname(process.execPath), 'Uninstall Qonlang.exe'))
    const args = installed ? ['--updated', '/S', '--force-run'] : ['--updated']
    const child = spawn(file, args, { detached: true, stdio: 'ignore' })
    child.unref()
    app.quit()
    return
  }
  if (process.platform === 'darwin') void shell.openPath(file)
  else shell.showItemInFolder(file)
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
let winStateTimer: ReturnType<typeof setTimeout> | null = null

const dialogText = {
  zh: {
    title: '有未保存的改动',
    body: '要在关闭前保存吗？',
    save: '保存并关闭',
    discard: '不保存',
    cancel: '取消'
  },
  en: {
    title: 'Unsaved changes',
    body: 'Save before closing?',
    save: 'Save and close',
    discard: "Don't save",
    cancel: 'Cancel'
  }
}

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

/** 上次关窗时的大小与位置；读不到就用默认值 */
function readWindowState(): WindowState {
  try {
    const raw = readFileSync(windowFile(), 'utf8')
    const w = JSON.parse(raw) as Partial<WindowState>
    if (typeof w.width === 'number' && typeof w.height === 'number')
      return {
        width: Math.max(900, Math.round(w.width)),
        height: Math.max(600, Math.round(w.height)),
        x: typeof w.x === 'number' ? Math.round(w.x) : undefined,
        y: typeof w.y === 'number' ? Math.round(w.y) : undefined,
        maximized: !!w.maximized
      }
  } catch {
    // 头一次启动，或者文件坏了，用默认值
  }
  return { width: 1280, height: 820 }
}

function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const maximized = mainWindow.isMaximized()
  const b = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  try {
    // 同步写：关窗时进程随即退出，异步写来不及落盘
    writeFileSync(windowFile(), JSON.stringify({ ...b, maximized }, null, 2), 'utf8')
  } catch {
    // 记不住窗口大小不该影响正常使用
  }
}

/** 上次的位置可能落在已经拔掉的显示器上，那就只留大小 */
function onSomeDisplay(x: number, y: number, width: number, height: number): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y
  })
}

function createWindow(): void {
  const ws = readWindowState()
  if (ws.x !== undefined && ws.y !== undefined && !onSomeDisplay(ws.x, ws.y, ws.width, ws.height)) {
    ws.x = undefined
    ws.y = undefined
  }
  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    ...(ws.x !== undefined && ws.y !== undefined ? { x: ws.x, y: ws.y } : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: '千语集',
    backgroundColor: '#fafaf7',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 分批跑的活（整库演化、批量推导、一致性检查、进度条）都靠 setTimeout 让出线程；
      // 窗口被挡住时 Chromium 会把这类定时器压到每分钟一次，活就卡住了，所以关掉节流
      backgroundThrottling: false
    }
  })

  if (ws.maximized) mainWindow.maximize()
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  const rememberBounds = (): void => {
    if (winStateTimer) clearTimeout(winStateTimer)
    winStateTimer = setTimeout(saveWindowState, 400)
  }
  mainWindow.on('resize', rememberBounds)
  mainWindow.on('move', rememberBounds)
  mainWindow.on('maximize', rememberBounds)
  mainWindow.on('unmaximize', rememberBounds)
  mainWindow.on('close', () => saveWindowState())

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

  // 右键菜单：编辑角色 + 常用命令
  mainWindow.webContents.on('context-menu', (_e, params) => {
    void (async () => {
      const prefs = await getPrefs()
      const zh = prefs.locale.startsWith('zh')
      const L = (z: string, e: string): string => (zh ? z : e)
      const send = (a: string) => () => mainWindow?.webContents.send('menu', a)
      const items: MenuItemConstructorOptions[] = []
      if (params.isEditable) {
        items.push(
          { role: 'undo', label: L('撤销输入', 'Undo typing'), enabled: params.editFlags.canUndo },
          { role: 'redo', label: L('重做输入', 'Redo typing'), enabled: params.editFlags.canRedo },
          { type: 'separator' },
          { role: 'cut', label: L('剪切', 'Cut'), enabled: params.editFlags.canCut },
          { role: 'copy', label: L('复制', 'Copy'), enabled: params.editFlags.canCopy },
          { role: 'paste', label: L('粘贴', 'Paste'), enabled: params.editFlags.canPaste },
          { role: 'selectAll', label: L('全选', 'Select all') },
          { type: 'separator' }
        )
      } else if (params.selectionText) {
        items.push({ role: 'copy', label: L('复制', 'Copy') }, { type: 'separator' })
      }
      if (params.linkURL) {
        items.push(
          { label: L('复制链接', 'Copy link'), click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' }
        )
      }
      items.push(
        {
          label: L('撤销上一步改动', 'Undo last change'),
          accelerator: 'CmdOrCtrl+Z',
          click: send('undo')
        },
        { label: L('重做', 'Redo'), accelerator: 'CmdOrCtrl+Y', click: send('redo') },
        { label: L('返回上一页', 'Back'), accelerator: 'Alt+Left', click: send('back') },
        { type: 'separator' },
        {
          label: L('命令面板', 'Command palette'),
          accelerator: 'CmdOrCtrl+K',
          click: send('palette')
        },
        {
          label: L('字符面板', 'Character panel'),
          accelerator: 'CmdOrCtrl+I',
          click: send('chars')
        },
        { label: L('保存', 'Save'), accelerator: 'CmdOrCtrl+S', click: send('save') },
        { type: 'separator' },
        { label: L('使用指南', 'User guide'), click: () => void shell.openExternal(GUIDE_URL) }
      )
      Menu.buildFromTemplate(items).popup({ window: mainWindow! })
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
    for (const p of r.filePaths)
      out.push({ name: basename(p), content: await fs.readFile(p, 'utf8') })
    return out
  })

  ipcMain.handle(
    'file:readBinary',
    async (_e, opts: { multiple: boolean; extensions: string[] }) => {
      const r = await dialog.showOpenDialog(mainWindow!, {
        properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [
          { name: 'Files', extensions: opts.extensions.length ? opts.extensions : ['*'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (r.canceled) return []
      const out: { name: string; base64: string }[] = []
      for (const p of r.filePaths)
        out.push({ name: basename(p), base64: (await fs.readFile(p)).toString('base64') })
      return out
    }
  )

  ipcMain.handle('export:pdf', async (_e, html: string, suggestedName: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: join(app.getPath('documents'), suggestedName),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled || !r.filePath) return false
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await win.loadURL(
        'data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64')
      )
      await new Promise((res) => setTimeout(res, 400))
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      await fs.writeFile(r.filePath, pdf)
      return true
    } finally {
      win.destroy()
    }
  })

  ipcMain.handle('file:saveText', async (_e, suggestedName: string, content: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: join(app.getPath('documents'), suggestedName)
    })
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
    const list = (await readJson<RecentEntry[]>(recentFile(), [])).filter(
      (r) => r.path !== entry.path
    )
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
  // 随软件带的字体：不用联网，拷进用户字体目录即可
  const BUILTIN_FONTS: Record<string, string> = { 'Gilatod_unicode.otf': gilatodFont }
  ipcMain.handle('fonts:installBuiltin', async (_e, file: string) => {
    const src = BUILTIN_FONTS[basename(file)]
    if (!src) return false
    await fs.mkdir(fontsDir(), { recursive: true })
    await fs.copyFile(src, join(fontsDir(), basename(file)))
    return true
  })
  ipcMain.handle('fonts:download', async (_e, url: string, file: string) => {
    await fs.mkdir(fontsDir(), { recursive: true })
    const dest = join(fontsDir(), basename(file))
    try {
      await downloadTo(url, dest + '.part', (received, total) =>
        mainWindow?.webContents.send('fonts:progress', { file, received, total })
      )
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
  ipcMain.handle('app:checkUpdate', () => checkUpdate())
  ipcMain.handle('app:downloadUpdate', (_e, url: string, name: string) => downloadUpdate(url, name))
  ipcMain.handle('app:installUpdate', (_e, file: string) => installUpdate(file))
}

/** 应用菜单：macOS 靠它提供 Cmd+C/V/Z、隐藏、退出；Windows / Linux 上被 autoHideMenuBar 隐藏，按 Alt 可见 */
function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const tpl: MenuItemConstructorOptions[] = []
  if (isMac) {
    tpl.push({
      label: app.name,
      submenu: [
        { role: 'about', label: '关于千语集 / About Qonlang' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }
  tpl.push(
    {
      label: '文件 / File',
      submenu: [
        {
          label: '保存 / Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu', 'save')
        },
        {
          label: '另存为 / Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu', 'saveAs')
        },
        {
          label: '打开 / Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu', 'open')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: '编辑 / Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图 / View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: '窗口 / Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }]
    },
    {
      label: '帮助 / Help',
      submenu: [
        { label: '使用指南 / User guide', click: () => void shell.openExternal(GUIDE_URL) },
        {
          label: 'GitHub',
          click: () => void shell.openExternal('https://github.com/Kinnuch/Qonlang')
        }
      ]
    }
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID)
  buildMenu()
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
