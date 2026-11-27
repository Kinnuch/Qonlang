/** 将弹层移出检视器或手写板的滚动容器，定位到触发控件。 */
import { floatingGeometry } from './floatingGeometry'

interface FloatingOptions {
  anchor: HTMLElement | null | undefined
  matchWidth?: boolean
  align?: 'start' | 'end' | 'center'
  placement?: 'auto' | 'above' | 'below'
  /** 提示打开期间跟踪 transform 动画；普通菜单仍只按事件更新。 */
  track?: boolean
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
  node.style.position = 'fixed'
  node.style.boxSizing = 'border-box'
  document.body.appendChild(node)

  function position(): void {
    if (disposed) return
    const anchor = options.anchor
    if (!anchor || !anchor.isConnected) {
      options.onAnchorHidden?.()
      return
    }
    const rect = anchor.getBoundingClientRect()
    const vp = window.visualViewport
    const viewport = {
      left: vp?.offsetLeft ?? 0,
      top: vp?.offsetTop ?? 0,
      width: vp?.width ?? document.documentElement.clientWidth,
      height: vp?.height ?? document.documentElement.clientHeight
    }
    const desiredWidth =
      options.width ?? (options.matchWidth === false ? node.offsetWidth : rect.width)
    const alignRight = (getComputedStyle(anchor).direction === 'rtl') !== (options.align === 'end')
    const geometry = {
      anchor: rect,
      viewport,
      width: desiredWidth,
      gap: options.gap,
      align:
        options.align === 'center'
          ? ('center' as const)
          : alignRight
            ? ('right' as const)
            : ('left' as const),
      placement: options.placement
    }
    const panelWidth = floatingGeometry({ ...geometry, height: 0 }).width
    if (node.style.width !== panelWidth + 'px') node.style.width = panelWidth + 'px'
    const needed = node.scrollHeight + node.offsetHeight - node.clientHeight
    const at = floatingGeometry({ ...geometry, height: needed })
    node.style.maxHeight = at.maxHeight + 'px'
    node.style.left = at.left + 'px'
    node.style.top = at.top + 'px'
  }
  function schedule(): void {
    if (frame || disposed) return
    frame = requestAnimationFrame(() => {
      frame = 0
      position()
      if (options.track) schedule()
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
  if (options.track) schedule()
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
