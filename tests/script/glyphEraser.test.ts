import { describe, expect, it } from 'vitest'
import type { GlyphDrawing } from '$lib/core/model'
import { createScript } from '$lib/core/factory'
import { eraseDrawing } from '$lib/script/glyphEraser'
import { drawingFromFont, buildScriptFont } from '$lib/script/fontBuild'
import { decodeGlyphs, encodeGlyphs } from '$lib/script/glyphClipboard'
import { writeTtf } from '$lib/script/fontWriter'
import {
  ellipseContour,
  flattenContour,
  rectContour,
  reverseContour,
  segDist,
  signedArea,
  type GlyphContour,
  type Pt
} from '$lib/script/glyphGeometry'

const drawing = (contours: GlyphContour[] = []): GlyphDrawing => ({
  advance: 850,
  strokes: [],
  contours
})
function winding(point: Pt, polygon: Pt[]): number {
  let value = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length]
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (point[0] - a[0]) * (b[1] - a[1])
    if (a[1] <= point[1] && b[1] > point[1] && cross > 0) value++
    if (a[1] > point[1] && b[1] <= point[1] && cross < 0) value--
  }
  return value
}
function ink(d: GlyphDrawing, point: Pt): boolean {
  if (d.contours?.reduce((n, c) => n + winding(point, flattenContour(c, 1)), 0)) return true
  return d.strokes.some((stroke) =>
    stroke.points.some((p, i) =>
      i
        ? segDist(point, stroke.points[i - 1], p) < stroke.width / 2
        : Math.hypot(point[0] - p[0], point[1] - p[1]) < stroke.width / 2
    )
  )
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

describe('local round-brush erasing geometry', () => {
  it('cuts a legacy straight stroke at its middle instead of deleting either surviving side', () => {
    const before: GlyphDrawing = freeze({
      advance: 850,
      strokes: [
        {
          width: 40,
          points: [
            [0, 0],
            [300, 0]
          ]
        }
      ]
    })
    const after = eraseDrawing(
      before,
      [
        [150, -100],
        [150, 100]
      ],
      20
    )
    expect(after).not.toBe(before)
    expect(after.advance).toBe(850)
    expect(ink(after, [50, 0])).toBe(true)
    expect(ink(after, [250, 0])).toBe(true)
    expect(ink(after, [150, 0])).toBe(false)
    expect(after.contours?.filter((c) => signedArea(flattenContour(c)) > 0)).toHaveLength(2)
    expect(before.strokes[0].points).toEqual([
      [0, 0],
      [300, 0]
    ])
  })
  it('erases the visible edge of a thick line even when the centerline is outside the brush', () => {
    const before: GlyphDrawing = {
      advance: 850,
      strokes: [
        {
          width: 120,
          points: [
            [0, 0],
            [300, 0]
          ]
        }
      ]
    }
    const after = eraseDrawing(before, [[150, 55]], 15)
    expect(ink(after, [150, 52])).toBe(false)
    expect(ink(after, [150, 0])).toBe(true)
    expect(ink(after, [150, -50])).toBe(true)
    expect(ink(after, [20, 50])).toBe(true)
  })
  it('sweeps between sparse pointer samples and round endpoints, not only at recorded points', () => {
    const before = drawing([rectContour(0, 0, 300, 300)])
    const after = eraseDrawing(
      before,
      [
        [-100, 150],
        [400, 150]
      ],
      12
    )
    expect(ink(after, [150, 150])).toBe(false)
    expect(ink(after, [150, 100])).toBe(true)
    expect(ink(after, [150, 200])).toBe(true)
  })
  it('removes part of a single-point pen dot while retaining the other side', () => {
    const before: GlyphDrawing = { advance: 400, strokes: [{ width: 100, points: [[100, 100]] }] }
    const after = eraseDrawing(before, [[135, 100]], 25)
    expect(ink(after, [135, 100])).toBe(false)
    expect(ink(after, [70, 100])).toBe(true)
  })
  it('punches a real hole in a closed shape with an oppositely wound inner ring', () => {
    const before = drawing([rectContour(0, 0, 300, 300)])
    const after = eraseDrawing(before, [[150, 150]], 30)
    expect(ink(after, [150, 150])).toBe(false)
    expect(ink(after, [20, 20])).toBe(true)
    expect(after.contours).toHaveLength(2)
    expect(after.contours!.map((c) => Math.sign(signedArea(flattenContour(c)))).sort()).toEqual([
      -1, 1
    ])
  })
  it('preserves existing holes and untouched islands while opening a local notch', () => {
    const untouched = ellipseContour(600, 150, 60, 100)
    const before = drawing([
      rectContour(0, 0, 300, 300),
      reverseContour(rectContour(80, 80, 220, 220)),
      untouched
    ])
    const after = eraseDrawing(before, [[0, 40]], 25)
    expect(ink(after, [10, 40])).toBe(false)
    expect(ink(after, [150, 150])).toBe(false)
    expect(ink(after, [150, 30])).toBe(true)
    expect(after.contours).toContain(untouched)
    expect(after.contours!.find((c) => c === untouched)?.cmds.some((c) => c[0] === 'C')).toBe(true)
  })
  it('keeps a separate smooth Bézier contour unchanged even when its broad box overlaps', () => {
    const one = ellipseContour(0, 0, 100, 100),
      other = ellipseContour(150, 150, 100, 100)
    const before = drawing([one, other]),
      after = eraseDrawing(before, [[-90, 0]], 20)
    expect(after.contours).toContain(other)
    expect(other.cmds.some((c) => c[0] === 'C')).toBe(true)
    expect(ink(after, [150, 150])).toBe(true)
  })
  it('keeps nonzero filling for reversed outlines, same-winding nesting, and nested islands', () => {
    const reversed = drawing([
      reverseContour(rectContour(0, 0, 100, 100)),
      rectContour(20, 20, 80, 80)
    ])
    const cut = eraseDrawing(reversed, [[5, 50]], 8)
    expect(ink(cut, [5, 50])).toBe(false)
    expect(ink(cut, [50, 50])).toBe(false)
    expect(ink(cut, [90, 50])).toBe(true)
    const same = drawing([rectContour(0, 0, 100, 100), rectContour(20, 20, 80, 80)])
    const sameCut = eraseDrawing(same, [[50, 50]], 5)
    expect(ink(sameCut, [40, 40])).toBe(true)
    expect(ink(sameCut, [50, 50])).toBe(false)
    const island = drawing([
      rectContour(0, 0, 100, 100),
      reverseContour(rectContour(20, 20, 80, 80)),
      rectContour(40, 40, 60, 60)
    ])
    const islandCut = eraseDrawing(island, [[50, 50]], 3)
    expect(ink(islandCut, [30, 30])).toBe(false)
    expect(ink(islandCut, [44, 44])).toBe(true)
    expect(ink(islandCut, [50, 50])).toBe(false)
  })
  it('does not turn a negative contour into a hole where two positive contours overlap', () => {
    const before = drawing([
      rectContour(0, 0, 100, 100),
      rectContour(10, 10, 90, 90),
      reverseContour(rectContour(30, 30, 70, 70))
    ])
    const after = eraseDrawing(before, [[5, 5]], 3)
    expect(ink(after, [50, 50])).toBe(true)
    expect(ink(after, [5, 5])).toBe(false)
  })
  it('preserves both lobes of a self-crossing closed contour except the actual brushed part', () => {
    const before = drawing([
      { cmds: [['M', 0, 0], ['L', 100, 100], ['L', 0, 100], ['L', 100, 0], ['Z']] }
    ])
    const after = eraseDrawing(before, [[50, 15]], 5)
    expect(ink(after, [50, 15])).toBe(false)
    expect(ink(after, [50, 30])).toBe(true)
    expect(ink(after, [50, 85])).toBe(true)
  })
  it('unions pen ink crossing a contour hole before taking the local difference', () => {
    const before = drawing([
      rectContour(0, 0, 200, 200),
      reverseContour(rectContour(40, 40, 160, 160))
    ])
    before.strokes = [
      {
        width: 20,
        points: [
          [0, 100],
          [200, 100]
        ]
      }
    ]
    const after = eraseDrawing(before, [[100, 100]], 6)
    expect(ink(after, [100, 100])).toBe(false)
    expect(ink(after, [70, 100])).toBe(true)
    expect(ink(after, [100, 70])).toBe(false)
  })
  it('returns the original object for empty, invalid, distant, tangent or already empty gestures', () => {
    const before = drawing([
      rectContour(0, 0, 100, 100),
      reverseContour(rectContour(20, 20, 80, 80))
    ])
    for (const [path, radius] of [
      [[], 10],
      [[[500, 500]], 10],
      [[[50, 50]], 5],
      [[[-10, 50]], 10],
      [[[NaN, 0]], 10],
      [[[0, 0]], 0],
      [[[0, 0]], Infinity]
    ] as [Pt[], number][])
      expect(eraseDrawing(before, path, radius)).toBe(before)
  })
  it('does not change a curved stroke merely because its bounding box was touched', () => {
    const before: GlyphDrawing = {
      advance: 850,
      strokes: [
        {
          width: 10,
          points: [
            [0, 0],
            [100, 0],
            [100, 100]
          ]
        }
      ]
    }
    expect(eraseDrawing(before, [[20, 80]], 4)).toBe(before)
  })
  it('can erase all visible ink without changing advance and can be applied repeatedly', () => {
    const before = drawing([rectContour(0, 0, 100, 100)]),
      once = eraseDrawing(before, [[25, 50]], 10),
      twice = eraseDrawing(once, [[75, 50]], 10)
    expect(ink(twice, [25, 50])).toBe(false)
    expect(ink(twice, [75, 50])).toBe(false)
    expect(ink(twice, [50, 50])).toBe(true)
    const gone = eraseDrawing(twice, [[50, 50]], 100)
    expect(gone.advance).toBe(850)
    expect(gone.strokes).toHaveLength(0)
    expect(gone.contours).toHaveLength(0)
    expect(eraseDrawing(gone, [[50, 50]], 100)).toBe(gone)
  })
  it('agrees with dense point samples of the original ink minus a swept eraser', () => {
    const before = drawing([
      rectContour(0, 0, 300, 200),
      reverseContour(rectContour(80, 60, 180, 140)),
      ellipseContour(400, 100, 60, 80)
    ])
    before.strokes = [
      {
        width: 20,
        points: [
          [-30, 30],
          [250, 170],
          [400, 30]
        ]
      }
    ]
    const path: Pt[] = [
        [30, -50],
        [240, 240]
      ],
      after = eraseDrawing(before, path, 17)
    for (let x = -20; x <= 480; x += 13)
      for (let y = -20; y <= 240; y += 13) {
        const point: Pt = [x + 0.37, y + 0.29],
          distance = segDist(point, path[0], path[1])
        if (Math.abs(distance - 17) < 0.6) continue
        expect(ink(after, point), `at ${point}`).toBe(ink(before, point) && distance > 17)
      }
  })
  it('keeps serialized drawings, copy payloads, undo snapshots and font export compatible', () => {
    const before = drawing([rectContour(0, 0, 300, 300)]),
      snapshot = JSON.stringify(before),
      after = eraseDrawing(freeze(before), [[150, 150]], 40)
    const saved = JSON.parse(JSON.stringify(after)) as GlyphDrawing
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(ink(saved, [150, 150])).toBe(false)
    const payload = decodeGlyphs(
      encodeGlyphs([
        {
          id: 'qa',
          char: 'A',
          name: 'QA',
          value: 'a',
          category: 'letter',
          notes: 'note',
          drawing: saved
        }
      ])
    )!
    expect(payload[0].drawing).toEqual(saved)
    const script = createScript('Eraser QA')
    script.glyphs = [
      {
        id: 'qa',
        char: 'A',
        name: 'QA',
        value: 'a',
        category: 'letter',
        notes: 'note',
        drawing: saved
      }
    ]
    const font = buildScriptFont(script),
      imported = drawingFromFont(font, 'A')!
    expect(imported.advance).toBe(850)
    expect(ink(imported, [150, 150])).toBe(false)
    expect(ink(imported, [20, 20])).toBe(true)
    const cutAgain = eraseDrawing(imported, [[5, 150]], 20)
    expect(ink(cutAgain, [5, 150])).toBe(false)
    expect(ink(cutAgain, [150, 150])).toBe(false)
    expect(ink(cutAgain, [250, 150])).toBe(true)
  })
  it('preserves all distant stroke and Bézier object identities in a larger glyph', () => {
    const before = drawing(
      Array.from({ length: 200 }, (_, i) => ellipseContour(2000 + i * 150, 2000, 40, 50))
    )
    before.strokes = [
      {
        width: 20,
        points: [
          [0, 0],
          [200, 0]
        ]
      },
      ...Array.from({ length: 200 }, (_, i) => ({
        width: 20,
        points: [
          [2000 + i * 150, 0],
          [2100 + i * 150, 0]
        ] as Pt[]
      }))
    ]
    const after = eraseDrawing(before, [[100, 0]], 10)
    expect(after.contours!.slice(0, 200)).toEqual(before.contours)
    expect(after.contours!.slice(0, 200).every((c, i) => c === before.contours![i])).toBe(true)
    expect(after.strokes.every((stroke, i) => stroke === before.strokes[i + 1])).toBe(true)
  })
  it('erases a genuinely imported quadratic font glyph and patches export without changing another glyph', () => {
    const source = writeTtf({
      familyName: 'Synthetic eraser input',
      ascender: 800,
      descender: -200,
      timestamp: 0,
      glyphs: [
        {
          codepoints: [65],
          advance: 875,
          contours: [
            ellipseContour(400, 300, 300, 250),
            reverseContour(ellipseContour(400, 300, 100, 90))
          ]
        },
        { codepoints: [66], advance: 500, contours: [rectContour(50, 0, 450, 600)] }
      ]
    })
    const imported = drawingFromFont(source, 'A')!,
      other = drawingFromFont(source, 'B')!
    expect(imported.contours!.some((c) => c.cmds.some((cmd) => cmd[0] === 'Q'))).toBe(true)
    const erased = eraseDrawing(imported, [[690, 300]], 30)
    expect(ink(erased, [690, 300])).toBe(false)
    expect(ink(erased, [110, 300])).toBe(true)
    expect(ink(erased, [400, 300])).toBe(false)
    let binary = ''
    for (const byte of new Uint8Array(source)) binary += String.fromCharCode(byte)
    const script = createScript('Imported eraser QA')
    script.font = {
      family: '',
      fileName: 'input.ttf',
      dataUrl: 'data:font/ttf;base64,' + btoa(binary)
    }
    script.glyphs = [
      { id: 'A', char: 'A', name: 'QA', value: 'a', category: 'letter', notes: '', drawing: erased }
    ]
    const exported = buildScriptFont(script),
      roundTrip = drawingFromFont(exported, 'A')!
    expect(roundTrip.advance).toBe(875)
    expect(ink(roundTrip, [690, 300])).toBe(false)
    expect(ink(roundTrip, [400, 300])).toBe(false)
    expect(drawingFromFont(exported, 'B')).toEqual(other)
  })
  it('retains collinear backtracking and closed-loop eraser geometry when thinning dense paths', () => {
    const before = drawing([rectContour(0, 0, 300, 300)])
    const backtrack = eraseDrawing(
      before,
      [
        [50, 100],
        [150, 100],
        [100, 100]
      ],
      10
    )
    expect(ink(backtrack, [145, 100])).toBe(false)
    expect(ink(backtrack, [30, 100])).toBe(true)
    const circle: Pt[] = Array.from({ length: 301 }, (_, i) => [
      150 + 60 * Math.cos((i * 2 * Math.PI) / 300),
      150 + 60 * Math.sin((i * 2 * Math.PI) / 300)
    ])
    const loop = eraseDrawing(before, circle, 10)
    expect(ink(loop, [150, 150])).toBe(true)
    expect(ink(loop, [210, 150])).toBe(false)
    expect(ink(loop, [250, 150])).toBe(true)
  })
  it('stays within the 0.25-unit ink/eraser boundary budget on long curves and scribbles', () => {
    const stroke: Pt[] = Array.from({ length: 2000 }, (_, i) => [
      (i * 900) / 1999,
      300 + 30 * Math.sin((i * 30) / 2000)
    ])
    const trail: Pt[] = Array.from({ length: 600 }, (_, i) => [
      430 + 35 * Math.sin(i / 60),
      180 + i * 0.4
    ])
    const before: GlyphDrawing = { advance: 1000, strokes: [{ width: 30, points: stroke }] },
      after = eraseDrawing(before, trail, 12)
    const distance = (point: Pt, path: Pt[]): number =>
      Math.min(...path.slice(1).map((end, i) => segDist(point, path[i], end)))
    let checked = 0
    for (let i = 10; i < stroke.length - 10; i += 23) {
      const p = stroke[i],
        dx = stroke[i + 1][0] - stroke[i - 1][0],
        dy = stroke[i + 1][1] - stroke[i - 1][1],
        length = Math.hypot(dx, dy)
      for (const offset of [-15.3, -14.7, 0, 14.7, 15.3]) {
        const point: Pt = [p[0] - (dy / length) * offset, p[1] + (dx / length) * offset],
          sourceDistance = distance(point, stroke),
          eraseDistance = distance(point, trail)
        if (Math.abs(sourceDistance - 15) <= 0.26 || Math.abs(eraseDistance - 12) <= 0.26) continue
        expect(ink(after, point), `long curve ${point}`).toBe(
          sourceDistance < 15 && eraseDistance > 12
        )
        checked++
      }
    }
    expect(checked).toBeGreaterThan(200)
    const scribble: Pt[] = Array.from({ length: 400 }, (_, i) => [
      150 + 100 * Math.sin(i / 17),
      150 + 90 * Math.sin(i / 11)
    ])
    const solid = drawing([rectContour(0, 0, 300, 300)]),
      scribbled = eraseDrawing(solid, scribble, 8)
    for (let x = 10; x < 300; x += 13)
      for (let y = 10; y < 300; y += 13) {
        const point: Pt = [x + 0.37, y + 0.23],
          d = distance(point, scribble)
        if (Math.abs(d - 8) > 0.26) expect(ink(scribbled, point), `scribble ${point}`).toBe(d > 8)
      }
  })
  it('handles repeated curved gestures without changing unrelated ink or throwing on round joins', () => {
    const before = drawing([
      ellipseContour(300, 300, 240, 220),
      reverseContour(ellipseContour(300, 300, 80, 70))
    ])
    before.strokes = [
      {
        width: 34,
        points: Array.from({ length: 100 }, (_, i) => [30 + i * 6, 80 + 25 * Math.sin(i / 6)] as Pt)
      }
    ]
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8,
        path: Pt[] = [
          [300 + 150 * Math.cos(angle), 300 + 150 * Math.sin(angle)],
          [300 + 350 * Math.cos(angle + 0.3), 300 + 350 * Math.sin(angle + 0.3)]
        ]
      const after = eraseDrawing(before, path, 12 + i / 2)
      expect(after.advance).toBe(850)
      expect(ink(after, [300, 300])).toBe(false)
      expect(
        after.contours?.every((c) => c.cmds.every((cmd) => cmd.slice(1).every(Number.isFinite)))
      ).toBe(true)
    }
  })
})
