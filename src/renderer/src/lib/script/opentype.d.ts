/** opentype.js 没带类型：这里只写手写字形生成字体用到的那几样 */
declare module 'opentype.js' {
  export class Path {
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void
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
  export function parse(buffer: ArrayBuffer): {
    glyphs: { length: number; get(i: number): { unicode?: number; advanceWidth?: number } }
    names: Record<string, unknown>
  }
}
