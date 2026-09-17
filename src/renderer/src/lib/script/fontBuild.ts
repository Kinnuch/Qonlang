/**
 * 内嵌字体和画板之间的往返：从内嵌字体里读出某个字的轮廓给画板改，
 * 改完把原字体的字形连同画过的字一起重新写成一份 TTF（画过的字盖掉原来的）。
 * 读字体用 opentype.js（TTF / OTF / WOFF，WOFF2 读不了），写字体用 fontWriter。
 */
import { parse, type ParsedFont } from 'opentype.js'
import type { GlyphDrawing, Script } from '$lib/core/model'
import { ASCENDER, DESCENDER, UNITS_PER_EM, drawnGlyphs } from './drawnFont'
import {
  commandsToContours,
  drawingContours,
  normalizeContours,
  type GlyphContour
} from './glyphGeometry'
import { writeTtf, type WriterGlyph } from './fontWriter'

/** data URL → ArrayBuffer */
export function dataUrlToBuffer(url: string): ArrayBuffer {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

/** 同一份字体数据只解析一次（画板开开关关、导出都要用） */
const parsedCache = new WeakMap<ArrayBuffer, ParsedFont>()
export function openFont(data: ArrayBuffer): ParsedFont {
  const hit = parsedCache.get(data)
  if (hit) return hit
  const font = parse(data)
  parsedCache.set(data, font)
  return font
}

/** 按 data URL 记住上一份解析结果：导出、写回时不用每次重新解析整套字体 */
let lastUrl: { url: string; font: ParsedFont } | null = null
export function openFontUrl(url: string): ParsedFont {
  if (lastUrl?.url === url) return lastUrl.font
  const font = openFont(dataUrlToBuffer(url))
  lastUrl = { url, font }
  return font
}

/** 字体里一个字形 → 画板上的轮廓（缩放到一个 em = 1000，外轮廓统一逆时针） */
function glyphContours(
  font: ParsedFont,
  index: number
): { contours: GlyphContour[]; advance: number } {
  const g = font.glyphs.get(index)
  const scale = UNITS_PER_EM / (font.unitsPerEm || UNITS_PER_EM)
  const contours = normalizeContours(commandsToContours(g.path?.commands ?? [], scale))
  return { contours, advance: Math.round((g.advanceWidth ?? font.unitsPerEm) * scale) }
}

/**
 * 从字体数据里取一个字；字体里没有这个字返回 null，字体读不了就抛错。
 * 只认单个码位的字符。
 */
export function drawingFromFont(data: ArrayBuffer, char: string): GlyphDrawing | null {
  const cps = [...char]
  if (cps.length !== 1) return null
  const font = openFont(data)
  const index = font.charToGlyphIndex(char)
  if (!index) return null
  const { contours, advance } = glyphContours(font, index)
  return { strokes: [], contours, advance }
}

/**
 * 这套文字的完整字体：内嵌字体里有码位的字形全部带上，画过的字（单个码位）盖掉或补进去。
 * 字距、连字、hinting 这些原字体里的东西不保留。内嵌字体读不了时抛错。
 */
export function buildScriptFont(
  script: Script,
  options: { familyName?: string; timestamp?: number } = {}
): ArrayBuffer {
  const entries: WriterGlyph[] = []
  let ascender = ASCENDER
  let descender = DESCENDER
  if (script.font.dataUrl) {
    const font = openFontUrl(script.font.dataUrl)
    const scale = UNITS_PER_EM / (font.unitsPerEm || UNITS_PER_EM)
    if (font.ascender) ascender = Math.round(font.ascender * scale)
    if (font.descender) descender = Math.round(font.descender * scale)
    for (let i = 1; i < font.glyphs.length; i++) {
      const g = font.glyphs.get(i)
      const cps = (
        g.unicodes?.length ? g.unicodes : g.unicode !== undefined ? [g.unicode] : []
      ).filter((cp) => cp > 0)
      if (!cps.length) continue
      const { contours, advance } = glyphContours(font, i)
      entries.push({ codepoints: cps, advance, contours })
    }
  }
  const drawn = drawnGlyphs(script)
  const override = new Set(drawn.map((d) => d.codepoint))
  const kept = entries
    .map((e) => ({ ...e, codepoints: e.codepoints.filter((cp) => !override.has(cp)) }))
    .filter((e) => e.codepoints.length)
  for (const d of drawn)
    kept.push({
      codepoints: [d.codepoint],
      advance: Math.max(1, Math.round(d.drawing.advance || UNITS_PER_EM)),
      contours: drawingContours(d.drawing)
    })
  kept.sort((a, b) => a.codepoints[0] - b.codepoints[0])
  return writeTtf({
    familyName: options.familyName || script.font.family || script.name,
    ascender,
    descender,
    glyphs: kept,
    timestamp: options.timestamp
  })
}
