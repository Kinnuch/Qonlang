import type { Id, Language, Project } from '$lib/core/model'
import { createProject, now, type CreateProjectOptions } from '$lib/core/factory'
import {
  PROJECT_EXTENSION,
  ProjectParseError,
  parseProject,
  projectToFolder,
  serializeProject
} from '$lib/core/serialize'
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

  get currentLanguage(): Language | null {
    if (!this.project || !this.currentLanguageId) return null
    return this.project.languages.find((l) => l.id === this.currentLanguageId) ?? null
  }

  get fileName(): string {
    return this.target?.name ?? (this.project?.meta.name || t('app.untitled')) + PROJECT_EXTENSION
  }

  /** 每次修改项目数据后调用 */
  touch(): void {
    if (!this.project) return
    this.project.meta.updatedAt = now()
    if (!this.dirty) {
      this.dirty = true
      platform.setDirty(true)
    }
  }

  private markClean(): void {
    this.dirty = false
    platform.setDirty(false)
  }

  create(opts: Omit<CreateProjectOptions, 'appVersion' | 'uiLocale'> & { appVersion: string; uiLocale: string }): void {
    const p = createProject(opts)
    this.load(p, null)
    this.dirty = true
    platform.setDirty(true)
  }

  load(p: Project, target: SaveTarget | null): void {
    this.project = p
    this.target = target
    this.currentLanguageId = p.settings.defaultLanguageId ?? p.languages[0]?.id ?? null
    this.lastSavedAt = target ? p.meta.updatedAt : null
    this.markClean()
    ui.section = 'languages'
  }

  private handleParseError(e: unknown): void {
    if (e instanceof ProjectParseError) {
      const key = { 'invalid-json': 'invalidJson', 'not-a-project': 'notAProject', 'newer-schema': 'newerSchema' }[e.code]
      ui.error(t(`errors.${key}`))
    } else {
      ui.error(t('errors.openFailed', { msg: (e as Error).message }))
    }
  }

  async open(): Promise<boolean> {
    try {
      const r = await platform.openProject()
      if (!r) return false
      const p = parseProject(r.content)
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
      const p = parseProject(r.content)
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
    this.saving = true
    try {
      const content = serializeProject($state.snapshot(this.project) as Project)
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
    if (!this.project || !this.dirty) return
    await platform.saveSnapshot(serializeProject($state.snapshot(this.project) as Project))
  }

  async exportFolder(): Promise<void> {
    if (!this.project) return
    const files = projectToFolder($state.snapshot(this.project) as Project)
    await platform.exportFolder(files, this.project.meta.name || 'qianyuji')
  }

  close(): void {
    this.project = null
    this.target = null
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
