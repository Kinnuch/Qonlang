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
  /**
   * 钉住：点过卡片里的成分之后，卡片高度会变，鼠标很容易落到卡片外面，
   * 这时候再按「鼠标离开就收」处理就会闪没。钉住后只有点别处或按 Esc 才关。
   */
  pinned = $state(false)
  /** 分不出是哪一个时的候选（两个以上才用），挑中一个就交给 onPick */
  candidates = $state<{ lexemeId?: Id | null; morphemeId?: Id | null }[]>([])
  private onPick: ((c: { lexemeId?: Id | null; morphemeId?: Id | null }) => void) | null = null
  private showTimer: ReturnType<typeof setTimeout> | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  show(lexemeId: Id, rect: DOMRect, parts: HoverPart[] = []): void {
    this.cancel()
    this.pinned = false
    this.showTimer = setTimeout(() => {
      this.candidates = []
      this.lexemeId = lexemeId
      this.morphemeId = null
      this.rect = rect
      this.parts = parts
    }, 280)
  }
  showMorpheme(morphemeId: Id, rect: DOMRect, parts: HoverPart[] = []): void {
    this.cancel()
    this.pinned = false
    this.showTimer = setTimeout(() => {
      this.candidates = []
      this.morphemeId = morphemeId
      this.lexemeId = null
      this.rect = rect
      this.parts = parts
    }, 280)
  }
  /** 同时浮出几个候选让用户挑；挑中之后调 onPick（通常是把它写进分析并确认） */
  showCandidates(
    cands: { lexemeId?: Id | null; morphemeId?: Id | null }[],
    rect: DOMRect,
    onPick: (c: { lexemeId?: Id | null; morphemeId?: Id | null }) => void
  ): void {
    this.cancel()
    this.pinned = false
    this.showTimer = setTimeout(() => {
      this.lexemeId = null
      this.morphemeId = null
      this.parts = []
      this.candidates = cands
      this.onPick = onPick
      this.rect = rect
    }, 280)
  }
  pick(c: { lexemeId?: Id | null; morphemeId?: Id | null }): void {
    const fn = this.onPick
    this.onPick = null
    this.candidates = []
    fn?.(c)
    this.swap(c)
  }
  /** 卡片里点开某个组成部分时立即切换，不再等延时 */
  swap(target: { lexemeId?: Id | null; morphemeId?: Id | null }): void {
    this.cancel()
    this.candidates = []
    this.lexemeId = target.lexemeId ?? null
    this.morphemeId = target.morphemeId ?? null
    this.pinned = true
  }
  keep(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = null
  }
  hide(now = false): void {
    if (this.pinned && !now) return
    if (this.showTimer) clearTimeout(this.showTimer)
    this.showTimer = null
    if (now) {
      this.pinned = false
      this.candidates = []
      this.onPick = null
      this.lexemeId = null
      this.morphemeId = null
      this.rect = null
      return
    }
    this.keep()
    this.hideTimer = setTimeout(() => {
      this.candidates = []
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
