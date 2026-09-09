/**
 * 词条配图：按项目设置的尺寸裁剪 / 缩放，编码时保持源格式（PNG / GIF / BMP 走无损 PNG；JPEG / WebP 走高质量同格式），
 * 尺寸已相符的原样保留，不重新编码。
 */
export interface ImageSize {
  width: number
  height: number
}

export const DEFAULT_IMAGE_SIZE: ImageSize = { width: 320, height: 240 }

export function mimeOf(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'webp'
      ? 'image/webp'
      : ext === 'gif'
        ? 'image/gif'
        : ext === 'bmp'
          ? 'image/bmp'
          : 'image/png'
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('cannot decode image'))
    img.src = src
  })
}

/** 输出格式：源是有损格式就沿用（避免体积暴涨），否则用无损 PNG */
export function outputMime(sourceMime: string): { mime: string; quality?: number } {
  if (sourceMime === 'image/jpeg') return { mime: 'image/jpeg', quality: 0.92 }
  if (sourceMime === 'image/webp') return { mime: 'image/webp', quality: 0.95 }
  return { mime: 'image/png' }
}

/** 从源图裁出一块并缩放到目标尺寸 */
export function cropToDataUrl(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  size: ImageSize,
  sourceMime: string
): string {
  const c = document.createElement('canvas')
  c.width = size.width
  c.height = size.height
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size.width, size.height)
  const o = outputMime(sourceMime)
  return c.toDataURL(o.mime, o.quality)
}

export interface PreparedImage {
  /** 已可直接使用的 data URL（尺寸相符或等比缩放后） */
  dataUrl: string | null
  /** 需要用户裁剪 */
  needsCrop: boolean
  img: HTMLImageElement
  mime: string
}

/** 判断一张图是否直接可用：尺寸恰好相符 → 原样；比例相同 → 等比缩放；否则交给裁剪器 */
export async function prepareImage(
  base64: string,
  fileName: string,
  size: ImageSize
): Promise<PreparedImage> {
  const mime = mimeOf(fileName)
  const src = `data:${mime};base64,${base64}`
  const img = await loadImage(src)
  if (img.naturalWidth === size.width && img.naturalHeight === size.height)
    return { dataUrl: src, needsCrop: false, img, mime }
  const ratio = img.naturalWidth / img.naturalHeight
  const want = size.width / size.height
  if (Math.abs(ratio - want) / want < 0.01)
    return {
      dataUrl: cropToDataUrl(img, 0, 0, img.naturalWidth, img.naturalHeight, size, mime),
      needsCrop: false,
      img,
      mime
    }
  return { dataUrl: null, needsCrop: true, img, mime }
}

export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  return Math.floor(((dataUrl.length - i - 1) * 3) / 4)
}
