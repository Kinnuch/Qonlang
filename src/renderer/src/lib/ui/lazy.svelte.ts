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

/** 放在列表末尾的哨兵：滚进视野（提前 400px）就再要一批 */
export function lazyMore(node: HTMLElement, l: { grow: () => void }): { destroy(): void } {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) l.grow()
    },
    { rootMargin: '400px' }
  )
  io.observe(node)
  return { destroy: () => io.disconnect() }
}
