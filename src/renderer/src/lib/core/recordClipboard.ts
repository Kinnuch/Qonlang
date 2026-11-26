/** 词条与语素的整条记录剪贴板。剪切只登记意图，成功粘贴才改变所属语言。 */
import type { Id, Lexeme, Morpheme, Project } from './model'
import { newId, now } from './factory'

export type RecordClipboardKind = 'lexeme' | 'morpheme'
export interface RecordClipboard {
  format: 'qonlang-records'
  version: 1
  id: string
  mode: 'copy' | 'cut'
  projectId: Id
  kind: RecordClipboardKind
  createdAt: number
  records: (Lexeme | Morpheme)[]
}
export type RecordPasteResult =
  | { ok: true; ids: Id[]; mode: 'copy' | 'cut' }
  | {
      ok: false
      reason:
        | 'readonly'
        | 'invalid-source'
        | 'cross-project'
        | 'invalid-target'
        | 'stale'
        | 'expired'
        | 'consumed'
    }
const cuts = new Map<string, { project: Project; source: string; kind: RecordClipboardKind }>()
const consumed = new Set<string>()
const copies = new Map<
  string,
  { project: Project; kind: RecordClipboardKind; records: (Lexeme | Morpheme)[] }
>()
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const collection = (p: Project, kind: RecordClipboardKind): (Lexeme | Morpheme)[] =>
  kind === 'lexeme' ? p.lexemes : p.morphemes
function canChangeLanguage(row: Lexeme | Morpheme): boolean {
  if (row.stageId) return false
  if ('lemma' in row)
    return (
      !Object.keys(row.pronunciations).length &&
      !Object.keys(row.scriptForms).length &&
      !row.dialectIds.length &&
      !row.senses.some((s) => s.dialectIds.length) &&
      !Object.keys(row.morphemeBindings ?? {}).length &&
      !Object.keys(row.forms).length &&
      !row.paradigmId &&
      !row.extraParadigms?.length
    )
  return true
}

export function createRecordClipboard(
  project: Project,
  kind: RecordClipboardKind,
  ids: readonly Id[],
  mode: 'copy' | 'cut',
  clock = Date.now()
): RecordClipboard | null {
  if (project.meta.readOnly) return null
  const wanted = new Set(ids),
    records = collection(project, kind).filter((r) => wanted.has(r.id))
  if (!records.length) return null
  cuts.clear()
  copies.clear()
  const payload: RecordClipboard = {
    format: 'qonlang-records',
    version: 1,
    id: newId(),
    mode,
    projectId: project.meta.id,
    kind,
    createdAt: clock,
    records: clone(records)
  }
  if (mode === 'cut') cuts.set(payload.id, { project, kind, source: JSON.stringify(records) })
  else copies.set(payload.id, { project, kind, records: clone(records) })
  return payload
}

export function isRecordClipboard(value: unknown): value is RecordClipboard {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<RecordClipboard>
  return (
    v.format === 'qonlang-records' &&
    v.version === 1 &&
    typeof v.id === 'string' &&
    typeof v.projectId === 'string' &&
    (v.kind === 'lexeme' || v.kind === 'morpheme') &&
    (v.mode === 'copy' || v.mode === 'cut') &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt) &&
    Array.isArray(v.records) &&
    v.records.length > 0 &&
    v.records.length <= 50000 &&
    v.records.every(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        typeof r.languageId === 'string' &&
        typeof (v.kind === 'lexeme' ? (r as Lexeme).lemma : (r as Morpheme).form) === 'string'
    )
  )
}

/** 跨工程缺少依赖映射时拒绝，不能把碰巧相同的义项、正字法或语素 ID 当成目标。 */
export function pasteRecordClipboard(
  project: Project,
  payload: unknown,
  targetLanguageId: Id | null,
  makeId: () => Id = newId,
  clock = Date.now()
): RecordPasteResult {
  if (project.meta.readOnly) return { ok: false, reason: 'readonly' }
  if (!isRecordClipboard(payload)) return { ok: false, reason: 'invalid-source' }
  if (project.meta.id !== payload.projectId) return { ok: false, reason: 'cross-project' }
  if (
    (payload.mode === 'cut' && clock - payload.createdAt > 30 * 60 * 1000) ||
    clock < payload.createdAt - 60000
  )
    return { ok: false, reason: 'expired' }
  if (targetLanguageId && !project.languages.some((l) => l.id === targetLanguageId))
    return { ok: false, reason: 'invalid-target' }
  const rows = collection(project, payload.kind),
    ids = new Set(payload.records.map((r) => r.id))
  if (ids.size !== payload.records.length) return { ok: false, reason: 'invalid-source' }
  const current = rows.filter((r) => ids.has(r.id))
  const stored = copies.get(payload.id)
  if (
    payload.mode === 'copy' &&
    (!stored ||
      stored.project !== project ||
      stored.kind !== payload.kind ||
      stored.records.length !== ids.size ||
      stored.records.some((r) => !ids.has(r.id)))
  )
    return { ok: false, reason: 'stale' }
  const source = payload.mode === 'copy' && stored?.project === project ? stored.records : current
  if (source.length !== ids.size) return { ok: false, reason: 'stale' }
  if (
    targetLanguageId &&
    source.some(
      (row) =>
        row.languageId !== targetLanguageId &&
        'custom' in row &&
        Object.keys(row.custom ?? {}).some((id) => {
          const field = project.customFields.find((f) => f.id === id)
          return field?.languageIds.length && !field.languageIds.includes(targetLanguageId)
        })
    )
  )
    return { ok: false, reason: 'invalid-target' }
  if (payload.mode === 'cut') {
    if (consumed.has(payload.id)) return { ok: false, reason: 'consumed' }
    const cut = cuts.get(payload.id)
    if (
      !cut ||
      cut.project !== project ||
      cut.kind !== payload.kind ||
      cut.source !== JSON.stringify(current)
    )
      return { ok: false, reason: 'stale' }
    if (targetLanguageId && source.some((r) => r.languageId !== targetLanguageId)) {
      if (
        payload.kind === 'morpheme' &&
        project.lexemes.some((l) =>
          Object.values(l.morphemeBindings ?? {}).some((id) => ids.has(id))
        )
      )
        return { ok: false, reason: 'invalid-target' }
      if (
        project.sentences.some((s) =>
          s.tokens.some((token) =>
            token.analyses.some((a) =>
              payload.kind === 'lexeme'
                ? (!!a.lexemeId && ids.has(a.lexemeId)) ||
                  a.morphs.some((m) => !!m.lexemeId && ids.has(m.lexemeId))
                : a.morphs.some((m) => !!m.morphemeId && ids.has(m.morphemeId))
            )
          )
        )
      )
        return { ok: false, reason: 'invalid-target' }
    }
    // 语言专属字段没有映射时不猜测；跨语言操作由调用方显式确认后启用。
    if (
      targetLanguageId &&
      source.some((r) => r.languageId !== targetLanguageId && !canChangeLanguage(r))
    )
      return { ok: false, reason: 'invalid-target' }
    if (targetLanguageId) for (const row of source) row.languageId = targetLanguageId
    consumed.add(payload.id)
    cuts.delete(payload.id)
    return { ok: true, ids: source.map((r) => r.id), mode: 'cut' }
  }
  if (
    targetLanguageId &&
    source.some((r) => r.languageId !== targetLanguageId && !canChangeLanguage(r))
  )
    return { ok: false, reason: 'invalid-target' }
  // 使用本会话登记的可信副本，不把任意系统文本或另一个工程的内容注入模型。
  const existing = new Set<string>()
  for (const r of [...project.lexemes, ...project.morphemes]) {
    existing.add(r.id)
    if ('senses' in r) {
      for (const s of r.senses) existing.add(s.id)
      for (const image of r.images) existing.add(image.id)
    }
    for (const s of r.etymology.stages) existing.add(s.id)
  }
  const fresh = (): Id => {
    for (let tries = 0; tries < 100; tries++) {
      const id = makeId()
      if (id && !existing.has(id)) {
        existing.add(id)
        return id
      }
    }
    throw new Error('Invalid clipboard ID generator')
  }
  const map = new Map(source.map((r) => [r.id, fresh()]))
  const copied = source.map((r) => {
    const row = clone(r)
    row.id = map.get(r.id)!
    if (targetLanguageId) row.languageId = targetLanguageId
    row.etymology.stages = row.etymology.stages.map((s) => ({ ...s, id: fresh() }))
    row.etymology.sources = row.etymology.sources.map((s) =>
      s.kind === payload.kind && map.has(s.id) ? { ...s, id: map.get(s.id)! } : s
    )
    if (payload.kind === 'lexeme') {
      const l = row as Lexeme
      l.senses = l.senses.map((s) => ({ ...s, id: fresh() }))
      l.images = l.images.map((i) => ({ ...i, id: fresh() }))
      l.relations = l.relations.map((s) => ({ ...s, lexemeId: map.get(s.lexemeId) ?? s.lexemeId }))
      l.createdAt = l.updatedAt = now()
    }
    return row
  })
  if (payload.kind === 'lexeme') project.lexemes.push(...(copied as Lexeme[]))
  else project.morphemes.push(...(copied as Morpheme[]))
  return { ok: true, ids: copied.map((r) => r.id), mode: 'copy' }
}
