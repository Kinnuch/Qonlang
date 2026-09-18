/**
 * 内嵌字体和画板之间的往返：从内嵌字体里读出某个字的轮廓给画板改，
 * 改完把画过的字写回字体。
 *
 * 写回有两条路，能走第一条就走第一条：
 * 1. 内嵌字体是 glyf 的 TrueType → 在原字体上动手术（fontPatch）：只换画过的那几个字形，
 *    别的表原样搬走，字距、连字、hinting 都留着；
 * 2. 内嵌字体是 CFF（OTF）、或者根本没有内嵌字体 → 从零写一份（fontWriter），这时字距、连字、hinting 留不住。
 *
 * 读字体用 opentype.js（TTF / OTF / WOFF，WOFF2 读不了）。
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
import { patchTtf } from './fontPatch'

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

/** 重新写出来的字体走的是哪条路：patch = 在原字体上改，scratch = 从零写 */
export type FontBuildMode = 'patch' | 'scratch'

export interface ScriptFontBuild {
  data: ArrayBuffer
  mode: FontBuildMode
  /** 原地换掉轮廓的字形数（这些字形自己的 hinting 丢了） */
  replaced: number
  /** 加在字体末尾的新字形数 */
  added: number
  /** 改字形时不得不丢掉的表（签名、字形数变了就失效的那几张） */
  dropped: string[]
}

/**
 * 这套文字的完整字体。内嵌字体是 glyf 的 TrueType 时在原字体上动手术，
 * 别的情况从零写一份。内嵌字体读不了时抛错。
 */
export function buildScriptFontFull(
  script: Script,
  options: { familyName?: string; timestamp?: number } = {}
): ScriptFontBuild {
  const drawn = drawnGlyphs(script)
  if (script.font.dataUrl) {
    const source = dataUrlToBuffer(script.font.dataUrl)
    const patched = patchTtf(
      source,
      drawn.map((d) => ({
        codepoint: d.codepoint,
        advance: Math.max(1, Math.round(d.drawing.advance || UNITS_PER_EM)),
        contours: drawingContours(d.drawing)
      })),
      { sourceUnitsPerEm: UNITS_PER_EM }
    )
    if (patched)
      return {
        data: patched.data,
        mode: 'patch',
        replaced: patched.replaced,
        added: patched.added,
        dropped: patched.dropped
      }
  }
  return {
    data: writeScriptFont(script, options),
    mode: 'scratch',
    replaced: 0,
    added: 0,
    dropped: []
  }
}

/** 这套文字的完整字体（只要字节，不管走的哪条路） */
export function buildScriptFont(
  script: Script,
  options: { familyName?: string; timestamp?: number } = {}
): ArrayBuffer {
  return buildScriptFontFull(script, options).data
}

/**
 * 从零写：内嵌字体里的字形全部读出来重画一遍，画过的字盖掉或补进去。
 * 字距、连字、hinting 这些原字体里的东西留不住。
 */
function writeScriptFont(
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
      const { contours, advance } = glyphContours(font, i)
      // 没码位的字形（连字组件、变体形）也留着，字形表不至于被削掉一块；空又没码位的才跳过
      if (!cps.length && !contours.length) continue
      entries.push({ codepoints: cps, advance, contours })
    }
  }
  const drawn = drawnGlyphs(script)
  const override = new Set(drawn.map((d) => d.codepoint))
  const kept = entries
    .map((e) => ({
      ...e,
      mapped: e.codepoints.length > 0,
      codepoints: e.codepoints.filter((cp) => !override.has(cp))
    }))
    .filter((e) => e.codepoints.length || !e.mapped)
  for (const d of drawn)
    kept.push({
      mapped: true,
      codepoints: [d.codepoint],
      advance: Math.max(1, Math.round(d.drawing.advance || UNITS_PER_EM)),
      contours: drawingContours(d.drawing)
    })
  // 按码位排，没码位的排到最后
  const order = (e: WriterGlyph): number => e.codepoints[0] ?? Number.MAX_SAFE_INTEGER
  kept.sort((a, b) => order(a) - order(b))
  return writeTtf({
    familyName: options.familyName || script.font.family || script.name,
    ascender,
    descender,
    glyphs: kept,
    timestamp: options.timestamp
  })
}
