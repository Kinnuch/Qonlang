import { describe, expect, it } from 'vitest'
import { parse } from 'opentype.js'
import { toWoff, writeTtf } from '$lib/script/fontWriter'
import { buildScriptFont, drawingFromFont } from '$lib/script/fontBuild'
import { ellipseContour, rectContour, reverseContour } from '$lib/script/glyphGeometry'
import { parseFont } from '$lib/script/fontParse'
import { buildDrawnFont } from '$lib/script/drawnFont'
import type { Script } from '$lib/core/model'

/** 一个「口」字形（外框加内洞）、一个椭圆、一个补充平面的字 */
function sample(): ArrayBuffer {
  return writeTtf({
    familyName: 'Test Script',
    ascender: 800,
    descender: -200,
    timestamp: 0,
    glyphs: [
      {
        codepoints: [0x41],
        advance: 600,
        contours: [rectContour(50, 0, 550, 700), reverseContour(rectContour(150, 100, 450, 600))]
      },
      { codepoints: [0x42, 0x43], advance: 700, contours: [ellipseContour(350, 350, 300, 350)] },
      { codepoints: [0x1f600], advance: 1000, contours: [rectContour(0, -100, 1000, 800)] },
      { codepoints: [0x20], advance: 250, contours: [] }
    ]
  })
}

/** 字体文件整体校验和应当是 0xB1B0AFBA */
function fileChecksum(buf: ArrayBuffer): number {
  const b = new Uint8Array(buf)
  let sum = 0
  for (let i = 0; i < b.length; i += 4)
    sum =
      (sum +
        ((b[i] << 24) >>> 0) +
        ((b[i + 1] ?? 0) << 16) +
        ((b[i + 2] ?? 0) << 8) +
        (b[i + 3] ?? 0)) >>>
      0
  return sum
}

describe('TTF 写出', () => {
  it('opentype.js 读得回来：字形数、cmap、字宽、外框', () => {
    const buf = sample()
    expect(fileChecksum(buf)).toBe(0xb1b0afba)
    const font = parse(buf)
    expect(font.unitsPerEm).toBe(1000)
    expect(font.glyphs.length).toBe(5)
    const a = font.charToGlyph('A')
    expect(a.advanceWidth).toBe(600)
    expect(font.charToGlyphIndex('B')).toBe(font.charToGlyphIndex('C'))
    expect(font.charToGlyph('C').advanceWidth).toBe(700)
    expect(font.charToGlyphIndex(String.fromCodePoint(0x1f600))).toBe(3)
    expect(font.charToGlyph(' ').advanceWidth).toBe(250)
    const xs = a.path.commands.filter((c) => c.x !== undefined).map((c) => c.x!)
    const ys = a.path.commands.filter((c) => c.y !== undefined).map((c) => c.y!)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([
      50, 550, 0, 700
    ])
    // 自己的 cmap 解析器也认
    expect(parseFont(buf).glyphs.map((g) => g.codepoint)).toEqual([0x20, 0x41, 0x42, 0x43, 0x1f600])
  })

  it('读回画板：外轮廓逆时针，椭圆的外框还在', () => {
    const d = drawingFromFont(sample(), 'B')!
    expect(d.advance).toBe(700)
    expect(d.contours!.length).toBe(1)
    const xs = d.contours![0].cmds.flatMap((c) => (c[0] === 'Z' ? [] : [c[c.length - 2] as number]))
    expect(Math.min(...xs)).toBeCloseTo(50, 0)
    expect(Math.max(...xs)).toBeCloseTo(650, 0)
    expect(drawingFromFont(sample(), 'Z')).toBeNull()
    // 矩形读回来还是 M + 三条直线 + Z：原地不动的直线、回到起点的直线都去掉了
    const a = drawingFromFont(sample(), 'A')!
    expect(a.contours!.map((c) => c.cmds.length)).toEqual([5, 5])
  })

  it('合并内嵌字体和手写的字：画过的盖掉原来的', () => {
    const bin = new Uint8Array(sample())
    let s = ''
    for (const b of bin) s += String.fromCharCode(b)
    const script = {
      id: 's',
      name: 'Merged',
      type: 'alphabet',
      direction: 'ltr',
      font: { family: '', dataUrl: 'data:font/ttf;base64,' + btoa(s), fileName: 'x.ttf' },
      rules: '',
      notes: '',
      glyphs: [
        {
          id: 'g',
          char: 'A',
          name: '',
          value: '',
          category: '',
          notes: '',
          drawing: {
            advance: 900,
            strokes: [
              {
                width: 60,
                points: [
                  [100, 0],
                  [800, 700]
                ]
              }
            ]
          }
        },
        {
          id: 'h',
          char: 'D',
          name: '',
          value: '',
          category: '',
          notes: '',
          drawing: { advance: 500, strokes: [], contours: [rectContour(0, 0, 400, 400)] }
        }
      ]
    } as Script
    const font = parse(buildScriptFont(script, { timestamp: 0 }))
    expect(font.charToGlyph('A').advanceWidth).toBe(900)
    expect(font.charToGlyph('C').advanceWidth).toBe(700)
    expect(font.charToGlyph('D').advanceWidth).toBe(500)
    expect(font.hasChar(String.fromCodePoint(0x1f600))).toBe(true)
  })

  it('CFF 字体（三次曲线）也能载入画板、再写成 TTF', () => {
    const script = {
      id: 'c',
      name: 'Cff',
      type: 'alphabet',
      direction: 'ltr',
      font: { family: '', dataUrl: null, fileName: '' },
      rules: '',
      notes: '',
      glyphs: [
        {
          id: 'e',
          char: 'O',
          name: '',
          value: '',
          category: '',
          notes: '',
          drawing: { advance: 800, strokes: [], contours: [ellipseContour(400, 350, 300, 350)] }
        }
      ]
    } as Script
    const otf = buildDrawnFont(script, 'cff-test')!
    const d = drawingFromFont(otf, 'O')!
    expect(d.advance).toBe(800)
    expect(d.contours!.some((c) => c.cmds.some((x) => x[0] === 'C'))).toBe(true)
    const ttf = buildScriptFont({ ...script, glyphs: [{ ...script.glyphs[0], drawing: d }] })
    const glyph = parse(ttf).charToGlyph('O')
    const xs = glyph.path.commands.filter((c) => c.x !== undefined).map((c) => c.x!)
    expect(Math.min(...xs)).toBeCloseTo(100, -1)
    expect(Math.max(...xs)).toBeCloseTo(700, -1)
  })
})

describe('WOFF', () => {
  it.skipIf(typeof CompressionStream === 'undefined')(
    '文件头是 wOFF，opentype.js 读得回来',
    async () => {
      const woff = await toWoff(sample())
      const tag = String.fromCharCode(...new Uint8Array(woff.slice(0, 4)))
      expect(tag).toBe('wOFF')
      const dv = new DataView(woff)
      expect(dv.getUint32(8)).toBe(woff.byteLength)
      const font = parse(woff)
      expect(font.charToGlyph('A').advanceWidth).toBe(600)
    }
  )
})
