import { describe, expect, it } from 'vitest'
import {
  convertEditorSegment,
  copyEditorDrawing,
  editorBezierContour,
  normalizeEditorSettings,
  snapEditorPoint,
  splitEditorSegment
} from '$lib/script/glyphEditor'
import { createLanguage, createProject, createScript } from '$lib/core/factory'
import {
  parseProject,
  serializeProject,
  projectToFolder,
  projectFromFolder
} from '$lib/core/serialize'
import { autoMappingLines, renderScript } from '$lib/script/render'
import { projectFromCsv, projectToCsv } from '$lib/core/projectCsv'
import { drawnGlyphs, drawingPath } from '$lib/script/drawnFont'
import { eraseDrawing } from '$lib/script/glyphEraser'
import { rectContour, reverseContour, type GlyphContour, type Pt } from '$lib/script/glyphGeometry'
import type { GlyphDrawing } from '$lib/core/model'

function evaluate(c: GlyphContour, index: number, t: number): Pt {
  const prev = c.cmds[index - 1],
    cmd = c.cmds[index]
  const a: Pt =
    prev[0] === 'C'
      ? [prev[5], prev[6]]
      : prev[0] === 'Q'
        ? [prev[3], prev[4]]
        : [prev[1] as number, prev[2] as number]
  const q = 1 - t
  if (cmd[0] === 'L') return [q * a[0] + t * cmd[1], q * a[1] + t * cmd[2]]
  if (cmd[0] === 'Q')
    return [
      q * q * a[0] + 2 * q * t * cmd[1] + t * t * cmd[3],
      q * q * a[1] + 2 * q * t * cmd[2] + t * t * cmd[4]
    ]
  if (cmd[0] === 'C')
    return [
      q ** 3 * a[0] + 3 * q * q * t * cmd[1] + 3 * q * t * t * cmd[3] + t ** 3 * cmd[5],
      q ** 3 * a[1] + 3 * q * q * t * cmd[2] + 3 * q * t * t * cmd[4] + t ** 3 * cmd[6]
    ]
  throw Error('not a segment')
}
const old: GlyphDrawing = {
  advance: 850,
  strokes: [
    {
      width: 60,
      points: [
        [100, 100],
        [500, 100]
      ]
    }
  ],
  contours: [rectContour(100, 200, 700, 700), reverseContour(rectContour(200, 300, 600, 600))]
}

describe('project drawing editor', () => {
  it('uses legacy defaults and bounds invalid preset parameters', () => {
    expect(normalizeEditorSettings()).toMatchObject({
      advance: 1000,
      width: 60,
      showGrid: false,
      snap: false,
      step: 50,
      originX: 0,
      originY: 0
    })
    expect(
      normalizeEditorSettings({
        advance: Infinity,
        width: -5,
        step: NaN,
        originX: 9000,
        showGrid: 'true' as unknown as boolean,
        guides: [{ id: 'bad', axis: 'y', position: Infinity, name: '' }]
      })
    ).toMatchObject({
      advance: 1000,
      width: 10,
      step: 50,
      originX: 5000,
      showGrid: false,
      guides: []
    })
  })
  it('snaps against both shifted coordinates and supports a temporary bypass', () => {
    const settings = normalizeEditorSettings({ snap: true, step: 25, originX: 3, originY: -7 })
    expect(snapEditorPoint([41, 31], settings)).toEqual([53, 43])
    expect(snapEditorPoint([41, 31], settings, true)).toEqual([41, 31])
    expect(snapEditorPoint([41, 31], { ...settings, snap: false })).toEqual([41, 31])
  })
  for (const cmd of [
    ['L', 500, 300],
    ['Q', 220, 800, 500, 300],
    ['C', 100, 900, 700, -100, 500, 300]
  ] as const) {
    it(`splits ${cmd[0]} with the exact same geometric curve`, () => {
      const c: GlyphContour = { cmds: [['M', 10, 20], [...cmd], ['Z']] }
      const before = structuredClone(c),
        split = splitEditorSegment(c, 1)
      for (const t of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
        const expected = evaluate(c, 1, t),
          actual = evaluate(split, t <= 0.5 ? 1 : 2, t <= 0.5 ? t * 2 : (t - 0.5) * 2)
        expect(actual[0]).toBeCloseTo(expected[0], 8)
        expect(actual[1]).toBeCloseTo(expected[1], 8)
      }
      expect(c).toEqual(before)
      expect(split.cmds.at(-1)).toEqual(['Z'])
    })
  }
  it('converts a quadratic to an exactly equivalent editable cubic', () => {
    const c: GlyphContour = { cmds: [['M', 0, 0], ['Q', 200, 800, 500, 100], ['Z']] }
    const cubic = convertEditorSegment(c, 1, 'C')
    for (const t of [0.1, 0.5, 0.9]) {
      expect(evaluate(cubic, 1, t)[0]).toBeCloseTo(evaluate(c, 1, t)[0], 9)
      expect(evaluate(cubic, 1, t)[1]).toBeCloseTo(evaluate(c, 1, t)[1], 9)
    }
    expect(convertEditorSegment(c, 0, 'C')).toBe(c)
    expect(splitEditorSegment(c, 2)).toBe(c)
    expect(splitEditorSegment(c, 1, NaN)).toBe(c)
  })
  it('creates a closed Bézier contour with independently editable handles', () => {
    expect(editorBezierContour([{ point: [0, 0], handle: [10, 10] }])).toBeNull()
    const c = editorBezierContour([
      { point: [100, 100], handle: [150, 200] },
      { point: [400, 500], handle: [500, 550] }
    ])!
    expect(c.cmds).toEqual([
      ['M', 100, 100],
      ['C', 150, 200, 300, 450, 400, 500],
      ['C', 500, 550, 50, 0, 100, 100],
      ['Z']
    ])
    expect(
      drawingPath({ advance: 800, strokes: [], contours: [c] }).commands.some((x) => x.type === 'C')
    ).toBe(true)
  })
  it('inserts independent copies preserving holes, advance and legacy strokes', () => {
    const before = structuredClone(old),
      copy = copyEditorDrawing(old, [30, -20])
    expect(copy.advance).toBe(850)
    expect(copy.strokes[0].points[0]).toEqual([130, 80])
    expect(copy.contours?.[0].cmds[0]).toEqual(['M', 130, 180])
    copy.strokes[0].points[0][0] = 999
    copy.contours![0].cmds[0] = ['M', 999, 999]
    expect(old).toEqual(before)
    expect(
      eraseDrawing(
        copyEditorDrawing(old),
        [
          [400, 0],
          [400, 800]
        ],
        25
      ).advance
    ).toBe(850)
  })
  it('round trips reusable project presets and script-only components without mapping them', () => {
    const p = createProject({
      name: 'drawing QA',
      template: 'blank',
      appVersion: '1.1.0',
      uiLocale: 'en'
    })
    const lang = createLanguage({ name: 'QA' }),
      a = createScript('A'),
      b = createScript('B')
    a.components = [{ id: 'part', name: 'part', drawing: copyEditorDrawing(old) }]
    a.glyphs = [
      {
        id: 'g',
        name: 'g',
        char: 'x',
        value: 'a',
        category: 'letter',
        notes: '',
        drawing: copyEditorDrawing(old)
      }
    ]
    lang.scripts = [a, b]
    p.languages = [lang]
    p.glyphEditor = {
      presets: [
        {
          id: 'p',
          name: 'same across scripts',
          settings: normalizeEditorSettings({
            advance: 700,
            width: 40,
            snap: true,
            guides: [{ id: 'g', name: 'custom', axis: 'y', position: 333 }]
          })
        }
      ],
      defaultPresetId: 'p'
    }
    const round = parseProject(serializeProject(p))
    expect(round.glyphEditor).toEqual(p.glyphEditor)
    const folder = projectFromFolder(projectToFolder(p))
    expect(folder.glyphEditor).toEqual(p.glyphEditor)
    expect(folder.languages[0].scripts[0].components).toEqual(a.components)
    const csv = projectFromCsv(projectToCsv(p))
    expect(csv.glyphEditor).toEqual(p.glyphEditor)
    expect(csv.languages[0].scripts[0].components).toEqual(a.components)
    expect(round.languages[0].scripts[0].components).toEqual(a.components)
    expect(autoMappingLines(a)).toEqual(['a > x'])
    expect(renderScript(lang, a, 'a part')).toBe('x pxrt')
    expect(drawnGlyphs(a)).toHaveLength(1)
    expect(drawnGlyphs(b)).toHaveLength(0)
  })
  it('keeps absent editor fields optional for old projects', () => {
    const p = parseProject(
      JSON.stringify({
        schemaVersion: 1,
        meta: { name: 'old' },
        languages: [{ id: 'lang', name: 'old', scripts: [createScript('old')] }]
      })
    )
    expect(p.glyphEditor).toBeUndefined()
    expect(p.languages[0].scripts[0].components).toBeUndefined()
  })
})
