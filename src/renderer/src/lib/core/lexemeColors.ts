/** 词库标签与词类徽章的项目颜色；严格限制为不含CSS语法的十六进制值。 */
import type { Project } from './model'
export function normalizeBadgeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const color = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(color)) return color
  if (/^#[0-9a-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map((c) => c + c).join('')
  return undefined
}
export function badgeForeground(value: unknown): '#000000' | '#ffffff' {
  const color = normalizeBadgeColor(value)
  if (!color) return '#000000'
  const channels = [1, 3, 5].map((at) => {
    const v = parseInt(color.slice(at, at + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
}
export function badgeColorStyle(value: unknown): string {
  const color = normalizeBadgeColor(value)
  return color
    ? `background-color:${color};color:${badgeForeground(color)};border-color:${color};`
    : ''
}
export function lexiconTagColor(project: Project, tag: string): string | undefined {
  const colors = project.settings.lexiconTagColors
  return colors &&
    typeof colors === 'object' &&
    !Array.isArray(colors) &&
    Object.hasOwn(colors, tag)
    ? normalizeBadgeColor(colors[tag])
    : undefined
}
export function normalizeLexiconTagColors(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).flatMap(([tag, value]) => {
    const color = normalizeBadgeColor(value)
    return tag && color ? [[tag, color] as const] : []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}
export function setLexiconTagColor(
  project: Project,
  tag: string,
  value: string | undefined
): boolean {
  if (!tag) return false
  const color = normalizeBadgeColor(value)
  if (value !== undefined && !color) return false
  const colors = project.settings.lexiconTagColors
  if (
    color === lexiconTagColor(project, tag) &&
    !(color === undefined && colors && Object.hasOwn(colors, tag))
  )
    return false
  const next = { ...normalizeLexiconTagColors(colors), ...(color ? { [tag]: color } : {}) }
  if (!color) delete next[tag]
  if (Object.keys(next).length) project.settings.lexiconTagColors = next
  else delete project.settings.lexiconTagColors
  return true
}
/** 删除最后一次使用后才清理颜色；其他词、义项和语言仍用着的同名标签保留。 */
export function pruneLexiconTagColors(project: Project): boolean {
  if (!project.settings.lexiconTagColors) return false
  const used = new Set(
    project.lexemes.flatMap((word) => [...word.tags, ...word.senses.flatMap((sense) => sense.tags)])
  )
  let changed = false
  for (const tag of Object.keys(project.settings.lexiconTagColors))
    if (!used.has(tag)) changed = setLexiconTagColor(project, tag, undefined) || changed
  return changed
}
/** 局部重命名不改未选记录；合并到有颜色的标签时保留目标色。 */
export function followLexiconTagRename(project: Project, from: string, to: string): void {
  const color = lexiconTagColor(project, from)
  if (color && !lexiconTagColor(project, to)) setLexiconTagColor(project, to, color)
  pruneLexiconTagColors(project)
}
