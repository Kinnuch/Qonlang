/** 将弹层移出检视器或手写板的滚动容器，定位到触发控件。 */
interface FloatingOptions {
  anchor: HTMLElement | null | undefined
  matchWidth?: boolean
  width?: number
  gap?: number
  onAnchorHidden?: () => void
}

export function anchoredFloating(
  node: HTMLElement,
  initial: FloatingOptions
): {
  update: (next: FloatingOptions) => void
  destroy: () => void
} {
  let options = initial,
    frame = 0,
    disposed = false
  const margin = 8
  node.style.position = 'fixed'
  node.style.boxSizing = 'border-box'
  document.body.appendChild(node)

  function position(): void {
    if (disposed) return
    const anchor = options.anchor
    if (!anchor || !anchor.isConnected) return
    const rect = anchor.getBoundingClientRect()
    const vp = window.visualViewport
    const leftEdge = vp?.offsetLeft ?? 0,
      topEdge = vp?.offsetTop ?? 0
    const width = vp?.width ?? document.documentElement.clientWidth
    const height = vp?.height ?? document.documentElement.clientHeight
    const limitX = leftEdge + width - margin,
      limitY = topEdge + height - margin
    const desiredWidth =
      options.width ?? (options.matchWidth === false ? node.offsetWidth : rect.width)
    const panelWidth = Math.min(desiredWidth, Math.max(1, width - margin * 2))
    node.style.width = panelWidth + 'px'
    const gap = options.gap ?? 4
    const above = Math.max(0, rect.top - gap - topEdge - margin)
    const below = Math.max(0, limitY - rect.bottom - gap)
    const needed = node.scrollHeight + node.offsetHeight - node.clientHeight
    const up = below < needed && above > below
    node.style.maxHeight = (up ? above : below) + 'px'
    const top = up ? rect.top - gap - node.offsetHeight : rect.bottom + gap
    const left = getComputedStyle(anchor).direction === 'rtl' ? rect.right - panelWidth : rect.left
    node.style.left = Math.max(leftEdge + margin, Math.min(left, limitX - panelWidth)) + 'px'
    node.style.top = Math.max(topEdge + margin, Math.min(top, limitY - node.offsetHeight)) + 'px'
  }
  function schedule(): void {
    if (frame || disposed) return
    frame = requestAnimationFrame(() => {
      frame = 0
      position()
    })
  }
  const size = new ResizeObserver(schedule)
  size.observe(node)
  const visibility = new IntersectionObserver((entries) => {
    if (!disposed && entries.some((e) => e.target === options.anchor && !e.isIntersecting))
      options.onAnchorHidden?.()
  })
  function observe(anchor: FloatingOptions['anchor']): void {
    if (anchor) {
      size.observe(anchor)
      visibility.observe(anchor)
    }
  }
  observe(options.anchor)
  function onScroll(e: Event): void {
    if (!(e.target instanceof Node) || !node.contains(e.target)) schedule()
  }
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', schedule)
  const viewport = window.visualViewport
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  position()
  return {
    update(next) {
      if (next.anchor !== options.anchor) {
        if (options.anchor) {
          size.unobserve(options.anchor)
          visibility.unobserve(options.anchor)
        }
        observe(next.anchor)
      }
      options = next
      schedule()
    },
    destroy() {
      disposed = true
      cancelAnimationFrame(frame)
      size.disconnect()
      visibility.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', schedule)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      node.remove()
    }
  }
}
