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
import {
  promises as fs,
  accessSync,
  constants as fsConstants,
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'fs'
import { createHash } from 'crypto'
import { promisify } from 'util'
import type { AppUpdater } from 'electron-updater'
import { execFile, spawn } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import gilatodFont from '../../resources/fonts/Gilatod_unicode.otf?asset'
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  WINDOW_STATE_VERSION,
  defaultWindowSize,
  fitWindowState,
  type WindowState
} from './windowState'
import {
  installerCandidates,
  macBundleMovable,
  macBundlePath,
  macReplaceScript,
  newerThan,
  parseLatestYml,
  pickInstaller,
  versionFromReleaseUrl,
  type Installer,
  type InstallerTarget,
  type ReleaseAsset
} from './update'

const execFileAsync = promisify(execFile)

const APP_ID = 'io.github.kinnuch.qonlang'
const GUIDE_URL = 'https://kinnuch.github.io/cerf/qonlang/'
/** 使用指南：中文界面打开中文版，其余打开英文版 */
const guideUrlFor = (locale: string): string => GUIDE_URL + (locale.startsWith('zh') ? '' : 'en/')
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
  installer: Installer | null
}

/** 检查更新的结果：失败时写明原因，设置页「立即检查」要显示 */
export interface UpdateCheck {
  status: 'newer' | 'latest' | 'failed'
  /** Release 上的最新版本号 */
  latest?: string
  info?: UpdateInfo
  error?: 'offline' | 'rateLimited' | 'notFound'
}

const REPO_URL = 'https://github.com/Kinnuch/Qonlang'

/** 上一次问到的 Release 与它的 ETag：没变时 GitHub 回 304（注意：不登录时 304 也照扣匿名额度） */
let releaseCache: { etag: string; info: UpdateInfo } | null = null
/** 接口被限流了：到 GitHub 说的恢复时间之前不再问 */
let apiBlockedUntil = 0
/** 最近一次查到的新版本（下载时按里面的校验值核对） */
let lastInfo: UpdateInfo | null = null

/** 挑安装包要知道的本机情况 */
function installerTarget(): InstallerTarget {
  return {
    platform: process.platform,
    // Apple 芯片上用 Rosetta 跑 x64 版时也挑 arm64 版，更新时顺手换成原生的
    arch: process.arch === 'arm64' || app.runningUnderARM64Translation ? 'arm64' : 'x64',
    macSelfReplace: canReplaceMacApp()
  }
}

/**
 * 问 GitHub 接口最新的 Release（带安装包的校验值与更新说明）。
 * 离线、出错给 null；被限流（403 / 429）时记下恢复时间，沿用上一次问到的
 */
function fetchLatestRelease(): Promise<{ info: UpdateInfo | null; limited?: boolean }> {
  if (Date.now() < apiBlockedUntil)
    return Promise.resolve({ info: releaseCache?.info ?? null, limited: true })
  return new Promise((resolve) => {
    const req = net.request({
      url: 'https://api.github.com/repos/Kinnuch/Qonlang/releases/latest',
      redirect: 'follow'
    })
    req.setHeader('User-Agent', 'Qonlang')
    req.setHeader('Accept', 'application/vnd.github+json')
    if (releaseCache) req.setHeader('If-None-Match', releaseCache.etag)
    const timer = setTimeout(() => {
      req.abort()
      resolve({ info: null })
    }, 8000)
    req.on('response', (res) => {
      if (res.statusCode === 304 && releaseCache) {
        clearTimeout(timer)
        return resolve({ info: releaseCache.info })
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer)
        if (res.statusCode === 403 || res.statusCode === 429) {
          const reset = Number([res.headers['x-ratelimit-reset']].flat()[0] ?? 0)
          apiBlockedUntil = reset > 0 ? reset * 1000 : Date.now() + 3600_000
          return resolve({ info: releaseCache?.info ?? null, limited: true })
        }
        return resolve({ info: null })
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
            assets?: ReleaseAsset[]
          }
          const version = (j.tag_name ?? '').replace(/^v/, '')
          if (!version) return resolve({ info: null })
          const info: UpdateInfo = {
            version,
            url: j.html_url ?? `${REPO_URL}/releases`,
            notes: (j.body ?? '').slice(0, 1200),
            installer: pickInstaller(j.assets ?? [], installerTarget())
          }
          const etag = res.headers['etag']
          const tag = Array.isArray(etag) ? etag[0] : etag
          if (tag) releaseCache = { etag: String(tag), info }
          resolve({ info })
        } catch {
          resolve({ info: null })
        }
      })
    })
    req.on('error', () => {
      clearTimeout(timer)
      resolve({ info: null })
    })
    req.end()
  })
}

/** 只看响应头：跳转去了哪、状态码是多少（不收正文，不占接口额度） */
function probe(url: string): Promise<{ status: number; location?: string }> {
  return new Promise((resolve) => {
    const req = net.request({ url, method: 'HEAD', redirect: 'manual' })
    req.setHeader('User-Agent', 'Qonlang')
    const timer = setTimeout(() => {
      req.abort()
      resolve({ status: 0 })
    }, 10000)
    req.on('redirect', (status, _method, redirectUrl) => {
      clearTimeout(timer)
      req.abort()
      resolve({ status, location: redirectUrl })
    })
    req.on('response', (res) => {
      clearTimeout(timer)
      resolve({ status: res.statusCode })
    })
    req.on('error', () => {
      clearTimeout(timer)
      resolve({ status: 0 })
    })
    req.end()
  })
}

/** 取一个小文本文件（latest.yml），跟着跳转走；拿不到给 null */
function fetchText(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = net.request({ url, redirect: 'follow' })
    req.setHeader('User-Agent', 'Qonlang')
    const timer = setTimeout(() => {
      req.abort()
      resolve(null)
    }, 10000)
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer)
        return resolve(null)
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        clearTimeout(timer)
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
    })
    req.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    req.end()
  })
}

/**
 * 接口问不到时，按 Release 的命名规则找本机的安装包：一个个试（跳转到下载地址就是有），
 * Windows 安装包再从 latest.yml 里拿 sha512 与大小。没有更新说明
 */
async function releaseByConvention(version: string): Promise<UpdateInfo> {
  const base = `${REPO_URL}/releases/download/v${version}/`
  let installer: Installer | null = null
  for (const c of installerCandidates(version, installerTarget())) {
    const r = await probe(base + encodeURIComponent(c.name))
    if (r.location || r.status === 200) {
      installer = { url: base + c.name, name: c.name, size: 0, sha256: null, auto: c.auto }
      break
    }
  }
  if (installer && process.platform === 'win32') {
    const yml = await fetchText(base + 'latest.yml')
    const f = yml ? parseLatestYml(yml).files.find((x) => x.url === installer.name) : undefined
    if (f) {
      installer.sha512 = f.sha512
      installer.size = f.size
    }
  }
  return { version, url: `${REPO_URL}/releases/tag/v${version}`, notes: '', installer }
}

/**
 * 检查更新：先问 github.com/…/releases/latest 跳到哪个版本（不占接口额度）；
 * 比当前新才问一次接口拿校验值与说明，接口被限流或连不上就按命名规则找安装包。
 * 跳转也拿不到时退回问接口；都不行就给出失败原因
 */
async function checkUpdate(): Promise<UpdateCheck> {
  const head = await probe(`${REPO_URL}/releases/latest`)
  let latest = head.location ? versionFromReleaseUrl(head.location) : null
  if (!latest) {
    const api = await fetchLatestRelease()
    if (!api.info)
      return {
        status: 'failed',
        error:
          head.status === 429 || api.limited
            ? 'rateLimited'
            : head.status === 404
              ? 'notFound'
              : 'offline'
      }
    latest = api.info.version
    if (!newerThan(latest, app.getVersion())) return { status: 'latest', latest }
    lastInfo = api.info
    return { status: 'newer', latest, info: api.info }
  }
  if (!newerThan(latest, app.getVersion())) return { status: 'latest', latest }
  if (lastInfo?.version === latest && lastInfo.installer)
    return { status: 'newer', latest, info: lastInfo }
  const api = await fetchLatestRelease()
  let info = api.info?.version === latest ? api.info : null
  // 接口没问到，或者那时 Release 上还没有本机的包（两个平台的包先后传）：按命名规则再找一遍
  if (!info?.installer) {
    const byName = await releaseByConvention(latest)
    if (byName.installer || !info) info = { ...byName, notes: info?.notes ?? '' }
  }
  lastInfo = info
  return { status: 'newer', latest, info }
}

const updateDir = (): string => join(app.getPath('temp'), 'qonlang-update')

/**
 * 这份千语集是不是用安装包装的（旁边有卸载程序）；解压直接运行的不算。
 * 卸载程序的名字跟着可执行文件名走（Uninstall Qonlang.exe），不写死，认「Uninstall 开头的 exe」
 */
function isInstalled(): boolean {
  try {
    return readdirSync(dirname(process.execPath)).some((f) => /^Uninstall .+\.exe$/i.test(f))
  } catch {
    return false
  }
}

/**
 * 用到时才加载 electron-updater。打出来的主进程是 CommonJS，electron-updater 的 autoUpdater 是个 getter，
 * 动态 import 时拿不到这个具名导出，只挂在 default 上（直接解构会是 undefined）。
 */
async function loadAutoUpdater(): Promise<AppUpdater> {
  const mod = await import('electron-updater')
  return (
    mod.autoUpdater ??
    (mod as unknown as { default: { autoUpdater: AppUpdater } }).default.autoUpdater
  )
}

/**
 * 增量更新，只用在装过的 Windows 版上：electron-updater 拿上次安装时 NSIS 自己存下的安装包
 * （%LOCALAPPDATA%\<名字>-updater\installer.exe）跟新旧两版的 .blockmap 比对，只下载变了的块，
 * 拼出新的安装包。拼好的整个文件按 latest.yml 里的 sha512 校验，对不上或者中间出任何错，
 * electron-updater 会自己改成整包下载（整包同样校验）——所以最后拿到的安装包一定跟 Release 上的一模一样，
 * 增量只影响下载了多少。这里只借它下载，安装照旧走 installUpdate。
 * 返回 null：这台机器、这个版本走不了（开发版、免安装版、Release 上没有 latest.yml、版本对不上……），由调用方整包下载。
 */
async function downloadWithUpdater(version: string): Promise<string | null> {
  if (process.platform !== 'win32' || !app.isPackaged || !isInstalled()) return null
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) return null
  const autoUpdater = await loadAutoUpdater()
  const log: string[] = [`${new Date().toISOString()} ${app.getVersion()} → ${version}`]
  const note = (m: unknown): void => void log.push(String(m))
  autoUpdater.logger = { info: note, warn: note, error: note, debug: () => {} }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.allowDowngrade = false
  const onProgress = (p: { transferred: number; total: number }): void =>
    mainWindow?.webContents.send('update:progress', { received: p.transferred, total: p.total })
  autoUpdater.on('download-progress', onProgress)
  try {
    const found = await autoUpdater.checkForUpdates()
    if (!found?.isUpdateAvailable || found.updateInfo.version !== version) {
      note(`skip: latest.yml says ${found?.updateInfo.version ?? 'nothing'}`)
      return null
    }
    const files = await autoUpdater.downloadUpdate()
    const exe = files.find((f) => f.toLowerCase().endsWith('.exe')) ?? null
    note(`done: ${exe}`)
    return exe
  } catch (e) {
    note(`error: ${e}`)
    return null
  } finally {
    autoUpdater.removeListener('download-progress', onProgress)
    await fs
      .writeFile(join(userData(), 'update.log'), log.join('\n') + '\n', 'utf8')
      .catch(() => {})
  }
}

/** 下好的安装包 → 版本号（macOS 解开之后核对用） */
const downloadedVersions = new Map<string, string>()

/** 整个文件的摘要：sha256 用小写十六进制（跟接口的 digest 一样），sha512 用 base64（跟 latest.yml 一样） */
function hashFile(file: string, algo: 'sha256' | 'sha512'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algo)
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest(algo === 'sha256' ? 'hex' : 'base64')))
      .on('error', reject)
  })
}

/**
 * 把安装包下到临时目录；进度推给渲染层。装过的 Windows 版先试增量下载，走不了再整包下。
 * 整包下完按 GitHub 给这个资产算的 sha256 校验（接口没给就只能不校验），对不上算下载失败。
 */
async function downloadUpdate(
  url: string,
  name: string,
  version?: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (version) {
    const viaUpdater = await downloadWithUpdater(version)
    if (viaUpdater) return { ok: true, path: viaUpdater }
  }
  await fs.mkdir(updateDir(), { recursive: true })
  const dest = join(updateDir(), basename(name))
  try {
    await downloadTo(url, dest + '.part', (received, total) =>
      mainWindow?.webContents.send('update:progress', { received, total })
    )
    const known = lastInfo?.installer?.name === name ? lastInfo.installer : null
    if (known?.sha256) {
      const got = await hashFile(dest + '.part', 'sha256')
      if (got !== known.sha256) throw new Error(`sha256 mismatch: ${got}`)
    } else if (known?.sha512) {
      const got = await hashFile(dest + '.part', 'sha512')
      if (got !== known.sha512) throw new Error(`sha512 mismatch: ${got}`)
    }
    await fs.rename(dest + '.part', dest)
    if (version) downloadedVersions.set(dest, version)
    return { ok: true, path: dest }
  } catch (e) {
    await fs.rm(dest + '.part', { force: true })
    return { ok: false, error: String(e) }
  }
}

/**
 * macOS：这份千语集能不能自己把新版本换进去——打包好的应用、不是从 dmg 或下载目录直接运行的
 * （App Translocation 的随机只读路径）、应用和它所在的目录都可写（普通用户往「应用程序」里装的一般可以）。
 */
function canReplaceMacApp(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged) return false
  const bundle = macBundlePath(process.execPath)
  if (!bundle || !macBundleMovable(bundle)) return false
  try {
    accessSync(dirname(bundle), fsConstants.W_OK)
    accessSync(bundle, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * macOS 自动更新：解开下好的 zip（ditto，保留应用包里的链接与权限），核对是完整的应用、版本号对得上，
 * 写好替换脚本交给 bash 在后台跑，然后退出——脚本等这边退出后把新的 .app 换到原来的位置再打开。
 * 没有签名用不了 Squirrel.Mac，只能自己换；中间任何一步出错都抛出来，由调用方退回手动安装。
 */
async function replaceMacApp(zip: string): Promise<void> {
  const bundle = macBundlePath(process.execPath)
  if (!bundle) throw new Error('not running from an app bundle')
  const stage = join(updateDir(), 'stage')
  await fs.rm(stage, { recursive: true, force: true })
  await fs.mkdir(stage, { recursive: true })
  await execFileAsync('/usr/bin/ditto', ['-x', '-k', zip, stage])
  const name = (await fs.readdir(stage)).find((f) => f.endsWith('.app'))
  if (!name) throw new Error('no .app in the update')
  const next = join(stage, name)
  if (!existsSync(join(next, 'Contents', 'MacOS', basename(process.execPath))))
    throw new Error('the update app is incomplete')
  const want = downloadedVersions.get(zip)
  if (want) {
    const plist = await fs.readFile(join(next, 'Contents', 'Info.plist'), 'utf8').catch(() => '')
    const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)
    if (m && m[1].trim() !== want) throw new Error(`the update app is ${m[1]}, expected ${want}`)
  }
  const script = join(updateDir(), 'replace-app.sh')
  await fs.writeFile(script, macReplaceScript(), { mode: 0o755 })
  const started = await spawnDetached(
    '/bin/bash',
    [script, String(process.pid), next, bundle, join(userData(), 'update.log')],
    { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
  )
  if (started !== true) throw new Error(started)
  forceClose = true
  dirty = false
  app.quit()
}

/**
 * 装下好的包再重开。
 * Windows：NSIS 静默模式（/S）沿用上次的安装目录与快捷方式选项，--force-run 装完自动拉起；
 * macOS：下的是 zip 又能替换时自己换掉旧的应用再打开；换不了（下的是 dmg，或者替换出错）就打开安装包让用户拖进去；
 * Linux：打开所在目录。
 * manual：没有自动装，界面上要告诉用户接下来自己怎么做。
 */
/** 起一个脱离本进程的子进程，等它真的起来（或出错）再返回：起来了给 true，否则给错误信息 */
function spawnDetached(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<true | string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', ...(env ? { env } : {}) })
    child.once('error', (e) => resolve(String(e)))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

async function installUpdate(
  file: string
): Promise<{ ok: boolean; manual?: boolean; error?: string }> {
  if (process.platform === 'win32') {
    // 装过的（旁边有卸载程序）才静默沿用上次的目录；解压直接运行的弹向导让用户自己选
    const args = isInstalled() ? ['--updated', '/S', '--force-run'] : ['--updated']
    // 安装包不见了或者起不来：报回界面，不退出（不接住 error 会弹主进程崩溃框）
    if (!existsSync(file)) return { ok: false, error: `installer not found: ${file}` }
    const started = await spawnDetached(file, args)
    if (started !== true) return { ok: false, error: started }
    forceClose = true
    dirty = false
    app.quit()
    return { ok: true }
  }
  if (process.platform === 'darwin') {
    if (file.toLowerCase().endsWith('.zip') && canReplaceMacApp()) {
      try {
        await replaceMacApp(file)
        return { ok: true }
      } catch (e) {
        shell.showItemInFolder(file)
        return { ok: false, manual: true, error: String(e) }
      }
    }
    await shell.openPath(file)
    return { ok: true, manual: true }
  }
  shell.showItemInFolder(file)
  return { ok: true, manual: true }
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
/** 开着的是不是纯欣赏项目（渲染层告诉的） */
let readOnlyOpen = false
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

/** 上次关窗时的大小与位置；头一次启动或者文件坏了给 null，按屏幕算默认值 */
function readWindowState(): WindowState | null {
  try {
    const raw = readFileSync(windowFile(), 'utf8')
    const w = JSON.parse(raw) as Partial<WindowState>
    if (typeof w.width === 'number' && typeof w.height === 'number')
      return {
        width: Math.max(MIN_WIDTH, Math.round(w.width)),
        height: Math.max(MIN_HEIGHT, Math.round(w.height)),
        x: typeof w.x === 'number' ? Math.round(w.x) : undefined,
        y: typeof w.y === 'number' ? Math.round(w.y) : undefined,
        maximized: !!w.maximized,
        v: typeof w.v === 'number' ? w.v : 1
      }
  } catch {
    // 头一次启动，或者文件坏了，用默认值
  }
  return null
}

function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const maximized = mainWindow.isMaximized()
  const b = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  try {
    // 同步写：关窗时进程随即退出，异步写来不及落盘
    writeFileSync(
      windowFile(),
      JSON.stringify({ ...b, maximized, v: WINDOW_STATE_VERSION }, null, 2),
      'utf8'
    )
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
  const saved = readWindowState()
  if (
    saved &&
    saved.x !== undefined &&
    saved.y !== undefined &&
    !onSomeDisplay(saved.x, saved.y, saved.width, saved.height)
  ) {
    saved.x = undefined
    saved.y = undefined
  }
  // 按记录所在的屏幕（头一次启动就是主屏）算默认大小、放进工作区（旧版记下的窄窗口先放宽一次）
  const display =
    saved && saved.x !== undefined && saved.y !== undefined
      ? screen.getDisplayMatching({
          x: saved.x,
          y: saved.y,
          width: saved.width,
          height: saved.height
        })
      : screen.getPrimaryDisplay()
  const def = defaultWindowSize(display.size)
  const ws = fitWindowState(saved ?? { ...def, v: WINDOW_STATE_VERSION }, display.workArea, def)
  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    ...(ws.x !== undefined && ws.y !== undefined ? { x: ws.x, y: ws.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
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
  // 纯欣赏项目开着时（正式包）：开发者工具一打开就关掉
  mainWindow.webContents.on('devtools-opened', () => {
    if (readOnlyOpen && app.isPackaged) mainWindow?.webContents.closeDevTools()
  })
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
        {
          label: L('另存为…', 'Save as…'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: send('saveAs')
        },
        { type: 'separator' },
        {
          label: L('使用指南', 'User guide'),
          click: () => void shell.openExternal(guideUrlFor(prefs.locale))
        }
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
  ipcMain.handle('app:setReadOnly', (_e, on: boolean) => {
    readOnlyOpen = on
    if (on && app.isPackaged) mainWindow?.webContents.closeDevTools()
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
        { name: 'Qonlang project', extensions: ['json', 'csv'] },
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
  ipcMain.handle('app:downloadUpdate', (_e, url: string, name: string, version?: string) =>
    downloadUpdate(url, name, version)
  )
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
        {
          label: '使用指南 / User guide',
          click: () => void getPrefs().then((p) => shell.openExternal(guideUrlFor(p.locale)))
        },
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
