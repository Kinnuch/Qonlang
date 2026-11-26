import type { Id, Lexeme, Morpheme, MorphemeSlot, Project } from './model'
import { canonicalG } from '$lib/ipa/equivalence'

export function slotUsage(project: Project, id: Id): { words: number; steps: number } {
  let steps = 0
  for (const paradigm of project.paradigms)
    for (const generator of Object.values(paradigm.generators)) {
      if (generator.kind === 'pipeline')
        for (const step of generator.steps)
          if ((step.kind === 'prefix' || step.kind === 'suffix') && step.morphemeSlot === id)
            steps++
    }
  return {
    words: project.lexemes.filter((l) => Object.hasOwn(l.morphemeBindings ?? {}, id)).length,
    steps
  }
}

export interface RemovedMorphemeSlot {
  slot: MorphemeSlot
  index: number
  bindings: { word: Id; morpheme: Id }[]
}

/** 保留构形步骤原来的槽 ID，以便提示重新选槽、或在撤销时恢复同一引用。 */
export function detachMorphemeSlot(project: Project, id: Id): RemovedMorphemeSlot | null {
  const index = project.morphemeSlots?.findIndex((s) => s.id === id) ?? -1
  if (index < 0 || !project.morphemeSlots || project.meta.readOnly) return null
  const slot = { ...project.morphemeSlots[index] },
    bindings: RemovedMorphemeSlot['bindings'] = []
  project.morphemeSlots.splice(index, 1)
  for (const l of project.lexemes) {
    if (!l.morphemeBindings || !Object.hasOwn(l.morphemeBindings, id)) continue
    bindings.push({ word: l.id, morpheme: l.morphemeBindings[id] })
    const remaining = { ...l.morphemeBindings }
    delete remaining[id]
    if (Object.keys(remaining).length) l.morphemeBindings = remaining
    else delete l.morphemeBindings
  }
  return { slot, index, bindings }
}
export function restoreMorphemeSlot(project: Project, removed: RemovedMorphemeSlot): boolean {
  const slots = project.morphemeSlots ?? []
  if (project.meta.readOnly || slots.some((s) => s.id === removed.slot.id)) return false
  const names = new Set(slots.map((s) => s.name.toLocaleLowerCase()))
  let name = removed.slot.name,
    suffix = 2
  while (names.has(name.toLocaleLowerCase())) {
    name = removed.slot.name + ' (' + suffix + ')'
    suffix++
  }
  const restored = [...slots]
  restored.splice(Math.min(removed.index, restored.length), 0, { ...removed.slot, name })
  project.morphemeSlots = restored
  const words = new Map(project.lexemes.map((w) => [w.id, w])),
    morphemes = new Map(project.morphemes.map((m) => [m.id, m]))
  for (const binding of removed.bindings) {
    const w = words.get(binding.word),
      m = morphemes.get(binding.morpheme)
    if (
      w &&
      m?.languageId === w.languageId &&
      typeof w.morphemeBindings?.[removed.slot.id] !== 'string'
    )
      w.morphemeBindings = { ...w.morphemeBindings, [removed.slot.id]: binding.morpheme }
  }
  return true
}

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
