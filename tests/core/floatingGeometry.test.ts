import { describe, expect, it } from 'vitest'
import { floatingGeometry, type FloatingGeometry } from '$lib/ui/floatingGeometry'

const base: FloatingGeometry = {
  anchor: { left: 400, right: 414, top: 300, bottom: 314, width: 14 },
  viewport: { left: 0, top: 0, width: 1000, height: 700 },
  width: 280,
  height: 90,
  gap: 6,
  align: 'center',
  placement: 'above'
}

describe('视口浮层几何', () => {
  it('居中对齐问号且优先在上方，使用真实气泡高度', () => {
    const r = floatingGeometry(base)
    expect(r.left).toBe(267)
    expect(r.top).toBe(204)
    expect(r.above).toBe(true)
    expect(r.top + base.height).toBe(base.anchor.top - 6)
  })
  it('上方不足时翻至下方，不使用固定高度阈值', () => {
    const r = floatingGeometry({ ...base, anchor: { ...base.anchor, top: 50, bottom: 64 } })
    expect(r.above).toBe(false)
    expect(r.top).toBe(70)
  })
  it('两侧都放不下时选择更宽裕的一侧并约束长文', () => {
    const r = floatingGeometry({ ...base, height: 3000 })
    expect(r.above).toBe(false)
    expect(r.maxHeight).toBe(372)
    expect(r.top + r.maxHeight).toBe(692)
  })
  it('靠底部的长文使用上方可用空间', () => {
    const r = floatingGeometry({
      ...base,
      height: 3000,
      anchor: { ...base.anchor, top: 600, bottom: 614 }
    })
    expect(r.above).toBe(true)
    expect(r.top).toBe(8)
    expect(r.maxHeight).toBe(586)
  })
  it.each([0, 980])('靠水平边缘 %s 时保留视口内边距', (left) => {
    const r = floatingGeometry({ ...base, anchor: { ...base.anchor, left, right: left + 14 } })
    expect(r.left).toBeGreaterThanOrEqual(8)
    expect(r.left + r.width).toBeLessThanOrEqual(992)
  })
  it('窄窗口缩小固定宽度，不把左边界推成负数', () => {
    const r = floatingGeometry({ ...base, viewport: { left: 0, top: 0, width: 240, height: 700 } })
    expect(r.width).toBe(224)
    expect(r.left).toBe(8)
  })
  it('视觉视口偏移和缩放后坐标仍在同一参照系', () => {
    const r = floatingGeometry({
      ...base,
      viewport: { left: 120, top: 100, width: 400, height: 350 }
    })
    expect(r.left).toBeGreaterThanOrEqual(128)
    expect(r.left + r.width).toBeLessThanOrEqual(512)
    expect(r.top).toBeGreaterThanOrEqual(108)
    expect(r.top + base.height).toBeLessThanOrEqual(442)
    expect(r.top + base.height).toBe(base.anchor.top - 6)
  })
  it('普通菜单默认仍下方优先，空间不足才翻转', () => {
    expect(floatingGeometry({ ...base, placement: 'auto' }).top).toBe(320)
    expect(floatingGeometry({ ...base, placement: 'auto', height: 600 }).above).toBe(false)
    expect(
      floatingGeometry({
        ...base,
        placement: 'auto',
        anchor: { ...base.anchor, top: 600, bottom: 614 }
      }).above
    ).toBe(true)
  })
  it('起始/末端对齐不影响普通菜单原有锚点', () => {
    expect(floatingGeometry({ ...base, align: 'left' }).left).toBe(400)
    expect(floatingGeometry({ ...base, align: 'right' }).left).toBe(134)
  })
  it('极小但非零视口不产生负宽度或越界', () => {
    const r = floatingGeometry({ ...base, viewport: { left: 0, top: 0, width: 10, height: 10 } })
    expect(r.width).toBe(1)
    expect(r.left).toBe(4.5)
    expect(r.left + r.width).toBeLessThanOrEqual(10)
  })
})
