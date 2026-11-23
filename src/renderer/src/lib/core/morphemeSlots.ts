import type { Id, Lexeme, Morpheme, MorphemeSlot, Project } from './model'
import { canonicalG } from '$lib/ipa/equivalence'

export type MorphemeBindingIssue =
  'slot-missing' | 'unbound' | 'morpheme-missing' | 'wrong-language'
export type MorphemeBindingResult =
  | { slot: MorphemeSlot; morpheme: Morpheme; issue: null }
  | { slot: MorphemeSlot | null; morpheme: null; issue: MorphemeBindingIssue }

/** 只认显式 ID 绑定，缺少、已删除或跨语言的绑定都不能悄悄换成另一个语素。 */
export function boundMorpheme(project: Project, lexeme: Lexeme, slotId: Id): MorphemeBindingResult {
  const slot = project.morphemeSlots?.find((item) => item.id === slotId) ?? null
  if (!slot) return { slot, morpheme: null, issue: 'slot-missing' }
  const id = lexeme.morphemeBindings?.[slotId]
  if (!id) return { slot, morpheme: null, issue: 'unbound' }
  const morpheme = project.morphemes.find((item) => item.id === id)
  if (!morpheme) return { slot, morpheme: null, issue: 'morpheme-missing' }
  if (morpheme.languageId !== lexeme.languageId)
    return { slot, morpheme: null, issue: 'wrong-language' }
  return { slot, morpheme, issue: null }
}

/** 用户明确指定包含分隔符的前／后段，剩余部分才可作为命名词干；不修改原词头。 */
export function splitMorphemePart(
  lemma: string,
  part: string,
  side: 'prefix' | 'suffix'
): string | null {
  if (!part || part.length >= lemma.length) return null
  if (side === 'prefix')
    return canonicalG(lemma).startsWith(canonicalG(part)) ? lemma.slice(part.length) : null
  return canonicalG(lemma).endsWith(canonicalG(part))
    ? lemma.slice(0, lemma.length - part.length)
    : null
}
