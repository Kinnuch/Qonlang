import type { Language, Lexeme, Project, EtymologySource, EtymologyStage } from '$lib/core/model'
import type { FieldSpec } from './csvImport'
import { now } from '$lib/core/factory'
import { transcribe } from '$lib/core/pronounce'
import { lexemeStress } from '$lib/core/stressInfo'

/** 相同来源按身份更新；同一组合里明确重复的来源保留其出现次数。 */
export function mergeImportedSources(
  existing: EtymologySource[],
  incoming: EtymologySource[]
): EtymologySource[] {
  const key = (source: EtymologySource): string =>
    source.kind === 'external'
      ? `external\0${source.language}\0${source.form}`
      : `${source.kind}\0${source.id}`
  const result = [...existing],
    positions = new Map<string, number[]>(),
    used = new Map<string, number>()
  existing.forEach((source, index) => {
    const identity = key(source),
      list = positions.get(identity) ?? []
    list.push(index)
    positions.set(identity, list)
  })
  for (const source of incoming) {
    const identity = key(source),
      occurrence = used.get(identity) ?? 0,
      index = positions.get(identity)?.[occurrence]
    used.set(identity, occurrence + 1)
    if (index !== undefined) result[index] = { ...result[index], ...source } as EtymologySource
    else result.push(source)
  }
  return result
}
function mergeImportedStages(
  existing: EtymologyStage[],
  incoming: EtymologyStage[],
  fromOwner: string,
  toOwner: string
): EtymologyStage[] {
  const result = [...existing],
    used = new Set<string>()
  for (const stage of incoming) {
    const prefix = `csv-stage:${fromOwner}:`,
      id = stage.id.startsWith(prefix)
        ? `csv-stage:${toOwner}:${stage.id.slice(prefix.length)}`
        : stage.id
    let match = result.find((item) => item.id === id)
    if (!match) {
      const byLabel = result.filter(
        (item) => !used.has(item.id) && !!stage.notes && item.notes === stage.notes
      )
      if (byLabel.length === 1) match = byLabel[0]
    }
    if (!match) {
      const exact = result.filter(
        (item) => !used.has(item.id) && item.form === stage.form && item.notes === stage.notes
      )
      if (exact.length === 1) match = exact[0]
    }
    if (!match && !stage.notes) {
      const plain = result.filter(
        (item) => !used.has(item.id) && !item.notes && !item.id.startsWith('csv-stage:')
      )
      if (plain.length === 1) match = plain[0]
    }
    if (match) {
      used.add(match.id)
      result[result.indexOf(match)] = { ...match, form: stage.form, notes: stage.notes }
    } else {
      result.push({ ...stage, id })
      used.add(id)
    }
  }
  return result
}

/** 只覆盖本行提供的非空字段；不替换id，未提供的数据与入边都继续有效。 */
export function mergeImportedLexeme(
  existing: Lexeme,
  incoming: Lexeme,
  fields: FieldSpec[]
): Lexeme {
  const result = JSON.parse(JSON.stringify(existing)) as Lexeme
  const kinds = new Set(fields.map((field) => field.kind))
  if (incoming.posId) result.posId = incoming.posId
  result.features = { ...result.features, ...incoming.features }
  result.stems = { ...result.stems, ...incoming.stems }
  result.forms = { ...result.forms, ...incoming.forms }
  result.pronunciations = { ...result.pronunciations, ...incoming.pronunciations }
  result.scriptForms = { ...result.scriptForms, ...incoming.scriptForms }
  if (incoming.custom) result.custom = { ...result.custom, ...incoming.custom }
  if (kinds.has('tags') && incoming.tags.length) result.tags = [...incoming.tags]
  else result.tags = [...new Set([...result.tags, ...incoming.tags])]
  if (kinds.has('dialects') && incoming.dialectIds.length)
    result.dialectIds = [...incoming.dialectIds]
  if (incoming.notes) result.notes = incoming.notes
  if (incoming.stress) result.stress = incoming.stress
  if (incoming.paradigmId) result.paradigmId = incoming.paradigmId
  if (incoming.paradigmVariantId !== undefined)
    result.paradigmVariantId = incoming.paradigmVariantId
  if (kinds.has('etymologyType')) result.etymology.type = incoming.etymology.type
  if (kinds.has('etymologyNotes') && incoming.etymology.notes)
    result.etymology.notes = incoming.etymology.notes
  result.etymology.sources = mergeImportedSources(
    result.etymology.sources,
    incoming.etymology.sources
  )
  result.etymology.stages = mergeImportedStages(
    result.etymology.stages,
    incoming.etymology.stages,
    incoming.id,
    existing.id
  )
  for (let i = 0; i < incoming.senses.length; i++) {
    const imported = incoming.senses[i]
    if (!result.senses[i]) {
      result.senses.push(imported)
      continue
    }
    const sense = result.senses[i]
    Object.assign(sense.definition, imported.definition)
    if (imported.posId) sense.posId = imported.posId
    if (kinds.has('senseTags') && imported.tags.length) sense.tags = [...imported.tags]
    else sense.tags = [...new Set([...sense.tags, ...imported.tags])]
    if (kinds.has('register') && imported.registers.length)
      sense.registers = [...imported.registers]
    else sense.registers = [...new Set([...sense.registers, ...imported.registers])]
  }
  result.updatedAt = now()
  return result
}

/** 有IPA列只处理指定正字法；没有IPA列时只处理主正字法，其他读音不动。 */
export function automaticImportedIpa(
  project: Project,
  language: Language | undefined,
  lexeme: Lexeme,
  fields: FieldSpec[]
): void {
  if (!language) return
  const columns = fields.filter(
    (field): field is Extract<FieldSpec, { kind: 'pronunciation' }> =>
      field.kind === 'pronunciation'
  )
  const primary =
    language.orthographies.find((ortho) => ortho.isPrimary) ?? language.orthographies[0]
  const orthographies = columns.length
    ? columns.flatMap((field) => {
        const name = field.orthography?.trim()
        const ortho = name
          ? language.orthographies.find(
              (item) => item.id === name || item.name.trim().toLowerCase() === name.toLowerCase()
            )
          : primary
        return ortho ? [ortho] : []
      })
    : primary
      ? [primary]
      : []
  const stress = lexemeStress(project, lexeme)
  for (const ortho of new Map(orthographies.map((item) => [item.id, item])).values()) {
    const before = lexeme.pronunciations[ortho.id]
    const generated = transcribe(language, ortho, lexeme.lemma, stress)
    lexeme.pronunciations[ortho.id] = { ipa: generated ?? before?.ipa ?? '', irregular: false }
  }
}
