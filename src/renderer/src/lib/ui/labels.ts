/** 界面上的名字：种类允许用户自定义，翻译不到就原样显示。 */
import { t } from '$lib/i18n/index.svelte'

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
