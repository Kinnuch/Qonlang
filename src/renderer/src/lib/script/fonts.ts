/** 把文字里内嵌的字体注册成 FontFace；返回该文字应使用的 font-family。 */
import type { Script } from '$lib/core/model'
import { buildDrawnFont, drawnGlyphs } from './drawnFont'
import { hasDrawingContent } from './glyphGeometry'
import { scriptCacheStamp, scriptCacheValid } from './render'

const registered = new Map<string, string>() // scriptId → dataUrl 已注册
/** 手写字形做成的字体：scriptId → { 画的内容，已注册的 FontFace } */
const drawnRegistered = new Map<string, { key: string; face: FontFace | null }>()

/** 手写字形字体的名字（只含这套文字里画过的字，排在字体栈最前面） */
export function drawnFontFamily(script: Script): string {
  return `qy-drawn-${script.id}`
}
/** 这套文字里有没有手写的字：字体栈要不要带上手写字体。几千个字形的文字每个格子都要问，项目改动之后才重数 */
const drawnFlags = new WeakMap<Script, { stamp: number; drawn: boolean }>()
const hasDrawn = (script: Script): boolean => {
  const hit = drawnFlags.get(script)
  if (hit && scriptCacheValid(hit.stamp)) return hit.drawn
  const drawn = script.glyphs.some((g) => hasDrawingContent(g.drawing))
  drawnFlags.set(script, { stamp: scriptCacheStamp(), drawn })
  return drawn
}

/** 手写字形变了就重新做字体、换掉原来注册的那个 */
export function ensureDrawnFont(script: Script): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  const drawn = drawnGlyphs(script)
  const key = JSON.stringify(drawn)
  const prev = drawnRegistered.get(script.id)
  if (prev?.key === key) return
  if (prev?.face) document.fonts.delete(prev.face)
  if (!drawn.length) {
    drawnRegistered.set(script.id, { key, face: null })
    return
  }
  try {
    const buf = buildDrawnFont(script, drawnFontFamily(script))
    if (!buf) return
    const face = new FontFace(drawnFontFamily(script), buf)
    drawnRegistered.set(script.id, { key, face })
    face
      .load()
      .then((f) => {
        if (drawnRegistered.get(script.id)?.face === f) document.fonts.add(f)
      })
      .catch(() => {})
  } catch {
    /* 字体做不出来：画的字照旧显示成方框，不影响别的 */
  }
}

export function scriptFontFamily(script: Script): string {
  if (script.font.dataUrl) return `qy-script-${script.id}`
  return script.font.family
}

export function ensureScriptFont(script: Script): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  ensureDrawnFont(script)
  const url = script.font.dataUrl
  if (!url) return
  if (registered.get(script.id) === url) return
  try {
    const face = new FontFace(`qy-script-${script.id}`, `url(${url})`)
    face
      .load()
      .then((f) => document.fonts.add(f))
      .catch(() => {})
    registered.set(script.id, url)
  } catch {
    /* 非浏览器环境 */
  }
}

/** 竖排：direction 为 ttb 或勾了竖排都算；列从右往左，除非明确是 ltr */
export function isVertical(script: Script): boolean {
  return !!script.vertical || script.direction === 'ttb'
}

/**
 * 文字的内联样式：字体，加上竖排时的书写模式。
 * 所有渲染文字的地方都用它，竖排开关才能一处生效。
 */
/** 皮肤里给某套文字单独指定字体时用的 CSS 变量名 */
export function scriptFontVar(scriptId: string): string {
  return `--script-font-${scriptId.replace(/[^A-Za-z0-9_-]/g, '')}`
}

/**
 * 只有 font-family（输入框、检视器标题这些地方用，不带竖排）。
 * 顺序：皮肤里给这套文字指定的字体 → 文字自带或内嵌的字体 → 皮肤的「自定义文字」槽。
 */
export function fontFamilyCss(script: Script): string {
  const fam = scriptFontFamily(script)
  const own = fam ? `"${fam.replace(/"/g, '')}"` : 'var(--font-script)'
  const drawn = hasDrawn(script) ? `"${drawnFontFamily(script)}",` : ''
  return `font-family:${drawn}var(${scriptFontVar(script.id)}, ${own}),var(--font-script)`
}

/**
 * 等宽正文里夹着自定义文字（导出预览这类）：先用 base 字体，缺的字依次回落到各套文字的字体，
 * 拉丁字母仍按等宽对齐，文字行也不再是方框。
 */
export function mixedFontCss(scripts: Script[], base = 'var(--font-mono)'): string {
  const fams = scripts.flatMap((s) => {
    const fam = scriptFontFamily(s).replace(/"/g, '')
    const own = `var(${scriptFontVar(s.id)}, ${fam ? `"${fam}"` : 'var(--font-script)'})`
    return hasDrawn(s) ? [`"${drawnFontFamily(s)}"`, own] : [own]
  })
  return `font-family:${[base, ...fams, 'var(--font-script)'].join(',')}`
}

export function fontCss(script: Script): string {
  const font = fontFamilyCss(script)
  if (!isVertical(script)) return font
  const mode = script.direction === 'ltr' ? 'vertical-lr' : 'vertical-rl'
  return `${font};writing-mode:${mode};text-orientation:upright;max-height:60vh;overflow:auto;align-self:flex-start`
}

/** 把 base64 字体数据转成 data URL，按扩展名挑 MIME */
export function fontDataUrl(fileName: string, base64: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  const mime =
    ext === 'otf'
      ? 'font/otf'
      : ext === 'woff'
        ? 'font/woff'
        : ext === 'woff2'
          ? 'font/woff2'
          : 'font/ttf'
  return `data:${mime};base64,${base64}`
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}
