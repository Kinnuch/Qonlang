/**
 * 「导出学习包」页的设置（给 Qonlang Study 的）：不进项目文件，按项目 id 存在本机，
 * 改一下就过一会儿自动存；导出时跟项目一起打进 `.qstudy.json`。格式见 lib/core/studyPack.ts。
 */
import { platform } from '$lib/platform'
import { t } from '$lib/i18n/index.svelte'
import type { Project } from '$lib/core/model'
import {
  STUDY_PACK_EXTENSION,
  StudyPackError,
  defaultStudySettings,
  parseStudyPack,
  reconcileStudySettings,
  serializeStudyPack,
  type StudySettings
} from '$lib/core/studyPack'
import { ui } from './ui.svelte'

const SAVE_DELAY = 600

class StudyExportState {
  settings = $state<StudySettings | null>(null)
  #projectId: string | null = null
  #timer: ReturnType<typeof setTimeout> | undefined

  /** 进页面时读这个项目记下的设置；没有就用默认的 */
  async open(project: Project): Promise<void> {
    if (this.#projectId === project.meta.id && this.settings) {
      // 同一个项目再进来：跟项目对一遍（中间可能删了词条），别的照旧
      this.settings = reconcileStudySettings($state.snapshot(this.settings), project)
      return
    }
    this.flush()
    this.#projectId = project.meta.id
    let saved: Partial<StudySettings> | null = null
    try {
      const text = await platform.loadStudySettings(project.meta.id)
      saved = text ? JSON.parse(text) : null
    } catch {
      saved = null
    }
    this.settings = saved ? reconcileStudySettings(saved, project) : defaultStudySettings(project)
  }

  /** 改了设置：过一会儿存盘（连着改只存一次） */
  touch(): void {
    if (!this.settings) return
    this.settings.updatedAt = new Date().toISOString()
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.flush(), SAVE_DELAY)
  }

  /** 马上存（离开页面、换项目时） */
  flush(): void {
    clearTimeout(this.#timer)
    this.#timer = undefined
    if (!this.settings || !this.#projectId) return
    void platform.saveStudySettings(this.#projectId, JSON.stringify($state.snapshot(this.settings)))
  }

  /** 从以前导出的学习包读回设置（换了电脑、重装之后用）：能对上现在项目的部分留下 */
  async loadFromPack(project: Project): Promise<void> {
    const [file] = await platform.readTextFiles({ multiple: false, extensions: ['json'] })
    if (!file) return
    try {
      const pack = parseStudyPack(file.content)
      if (pack.project.meta.id !== project.meta.id)
        ui.toast(t('studyExport.otherProject', { name: pack.project.meta.name }))
      this.settings = reconcileStudySettings(pack.study, project)
      this.touch()
      ui.toast(t('studyExport.loadedFromPack'))
    } catch (e) {
      ui.error(e instanceof StudyPackError ? t('studyExport.notAPack') : String(e))
    }
  }

  async export(project: Project): Promise<void> {
    if (!this.settings) return
    this.flush()
    const text = serializeStudyPack(
      $state.snapshot(project) as Project,
      $state.snapshot(this.settings) as StudySettings,
      __APP_VERSION__
    )
    const name = (project.meta.name || 'qonlang') + STUDY_PACK_EXTENSION
    if (await platform.saveTextFile(name, text))
      ui.toast(t('studyExport.exported', { size: formatSize(text.length) }))
  }
}

function formatSize(chars: number): string {
  return chars > 1e6
    ? `${(chars / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(chars / 1e3))} KB`
}

export const studyExport = new StudyExportState()
