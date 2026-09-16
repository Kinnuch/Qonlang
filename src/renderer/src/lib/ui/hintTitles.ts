/**
 * 框里的灰字提示（placeholder）常常显示不全：把它也放进 title，鼠标停上去系统提示里能看全。
 * 用在检视器这类窄面板的外层：`use:hintTitles`。本来就写了 title 的框不动。
 */
export function hintTitles(node: HTMLElement): { destroy: () => void } {
  const apply = (): void => {
    const boxes = node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[placeholder], textarea[placeholder]'
    )
    for (const el of boxes) {
      const hint = el.placeholder
      if (!hint) continue
      // 已经有别处给的 title 就别盖掉
      if (el.title && el.dataset.hintTitle !== el.title) continue
      if (el.title === hint) continue
      el.title = hint
      el.dataset.hintTitle = hint
    }
  }
  apply()
  const mo = new MutationObserver(apply)
  mo.observe(node, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['placeholder']
  })
  return { destroy: () => mo.disconnect() }
}
