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
    face.load().then((f) => document.fonts.add(f)).catch(() => {})
    registered.set(script.id, url)
  } catch {
    /* 非浏览器环境 */
  }
}

export function fontCss(script: Script): string {
  const fam = scriptFontFamily(script)
  return fam ? `font-family:"${fam.replace(/"/g, '')}",var(--font-data)` : ''
}

/** 把 base64 字体数据转成 data URL，按扩展名挑 MIME */
export function fontDataUrl(fileName: string, base64: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  const mime = ext === 'otf' ? 'font/otf' : ext === 'woff' ? 'font/woff' : ext === 'woff2' ? 'font/woff2' : 'font/ttf'
  return `data:${mime};base64,${base64}`
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}
