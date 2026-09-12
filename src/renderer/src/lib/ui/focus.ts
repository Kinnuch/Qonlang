/** 页签上的铅笔按下去之后：把检视器里对应的输入框滚进来、聚焦并选中，直接改名。 */
export function focusField(selector: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>(selector)
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    el.focus()
    el.select?.()
  })
}
