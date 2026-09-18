import { describe, expect, it } from 'vitest'
import { parse } from 'opentype.js'
import { assembleSfnt, toWoff, writeTtf } from '$lib/script/fontWriter'
import { patchTtf, sfntTables } from '$lib/script/fontPatch'
import { buildScriptFontFull, drawingFromFont } from '$lib/script/fontBuild'
import { buildDrawnFont } from '$lib/script/drawnFont'
import { parseFont } from '$lib/script/fontParse'
import { ellipseContour, rectContour } from '$lib/script/glyphGeometry'
import type { Script } from '$lib/core/model'

/** 一份小字体：A（口字形）、B / C（椭圆）、空格 */
function baseFont(upem = 1000): ArrayBuffer {
  const k = upem / 1000
  const s = (v: number): number => Math.round(v * k)
  return writeTtf({
    familyName: 'Patch Test',
    unitsPerEm: upem,
    ascender: s(800),
    descender: s(-200),
    timestamp: 0,
    glyphs: [
      { codepoints: [0x41], advance: s(600), contours: [rectContour(s(50), 0, s(550), s(700))] },
      {
        codepoints: [0x42, 0x43],
        advance: s(700),
        contours: [ellipseContour(s(350), s(350), s(300), s(350))]
      },
      { codepoints: [0x20], advance: s(250), contours: [] }
    ]
  })
}

/** 一张能用的 kern 表：A、B 之间 −50 */
function kernTable(): Uint8Array {
  const t = new Uint8Array(24)
  const dv = new DataView(t.buffer)
  dv.setUint16(0, 0) // version
  dv.setUint16(2, 1) // nTables
  dv.setUint16(4, 0) // 子表 version
  dv.setUint16(6, 20) // 子表长度
  dv.setUint16(8, 0x0001) // coverage：格式 0、横排
  dv.setUint16(10, 1) // nPairs
  dv.setUint16(12, 6)
  dv.setUint16(14, 0)
  dv.setUint16(16, 0)
  dv.setUint16(18, 1) // 左：A
  dv.setUint16(20, 2) // 右：B
  dv.setInt16(22, -50)
  return t
}

/** 空的 GPOS：三张列表都是 0 条 */
function gposTable(): Uint8Array {
  const t = new Uint8Array(16)
  const dv = new DataView(t.buffer)
  dv.setUint32(0, 0x00010000)
  dv.setUint16(4, 10)
  dv.setUint16(6, 12)
  dv.setUint16(8, 14)
  return t
}

/** post 2.0：给 numGlyphs 个字形各挂一个自定义名字 */
function post2(numGlyphs: number): Uint8Array {
  const names = Array.from({ length: numGlyphs }, (_, i) => (i ? `g${i}` : '.notdef'))
  const out: number[] = Array.from({ length: 32 }, () => 0)
  out[1] = 2 // version 2.0
  out.push(numGlyphs >> 8, numGlyphs & 0xff)
  for (let i = 0; i < numGlyphs; i++) {
    const idx = 258 + i
    out.push(idx >> 8, idx & 0xff)
  }
  for (const n of names) {
    out.push(n.length)
    for (const ch of n) out.push(ch.charCodeAt(0))
  }
  return new Uint8Array(out)
}

/** 带字距、连字、hinting、字形名的字体 */
function richFont(upem = 1000): ArrayBuffer {
  const tables = sfntTables(baseFont(upem))!
  tables.set('kern', kernTable())
  tables.set('GPOS', gposTable())
  tables.set('prep', new Uint8Array([0xb0, 0x00, 0x2c, 0x01]))
  tables.set('fpgm', new Uint8Array([0x2c, 0x01, 0x2d, 0x00]))
  tables.set('cvt ', new Uint8Array([0x02, 0x80, 0xff, 0x38]))
  tables.set('post', post2(4))
  return assembleSfnt(0x00010000, [...tables])
}

const HINT_TAGS = ['kern', 'GPOS', 'prep', 'fpgm', 'cvt ']
/** 原字体里没有的一个私用区码位 */
const PUA = String.fromCodePoint(0xe000)

/** 整个文件的校验和应当是 0xB1B0AFBA */
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

function xRange(buf: ArrayBuffer, char: string): [number, number] {
  const xs = parse(buf)
    .charToGlyph(char)
    .path.commands.filter((c) => c.x !== undefined)
    .map((c) => c.x!)
  return [Math.min(...xs), Math.max(...xs)]
}

describe('在原字体上改字形', () => {
  it('字距、连字、hinting 的表一个字节没动，字形号也没挪', () => {
    const src = richFont()
    const before = sfntTables(src)!
    const beforeFont = parse(src)
    const gidA = beforeFont.charToGlyphIndex('A')
    const gidB = beforeFont.charToGlyphIndex('B')
    const res = patchTtf(
      src,
      [{ codepoint: 0x41, advance: 900, contours: [rectContour(100, 0, 800, 700)] }],
      { sourceUnitsPerEm: 1000 }
    )!
    expect(res.replaced).toBe(1)
    expect(res.added).toBe(0)
    expect(fileChecksum(res.data)).toBe(0xb1b0afba)
    const after = sfntTables(res.data)!
    expect(HINT_TAGS.every((tag) => (before.get(tag)?.length ?? 0) > 0)).toBe(true)
    for (const tag of HINT_TAGS) expect(after.get(tag)).toEqual(before.get(tag))
    // name 表也是原样搬过去的
    expect(after.get('name')).toEqual(before.get('name'))
    const font = parse(res.data)
    expect(font.glyphs.length).toBe(beforeFont.glyphs.length)
    expect(font.charToGlyphIndex('A')).toBe(gidA)
    expect(font.charToGlyphIndex('B')).toBe(gidB)
    expect(font.charToGlyphIndex('C')).toBe(gidB)
    // 换过的字形：新轮廓、新字宽；没动的字形照旧
    expect(font.charToGlyph('A').advanceWidth).toBe(900)
    expect(xRange(res.data, 'A')).toEqual([100, 800])
    expect(font.charToGlyph('B').advanceWidth).toBe(700)
    expect(xRange(res.data, 'B')).toEqual(xRange(src, 'B'))
  })

  it('原字体里没有的字加在最后：字形号往后排，cmap 认得，字距表还在', () => {
    const src = richFont()
    const beforeFont = parse(src)
    const res = patchTtf(
      src,
      [{ codepoint: 0xe000, advance: 500, contours: [rectContour(0, 0, 400, 400)] }],
      { sourceUnitsPerEm: 1000 }
    )!
    expect(res.added).toBe(1)
    expect(res.replaced).toBe(0)
    expect(fileChecksum(res.data)).toBe(0xb1b0afba)
    const font = parse(res.data)
    expect(font.glyphs.length).toBe(beforeFont.glyphs.length + 1)
    expect(font.charToGlyphIndex(PUA)).toBe(beforeFont.glyphs.length)
    expect(font.charToGlyph(PUA).advanceWidth).toBe(500)
    expect(xRange(res.data, PUA)).toEqual([0, 400])
    // 老字形一个都没挪
    expect(font.charToGlyphIndex('A')).toBe(beforeFont.charToGlyphIndex('A'))
    expect(font.charToGlyph('A').advanceWidth).toBe(600)
    for (const tag of HINT_TAGS)
      expect(sfntTables(res.data)!.get(tag)).toEqual(sfntTables(src)!.get(tag))
    // post 2.0 跟着补了一条名字
    expect(parseFont(res.data).glyphs.find((g) => g.codepoint === 0xe000)?.name).toBe('uniE000')
  })

  it('原字体不是 1000 的 em：写进去缩放，读回画板再缩回来', () => {
    const src = richFont(2048)
    expect(parse(src).unitsPerEm).toBe(2048)
    const res = patchTtf(
      src,
      [{ codepoint: 0x41, advance: 600, contours: [rectContour(100, 0, 600, 700)] }],
      { sourceUnitsPerEm: 1000 }
    )!
    expect(res.unitsPerEm).toBe(2048)
    const font = parse(res.data)
    expect(font.unitsPerEm).toBe(2048)
    expect(font.charToGlyph('A').advanceWidth).toBe(Math.round(600 * 2.048))
    const [x0, x1] = xRange(res.data, 'A')
    expect(x0).toBeCloseTo(100 * 2.048, 0)
    expect(x1).toBeCloseTo(600 * 2.048, 0)
    // 再载回画板：又回到 1000 的 em
    const back = drawingFromFont(res.data, 'A')!
    expect(back.advance).toBe(600)
    const xs = back.contours!.flatMap((c) =>
      c.cmds.flatMap((cmd) => (cmd[0] === 'Z' ? [] : [cmd[cmd.length - 2] as number]))
    )
    expect(Math.min(...xs)).toBeCloseTo(100, 0)
    expect(Math.max(...xs)).toBeCloseTo(600, 0)
  })

  it('CFF（OTF）、坏数据不动手术，交给从零写的路子', () => {
    expect(patchTtf(buildDrawnFont(cffScript(), 'cff')!, [], {})).toBeNull()
    expect(patchTtf(new Uint8Array([1, 2, 3, 4]).buffer, [], {})).toBeNull()
  })

  it.skipIf(typeof CompressionStream === 'undefined')('动过手术的字体也包得成 WOFF', async () => {
    const res = patchTtf(
      richFont(),
      [{ codepoint: 0x41, advance: 900, contours: [rectContour(100, 0, 800, 700)] }],
      { sourceUnitsPerEm: 1000 }
    )!
    const woff = await toWoff(res.data)
    expect(String.fromCharCode(...new Uint8Array(woff.slice(0, 4)))).toBe('wOFF')
    const font = parse(woff)
    expect(font.charToGlyph('A').advanceWidth).toBe(900)
    expect(font.charToGlyph('B').advanceWidth).toBe(700)
  })
})

// ───── 走哪条路 ─────

function script(dataUrl: string | null): Script {
  return {
    id: 's',
    name: 'S',
    type: 'alphabet',
    direction: 'ltr',
    font: { family: '', dataUrl, fileName: 'x.ttf' },
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
        drawing: { advance: 900, strokes: [], contours: [rectContour(100, 0, 800, 700)] }
      }
    ]
  } as Script
}

function cffScript(): Script {
  const s = script(null)
  s.glyphs[0].char = 'O'
  s.glyphs[0].drawing = {
    advance: 800,
    strokes: [],
    contours: [ellipseContour(400, 350, 300, 350)]
  }
  return s
}

function dataUrl(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return 'data:font/ttf;base64,' + btoa(bin)
}

describe('这套文字的字体怎么写', () => {
  it('内嵌的是 TrueType：动手术，字距表留着', () => {
    const src = richFont()
    const built = buildScriptFontFull(script(dataUrl(src)))
    expect(built.mode).toBe('patch')
    expect(built.replaced).toBe(1)
    expect(sfntTables(built.data)!.get('kern')).toEqual(sfntTables(src)!.get('kern'))
    expect(parse(built.data).charToGlyph('A').advanceWidth).toBe(900)
    // 没画过的字原样留着
    expect(parse(built.data).charToGlyph('B').advanceWidth).toBe(700)
  })

  it('内嵌的是 CFF、或者压根没有内嵌字体：从零写', () => {
    expect(buildScriptFontFull(script(null)).mode).toBe('scratch')
    const otf = buildDrawnFont(cffScript(), 'cff')!
    const built = buildScriptFontFull(script(dataUrl(otf)))
    expect(built.mode).toBe('scratch')
    expect(parse(built.data).charToGlyph('A').advanceWidth).toBe(900)
  })
})
