import type { Skin, UserSkinPreset } from '$lib/skin/presets'

export type MenuAction = 'save' | 'saveAs' | 'open' | 'undo' | 'redo' | 'palette' | 'chars' | 'back'
/**
 * 平台适配层：渲染层只认这个接口，不直接碰 Node 或浏览器专有 API。
 * Electron 实现走 IPC；网页实现走 File System Access API + IndexedDB。
 */

export interface SaveTarget {
  /** 桌面版：绝对路径；网页版：null */
  path: string | null
  /** 网页版：文件句柄在 IndexedDB 里的键 */
  handleKey: string | null
  /** 显示用文件名 */
  name: string
}

export interface RecentEntry {
  name: string
  path: string | null
  handleKey: string | null
  openedAt: string
}

export interface OpenResult {
  target: SaveTarget
  content: string
}

export interface Prefs {
  locale: string
  theme: 'system' | 'light' | 'dark'
  autosaveSeconds: number
  backupCount: number
  /** 上次打开的项目，启动时自动恢复 */
  reopenLast: boolean
  /** 右侧检视器宽度（px） */
  inspectorWidth: number
  /** 字符面板：最近插入的符号 */
  recentSymbols: string[]
  /** 字符面板：用户收藏的符号或组合 */
  savedSymbols: string[]
  /** CSV 导入向导保存的列映射预设 */
  csvPresets: CsvPreset[]
  /** 已关闭的联动提示 */
  dismissedHints: string[]
  /** 皮肤（颜色与字体） */
  skin: Skin
  /** 用户保存的皮肤预设 */
  skinPresets: UserSkinPreset[]
  /** 词库列宽：列 key → 像素 */
  lexiconColWidths: Record<string, number>
  /** 高亮重复词条（关掉后只留黄色叹号） */
  highlightDuplicates: boolean
  /** 板块与检视器标题旁的「?」小标记 */
  showHelpDots: boolean
  /** 词条下方默认显示的例句条数 */
  examplesPerEntry: number
  /** 各类可拖动面板的尺寸记忆：键 → 像素 */
  panelSizes: Record<string, number>
  /** 启动时检查新版本 */
  checkUpdates: boolean
  /** 用户选择跳过的版本号 */
  skippedVersion: string
  /** 词条卡里给构形推导出来的形式标一个齿轮 */
  showDerivedMark: boolean
  /** 点「使用指南」时每次都先看图文引导（关着时每个模块只自动讲一次） */
  guideTourAlways: boolean
  /** 已经讲过图文引导的模块 */
  seenTours: string[]
  /** 词条卡里语域标签：short 方框里一个字（英文缩写），full 整个名字 */
  registerDisplay: 'short' | 'full'
}

export interface CsvPreset {
  name: string
  target: 'lexemes' | 'morphemes'
  /** 表头名（或无表头时的列序号字符串）→ 字段 JSON */
  columns: Record<string, unknown>
  tagSeparator: string
  splitProtoArrow: boolean
  splitSenses?: boolean
  /** 义项前缀映射（每行 编码=标签） */
  sensePrefixMap?: string
  /** 方括号标记 → 处理方式（{ action, value }），读入时清洗 */
  senseMarkers?: Record<string, unknown>
}

export const DEFAULT_PREFS: Prefs = {
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
  seenTours: [],
  registerDisplay: 'short'
}

export interface UpdateInfo {
  version: string
  url: string
  notes: string
  /** 本机能直接装的安装包；为空只能去下载页 */
  installer: { url: string; name: string; size: number } | null
}

export interface AppInfo {
  version: string
  platform: 'electron' | 'web'
  userDataPath: string | null
  /** 开发用：启动后直接进入的页面（环境变量 QIANYUJI_SECTION） */
  initialSection?: string | null
}

export interface PlatformAPI {
  readonly kind: 'electron' | 'web'
  info(): Promise<AppInfo>

  /** 弹出打开对话框；用户取消返回 null */
  openProject(): Promise<OpenResult | null>
  /** 打开最近项目；文件不存在或权限被拒返回 null */
  openRecent(entry: RecentEntry): Promise<OpenResult | null>
  /** target 为 null 时弹出另存为对话框；用户取消返回 null */
  saveProject(
    target: SaveTarget | null,
    content: string,
    suggestedName: string
  ): Promise<SaveTarget | null>
  /** 导出为文件夹格式；用户取消返回 false */
  exportFolder(files: Record<string, string>, suggestedName: string): Promise<boolean>
  /** 让用户选若干文本文件并读出内容（导入用） */
  readTextFiles(opts: {
    multiple: boolean
    extensions: string[]
  }): Promise<{ name: string; content: string }[]>
  /** 让用户选二进制文件（字体等），内容以 base64 返回 */
  readBinaryFiles(opts: {
    multiple: boolean
    extensions: string[]
  }): Promise<{ name: string; base64: string }[]>
  /** 用户字体库（应用数据目录 fonts/） */
  listFonts(): Promise<{ file: string; size: number }[]>
  readFont(file: string): Promise<string | null>
  saveFont(file: string, base64: string): Promise<boolean>
  deleteFont(file: string): Promise<void>
  downloadFont(url: string, file: string): Promise<{ ok: boolean; error?: string }>
  /** 安装随软件带的字体（桌面版）；网页版返回 false */
  installBuiltinFont(file: string): Promise<boolean>
  onFontProgress(cb: (p: { file: string; received: number; total: number }) => void): void
  /** 应用菜单触发的动作（桌面版）：save / saveAs / open */
  onMenu(cb: (action: MenuAction) => void): void
  /** 把 HTML 渲染成 PDF 存盘（桌面版）或打开打印窗口（网页版）；用户取消返回 false */
  exportPdf(html: string, suggestedName: string): Promise<boolean>
  /** 把文本存成文件；用户取消返回 false */
  saveTextFile(suggestedName: string, content: string): Promise<boolean>

  getRecent(): Promise<RecentEntry[]>
  addRecent(entry: RecentEntry): Promise<void>
  clearRecent(): Promise<void>

  getPrefs(): Promise<Prefs>
  setPrefs(p: Prefs): Promise<void>

  /** 崩溃恢复用的快照（不等于保存） */
  loadSnapshot(): Promise<string | null>
  saveSnapshot(content: string | null): Promise<void>

  /** 通知宿主当前是否有未保存改动（桌面版用来拦截关窗） */
  setDirty(dirty: boolean): void
  /** 宿主要求「保存后关闭」时回调 */
  onSaveAndClose(cb: () => Promise<void>): void
  /** 保存完毕，允许关闭 */
  closeNow(): void

  showInFolder(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  /** 查有没有新版本；网页版或离线时返回 null */
  checkUpdate(): Promise<UpdateInfo | null>
  /** 下载安装包到临时目录（桌面版） */
  downloadUpdate(url: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }>
  onUpdateProgress(cb: (p: { received: number; total: number }) => void): void
  /** 静默安装并重开（Windows）；其他平台打开安装包 */
  installUpdate(path: string): Promise<void>
}
