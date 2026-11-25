import type { Id, MorphemeType, Project } from './model'
import { looseKey, morphemeLabel } from './etymology'
import { makeCollator } from './collate'
import { canonicalG } from '$lib/ipa/equivalence'

export interface ReferenceOption {
  id: Id
  label: string
  languageId: Id
  note: string
  kind: string
  fields: string[]
}
interface SearchOptions {
  kind: 'lexeme' | 'morpheme'
  skip?: Id
  languageId?: Id
  localOnly?: boolean
  type?: MorphemeType | ''
  glossLangs: string[]
  typeName: (type: MorphemeType) => string
}
export function referenceOptions(project: Project, opts: SearchOptions): ReferenceOption[] {
  const accepts = (r: { id: Id; languageId: Id }): boolean =>
    r.id !== opts.skip && (!opts.localOnly || r.languageId === opts.languageId)
  const preferred = (values: Record<string, string> | undefined): string =>
    values
      ? opts.glossLangs.map((k) => values[k]).find(Boolean) ||
        Object.values(values).find(Boolean) ||
        ''
      : ''
  if (opts.kind === 'lexeme')
    return project.lexemes.filter(accepts).map((l) => ({
      id: l.id,
      label: l.lemma,
      languageId: l.languageId,
      note: preferred(l.senses[0]?.definition),
      kind: '',
      fields: l.senses.flatMap((se) => Object.values(se.definition)).filter(Boolean)
    }))
  return project.morphemes
    .filter((m) => accepts(m) && (!opts.type || m.type === opts.type))
    .map((m) => {
      const kind = opts.typeName(m.type)
      return {
        id: m.id,
        label: morphemeLabel(m),
        languageId: m.languageId,
        note: m.gloss || preferred(m.meaning),
        kind,
        fields: [m.form, m.form2, m.gloss, kind, ...m.tags, ...Object.values(m.meaning)].filter(
          Boolean
        )
      }
    })
}
export function rankReferences(
  project: Project,
  options: ReferenceOption[],
  query: string,
  languageId: Id,
  limit = 40
): ReferenceOption[] {
  const norm = (s: string): string => canonicalG(s.normalize('NFC').toLowerCase()).trim()
  const q = norm(query),
    languages = new Map(project.languages.map((l) => [l.id, l]))
  const compare = makeCollator(languages.get(languageId)?.alphabet ?? [])
  const looseQueries = new Map<string, string>()
  const hits: { option: ReferenceOption; rank: number }[] = []
  for (const option of options) {
    const label = norm(option.label)
    let rank = 0
    if (q && label !== q) {
      const loose = languages.get(option.languageId)?.matchIgnore ?? ''
      if (!looseQueries.has(loose)) looseQueries.set(loose, looseKey(q, loose))
      const folded = looseQueries.get(loose)!,
        target = looseKey(label, loose)
      if (folded && target === folded) rank = 1
      else if (label.startsWith(q)) rank = 2
      else if (label.includes(q) || (folded && target.includes(folded))) rank = 3
      else if (option.fields.some((f) => norm(f) === q)) rank = 4
      else if (option.fields.some((f) => norm(f).includes(q))) rank = 5
      else continue
    }
    hits.push({ option, rank })
  }
  return hits
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        compare(a.option.label, b.option.label) ||
        Number(b.option.languageId === languageId) - Number(a.option.languageId === languageId)
    )
    .slice(0, limit)
    .map((h) => h.option)
}
