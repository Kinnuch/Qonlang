/**
 * 图文引导的状态：点「使用指南」先一步步指着界面讲，讲完弹框问要不要去网站看完整教程。
 * 每个模块默认只自动讲一次；设置里（或结束弹框里）勾上「每次都先看」才会每次都讲。
 *
 * 每一步可以带着界面走：切模块、切子页、开关检视器（见 tourSteps.ts）。
 * 进来时的位置记在 home 里，讲完（或跳过）原样切回去，别把人扔在别的模块。
 */
import { platform } from '$lib/platform'
import { guideUrl } from '$lib/core/guide'
import { TOUR_STEPS, type TourStep } from '$lib/core/tourSteps'
import { ui, type PageView, type Section } from './ui.svelte'

class Tour {
  section = $state<string | null>(null)
  index = $state(0)
  /** 正在一步步讲 */
  active = $state(false)
  /** 讲完了，显示「去网站看完整教程」弹框 */
  ending = $state(false)
  private anchor = ''
  /** 开讲之前用户在哪：讲完切回去 */
  private home: { section: Section; view: PageView | null; inspector: boolean } | null = null
  /** 引导自己切过去的模块：界面换到它不算「用户走开了」，别把讲解掐掉 */
  private expected: Section | null = null

  get steps(): TourStep[] {
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
      this.home = {
        section: ui.section,
        view: ui.currentView(ui.section),
        inspector: ui.inspectorOpen
      }
      this.apply()
      return
    }
    void platform.openExternal(guideUrl(section, anchor))
  }
  next(): void {
    if (this.index < this.steps.length - 1) {
      this.index++
      this.apply()
    } else this.finish()
  }
  prev(): void {
    if (this.index > 0) {
      this.index--
      this.apply()
    }
  }
  /** 这一步要讲的东西在哪：先把界面切过去，气泡那边等元素出现了再画框 */
  private apply(): void {
    const step = this.steps[this.index]
    if (!step) return
    if (step.go) {
      this.expected = step.go
      ui.tourGo(step.go, step.view)
    }
    if (step.inspector !== undefined) ui.inspectorOpen = step.inspector
  }
  /** 界面换到这个模块是引导自己干的（GuideTour 据此判断要不要掐掉讲解） */
  expects(section: string): boolean {
    return this.expected === section
  }
  /** 切回开讲之前的位置 */
  private goHome(): void {
    const h = this.home
    this.home = null
    if (!h) return
    this.expected = h.section
    ui.tourGo(h.section, h.view)
    ui.inspectorOpen = h.inspector
  }
  /** 讲完（或跳过）：回到原来的位置，记下这个模块讲过了，弹框 */
  finish(): void {
    this.active = false
    this.goHome()
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
    this.goHome()
    this.expected = null
  }
  /** 用户自己走开了（点了别的模块）：就停在他去的地方，不往回拉 */
  abandon(): void {
    this.home = null
    this.close()
  }
  openSite(): void {
    if (this.section) void platform.openExternal(guideUrl(this.section, this.anchor))
    this.close()
  }
}

export const tour = new Tour()
