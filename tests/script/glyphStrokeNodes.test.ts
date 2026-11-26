import { describe, it, expect } from 'vitest'
import {
  moveStrokeNode,
  strokeNodes,
  setStrokeNodeMode,
  insertStrokeNode,
  deleteStrokeNode,
  nearestStrokeSegment,
  strokeWithNodes,
  type StrokeNode
} from '$lib/script/glyphStrokeNodes'
import {
  mapStroke,
  translate,
  strokeContours,
  type Pt,
  type GlyphStroke
} from '$lib/script/glyphGeometry'
import { eraseDrawing } from '$lib/script/glyphEraser'

const original = (): GlyphStroke => ({
  width: 45,
  points: [
    [0, 0],
    [100, 100],
    [200, 0]
  ]
})
function bezier(a: StrokeNode, b: StrokeNode, t: number): Pt {
  const u = 1 - t
  return [0, 1].map(
    (k) =>
      u * u * u * a.point[k] +
      3 * u * u * t * a.out[k] +
      3 * u * t * t * b.in[k] +
      t * t * t * b.point[k]
  ) as Pt
}
describe('editable stroke centreline', () => {
  it('opens old point strokes as corners without changing them', () => {
    const s = original()
    const n = strokeNodes(s)
    expect(n).toHaveLength(3)
    expect(n[1].smooth).toBe(false)
    expect(n[1].point).toEqual(n[1].in)
    expect(s.nodes).toBeUndefined()
  })
  it('preserves width and tangent direction when editing a smooth handle; corners can turn sharply', () => {
    const s = setStrokeNodeMode(original(), 1, 'smooth')
    expect(s.nodes![1].smooth).toBe(true)
    expect(s.width).toBe(45)
    expect(s.points.length).toBeGreaterThan(3)
    const edit = moveStrokeNode(s, 1, [150, 150], 'out'),
      n = edit.nodes![1]
    expect(n.out).toEqual([150, 150])
    expect(n.in[0]).toBeCloseTo(n.in[1])
    expect(n.in[0]).toBeLessThan(100)
    const moved = moveStrokeNode(edit, 1, [103, 98]).nodes![1]
    expect(moved.out).toEqual([153, 148])
    expect(moved.smooth).toBe(true)
    const sharp = setStrokeNodeMode(edit, 1, 'corner')
    expect(sharp.nodes![1].in).toEqual([100, 100])
    expect(sharp.points).toEqual(original().points)
  })
  it('splits a cubic at the clicked parameter and preserves the exact curve on both sides', () => {
    const s = setStrokeNodeMode(original(), 1, 'smooth'),
      nodes = strokeNodes(s),
      pos = bezier(nodes[0], nodes[1], 0.28)
    const hit = nearestStrokeSegment(s, pos, 2)!
    expect(hit.index).toBe(0)
    expect(hit.t).toBeCloseTo(0.28, 3)
    const split = insertStrokeNode(s, 0, hit.t),
      n = split.nodes!
    expect(n).toHaveLength(4)
    expect(n[1].smooth).toBe(true)
    for (const t of [0, 0.11, 0.28, 0.6, 0.9, 1]) {
      const desired = bezier(nodes[0], nodes[1], t),
        actual =
          t < hit.t ? bezier(n[0], n[1], t / hit.t) : bezier(n[1], n[2], (t - hit.t) / (1 - hit.t))
      expect(actual[0]).toBeCloseTo(desired[0], 8)
      expect(actual[1]).toBeCloseTo(desired[1], 8)
    }
    expect(nearestStrokeSegment(s, [1000, 1000], 3)).toBeNull()
  })
  it('deletes a node and protects two-point strokes and invalid indices', () => {
    const s = setStrokeNodeMode(original(), 1, 'smooth'),
      one = deleteStrokeNode(s, 1)
    expect(one.points).toEqual([
      [0, 0],
      [200, 0]
    ])
    expect(deleteStrokeNode(one, 0)).toBe(one)
    expect(insertStrokeNode(one, 10, 0.5)).toBe(one)
    expect(setStrokeNodeMode(one, 9, 'smooth')).toBe(one)
  })
  it('maps anchor and handles when a component is placed, and keeps outline/eraser usable', () => {
    const s = setStrokeNodeMode(original(), 1, 'smooth'),
      m = mapStroke(s, translate(20, -15))
    expect(m.nodes![1].point).toEqual([120, 85])
    expect(m.nodes![1].out[0] - s.nodes![1].out[0]).toBeCloseTo(20)
    expect(strokeWithNodes(m, strokeNodes(m)).points.length).toBe(m.points.length)
    expect(strokeContours(m).length).toBeGreaterThan(0)
    const result = eraseDrawing({ advance: 600, strokes: [m] }, [[120, 85]], 12)
    expect(result.strokes.length).toBe(0)
    expect(result.contours?.length).toBeGreaterThan(0)
  })
})
