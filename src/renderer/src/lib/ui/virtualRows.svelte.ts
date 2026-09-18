/**
 * 长表格只画看得见的那些行：上下各多画一截，其余的高度用表格头尾两行空白撑出来，
 * 滚动条长短、滚动位置都跟全画出来一样。行高不一样（释义折行）也行：画出来的行量一次记下，
 * 没画过的按一个估计的行高算（第一次量完就定下来，免得估计一变整段空白跟着伸缩）；
 * 可见区域上面的行量出来跟估计不一样时，滚动位置补上差值，眼前的内容不跳。
 * 量好的高度按行 id 记在模块里，离开页面再回来还用得上。
 * 行高都对齐到整数个物理像素：上面那截空白是各行高度之和，带小数的话整张表就落在半个像素上，
 * 字会糊成一片（滚得越深越明显）。
 *
 * 用法：滚动容器 `use:rows.box`，每一行 `use:rows.row` 且带 `data-id`，
 * 只画 `rows.range.start` 到 `rows.range.end` 这一段，前后各放一行高度为 `rows.before` / `rows.after` 的空白。
 */
const remembered = new Map<string, Map<string, number>>()

/** 对齐到整数个物理像素：1.5 倍缩放下 27.33px 记成 27.33…→ 27.333 的整数倍，累加起来仍然落在像素格上 */
function snap(h: number): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Math.round(h * dpr) / dpr
}

export class VirtualRows {
  /** 滚动容器的 scrollTop */
  top = $state(0)
  /** 滚动容器的可见高度 */
  viewport = $state(800)
  /** 量到新行高时加一，让位置重算 */
  private measured = $state(0)
  private readonly heights: Map<string, number>
  /** 没量过的行按这个高度算 */
  private estimate: number
  private estimateFixed: boolean
  private boxEl: HTMLElement | null = null
  private observer: ResizeObserver | null = null
  private indexCache: { ids: readonly string[]; map: Map<string, number> } | null = null

  constructor(
    key: string,
    private readonly ids: () => readonly string[],
    private readonly overscan = 600,
    guess = 34
  ) {
    let known = remembered.get(key)
    if (!known) {
      known = new Map()
      remembered.set(key, known)
    }
    this.heights = known
    this.estimate = snap(known.size ? average(known) : guess)
    this.estimateFixed = known.size > 0
  }

  /** 每一行到表格顶部的距离；最后一项是总高 */
  offsets = $derived.by(() => {
    void this.measured
    const ids = this.ids()
    const out = new Float64Array(ids.length + 1)
    for (let i = 0; i < ids.length; i++)
      out[i + 1] = out[i] + (this.heights.get(ids[i]) ?? this.estimate)
    return out
  })

  /** 要画的那一段：[start, end) */
  range = $derived.by(() => {
    const off = this.offsets
    const n = off.length - 1
    if (n <= 0) return { start: 0, end: 0 }
    const from = Math.max(0, this.top - this.overscan)
    const to = this.top + this.viewport + this.overscan
    const start = firstEndingAfter(off, from)
    let end = start
    while (end < n && off[end] < to) end++
    return { start, end: Math.max(end, start + 1) }
  })

  get before(): number {
    return this.offsets[this.range.start] ?? 0
  }
  get after(): number {
    const off = this.offsets
    return Math.max(0, off[off.length - 1] - (off[this.range.end] ?? 0))
  }

  private indexOf(ids: readonly string[]): Map<string, number> {
    if (this.indexCache?.ids !== ids)
      this.indexCache = { ids, map: new Map(ids.map((id, i) => [id, i])) }
    return this.indexCache.map
  }

  /** 滚动容器：记下滚动位置与可见高度；滚动位置的补偿自己做，关掉浏览器的滚动锚定 */
  box = (node: HTMLElement): { destroy: () => void } => {
    this.boxEl = node
    node.style.overflowAnchor = 'none'
    const onScroll = (): void => {
      this.top = node.scrollTop
    }
    const ro = new ResizeObserver(() => {
      this.viewport = node.clientHeight
      this.top = node.scrollTop
    })
    node.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(node)
    this.viewport = node.clientHeight || this.viewport
    this.top = node.scrollTop
    return {
      destroy: () => {
        node.removeEventListener('scroll', onScroll)
        ro.disconnect()
        if (this.boxEl === node) this.boxEl = null
      }
    }
  }

  /** 画出来的一行（要带 data-id）：量它的高 */
  row = (node: HTMLElement): { destroy: () => void } => {
    this.observer ??= new ResizeObserver((entries) => this.measure(entries))
    this.observer.observe(node)
    return { destroy: () => this.observer?.unobserve(node) }
  }

  private measure(entries: ResizeObserverEntry[]): void {
    const ids = this.ids()
    const index = this.indexOf(ids)
    const box = this.boxEl
    const scrollTop = box?.scrollTop ?? this.top
    // 顶端在可见区域上沿之上的行（包括露出一半的那行）高度变了，下面的内容会被推开：滚动位置跟着补
    const off = this.offsets
    const hit = firstEndingAfter(off, scrollTop)
    const first = off[hit] < scrollTop ? hit + 1 : hit
    let shift = 0
    let changed = false
    for (const e of entries) {
      const target = e.target as HTMLElement
      const id = target.dataset.id
      const h = snap(e.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight)
      if (!id || !h) continue
      const old = this.heights.get(id)
      if (old !== undefined && Math.abs(old - h) < 0.5) continue
      const i = index.get(id)
      if (i !== undefined && i < first) shift += h - (old ?? this.estimate)
      this.heights.set(id, h)
      changed = true
    }
    if (!changed) return
    // 第一次量到行高：用它们的平均值当估计，此后不再改；上面没量过的行跟着新估计变高变矮，也补进滚动位置
    if (!this.estimateFixed) {
      const next = snap(average(this.heights))
      let unmeasured = 0
      for (let i = 0; i < first; i++) if (!this.heights.has(ids[i])) unmeasured++
      shift += unmeasured * (next - this.estimate)
      this.estimate = next
      this.estimateFixed = true
    }
    this.measured++
    if (shift && box) {
      box.scrollTop = scrollTop + shift
      this.top = box.scrollTop
    }
  }

  /** 把第 i 行滚到可见区域中间附近（先让它画出来，再由调用方精确滚过去） */
  scrollToIndex(i: number): void {
    const node = this.boxEl
    if (!node || i < 0) return
    const y = Math.max(0, (this.offsets[i] ?? 0) - this.viewport / 2)
    node.scrollTop = y
    this.top = node.scrollTop
  }
}

function average(heights: Map<string, number>): number {
  let sum = 0
  for (const h of heights.values()) sum += h
  return heights.size ? sum / heights.size : 34
}

/** offsets 里第一个在 y 之后结束的行 */
function firstEndingAfter(off: Float64Array, y: number): number {
  const n = off.length - 1
  let lo = 0
  let hi = Math.max(0, n - 1)
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (off[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}
