/** 浏览方式只影响本机显示，不改变记录或导出内容。 */
export type RecordViewMode = 'list' | 'gallery' | 'masonry'
export type RecordViewPage = 'corpus' | 'phrasebook'

export function recordViewMode(value: unknown): RecordViewMode {
  return value === 'gallery' || value === 'masonry' ? value : 'list'
}

export function galleryIndex(ids: readonly string[], activeId: string | null): number {
  const at = activeId === null ? -1 : ids.indexOf(activeId)
  return ids.length ? Math.max(0, at) : -1
}

export interface MasonryPosition {
  left: number
  top: number
  width: number
}

/** 按真实卡片高度放入目前最短的一列，顺序和高度相同则优先靠左。 */
export function masonryLayout(
  heights: readonly number[],
  availableWidth: number,
  gap = 8,
  minWidth = 300
): { positions: MasonryPosition[]; height: number; columns: number } {
  const width = Number.isFinite(availableWidth) ? Math.max(1, availableWidth) : 1
  const columns = Math.max(1, Math.floor((width + gap) / (minWidth + gap)))
  const itemWidth = (width - gap * (columns - 1)) / columns
  const bottoms = Array<number>(columns).fill(0)
  const positions = heights.map((height) => {
    let col = 0
    for (let i = 1; i < columns; i++) if (bottoms[i] < bottoms[col]) col = i
    const top = bottoms[col]
    bottoms[col] += (Number.isFinite(height) ? Math.max(1, height) : 100) + gap
    return { left: col * (itemWidth + gap), top, width: itemWidth }
  })
  return { positions, columns, height: heights.length ? Math.max(...bottoms) - gap : 0 }
}
