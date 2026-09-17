/** opentype.js 没带类型：这里只写手写字形生成字体、从字体读字形轮廓用到的那几样 */
declare module 'opentype.js' {
  /** 路径命令：字体单位，y 向上 */
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z'
    x?: number
    y?: number
    x1?: number
    y1?: number
    x2?: number
    y2?: number
  }
  export class Path {
    commands: PathCommand[]
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
    close(): void
  }
  export class Glyph {
    constructor(options: {
      name: string
      unicode?: number
      unicodes?: number[]
      advanceWidth: number
      path: Path
    })
    index: number
    name: string | null
    unicode?: number
    unicodes: number[]
    advanceWidth?: number
    /** 读字体时是懒加载的 getter */
    path: Path
  }
  export class Font {
    constructor(options: {
      familyName: string
      styleName: string
      unitsPerEm: number
      ascender: number
      descender: number
      glyphs: Glyph[]
    })
    toArrayBuffer(): ArrayBuffer
  }
  /** parse 读出来的字体 */
  export interface ParsedFont {
    unitsPerEm: number
    ascender: number
    descender: number
    outlinesFormat: string
    glyphs: { length: number; get(i: number): Glyph }
    names: Record<string, unknown>
    charToGlyphIndex(c: string): number
    charToGlyph(c: string): Glyph
    hasChar(c: string): boolean
  }
  export function parse(buffer: ArrayBuffer): ParsedFont
}
