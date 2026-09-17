/** 界面上的名字：种类允许用户自定义，翻译不到就原样显示。 */
import { t } from '$lib/i18n/index.svelte'
import { ETYMOLOGY_TYPES } from '$lib/core/model'
import { ui } from '$lib/state/ui.svelte'

/** 发音两边的符号：设置里选音位标注 /…/、音值标注 […]，或者什么都不加 */
export function pronText(ipa: string): string {
  const s = (ipa ?? '').trim()
  if (!s) return ''
  const mode = ui.prefs.pronBrackets
  return mode === 'none' ? s : mode === 'bracket' ? `[${s}]` : `/${s}/`
}

/**
 * 发音那一栏的名字：每套正字法按自己的转音标规则推出一个 IPA，叫「基于正字法的 IPA」；
 * 这门语言有几套正字法时后面带上正字法的名字
 */
export function orthoIpaLabel(orthoName: string, count: number): string {
  return count > 1 ? t('lexicon.orthoIpaOf', { name: orthoName }) : t('lexicon.orthoIpa')
}

/** 词源类别的显示名：内置类别翻译过来，用户自己写的（导入进来的 bor. from CS 这类）原样显示 */
export function etymologyTypeLabel(type: string): string {
  if (!type) return ''
  return (ETYMOLOGY_TYPES as readonly string[]).includes(type)
    ? t(`lexicon.etyTypes.${type}`)
    : type
}

/**
 * 关系种类的显示名：先查关系词表，再查词源类别（词源里挑了词条来源会用类别名建关系），
 * 都没有就原样显示。
 */
export function relationLabel(kind: string): string {
  if (!kind) return ''
  const rel = t(`lexicon.relKinds.${kind}`)
  if (rel !== `lexicon.relKinds.${kind}`) return rel
  const ety = t(`lexicon.etyTypes.${kind}`)
  if (ety !== `lexicon.etyTypes.${kind}`) return ety
  return kind
}
