/** 临时视图卸载列表时保存实际视口；行锚点吸收虚拟行测量或窗口尺寸变化。 */
export interface ListViewPosition {
  top: number
  left: number
  anchor?: { id: string; offset: number }
}

export function captureListViewPosition(node: HTMLElement | null): ListViewPosition | null {
  if (!node) return null
  const box = node.getBoundingClientRect(),
    header = node.querySelector('thead')?.getBoundingClientRect().height ?? 0
  const first = [...node.querySelectorAll<HTMLElement>('tbody tr[data-id]')].find((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > box.top + header && rect.top < box.bottom
  })
  return {
    top: node.scrollTop,
    left: node.scrollLeft,
    ...(first?.dataset.id
      ? { anchor: { id: first.dataset.id, offset: first.getBoundingClientRect().top - box.top } }
      : {})
  }
}

/** 限时等待虚拟列表与ResizeObserver完成；用户再次操作时立即让出滚动控制。 */
export function restoreListViewPosition(
  node: HTMLElement,
  position: ListViewPosition,
  isCurrent: () => boolean
): () => void {
  let raf = 0,
    frames = 12,
    first = true,
    stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    node.removeEventListener('wheel', stop)
    node.removeEventListener('pointerdown', stop)
    node.removeEventListener('touchstart', stop)
    node.removeEventListener('keydown', key)
  }
  const key = (event: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
      stop()
  }
  const apply = (): void => {
    if (stopped) return
    if (!node.isConnected || !isCurrent()) return stop()
    if (first) {
      first = false
      node.scrollTop = position.top
      node.scrollLeft = position.left
    }
    if (position.anchor) {
      const row = [...node.querySelectorAll<HTMLElement>('tbody tr[data-id]')].find(
        (row) => row.dataset.id === position.anchor!.id
      )
      if (row) {
        const delta =
          row.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          position.anchor.offset
        if (Math.abs(delta) > 0.25) node.scrollTop += delta
      }
    }
    if (--frames > 0) raf = requestAnimationFrame(apply)
    else stop()
  }
  node.addEventListener('wheel', stop, { passive: true })
  node.addEventListener('pointerdown', stop)
  node.addEventListener('touchstart', stop, { passive: true })
  node.addEventListener('keydown', key)
  raf = requestAnimationFrame(apply)
  return stop
}
