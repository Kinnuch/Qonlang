/**
 * 用户字体库：下载 / 导入到应用数据目录，启动时注册为 FontFace。
 */
import { platform } from '$lib/platform'
import { parseFont } from '$lib/script/fontParse'
import { base64ToBuffer, fontDataUrl } from '$lib/script/fonts'
import type { FontEntry } from '$lib/skin/presets'

export interface LoadedFont {
  file: string
  family: string
  size: number
}

class FontLibrary {
  fonts = $state<LoadedFont[]>([])
  /** file → 已收到字节 / 总字节 */
  progress = $state<Record<string, { received: number; total: number }>>({})
  loaded = $state(false)
  private registered = new Set<string>()

  async refresh(): Promise<void> {
    const list = await platform.listFonts()
    const out: LoadedFont[] = []
    for (const f of list) {
      let family = this.fonts.find((x) => x.file === f.file)?.family ?? ''
      if (!family || !this.registered.has(f.file)) {
        const base64 = await platform.readFont(f.file)
        if (!base64) continue
        try {
          family = parseFont(base64ToBuffer(base64)).family || f.file.replace(/\.[^.]+$/, '')
        } catch {
          family = f.file.replace(/\.[^.]+$/, '')
        }
        this.register(f.file, family, base64)
      }
      out.push({ file: f.file, family, size: f.size })
    }
    this.fonts = out
    this.loaded = true
  }

  private register(file: string, family: string, base64: string): void {
    if (typeof document === 'undefined' || !('fonts' in document)) return
    try {
      const face = new FontFace(family, `url(${fontDataUrl(file, base64)})`)
      face.load().then((f) => document.fonts.add(f)).catch(() => {})
      this.registered.add(file)
    } catch {
      /* ignore */
    }
  }

  isInstalled(entry: FontEntry): boolean {
    return this.fonts.some((f) => f.file === entry.file)
  }
  isDownloading(entry: FontEntry): boolean {
    return entry.file in this.progress
  }

  async download(entry: FontEntry, mirror: string): Promise<string | null> {
    const url = mirror.trim() ? mirror.trim().replace(/\/?$/, '/') + entry.url : entry.url
    this.progress = { ...this.progress, [entry.file]: { received: 0, total: 0 } }
    const r = await platform.downloadFont(url, entry.file)
    const { [entry.file]: _gone, ...rest } = this.progress
    this.progress = rest
    if (!r.ok) return r.error ?? 'download failed'
    await this.refresh()
    return null
  }

  async importLocal(): Promise<number> {
    const files = await platform.readBinaryFiles({ multiple: true, extensions: ['ttf', 'otf', 'woff', 'woff2'] })
    let n = 0
    for (const f of files) {
      if (await platform.saveFont(f.name, f.base64)) n++
    }
    if (n) await this.refresh()
    return n
  }

  async remove(file: string): Promise<void> {
    await platform.deleteFont(file)
    this.fonts = this.fonts.filter((f) => f.file !== file)
    this.registered.delete(file)
  }

  onProgress(): void {
    platform.onFontProgress((p) => {
      if (p.file in this.progress) this.progress = { ...this.progress, [p.file]: { received: p.received, total: p.total } }
    })
  }
}

export const fontLibrary = new FontLibrary()
