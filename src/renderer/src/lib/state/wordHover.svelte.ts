import type { Analysis, Id, Project } from '$lib/core/model'

/** 悬浮卡底部可以点开的组成部分：语料里已确认的切分、词源里的来源等 */
export interface HoverPart {
  label: string
  gloss?: string
  lexemeId?: Id | null
  morphemeId?: Id | null
  /** 这一段对不上词条也对不上语素：点开是「没有找到」 */
  missing?: boolean
}

/** 挑中的词条或语素；或者一种切法（搜索框里输入的写法能切开时，整个换成这几段） */
export interface HoverChoice {
  lexemeId?: Id | null
  morphemeId?: Id | null
  analysis?: Analysis
  /** 挑的是这个词条的第几个义项；不写就用第一个义项 */
  senseIndex?: number | null
}

/** 语料里悬浮时带上：没找到的整个词（index 为 null）或切分里的第 index 段可以手动指定 */
export interface HoverAssign {
  languageId: Id
  /** 这个词在原文里的写法：卡片上点铅笔改成别的词时，搜索框先填它 */
  surface?: string
  onAssign: (index: number | null, c: HoverChoice) => void
}

/** 悬浮词卡的全局状态：延迟显示、离开延迟隐藏、进入浮层时保持 */
class WordHover {
  lexemeId = $state<Id | null>(null)
  /** 悬浮的是语素时用这个（与 lexemeId 二选一） */
  morphemeId = $state<Id | null>(null)
  rect = $state<DOMRect | null>(null)
  /**
   * 卡片查词用的项目：平时是打开着的项目；开始页的画廊没打开项目，悬浮时把读进来的那个放这里。
   * raw：整个项目很大，不做深层响应式。卡片收起时清掉。
   */
  project = $state.raw<Project | null>(null)
  /**
   * 卡片上的铅笔（改成别的词）怎么办：语料页里有 assign，就地换成搜索框；
   * 开始页的画廊没有打开项目，给这个——先打开那个项目、跳到那一句，再在那里打开搜索框
   */
  editAt: ((index: number | null) => void) | null = null
  /** 卡片底部「在词库中查看」怎么打开：开始页要先打开那个项目再跳；不设就直接跳 */
  opener:
    ((target: { lexemeId: Id | null; morphemeId: Id | null; languageId: Id }) => void) | null = null
  /** 调用方给的切分（优先于卡片自己按词源推的） */
  parts = $state<HoverPart[]>([])
  /**
   * 卡片最初打开的是哪个词条 / 语素。悬浮到切分里的某一块时卡片换成那一块（swap），
   * 但切分那一行照这个算，不跟着换——不然换过去的词自己没有来源，那一行一消失整张卡就跳一下。
   */
  base = $state<{ lexemeId: Id | null; morphemeId: Id | null }>({
    lexemeId: null,
    morphemeId: null
  })
  /**
   * 钉住：点过卡片里的成分之后，卡片高度会变，鼠标很容易落到卡片外面，
   * 这时候再按「鼠标离开就收」处理就会闪没。钉住后只有点别处或按 Esc 才关。
   */
  pinned = $state(false)
  /** 分不出是哪一个时的候选（两个以上才用），挑中一个就交给 onPick */
  candidates = $state<HoverChoice[]>([])
  /**
   * 没找到：卡片里显示「没有找到」和搜索框；index 为 null 是整个词，否则是切分里的第几段。
   * edit：认出来了但认错了，用户点了铅笔——同一个搜索框，标题换成「应该是哪个词」
   */
  missing = $state<{ label: string; index: number | null; edit?: boolean } | null>(null)
  /** 能不能手动指定（语料里悬浮才带） */
  assign = $state<HoverAssign | null>(null)
  /**
   * 改成别的词时顺带把语料原文里的这个词也换成新词条的写法。
   * 记在这里：这一次运行里一直记着，不写进项目（卡片收起也不清）。
   */
  rewriteText = $state(false)
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
      this.base = { lexemeId: this.lexemeId, morphemeId: this.morphemeId }
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
    assign: HoverAssign | null
  ): void {
    this.open(() => {
      this.missing = { label, index }
      this.rect = rect
      this.parts = parts
      this.assign = assign
    })
  }
  /** 同时浮出几个候选让用户挑；挑中之后调 onPick（通常是把它写进分析并确认） */
  showCandidates(
    cands: HoverChoice[],
    rect: DOMRect,
    onPick: (c: HoverChoice) => void,
    assign: HoverAssign | null = null
  ): void {
    this.open(() => {
      this.parts = []
      this.assign = assign
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
    // 挑的是一种切法：列表里马上换成新的几段，卡片收起
    if (c.analysis) {
      this.hide(true)
      return
    }
    if (m.index !== null)
      this.parts = this.parts.map((p, i) =>
        i === m.index
          ? { ...p, lexemeId: c.lexemeId ?? null, morphemeId: c.morphemeId ?? null, missing: false }
          : p
      )
    this.swap(c)
  }
  /**
   * 卡片里点了某个义项：把这个词换成这个义项的意思。
   * 卡片正显示切分里的某一段时只改那一段——一个词由几个语素组成时，也挑得出某一段是哪个义项。
   */
  chooseSense(senseIndex: number): void {
    const lexemeId = this.lexemeId
    if (!this.assign || !lexemeId) return
    const i = this.parts.findIndex((p) => !!p.lexemeId && p.lexemeId === lexemeId)
    this.assign.onAssign(i >= 0 ? i : null, { lexemeId, senseIndex })
    this.pinned = true
  }
  /** 卡片上点了铅笔：换成搜索框挑正确的词；index 为 null 是整个词，否则是切分里的第几段 */
  startEdit(index: number | null, label: string): void {
    if (!this.assign) return
    this.cancel()
    this.candidates = []
    this.lexemeId = null
    this.morphemeId = null
    this.missing = { label, index, edit: true }
    this.pinned = true
  }
  /** 从别处跳过来直接打开「应该是哪个词」（语料页定位到那个词之后调），不等延时、直接钉住 */
  showEdit(
    label: string,
    index: number | null,
    rect: DOMRect,
    parts: HoverPart[],
    assign: HoverAssign
  ): void {
    this.cancel()
    this.candidates = []
    this.lexemeId = null
    this.morphemeId = null
    this.base = { lexemeId: null, morphemeId: null }
    this.rect = rect
    this.parts = parts
    this.assign = assign
    this.missing = { label, index, edit: true }
    this.pinned = true
  }
  /** 卡片里点了没找到的那一段（开始页画廊里没法就地指定，也照样显示「没有找到」，旁边的「改」去语料里指定） */
  openMissing(index: number): void {
    const p = this.parts[index]
    if (!p) return
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
    this.project = null
    this.opener = null
    this.editAt = null
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
