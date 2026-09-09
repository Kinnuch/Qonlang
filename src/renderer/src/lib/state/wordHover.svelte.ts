import type { Id } from '$lib/core/model'

/** 悬浮卡底部可以点开的组成部分：语料里已确认的切分、词源里的来源等 */
export interface HoverPart {
  label: string
  gloss?: string
  lexemeId?: Id | null
  morphemeId?: Id | null
}

/** 悬浮词卡的全局状态：延迟显示、离开延迟隐藏、进入浮层时保持 */
class WordHover {
  lexemeId = $state<Id | null>(null)
  /** 悬浮的是语素时用这个（与 lexemeId 二选一） */
  morphemeId = $state<Id | null>(null)
  rect = $state<DOMRect | null>(null)
  /** 调用方给的切分（优先于卡片自己按词源推的） */
  parts = $state<HoverPart[]>([])
  private showTimer: ReturnType<typeof setTimeout> | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  show(lexemeId: Id, rect: DOMRect, parts: HoverPart[] = []): void {
    this.cancel()
    this.showTimer = setTimeout(() => {
      this.lexemeId = lexemeId
      this.morphemeId = null
      this.rect = rect
      this.parts = parts
    }, 280)
  }
  showMorpheme(morphemeId: Id, rect: DOMRect, parts: HoverPart[] = []): void {
    this.cancel()
    this.showTimer = setTimeout(() => {
      this.morphemeId = morphemeId
      this.lexemeId = null
      this.rect = rect
      this.parts = parts
    }, 280)
  }
  /** 卡片里点开某个组成部分时立即切换，不再等延时 */
  swap(target: { lexemeId?: Id | null; morphemeId?: Id | null }): void {
    this.cancel()
    this.lexemeId = target.lexemeId ?? null
    this.morphemeId = target.morphemeId ?? null
  }
  keep(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
  }
  hide(now = false): void {
    if (this.showTimer) clearTimeout(this.showTimer)
    this.showTimer = null
    if (now) {
      this.lexemeId = null
      this.morphemeId = null
      this.rect = null
      return
    }
    this.keep()
    this.hideTimer = setTimeout(() => {
      this.lexemeId = null
      this.morphemeId = null
      this.rect = null
    }, 220)
  }
  private cancel(): void {
    if (this.showTimer) clearTimeout(this.showTimer)
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.showTimer = this.hideTimer = null
  }
}

export const wordHover = new WordHover()
