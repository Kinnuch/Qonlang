import type { Id } from '$lib/core/model'

/** 悬浮卡底部可以点开的组成部分：语料里已确认的切分、词源里的来源等 */
export interface HoverPart {
  label: string
  gloss?: string
  lexemeId?: Id | null
  morphemeId?: Id | null
  /** 这一段对不上词条也对不上语素：点开是「没有找到」 */
  missing?: boolean
}

/** 挑中的词条或语素 */
export interface HoverChoice {
  lexemeId?: Id | null
  morphemeId?: Id | null
}

/** 语料里悬浮时带上：没找到的整个词（index 为 null）或切分里的第 index 段可以手动指定 */
export interface HoverAssign {
  languageId: Id
  onAssign: (index: number | null, c: HoverChoice) => void
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
  candidates = $state<HoverChoice[]>([])
  /** 没找到：卡片里显示「没有找到」和搜索框；index 为 null 是整个词，否则是切分里的第几段 */
  missing = $state<{ label: string; index: number | null } | null>(null)
  /** 能不能手动指定（语料里悬浮才带） */
  assign = $state<HoverAssign | null>(null)
  private onPick: ((c: HoverChoice) => void) | null = null
  private showTimer: ReturnType<typeof setTimeout> | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  /** 稍等一下再换内容：鼠标只是划过去时不闪 */
  private open(fill: () => void): void {
    this.cancel()
    this.pinned = false
    this.showTimer = setTimeout(() => {
      this.candidates = []
      this.missing = null
      this.lexemeId = null
      this.morphemeId = null
      fill()
    }, 280)
  }
  show(
    lexemeId: Id,
    rect: DOMRect,
    parts: HoverPart[] = [],
    assign: HoverAssign | null = null
  ): void {
    this.open(() => {
      this.lexemeId = lexemeId
      this.rect = rect
      this.parts = parts
      this.assign = assign
    })
  }
  showMorpheme(
    morphemeId: Id,
    rect: DOMRect,
    parts: HoverPart[] = [],
    assign: HoverAssign | null = null
  ): void {
    this.open(() => {
      this.morphemeId = morphemeId
      this.rect = rect
      this.parts = parts
      this.assign = assign
    })
  }
  /** 找不到：整个词（index 为 null）或切分里的一段 */
  showMissing(
    label: string,
    index: number | null,
    rect: DOMRect,
    parts: HoverPart[],
    assign: HoverAssign
  ): void {
    this.open(() => {
      this.missing = { label, index }
      this.rect = rect
      this.parts = parts
      this.assign = assign
    })
  }
  /** 同时浮出几个候选让用户挑；挑中之后调 onPick（通常是把它写进分析并确认） */
  showCandidates(cands: HoverChoice[], rect: DOMRect, onPick: (c: HoverChoice) => void): void {
    this.open(() => {
      this.parts = []
      this.assign = null
      this.candidates = cands
      this.onPick = onPick
      this.rect = rect
    })
  }
  pick(c: HoverChoice): void {
    const fn = this.onPick
    this.onPick = null
    this.candidates = []
    fn?.(c)
    this.swap(c)
  }
  /** 手动指定没找到的那个词（或那一段）：写进分析，卡片换成刚挑的 */
  choose(c: HoverChoice): void {
    const m = this.missing
    if (!m || !this.assign) return
    this.assign.onAssign(m.index, c)
    if (m.index !== null)
      this.parts = this.parts.map((p, i) =>
        i === m.index
          ? { ...p, lexemeId: c.lexemeId ?? null, morphemeId: c.morphemeId ?? null, missing: false }
          : p
      )
    this.swap(c)
  }
  /** 卡片里点了没找到的那一段 */
  openMissing(index: number): void {
    const p = this.parts[index]
    if (!p || !this.assign) return
    this.cancel()
    this.candidates = []
    this.lexemeId = null
    this.morphemeId = null
    this.missing = { label: p.label, index }
    this.pinned = true
  }
  /** 卡片里点开某个组成部分时立即切换，不再等延时 */
  swap(target: HoverChoice): void {
    this.cancel()
    this.candidates = []
    this.missing = null
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
      this.clear()
      return
    }
    this.keep()
    this.hideTimer = setTimeout(() => this.clear(), 220)
  }
  private clear(): void {
    this.candidates = []
    this.onPick = null
    this.missing = null
    this.assign = null
    this.lexemeId = null
    this.morphemeId = null
    this.rect = null
  }
  private cancel(): void {
    if (this.showTimer) clearTimeout(this.showTimer)
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.showTimer = this.hideTimer = null
  }
}

export const wordHover = new WordHover()
