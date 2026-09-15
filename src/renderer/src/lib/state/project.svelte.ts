import type { Id, Language, Project } from '$lib/core/model'
import { createProject, now, type CreateProjectOptions } from '$lib/core/factory'
import {
  PROJECT_EXTENSION,
  ProjectParseError,
  parseProject,
  projectToFolder,
  readProjectText,
  serializeForDisk,
  serializeProject
} from '$lib/core/serialize'
import { isSealed } from '$lib/core/sealed'
import { setExportGuard } from '$lib/platform'
import { isProjectCsv, projectFromCsv, projectToCsv } from '$lib/core/projectCsv'
import { platform, type RecentEntry, type SaveTarget } from '$lib/platform'
import { t } from '$lib/i18n/index.svelte'
import { ui } from './ui.svelte'

class ProjectState {
  project = $state<Project | null>(null)
  target = $state<SaveTarget | null>(null)
  dirty = $state(false)
  saving = $state(false)
  lastSavedAt = $state<string | null>(null)
  /** 顶栏选中的当前语言；null 表示全部 */
  currentLanguageId = $state<Id | null>(null)

  // ── 撤销 / 重做：每次改动（去抖 400ms）把改动前的整份项目 JSON 压栈 ──
  private committed = ''
  private history: string[] = []
  private future: string[] = []
  private commitTimer: ReturnType<typeof setTimeout> | null = null
  /** 最近一次记进撤销栈的时间：页面出错时判断是不是刚做的那一步惹的 */
  private lastCommitAt = 0
  canUndo = $state(false)
  canRedo = $state(false)
  /** 撤销次数（供界面在撤销后闪一下） */
  undoTick = $state(0)

  private serializeNow(): string {
    return JSON.stringify($state.snapshot(this.project))
  }
  private resetHistory(): void {
    this.history = []
    this.future = []
    this.canUndo = false
    this.canRedo = false
    this.committed = this.project ? this.serializeNow() : ''
  }
  private scheduleCommit(): void {
    if (this.commitTimer) clearTimeout(this.commitTimer)
    this.commitTimer = setTimeout(() => this.commit(), 400)
  }
  private commit(): void {
    this.commitTimer = null
    if (!this.project) return
    const now = this.serializeNow()
    if (now === this.committed) return
    this.history.push(this.committed)
    if (this.history.length > 60) this.history.shift()
    this.future = []
    this.committed = now
    this.lastCommitAt = Date.now()
    this.canUndo = true
    this.canRedo = false
  }
  private restore(json: string): void {
    const p = parseProject(json)
    const lang = this.currentLanguageId
    this.project = p
    this.currentLanguageId =
      lang && p.languages.some((l) => l.id === lang) ? lang : (p.languages[0]?.id ?? null)
    this.committed = json
    if (!this.dirty) {
      this.dirty = true
      platform.setDirty(true)
    }
    this.undoTick++
  }
  undo(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer)
      this.commit()
    }
    const prev = this.history.pop()
    if (prev === undefined) return
    this.future.push(this.committed)
    this.restore(prev)
    this.canUndo = this.history.length > 0
    this.canRedo = true
  }
  /**
   * 页面出错后，把项目退回到上一次操作之前：还没记进撤销栈的改动（400ms 以内的）直接丢掉；
   * 没有这种改动、而刚记进去的那一步是 3 秒以内的，就撤销那一步。两样都没有就不动（多半跟改动无关，比如换页面时出的错）。
   * 返回有没有退回。
   */
  recoverFromCrash(): boolean {
    if (!this.project) return false
    const pending = this.commitTimer !== null
    if (this.commitTimer) {
      clearTimeout(this.commitTimer)
      this.commitTimer = null
    }
    let now = ''
    try {
      now = this.serializeNow()
    } catch {
      now = ''
    }
    if (this.committed && (pending || now !== this.committed)) {
      this.restore(this.committed)
      return true
    }
    if (this.history.length && Date.now() - this.lastCommitAt < 3000) {
      this.undo()
      return true
    }
    return false
  }
  redo(): void {
    const next = this.future.pop()
    if (next === undefined) return
    this.history.push(this.committed)
    this.restore(next)
    this.canUndo = true
    this.canRedo = this.future.length > 0
  }

  get currentLanguage(): Language | null {
    if (!this.project || !this.currentLanguageId) return null
    return this.project.languages.find((l) => l.id === this.currentLanguageId) ?? null
  }

  get fileName(): string {
    return this.target?.name ?? (this.project?.meta.name || t('app.untitled')) + PROJECT_EXTENSION
  }

  /** 纯欣赏模式：文件带只读标记时为真 */
  get readOnly(): boolean {
    return !!this.project?.meta.readOnly
  }
  /** 每次修改项目数据后调用 */
  touch(): void {
    if (!this.project) return
    if (this.readOnly) {
      ui.toast(t('readonly.blocked'))
      return
    }
    this.project.meta.updatedAt = now()
    this.scheduleCommit()
    if (!this.dirty) {
      this.dirty = true
      platform.setDirty(true)
    }
  }

  private markClean(): void {
    this.dirty = false
    platform.setDirty(false)
  }

  create(
    opts: Omit<CreateProjectOptions, 'appVersion' | 'uiLocale'> & {
      appVersion: string
      uiLocale: string
    }
  ): void {
    const p = createProject(opts)
    this.load(p, null)
    this.dirty = true
    platform.setDirty(true)
  }

  load(p: Project, target: SaveTarget | null): void {
    this.project = p
    this.target = target
    // 纯欣赏项目开着时，桌面版不让开开发者工具
    platform.setReadOnly(!!p.meta.readOnly)
    this.currentLanguageId = p.settings.defaultLanguageId ?? p.languages[0]?.id ?? null
    this.lastSavedAt = target ? p.meta.updatedAt : null
    this.markClean()
    this.resetHistory()
    ui.resetHistory()
    ui.section = 'languages'
  }

  private handleParseError(e: unknown): void {
    if (e instanceof ProjectParseError) {
      const key = {
        'invalid-json': 'invalidJson',
        'not-a-project': 'notAProject',
        'newer-schema': 'newerSchema',
        'invalid-csv': 'invalidCsv',
        'sealed-broken': 'sealedBroken'
      }[e.code]
      ui.error(t(`errors.${key}`, { msg: e.message }))
    } else {
      ui.error(t('errors.openFailed', { msg: (e as Error).message }))
    }
  }

  async open(): Promise<boolean> {
    try {
      const r = await platform.openProject()
      if (!r) return false
      // 整个项目导出的 CSV：读回来当成还没存盘的项目，保存时再问存到哪
      if (isProjectCsv(r.content)) {
        this.load(projectFromCsv(r.content), null)
        this.dirty = true
        platform.setDirty(true)
        ui.toast(t('projectCsv.opened'))
        return true
      }
      const p = parseProject(await readProjectText(r.content))
      this.load(p, r.target)
      await this.remember()
      return true
    } catch (e) {
      this.handleParseError(e)
      return false
    }
  }

  async openRecent(entry: RecentEntry): Promise<boolean> {
    try {
      const r = await platform.openRecent(entry)
      if (!r) {
        ui.error(t('welcome.recentMissing'))
        return false
      }
      const p = parseProject(await readProjectText(r.content))
      this.load(p, r.target)
      await this.remember()
      return true
    } catch (e) {
      this.handleParseError(e)
      return false
    }
  }

  /** 从崩溃快照恢复 */
  restoreSnapshot(content: string): boolean {
    try {
      const p = parseProject(content)
      this.load(p, null)
      this.dirty = true
      platform.setDirty(true)
      return true
    } catch (e) {
      this.handleParseError(e)
      return false
    }
  }

  async save(saveAs = false): Promise<boolean> {
    if (!this.project || this.saving) return false
    if (this.readOnly && !saveAs) {
      ui.toast(t('readonly.blocked'))
      return false
    }
    this.saving = true
    try {
      const content = await serializeForDisk($state.snapshot(this.project) as Project)
      const target = await platform.saveProject(saveAs ? null : this.target, content, this.fileName)
      if (!target) return false
      this.target = target
      this.lastSavedAt = now()
      this.markClean()
      await platform.saveSnapshot(null)
      await this.remember()
      return true
    } catch (e) {
      ui.error(t('errors.saveFailed', { msg: (e as Error).message }))
      return false
    } finally {
      this.saving = false
    }
  }

  async snapshot(): Promise<void> {
    if (!this.project || !this.dirty || this.readOnly) return
    await platform.saveSnapshot(serializeProject($state.snapshot(this.project) as Project))
  }

  /** 纯欣赏模式导出：另存一份带只读标记、加过密的项目文件（别人用千语集打开只能看，拿记事本打开是一串乱码） */
  async exportReadOnly(): Promise<void> {
    if (!this.project) return
    const copy = $state.snapshot(this.project) as Project
    copy.meta = { ...copy.meta, readOnly: true }
    const name = (copy.meta.name || 'qonlang') + '-' + t('readonly.suffix') + PROJECT_EXTENSION
    const ok = await platform.saveTextFile(name, await serializeForDisk(copy))
    if (ok) ui.toast(t('readonly.exported'))
  }

  async exportFolder(): Promise<void> {
    if (!this.project) return
    const files = projectToFolder($state.snapshot(this.project) as Project)
    await platform.exportFolder(files, this.project.meta.name || 'qianyuji')
  }

  /** 整个项目导出成一个 CSV（改完从「打开项目」选它就能读回来） */
  async exportCsv(): Promise<void> {
    if (!this.project) return
    const csv = projectToCsv($state.snapshot(this.project) as Project)
    const ok = await platform.saveTextFile(
      `${this.project.meta.name || 'qonlang'}.csv`,
      '\ufeff' + csv
    )
    if (ok) ui.toast(t('projectCsv.exported'))
  }

  close(): void {
    this.project = null
    this.target = null
    platform.setReadOnly(false)
    this.currentLanguageId = null
    this.markClean()
  }

  private async remember(): Promise<void> {
    if (!this.target || !this.project) return
    await platform.addRecent({
      name: this.project.meta.name || this.target.name,
      path: this.target.path,
      handleKey: this.target.handleKey,
      openedAt: now()
    })
  }
}

export const projectState = new ProjectState()
// 纯欣赏项目开着时，导出类的操作（另存文本、导出文件夹、PDF）一律不做——内容只能在软件里看；
// 加过密的纯欣赏副本本身可以照样写出去
setExportGuard((content) => {
  if (!projectState.readOnly || (content !== undefined && isSealed(content))) return false
  ui.toast(t('readonly.exportBlocked'))
  return true
})
// 「返回」要记下与恢复当前语言，还要知道记下的对象还在不在
ui.navAccess = {
  getLanguage: () => projectState.currentLanguageId,
  setLanguage: (id) => {
    projectState.currentLanguageId = id
  },
  exists: (kind, id) => {
    const p = projectState.project
    if (!p) return false
    switch (kind) {
      case 'language':
        return p.languages.some((x) => x.id === id)
      case 'lexeme':
        return p.lexemes.some((x) => x.id === id)
      case 'morpheme':
        return p.morphemes.some((x) => x.id === id)
      case 'sentence':
        return p.sentences.some((x) => x.id === id)
      case 'phrase':
        return p.phrasebook.some((x) => x.id === id)
      case 'doc':
        return p.docs.some((x) => x.id === id)
      case 'paradigm':
        return p.paradigms.some((x) => x.id === id)
      case 'ruleSet':
        return p.ruleSets.some((x) => x.id === id)
      case 'script':
        return p.languages.some((l) => l.scripts.some((sc) => sc.id === id))
      default:
        return true
    }
  }
}
