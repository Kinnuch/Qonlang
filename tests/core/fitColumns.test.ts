import { describe, expect, it } from 'vitest'
import { dragColumn, fitColumns } from '$lib/ui/fitColumns'

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0)

describe('表格列宽铺满', () => {
  it('列少：按比例放大，正好铺满容器', () => {
    const w = fitColumns(
      [
        { base: 100, min: 50 },
        { base: 300, min: 80 }
      ],
      800
    )
    expect(sum(w)).toBe(800)
    expect(w[1]).toBeGreaterThan(w[0] * 2.9)
  })

  it('加了列放不下：先按比例匀出已有各列的宽，不低于最小宽', () => {
    const w = fitColumns(
      [
        { base: 400, min: 60 },
        { base: 400, min: 300 },
        { base: 200, min: 60 }
      ],
      700
    )
    expect(sum(w)).toBe(700)
    expect(w[1]).toBeGreaterThanOrEqual(300)
    expect(w[0]).toBeGreaterThanOrEqual(60)
    expect(w[2]).toBeGreaterThanOrEqual(60)
  })

  it('都缩到最小宽也放不下：按最小宽排，表格比容器宽', () => {
    const w = fitColumns(
      [
        { base: 200, min: 150 },
        { base: 200, min: 150 }
      ],
      200
    )
    expect(w).toEqual([150, 150])
  })

  it('拖一列：右边的邻居反着让，总宽不变；两边都不低于最小宽', () => {
    const w = [200, 300, 100]
    const mins = [60, 60, 60]
    expect(dragColumn(w, mins, 0, 50)).toEqual([250, 250, 100])
    expect(dragColumn(w, mins, 0, 400)).toEqual([440, 60, 100])
    expect(dragColumn(w, mins, 1, -500)).toEqual([200, 60, 340])
    expect(dragColumn(w, mins, 2, 30)).toEqual([200, 300, 130])
  })
})
