/**
 * 「返回」要记住列表滚到哪：把这个动作挂在页面主列表的滚动容器上（use:navScroll={'lexicon'}）。
 * 滚动时报给 ui，返回时 ui.restoreScroll 按 data-nav-scroll 找回这个容器。
 */
import { ui, type Section } from '$lib/state/ui.svelte'

export function navScroll(
  node: HTMLElement,
  section: Section
): { update: (s: Section) => void; destroy: () => void } {
  let current = section
  node.dataset.navScroll = current
  const onScroll = (): void => ui.noteScroll(current, node.scrollTop)
  node.addEventListener('scroll', onScroll, { passive: true })
  return {
    update(s) {
      current = s
      node.dataset.navScroll = s
    },
    destroy() {
      node.removeEventListener('scroll', onScroll)
    }
  }
}
