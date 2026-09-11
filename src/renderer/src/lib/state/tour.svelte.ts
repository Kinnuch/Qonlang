/**
 * 图文引导的状态：点「使用指南」先一步步指着界面讲，讲完弹框问要不要去网站看完整教程。
 * 每个模块默认只自动讲一次；设置里（或结束弹框里）勾上「每次都先看」才会每次都讲。
 */
import { platform } from '$lib/platform'
import { guideUrl } from '$lib/core/guide'
import { TOUR_STEPS } from '$lib/core/tourSteps'
import { ui } from './ui.svelte'

class Tour {
  section = $state<string | null>(null)
  index = $state(0)
  /** 正在一步步讲 */
  active = $state(false)
  /** 讲完了，显示「去网站看完整教程」弹框 */
  ending = $state(false)
  private anchor = ''

  get steps(): { selector: string }[] {
    return this.section ? (TOUR_STEPS[this.section] ?? []) : []
  }

  /** 「使用指南」按钮：该讲就讲，不该讲就直接打开网站 */
  request(section: string, anchor = ''): void {
    const hasSteps = (TOUR_STEPS[section]?.length ?? 0) > 0
    const seen = ui.prefs.seenTours.includes(section)
    if (hasSteps && (!seen || ui.prefs.guideTourAlways)) {
      this.section = section
      this.anchor = anchor
      this.index = 0
      this.ending = false
      this.active = true
      return
    }
    void platform.openExternal(guideUrl(section, anchor))
  }
  next(): void {
    if (this.index < this.steps.length - 1) this.index++
    else this.finish()
  }
  prev(): void {
    if (this.index > 0) this.index--
  }
  /** 讲完（或跳过）：记下这个模块讲过了，弹框 */
  finish(): void {
    this.active = false
    this.ending = true
    if (this.section && !ui.prefs.seenTours.includes(this.section)) {
      ui.prefs.seenTours = [...ui.prefs.seenTours, this.section]
      void ui.savePrefs()
    }
  }
  close(): void {
    this.active = false
    this.ending = false
    this.section = null
  }
  openSite(): void {
    if (this.section) void platform.openExternal(guideUrl(this.section, this.anchor))
    this.close()
  }
}

export const tour = new Tour()
