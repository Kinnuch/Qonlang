import type { Id } from '$lib/core/model'

/** 悬浮词卡的全局状态：延迟显示、离开延迟隐藏、进入浮层时保持 */
class WordHover {
  lexemeId = $state<Id | null>(null)
  rect = $state<DOMRect | null>(null)
  private showTimer: ReturnType<typeof setTimeout> | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  show(lexemeId: Id, rect: DOMRect): void {
    this.cancel()
    this.showTimer = setTimeout(() => {
      this.lexemeId = lexemeId
      this.rect = rect
    }, 280)
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
      this.rect = null
      return
    }
    this.keep()
    this.hideTimer = setTimeout(() => {
      this.lexemeId = null
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
