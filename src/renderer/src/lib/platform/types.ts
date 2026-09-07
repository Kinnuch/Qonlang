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
}

export const DEFAULT_PREFS: Prefs = {
  locale: 'zh',
  theme: 'system',
  autosaveSeconds: 30,
  backupCount: 20,
  reopenLast: true
}

export interface AppInfo {
  version: string
  platform: 'electron' | 'web'
  userDataPath: string | null
}

export interface PlatformAPI {
  readonly kind: 'electron' | 'web'
  info(): Promise<AppInfo>

  /** 弹出打开对话框；用户取消返回 null */
  openProject(): Promise<OpenResult | null>
  /** 打开最近项目；文件不存在或权限被拒返回 null */
  openRecent(entry: RecentEntry): Promise<OpenResult | null>
  /** target 为 null 时弹出另存为对话框；用户取消返回 null */
  saveProject(target: SaveTarget | null, content: string, suggestedName: string): Promise<SaveTarget | null>
  /** 导出为文件夹格式；用户取消返回 false */
  exportFolder(files: Record<string, string>, suggestedName: string): Promise<boolean>

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
}
