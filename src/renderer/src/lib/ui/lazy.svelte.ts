/**
 * 长列表分批渲染：先画够一屏的量，滚到快见底了再画下一批。
 * 切页面、切筛选时列表整份重画，条目一多就会卡一下，分批之后只画看得见的部分。
 *
 * 用法：
 *   const lz = lazy(60)
 *   {#each list.slice(0, lz.shown) as x (x.id)} … {/each}
 *   {#if list.length > lz.shown}<div use:lazyMore={lz}></div>{/if}
 * 筛选、排序换了就 lz.reset()。
 */
export interface Lazy {
  readonly shown: number
  grow(): void
  reset(): void
}

export function lazy(step = 60): Lazy {
  let shown = $state(step)
  return {
    get shown() {
      return shown
    },
    grow() {
      shown += step
    },
    reset() {
      shown = step
    }
  }
}

/** 最近的一层会滚动的祖先（页面里的滚动区）；都不是就返回 null，按整个窗口算 */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY
    if (oy === 'auto' || oy === 'scroll') return el
  }
  return null
}

/**
 * 放在列表末尾的哨兵：滚到离它 400px 以内就再要一批。
 * 观察的根要用列表所在的滚动区：按整个窗口算的话，提前量管不到里面这层滚动区，
 * 哨兵又是零高度、贴在滚动区最底边，怎么滚都算不上「看见了」，列表就一直停在第一批。
 * 画完一批哨兵还在范围里（这一批太矮）就接着要，直到把它推出范围或者全画完。
 */
export function lazyMore(node: HTMLElement, l: { grow: () => void }): { destroy(): void } {
  let raf = 0
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      l.grow()
      cancelAnimationFrame(raf)
      // 重新观察一次会立刻回报当前状态：还在范围里就会再要一批
      raf = requestAnimationFrame(() => {
        io.unobserve(node)
        io.observe(node)
      })
    },
    { root: scrollParent(node), rootMargin: '400px' }
  )
  io.observe(node)
  return {
    destroy: () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }
}
