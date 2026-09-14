import { tick } from 'svelte'
import { ui, type Section } from '$lib/state/ui.svelte'

/**
 * 从别处跳过来，把列表滚到目标那一条；滚到了才返回（调用方这时再闪一下，高亮不会在半路上就褪完）。
 * 原来在两帧之后直接找元素：目标不在分批画的第一批里时还没画出来，什么都找不到；
 * 进页面时排队的「恢复上次滚动位置」又会连着几帧把滚动条拉回去，定位和高亮就都看不到了。
 * 现在先让滚动恢复停手，等筛选清掉、列表重算完，再补画到目标（ensure），画好了才滚。
 */
export async function scrollToItem(
  section: Section,
  selector: string,
  ensure?: () => void
): Promise<Element | null> {
  ui.cancelScrollRestore(section)
  await tick()
  ensure?.()
  await tick()
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  const el = document.querySelector(selector)
  if (!el) return null
  const box = document.querySelector<HTMLElement>(`[data-nav-scroll="${section}"]`)
  if (box && !fullyVisible(el, box)) {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        box.removeEventListener('scrollend', done)
        resolve()
      }
      // 滚不动（已经到底）时不会有 scrollend：最多等一秒多
      const timer = setTimeout(done, 1200)
      box.addEventListener('scrollend', done)
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  } else if (!box) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return el
}

function fullyVisible(el: Element, box: HTMLElement): boolean {
  const a = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  return a.top >= b.top && a.bottom <= b.bottom
}
