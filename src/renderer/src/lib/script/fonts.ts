/** 把文字里内嵌的字体注册成 FontFace；返回该文字应使用的 font-family。 */
import type { Script } from '$lib/core/model'

const registered = new Map<string, string>() // scriptId → dataUrl 已注册

export function scriptFontFamily(script: Script): string {
  if (script.font.dataUrl) return `qy-script-${script.id}`
  return script.font.family
}

export function ensureScriptFont(script: Script): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return
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
export function fontCss(script: Script): string {
  const fam = scriptFontFamily(script)
  const font = fam
    ? `font-family:"${fam.replace(/"/g, '')}",var(--font-script)`
    : 'font-family:var(--font-script)'
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
