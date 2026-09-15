/**
 * 手写字形 → 字体。字形表里画出来的字存成笔画（点列 + 粗细，字体单位，一个 em = 1000，基线 y = 0、向上为正），
 * 这里把每一笔描成轮廓：相邻两点之间一个矩形、每个点一个圆（圆头圆角），全都同一个绕向，叠在一起按非零规则填满。
 * 生成的字体只含手写的那些字，挂在这套文字字体栈的最前面，别的字照旧回落到原来的字体。
 */
import { Font, Glyph, Path } from 'opentype.js'
import type { GlyphDrawing, Script } from '$lib/core/model'

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

type Pt = [number, number]

/** 点列抽稀（Ramer–Douglas–Peucker），手抖的小弯去掉，轮廓少很多点 */
export function simplify(points: Pt[], epsilon = 3): Pt[] {
  if (points.length < 3) return points.slice()
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  let far = -1
  let farDist = 0
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]
    const d = len
      ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
      : Math.hypot(px - ax, py - ay)
    if (d > farDist) {
      farDist = d
      far = i
    }
  }
  if (farDist <= epsilon || far < 0) return [points[0], points[points.length - 1]]
  const left = simplify(points.slice(0, far + 1), epsilon)
  const right = simplify(points.slice(far), epsilon)
  return [...left.slice(0, -1), ...right]
}

/** 圆：八段二次曲线近似，角度从 0 往上转一圈，y 向上时是逆时针 */
function circle(path: Path, cx: number, cy: number, r: number): void {
  const n = 8
  const c = r / Math.cos(Math.PI / n)
  path.moveTo(cx + r, cy)
  for (let i = 0; i < n; i++) {
    const a1 = ((i + 1) * 2 * Math.PI) / n
    const am = ((i + 0.5) * 2 * Math.PI) / n
    path.quadraticCurveTo(
      cx + c * Math.cos(am),
      cy + c * Math.sin(am),
      cx + r * Math.cos(a1),
      cy + r * Math.sin(a1)
    )
  }
  path.close()
}

/** 两点之间的矩形（宽 w），逆时针 */
function segment(path: Path, a: Pt, b: Pt, w: number): void {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (!len) return
  const nx = (-dy / len) * (w / 2)
  const ny = (dx / len) * (w / 2)
  // a - n → b - n → b + n → a + n：法线在左边，这样走是逆时针
  path.moveTo(a[0] - nx, a[1] - ny)
  path.lineTo(b[0] - nx, b[1] - ny)
  path.lineTo(b[0] + nx, b[1] + ny)
  path.lineTo(a[0] + nx, a[1] + ny)
  path.close()
}

/** 一个字的全部笔画 → 字形轮廓 */
export function drawingPath(drawing: GlyphDrawing): Path {
  const path = new Path()
  for (const st of drawing.strokes) {
    const w = Math.max(4, st.width)
    const pts = simplify(st.points)
    if (!pts.length) continue
    for (let i = 0; i + 1 < pts.length; i++) segment(path, pts[i], pts[i + 1], w)
    for (const p of pts) circle(path, p[0], p[1], w / 2)
  }
  return path
}

/** 能挂进字体的手写字形：有笔画，字符正好是一个码位 */
export function drawnGlyphs(script: Script): { codepoint: number; drawing: GlyphDrawing }[] {
  const out: { codepoint: number; drawing: GlyphDrawing }[] = []
  const seen = new Set<number>()
  for (const g of script.glyphs) {
    if (!g.drawing?.strokes.length) continue
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
