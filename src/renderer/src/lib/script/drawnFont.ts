/**
 * 手写字形 → 字体。字形表里画出来的字存成笔画（点列 + 粗细，字体单位，一个 em = 1000，基线 y = 0、向上为正），
 * 这里把每一笔描成轮廓：相邻两点之间一个矩形、每个点一个圆（圆头圆角），全都同一个绕向，叠在一起按非零规则填满；
 * 从字体载入或画板里拉出来的轮廓（contours）原样放进去。
 * 生成的字体只含手写的那些字，挂在这套文字字体栈的最前面，别的字照旧回落到原来的字体。
 */
import { Font, Glyph, Path } from 'opentype.js'
import type { GlyphDrawing, Script } from '$lib/core/model'
import { drawingContours, hasDrawingContent } from './glyphGeometry'

export { simplify } from './glyphGeometry'

export const UNITS_PER_EM = 1000
export const ASCENDER = 800
export const DESCENDER = -200
/** 画板上的参考线（字体单位） */
export const GUIDES = {
  ascender: ASCENDER,
  capHeight: 700,
  xHeight: 500,
  baseline: 0,
  descender: DESCENDER
}

/** 一个字的全部轮廓与笔画 → 字形轮廓 */
export function drawingPath(drawing: GlyphDrawing): Path {
  const path = new Path()
  for (const c of drawingContours(drawing)) {
    for (const cmd of c.cmds) {
      if (cmd[0] === 'M') path.moveTo(cmd[1], cmd[2])
      else if (cmd[0] === 'L') path.lineTo(cmd[1], cmd[2])
      else if (cmd[0] === 'Q') path.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4])
      else if (cmd[0] === 'C') path.curveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6])
      else path.close()
    }
  }
  return path
}

/** 能挂进字体的手写字形：有笔画，字符正好是一个码位 */
export function drawnGlyphs(script: Script): { codepoint: number; drawing: GlyphDrawing }[] {
  const out: { codepoint: number; drawing: GlyphDrawing }[] = []
  const seen = new Set<number>()
  for (const g of script.glyphs) {
    if (!g.drawing || !hasDrawingContent(g.drawing)) continue
    const cps = [...g.char]
    if (cps.length !== 1) continue
    const cp = cps[0].codePointAt(0)!
    if (seen.has(cp)) continue
    seen.add(cp)
    out.push({ codepoint: cp, drawing: g.drawing })
  }
  return out
}

/** 这套文字的手写字形做成的字体（没有手写字形时返回 null） */
export function buildDrawnFont(script: Script, familyName: string): ArrayBuffer | null {
  const drawn = drawnGlyphs(script)
  if (!drawn.length) return null
  const glyphs = [
    new Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new Path() }),
    ...drawn.map(
      (d) =>
        new Glyph({
          name: 'uni' + d.codepoint.toString(16).toUpperCase().padStart(4, '0'),
          unicode: d.codepoint,
          advanceWidth: Math.max(1, Math.round(d.drawing.advance || UNITS_PER_EM)),
          path: drawingPath(d.drawing)
        })
    )
  ]
  const font = new Font({
    familyName,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: ASCENDER,
    descender: DESCENDER,
    glyphs
  })
  return font.toArrayBuffer()
}

/**
 * 给新画的字找一个私用区码位：从 U+F8FE 往下找（U+F8FF 常被系统字体占着），
 * 跳过项目里各套文字已经用了的字符、这套文字内嵌字体里已经有的码位
 */
export function freePrivateChar(
  used: Iterable<string>,
  fontCodepoints: Iterable<number> = []
): string {
  const taken = new Set<number>(fontCodepoints)
  for (const ch of used) for (const c of ch) taken.add(c.codePointAt(0)!)
  for (let cp = 0xf8fe; cp >= 0xe000; cp--) if (!taken.has(cp)) return String.fromCodePoint(cp)
  for (let cp = 0xf0000; cp <= 0xffffd; cp++) if (!taken.has(cp)) return String.fromCodePoint(cp)
  return ''
}
