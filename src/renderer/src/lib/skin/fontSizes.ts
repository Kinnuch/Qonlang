import type { FontSlot, Skin } from './presets'

export const FONT_SIZE_MIN = 50
export const FONT_SIZE_MAX = 200
export const FONT_SIZE_STEP = 5
export const FONT_SIZE_SLOTS: FontSlot[] = [
  'ui',
  'data',
  'mono',
  'corpusText',
  'corpusTr',
  'gloss',
  'script'
]
export const FONT_SCALE_VARS: Record<FontSlot, string> = {
  ui: '--font-scale-ui',
  data: '--font-scale-data',
  mono: '--font-scale-mono',
  corpusText: '--font-scale-corpus-text',
  corpusTr: '--font-scale-corpus-tr',
  gloss: '--font-scale-gloss',
  script: '--font-scale-script'
}
const PARENT: Partial<Record<FontSlot, FontSlot>> = {
  corpusText: 'data',
  corpusTr: 'ui',
  gloss: 'mono',
  script: 'data'
}

/** 留空表示继承；显式 100% 也要保留，以便覆盖父角色的大小。 */
export function validFontSize(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= FONT_SIZE_MIN &&
    value <= FONT_SIZE_MAX
    ? Math.round(value / FONT_SIZE_STEP) * FONT_SIZE_STEP
    : undefined
}
export function fontSizeMap(value: unknown, slotsOnly = false): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      const size = validFontSize(raw)
      return size !== undefined && key && (!slotsOnly || FONT_SIZE_SLOTS.includes(key as FontSlot))
        ? [[key, size]]
        : []
    })
  )
}
export function fontSize(skin: Pick<Skin, 'fontSizes'>, slot: FontSlot): number {
  return (
    validFontSize(skin.fontSizes?.[slot]) ?? (PARENT[slot] ? fontSize(skin, PARENT[slot]!) : 100)
  )
}
export function scriptFontSize(
  skin: Pick<Skin, 'fontSizes' | 'scriptFontSizes'>,
  id: string
): number {
  return validFontSize(skin.scriptFontSizes?.[id]) ?? fontSize(skin, 'script')
}
/** 文字 id 可含任意字符，变量名只用码位，避免互相覆盖。 */
export const scriptFontScaleVar = (id: string): string =>
  '--font-scale-script-' +
  Array.from(id)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join('-')
