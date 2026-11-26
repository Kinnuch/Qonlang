/** 短语的分类、计数与两处列表共用同一可见范围；目录按本层，工程根汇总。 */
import type { Id, Phrase } from './model'
import { matchQuery, parseQuery } from './query'
import { SEARCH_FIELDS } from './searchFields'

export function phraseFieldValues(phrase: Phrase, field: string | null): string[] {
  const translations = Object.values(phrase.translation)
  switch (field) {
    case 'text':
      return [phrase.text, ...phrase.variants.map((v) => v.text)]
    case 'tr':
      return translations
    case 'category':
      return [phrase.category]
    case 'tag':
      return phrase.tags
    case 'ipa':
      return Object.values(phrase.pronunciations).map((value) => value.ipa)
    default:
      return [phrase.text, ...translations]
  }
}
export interface PhrasebookView {
  /** 仅目录/语言，供原有范围编辑和无筛选状态使用。 */
  scoped: Phrase[]
  matching: Phrase[]
  categories: { name: string; count: number }[]
  list: Phrase[]
}
export function phrasebookView(
  phrases: readonly Phrase[],
  options: {
    languageId: Id | null
    folderId: Id
    root: boolean
    query: string
    category: string
    folderOf: (phrase: Phrase) => Id
  }
): PhrasebookView {
  const query = parseQuery(options.query, SEARCH_FIELDS.phrasebook)
  const scoped = phrases.filter(
    (phrase) =>
      (!options.languageId || phrase.languageId === options.languageId) &&
      (options.root || options.folderOf(phrase) === options.folderId)
  )
  const matching = query.terms.length
    ? scoped.filter((phrase) => matchQuery(query, (field) => phraseFieldValues(phrase, field)))
    : scoped
  const counts = new Map<string, number>()
  for (const phrase of matching)
    if (phrase.category) counts.set(phrase.category, (counts.get(phrase.category) ?? 0) + 1)
  return {
    scoped,
    matching,
    categories: [...counts]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, count]) => ({ name, count })),
    list: options.category
      ? matching.filter((phrase) => phrase.category === options.category)
      : matching
  }
}
