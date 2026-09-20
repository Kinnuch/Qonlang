/**
 * 皮肤的导出与导入：一套皮肤存成带记号的 JSON 文件。
 * 记号与版本号的写法跟构形剪贴板（qonlangMorphClip）一路：先认记号，再看版本。
 */
import {
  BACKGROUND_FITS,
  DEFAULT_BACKGROUND,
  EMPTY_FONTS,
  FONT_VARS,
  SKIN_EXTRA_VARS,
  SKIN_VARS,
  type FontSlot,
  type Skin,
  type SkinBackground
} from './presets'

/** 文件里的记号：认出是千语集导出的皮肤 */
export const SKIN_FILE_MARK = 'qonlangSkin'
/** 皮肤文件的格式版本 */
export const SKIN_FILE_VERSION = 1

export interface SkinFile {
  /** 记号兼版本号 */
  qonlangSkin: number
  /** 皮肤名，只作显示 */
  name: string
  skin: Omit<Skin, 'mirror'>
}

export type SkinParse =
  | { ok: true; name: string; skin: Omit<Skin, 'mirror'>; hasBackground: boolean }
  /** format：不是皮肤文件；version：来自更新版本的千语集 */
  | { ok: false; reason: 'format' | 'version' }

const VAR_NAMES = new Set([...SKIN_VARS.map((v) => v.name), ...SKIN_EXTRA_VARS])
const SLOTS = Object.keys(FONT_VARS) as FontSlot[]
const POSITIONS = ['center', 'top', 'bottom', 'left', 'right']

function strMap(o: unknown, keep?: (k: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {}
  if (!o || typeof o !== 'object') return out
  for (const [k, v] of Object.entries(o as Record<string, unknown>))
    if ((!keep || keep(k)) && typeof v === 'string' && v.trim()) out[k] = v
  return out
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** 背景图只收得出来的那几个字段，图必须是内嵌的 data URL */
function readBackground(o: unknown): SkinBackground | undefined {
  if (!o || typeof o !== 'object') return undefined
  const b = o as Record<string, unknown>
  const image = typeof b.image === 'string' && b.image.startsWith('data:image/') ? b.image : ''
  if (!image) return undefined
  const fit = BACKGROUND_FITS.find((f) => f === b.fit) ?? DEFAULT_BACKGROUND.fit
  const position = POSITIONS.includes(String(b.position))
    ? (b.position as SkinBackground['position'])
    : DEFAULT_BACKGROUND.position
  return {
    image,
    width: Math.max(0, Math.round(num(b.width, 0))),
    height: Math.max(0, Math.round(num(b.height, 0))),
    fit,
    opacity: Math.min(1, Math.max(0, num(b.opacity, DEFAULT_BACKGROUND.opacity))),
    scale: Math.max(0.05, num(b.scale, 1)),
    blur: Math.max(0, num(b.blur, 0)),
    position
  }
}

/**
 * 导出成文件内容。下载镜像是本机的网络设置，不跟着走；
 * 背景图是一整张内嵌的图（几 MB），要不要带由调用方决定。
 */
export function exportSkinFile(
  skin: Skin,
  opts: { name: string; withBackground: boolean }
): string {
  const background = opts.withBackground ? readBackground(skin.background) : undefined
  const file: SkinFile = {
    [SKIN_FILE_MARK]: SKIN_FILE_VERSION,
    name: opts.name,
    skin: {
      preset: typeof skin.preset === 'string' ? skin.preset : 'custom',
      light: strMap(skin.light, (k) => VAR_NAMES.has(k)),
      dark: strMap(skin.dark, (k) => VAR_NAMES.has(k)),
      fonts: { ...EMPTY_FONTS, ...strMap(skin.fonts, (k) => SLOTS.includes(k as FontSlot)) },
      scriptFonts: strMap(skin.scriptFonts),
      ...(background ? { background } : {})
    }
  }
  return JSON.stringify(file, null, 2) + '\n'
}

/** 读一个皮肤文件：认不出记号或版本太新都不套用 */
export function parseSkinFile(text: string): SkinParse {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'format' }
  }
  if (!o || typeof o !== 'object') return { ok: false, reason: 'format' }
  const v = o[SKIN_FILE_MARK]
  if (typeof v !== 'number' || !(v >= 1)) return { ok: false, reason: 'format' }
  if (v > SKIN_FILE_VERSION) return { ok: false, reason: 'version' }
  const src = (o.skin ?? {}) as Record<string, unknown>
  const background = readBackground(src.background)
  return {
    ok: true,
    name: typeof o.name === 'string' ? o.name : '',
    hasBackground: !!background,
    skin: {
      preset: typeof src.preset === 'string' ? src.preset : 'custom',
      light: strMap(src.light, (k) => VAR_NAMES.has(k)),
      dark: strMap(src.dark, (k) => VAR_NAMES.has(k)),
      fonts: { ...EMPTY_FONTS, ...strMap(src.fonts, (k) => SLOTS.includes(k as FontSlot)) },
      scriptFonts: strMap(src.scriptFonts),
      ...(background ? { background } : {})
    }
  }
}
