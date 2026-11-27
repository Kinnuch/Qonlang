import { tick } from 'svelte'
import { ui, type Section } from '$lib/state/ui.svelte'

interface RowNavigation {
  section: Section
  items: readonly { id: string }[]
  selected: string | null
  select: (id: string, index: number) => void
  ensure: (index: number) => void
}

/** 普通上下键按当前显示顺序选条目；输入框、控件、菜单仍处理自己的按键。 */
export function recordRowKeys(
  node: HTMLElement,
  initial: RowNavigation
): { update(next: RowNavigation): void; destroy(): void } {
  let options = initial
  let serial = 0
  let cursor = -1
  async function keydown(event: KeyboardEvent): Promise<void> {
    if (
      !['ArrowUp', 'ArrowDown'].includes(event.key) ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      ui.section !== options.section ||
      ui.syntaxOpen
    )
      return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const fromModuleButton = target.matches('.nav-btn.active')
    if (
      target !== document.body &&
      target !== document.documentElement &&
      !node.contains(target) &&
      !fromModuleButton
    )
      return
    if (
      !fromModuleButton &&
      target.closest(
        'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
      )
    )
      return
    if (
      document.querySelector(
        'dialog[open], [aria-modal="true"], [role="menu"], [role="listbox"], [role="dialog"]:not([hidden])'
      )
    )
      return
    const { items, selected } = options
    if (!items.length) return
    event.preventDefault()
    const current =
      items[cursor]?.id === selected ? cursor : items.findIndex((item) => item.id === selected)
    const down = event.key === 'ArrowDown'
    const next =
      current < 0
        ? down
          ? 0
          : items.length - 1
        : Math.max(0, Math.min(items.length - 1, current + (down ? 1 : -1)))
    const id = items[next].id
    cursor = next
    const request = ++serial
    ui.cancelScrollRestore(options.section)
    options.select(id, next)
    node.focus({ preventScroll: true })
    const selector = 'tr[data-id="' + CSS.escape(id) + '"]'
    if (!node.querySelector(selector)) options.ensure(next)
    await tick()
    if (request !== serial || !node.isConnected) return
    const row = node.querySelector(selector)
    if (!row) return
    const box = node.getBoundingClientRect(),
      rect = row.getBoundingClientRect()
    const top = box.top + (node.querySelector('thead')?.getBoundingClientRect().height ?? 0)
    if (rect.top < top) node.scrollTop += rect.top - top
    else if (rect.bottom > box.top + node.clientHeight)
      node.scrollTop += rect.bottom - box.top - node.clientHeight
  }
  window.addEventListener('keydown', keydown)
  return {
    update(next: RowNavigation) {
      options = next
    },
    destroy() {
      serial++
      window.removeEventListener('keydown', keydown)
    }
  }
}
