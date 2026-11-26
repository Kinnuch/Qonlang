import { describe, it, expect } from 'vitest'
import {
  setContourNodeMode,
  moveContourNode,
  splitContourNode,
  deleteContourNode,
  nearestContourSegment,
  contourNodeSmooth
} from '$lib/script/glyphContourNodes'
import {
  rectContour,
  reverseContour,
  mapContour,
  translate,
  flattenContour,
  type GlyphContour,
  type Pt
} from '$lib/script/glyphGeometry'
import { convertEditorSegment } from '$lib/script/glyphEditor'
import { parseProject, serializeProject } from '$lib/core/serialize'
import { createProject, createScript } from '$lib/core/factory'
const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0]
describe('persistent contour node modes', () => {
  it('turns an existing sharp corner into cubic tangent handles and preserves the mode when moving', () => {
    const c = rectContour(100, 100, 700, 700),
      copy = structuredClone(c),
      smooth = setContourNodeMode(c, 1, 'smooth')
    expect(smooth.smooth).toEqual([1])
    expect(smooth.cmds[1][0]).toBe('C')
    expect(smooth.cmds[2][0]).toBe('C')
    const moved = moveContourNode(smooth, 1, 2, [600, 50]),
      incoming = moved.cmds[1],
      outgoing = moved.cmds[2]
    if (incoming[0] !== 'C' || outgoing[0] !== 'C') throw Error('cubic expected')
    expect(
      cross([incoming[3] - 700, incoming[4] - 100], [outgoing[1] - 700, outgoing[2] - 100])
    ).toBeCloseTo(0, 8)
    const translated = moveContourNode(moved, 1, 0, [750, 140])
    expect(translated.smooth).toEqual([1])
    expect(translated.cmds[1].slice(-2)).toEqual([750, 140])
    expect(c).toEqual(copy)
  })
  it('corner conversion collapses both tangent handles and releases smooth mode', () => {
    const c = setContourNodeMode(rectContour(0, 0, 500, 500), 1, 'smooth'),
      corner = setContourNodeMode(c, 1, 'corner')
    expect(contourNodeSmooth(corner, 1)).toBe(false)
    expect(corner.cmds[1]).toEqual(['C', 500 / 3, 0, 500, 0, 500, 0])
    expect(corner.cmds[2][0]).toBe('C')
    const next = corner.cmds[2]
    if (next[0] === 'C') expect(next.slice(1, 3)).toEqual([500, 0])
  })
  it('smooths the implicit closing seam without opening it or moving anchors', () => {
    const c = setContourNodeMode(rectContour(100, 100, 700, 700), 0, 'smooth')
    expect(c.cmds.at(-1)).toEqual(['Z'])
    expect(c.cmds.at(-2)?.slice(-2)).toEqual([100, 100])
    expect(c.cmds.at(-2)?.[0]).toBe('C')
    expect(c.smooth).toEqual([0])
    const moved = moveContourNode(c, 0, 0, [120, 80])
    expect(moved.cmds[0]).toEqual(['M', 120, 80])
    expect(moved.cmds.at(-2)?.slice(-2)).toEqual([120, 80])
  })
  it('splits at an actual curve location and shifts all later smooth indices', () => {
    const c: GlyphContour = {
      cmds: [['M', 0, 0], ['C', 0, 500, 500, 500, 500, 0], ['L', 800, 0], ['Z']],
      smooth: [2]
    }
    const hit = nearestContourSegment(c, [250, 375], 1)
    expect(hit?.index).toBe(1)
    expect(hit?.t).toBeCloseTo(0.5, 3)
    const split = splitContourNode(c, hit!.index, hit!.t)
    expect(split.smooth).toEqual([3, 1])
    expect(split.cmds).toHaveLength(c.cmds.length + 1)
    expect(split.cmds[1].slice(-2)[0]).toBeCloseTo(250, 2)
    expect(nearestContourSegment(c, [9999, 9999], 10)).toBeNull()
  })
  it('deletion, reversing and explicit conversion keep or remove the right smooth identities', () => {
    expect(
      deleteContourNode(setContourNodeMode(rectContour(0, 0, 600, 600), 1, 'smooth'), 2).smooth
    ).not.toContain(1)
    const c = setContourNodeMode(rectContour(0, 0, 600, 600), 2, 'smooth'),
      split = splitContourNode(c, 1),
      deleted = deleteContourNode(split, 1)
    expect(deleted.smooth).toEqual([2])
    const rev = reverseContour(c)
    expect(rev.smooth).toHaveLength(1)
    const cmd = rev.cmds[rev.smooth![0]]
    expect(cmd.slice(-2)).toEqual([600, 600])
    expect(convertEditorSegment(c, 2, 'L').smooth).not.toContain(2)
    expect(
      deleteContourNode(setContourNodeMode(rectContour(0, 0, 600, 600), 0, 'smooth'), 0).cmds[0]
    ).toEqual(['M', 600, 0])
  })
  it('survives project serialization and transforms without changing the hidden-hole winding', () => {
    const c = setContourNodeMode(rectContour(0, 0, 600, 600), 2, 'smooth'),
      m = mapContour(c, translate(10, 20))
    expect(m.smooth).toEqual([2])
    const p = createProject({
        name: 'contour',
        template: 'blank',
        appVersion: '1.1.1',
        uiLocale: 'en'
      }),
      script = createScript('draw')
    script.glyphs = [
      {
        id: 'g',
        char: 'a',
        name: '',
        value: 'a',
        notes: '',
        category: 'letter',
        drawing: { advance: 850, strokes: [], contours: [m, reverseContour(m)] }
      }
    ]
    p.languages[0].scripts = [script]
    const round = parseProject(serializeProject(p))
    expect(round.languages[0].scripts[0].glyphs[0].drawing?.contours?.[0].smooth).toEqual([2])
    expect(flattenContour(m).length).toBeGreaterThan(4)
  })
})
