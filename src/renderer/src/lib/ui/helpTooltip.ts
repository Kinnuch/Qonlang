const DISMISS = 'qonlang-help-dismiss'

/** 只认该容器里帮助点所描述的气泡，不把其它弹窗的提示当作内部。 */
export function ownedHelpTooltip(
  owner: HTMLElement | null | undefined,
  target?: EventTarget | null
): HTMLElement | null {
  if (!owner) return null
  for (const dot of owner.querySelectorAll<HTMLElement>('[data-help-dot][aria-describedby]')) {
    const id = dot.getAttribute('aria-describedby')
    const tooltip = id ? owner.ownerDocument.getElementById(id) : null
    if (!tooltip?.hasAttribute('data-help-tooltip')) continue
    if (target === undefined || (target instanceof Node && tooltip.contains(target))) return tooltip
  }
  return null
}

export function dismissOwnedHelpTooltip(owner: HTMLElement | null | undefined): boolean {
  const tooltip = ownedHelpTooltip(owner)
  if (!tooltip) return false
  tooltip.dispatchEvent(new Event(DISMISS))
  return true
}

export function helpTooltipDismiss(node: HTMLElement, dismiss: () => void): { destroy(): void } {
  node.addEventListener(DISMISS, dismiss)
  return { destroy: () => node.removeEventListener(DISMISS, dismiss) }
}
