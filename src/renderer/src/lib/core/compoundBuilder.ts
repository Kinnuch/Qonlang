/** 复合词的显式来源与有界分解建议；不推测词类、释义或自动接受同形候选。 */
import type { Id, Lexeme, LocalizedText, Morpheme, Project } from './model'
import { createLexeme } from './factory'
import { canonicalG } from '$lib/ipa/equivalence'
export interface CompoundRef {
  kind: 'lexeme' | 'morpheme'
  id: Id
}
interface IndexedPart {
  ref: CompoundRef
  form: string
}
export type CompoundSourceRecord =
  { kind: 'lexeme'; record: Lexeme } | { kind: 'morpheme'; record: Morpheme }
export interface CompoundIndex {
  languageId: Id
  byForm: ReadonlyMap<string, readonly IndexedPart[]>
  records: ReadonlyMap<string, CompoundSourceRecord>
  separators: readonly string[]
  limited: boolean
}
export interface CompoundCombination {
  parts: CompoundRef[]
  forms: string[]
  separators: string[]
}
const keyOf = (text: string): string => canonicalG(text.normalize('NFC').toLowerCase()).trim()
export function prepareCompoundIndex(
  project: Project,
  languageId: Id,
  options: { excludeId?: Id } = {}
): CompoundIndex {
  const byForm = new Map<string, IndexedPart[]>(),
    records = new Map<string, CompoundSourceRecord>(),
    seen = new Set<string>()
  function add(source: CompoundSourceRecord, form: string): void {
    const { kind, record } = source,
      id = record.id
    if (id === options.excludeId) return
    const key = keyOf(form),
      identity = JSON.stringify([kind, id, key])
    if (!key || seen.has(identity)) return
    seen.add(identity)
    records.set(kind + ':' + id, source)
    const bucket = byForm.get(key) ?? []
    bucket.push({ ref: { kind, id }, form: form.trim() })
    byForm.set(key, bucket)
  }
  for (const word of project.lexemes)
    if (word.languageId === languageId && word.id !== options.excludeId)
      add({ kind: 'lexeme', record: word }, word.lemma)
  for (const morpheme of project.morphemes)
    if (
      morpheme.languageId === languageId &&
      morpheme.id !== options.excludeId &&
      !(morpheme.type === 'circumfix' && morpheme.form2)
    )
      add({ kind: 'morpheme', record: morpheme }, morpheme.form.replace(/^-+|-+$/g, ''))
  const all = [
    ...new Set(
      [...project.settings.morphemeBoundaries, '+', ' ', '·', '-']
        .filter((separator) => typeof separator === 'string')
        .map((separator) => canonicalG(separator.normalize('NFC').toLowerCase()))
        .filter(Boolean)
    )
  ]
  return {
    languageId,
    byForm,
    records,
    separators: all.slice(0, 32).sort((a, b) => b.length - a.length),
    limited: all.length > 32
  }
}
/** 位置DP只判断剩余片段是否可达，同形记录直到结果投影时才展开，避免词库的平方组合。 */
export function findCompoundCombinations(
  index: CompoundIndex,
  form: string,
  { limit = 40 }: { limit?: number } = {}
): { combinations: CompoundCombination[]; truncated: boolean } {
  const target = keyOf(form),
    budget = Math.max(0, Math.min(100, Math.floor(limit)))
  let limited = index.limited,
    probes = 0
  if (!target || !budget) return { combinations: [], truncated: limited }
  if (target.length > 512) return { combinations: [], truncated: true }
  interface Edge {
    parts: readonly IndexedPart[]
    next: number
    separator: string
  }
  const edgesCache = new Map<number, Edge[]>(),
    reachable = new Map<string, boolean>()
  const permit = (): boolean => {
    if (++probes <= 100000) return true
    limited = true
    return false
  }
  function edges(at: number): Edge[] {
    const cached = edgesCache.get(at)
    if (cached) return cached
    const found: Edge[] = []
    edgesCache.set(at, found)
    for (let end = at + 1; end < target.length; end++) {
      const code = target.charCodeAt(end)
      if (code >= 0xdc00 && code <= 0xdfff) continue
      if (!permit()) break
      const parts = index.byForm.get(target.slice(at, end))
      if (!parts) continue
      const ends = [end]
      let next = end
      for (let step = 0; step < 32; step++) {
        const separator = index.separators.find((separator) => target.startsWith(separator, next))
        if (!separator) break
        next += separator.length
        ends.push(next)
      }
      if (
        ends.length === 33 &&
        index.separators.some((separator) => target.startsWith(separator, next))
      )
        limited = true
      for (const next of ends)
        if (next < target.length) found.push({ parts, next, separator: target.slice(end, next) })
    }
    return found
  }
  function canFinish(at: number, remaining: number): boolean {
    const key = at + '/' + remaining,
      cached = reachable.get(key)
    if (cached !== undefined) return cached
    const result =
      remaining === 1
        ? permit() && index.byForm.has(target.slice(at))
        : edges(at).some((edge) => canFinish(edge.next, remaining - 1))
    reachable.set(key, result)
    return result
  }
  function collect(count: number): CompoundCombination[] {
    const found: CompoundCombination[] = [],
      seen = new Set<string>()
    function walk(
      at: number,
      remaining: number,
      parts: CompoundRef[],
      forms: string[],
      separators: string[]
    ): void {
      if (found.length > budget) return
      if (remaining === 1) {
        for (const part of index.byForm.get(target.slice(at)) ?? []) {
          const refs = [...parts, { ...part.ref }],
            identity = JSON.stringify([refs, separators])
          if (seen.has(identity)) continue
          seen.add(identity)
          found.push({ parts: refs, forms: [...forms, part.form], separators: [...separators] })
          if (found.length > budget) return
        }
        return
      }
      for (const edge of edges(at)) {
        if (!canFinish(edge.next, remaining - 1)) continue
        for (const part of edge.parts) {
          walk(
            edge.next,
            remaining - 1,
            [...parts, { ...part.ref }],
            [...forms, part.form],
            [...separators, edge.separator]
          )
          if (found.length > budget) return
        }
      }
    }
    if (canFinish(0, count)) walk(0, count, [], [], [])
    return found
  }
  const two = collect(2),
    three = collect(3),
    reserved = three.length ? Math.min(three.length, Math.max(1, Math.floor(budget / 3))) : 0
  const twoCount = Math.min(two.length, budget - reserved),
    threeCount = Math.min(three.length, budget - twoCount)
  return {
    combinations: [...two.slice(0, twoCount), ...three.slice(0, threeCount)],
    truncated: limited || two.length > twoCount || three.length > threeCount
  }
}
/** 应用前重新核对当前工程中的引用，不能把旧候选套到另一个语言或自身。 */
export function compoundSourcesValid(
  project: Project,
  languageId: Id,
  parts: readonly CompoundRef[],
  excludeId?: Id
): boolean {
  return (
    parts.length >= 2 &&
    parts.length <= 3 &&
    parts.every((ref) => {
      if (ref.id === excludeId || !['lexeme', 'morpheme'].includes(ref.kind)) return false
      const record =
        ref.kind === 'lexeme'
          ? project.lexemes.find((word) => word.id === ref.id)
          : project.morphemes.find((morpheme) => morpheme.id === ref.id)
      return !!record && record.languageId === languageId
    })
  )
}
export interface CompoundEntryInput {
  languageId: Id
  firstId: Id
  secondId: Id
  lemma: string
  posId?: Id | null
  definitions?: LocalizedText
}
/** 只构造草稿，来源已足够生成反向关系；不另外写可悬挂的手工relations。 */
export function createCompoundLexeme(project: Project, input: CompoundEntryInput): Lexeme | null {
  if (
    project.meta.readOnly ||
    !input.lemma.trim() ||
    !project.languages.some((lang) => lang.id === input.languageId)
  )
    return null
  const first = project.lexemes.find((word) => word.id === input.firstId),
    second = project.lexemes.find((word) => word.id === input.secondId)
  if (
    !first ||
    !second ||
    !first.lemma.trim() ||
    !second.lemma.trim() ||
    first.languageId !== input.languageId ||
    second.languageId !== input.languageId
  )
    return null
  if (input.posId && !project.posList.some((pos) => pos.id === input.posId)) return null
  const word = createLexeme(input.languageId, input.lemma.trim())
  word.posId = input.posId ?? null
  word.senses[0].definition = Object.fromEntries(
    Object.entries(input.definitions ?? {})
      .filter((entry) => typeof entry[1] === 'string')
      .map(([lang, text]) => [lang, text.trim()])
      .filter(([, text]) => !!text)
  )
  word.etymology = {
    type: 'compound',
    sources: [
      { kind: 'lexeme', id: first.id },
      { kind: 'lexeme', id: second.id }
    ],
    stages: [],
    notes: ''
  }
  return word
}
