/**
 * 一排排可能很多的小块（能插入的音类与语素、用到它的词条……）：超过五行就在这一块里滚动。
 * 按里面最高的小块和行距算出五行有多高，小块多了少了、字号不同都跟着变。
 */
export function fiveRows(node: HTMLElement, rows = 5): { destroy: () => void } {
  const apply = (): void => {
    let tallest = 0
    for (const el of Array.from(node.children).slice(0, 12))
      tallest = Math.max(tallest, (el as HTMLElement).offsetHeight)
    if (!tallest) {
      node.style.maxHeight = ''
      return
    }
    const gap = parseFloat(getComputedStyle(node).rowGap) || 0
    node.style.maxHeight = `${Math.ceil(rows * tallest + (rows - 1) * gap) + 2}px`
    node.style.overflowY = 'auto'
    node.style.alignContent = 'flex-start'
  }
  apply()
  const mo = new MutationObserver(apply)
  mo.observe(node, { childList: true, subtree: true, characterData: true })
  return {
    destroy: () => mo.disconnect()
  }
}
