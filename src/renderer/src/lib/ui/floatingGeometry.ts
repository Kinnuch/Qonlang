/** 只计算视口坐标；调用方负责把浮层移出带 transform/overflow 的祖先。 */
export interface FloatingGeometry {
  anchor: { left: number; top: number; right: number; bottom: number; width: number }
  viewport: { left: number; top: number; width: number; height: number }
  width: number
  height: number
  gap?: number
  margin?: number
  align?: 'left' | 'right' | 'center'
  placement?: 'auto' | 'above' | 'below'
}

export function floatingGeometry(options: FloatingGeometry): {
  left: number
  top: number
  width: number
  maxHeight: number
  above: boolean
} {
  const { anchor: a, viewport: v } = options
  const margin = Math.min(
    options.margin ?? 8,
    Math.max(0, (v.width - 1) / 2),
    Math.max(0, (v.height - 1) / 2)
  )
  const gap = options.gap ?? 4
  const width = Math.min(Math.max(1, options.width), Math.max(1, v.width - margin * 2))
  const above = Math.max(0, a.top - gap - v.top - margin)
  const below = Math.max(0, v.top + v.height - margin - a.bottom - gap)
  const preferAbove = options.placement === 'above'
  const up = preferAbove
    ? above >= options.height || (below < options.height && above > below)
    : below < options.height && above > below
  const maxHeight = up ? above : below
  const height = Math.min(options.height, maxHeight)
  const left =
    options.align === 'center'
      ? a.left + a.width / 2 - width / 2
      : options.align === 'right'
        ? a.right - width
        : a.left
  const top = up ? a.top - gap - height : a.bottom + gap
  return {
    left: Math.max(v.left + margin, Math.min(left, v.left + v.width - margin - width)),
    top: Math.max(v.top + margin, Math.min(top, v.top + v.height - margin - height)),
    width,
    maxHeight,
    above: up
  }
}
