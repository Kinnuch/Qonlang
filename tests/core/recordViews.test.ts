import { describe, expect, it } from 'vitest'
import {
  galleryIndex,
  masonryLayout,
  recordViewMode
} from '../../src/renderer/src/lib/ui/recordViews'

describe('记录浏览', () => {
  it('旧偏好和无效值沿用列表，两页可分别保存新模式', () => {
    for (const value of [undefined, null, '', 'grid', {}, 2])
      expect(recordViewMode(value)).toBe('list')
    expect(recordViewMode('gallery')).toBe('gallery')
    expect(recordViewMode('masonry')).toBe('masonry')
  })

  it('画廊跟随记录身份，过滤或删除后回退首条，空列表没有当前项', () => {
    expect(galleryIndex(['a', 'b', 'c'], 'b')).toBe(1)
    expect(galleryIndex(['c', 'b'], 'b')).toBe(1)
    expect(galleryIndex(['c'], 'b')).toBe(0)
    expect(galleryIndex(['c'], null)).toBe(0)
    expect(galleryIndex([], 'b')).toBe(-1)
  })

  it('真实最短列排列填补长卡旁的空位，不按行强制等高', () => {
    const layout = masonryLayout([300, 70, 80, 60], 608)
    expect(layout.columns).toBe(2)
    expect(layout.positions).toEqual([
      { left: 0, top: 0, width: 300 },
      { left: 308, top: 0, width: 300 },
      { left: 308, top: 78, width: 300 },
      { left: 308, top: 166, width: 300 }
    ])
    expect(layout.height).toBe(300)
  })

  it('展开或字体改变后重新测量的高度不会重叠', () => {
    for (const heights of [
      [100, 100, 500, 80, 90],
      [700, 30, 20, 450, 100]
    ]) {
      const { positions, height } = masonryLayout(heights, 920)
      positions.forEach((a, i) => {
        expect(a.top + heights[i]).toBeLessThanOrEqual(height)
        positions.slice(i + 1).forEach((b, offset) => {
          const j = i + offset + 1
          expect(
            a.left !== b.left || b.top >= a.top + heights[i] + 8 || a.top >= b.top + heights[j] + 8
          ).toBe(true)
        })
      })
    }
  })

  it('窄屏单列、空表和未知高度有有限且正确的范围', () => {
    expect(masonryLayout([30, 70], 220)).toEqual({
      columns: 1,
      height: 108,
      positions: [
        { left: 0, top: 0, width: 220 },
        { left: 0, top: 38, width: 220 }
      ]
    })
    expect(masonryLayout([], 0).height).toBe(0)
    expect(masonryLayout([NaN, Infinity], NaN).height).toBe(208)
  })
})
