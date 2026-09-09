/**
 * 整库演化：把源语言的全部词条用规则集推到目标语言，建立词源链接。
 * 先 plan 出预览，再 apply 写入；已由同一源词生成的目标词按需更新而不是重复建。
 */
import type { Id, Lexeme, Morpheme, Project, RuleSet } from '$lib/core/model'
import { createLexeme, now } from '$lib/core/factory'
import { runRules, type RuleProgram } from '$lib/engine/sca'

export interface EvolveOptions {
  ruleSet: RuleSet
  program: RuleProgram
  sourceLanguageId: Id
  targetLanguageId: Id
  /** 输入已是该阶段的形式（空 = 从头） */
  startAt?: string
  /** 推到该阶段为止（空 = 到底） */
  stopAt?: string
  /** 输入来源：词条的词头、某个词干槽，或源语言的语素表（词根） */
  inputField?: { kind: 'lemma' } | { kind: 'stem'; name: string } | { kind: 'morpheme' }
  /** 只处理这些词类（空 = 全部） */
  posIds?: Id[]
}

export interface EvolveRow {
  source: Lexeme | Morpheme
  sourceKind: 'lexeme' | 'morpheme'
  input: string
  output: string
  /** 目标语言里已由该源词派生出的词条 */
  existing: Lexeme | null
  /** 目标语言里词头恰好相同但没有词源链接的词条 */
  collision: Lexeme | null
  action: 'create' | 'update' | 'same' | 'skip'
}

function inputOf(l: Lexeme, field: EvolveOptions['inputField']): string {
  if (!field || field.kind !== 'stem') return l.lemma
  return l.stems[field.name] ?? ''
}

export function planEvolution(project: Project, o: EvolveOptions): EvolveRow[] {
  const targets = project.lexemes.filter((l) => l.languageId === o.targetLanguageId)
  const bySource = new Map<Id, Lexeme>()
  for (const t of targets)
    for (const s of t.etymology.sources)
      if (s.kind === 'lexeme' || s.kind === 'morpheme') bySource.set(s.id, t)
  const byLemma = new Map<string, Lexeme>()
  for (const t of targets) if (!byLemma.has(t.lemma)) byLemma.set(t.lemma, t)
  const rows: EvolveRow[] = []
  const morphemeMode = o.inputField?.kind === 'morpheme'
  const sources: (Lexeme | Morpheme)[] = morphemeMode
    ? project.morphemes.filter((m) => m.languageId === o.sourceLanguageId)
    : project.lexemes.filter((l) => l.languageId === o.sourceLanguageId)
  for (const l of sources) {
    if (
      !morphemeMode &&
      o.posIds?.length &&
      (!(l as Lexeme).posId || !o.posIds.includes((l as Lexeme).posId!))
    )
      continue
    const input = morphemeMode ? (l as Morpheme).form : inputOf(l as Lexeme, o.inputField)
    if (!input.trim()) continue
    let output = ''
    try {
      output = runRules(o.program, input, {
        startAt: o.startAt || undefined,
        stopAt: o.stopAt || undefined,
        trace: false
      }).output
    } catch {
      output = ''
    }
    const existing = bySource.get(l.id) ?? null
    const collision = !existing ? (byLemma.get(output) ?? null) : null
    let action: EvolveRow['action'] = 'create'
    if (!output) action = 'skip'
    else if (existing) action = existing.lemma === output ? 'same' : 'update'
    else if (collision) action = 'skip'
    rows.push({
      source: l,
      sourceKind: morphemeMode ? 'morpheme' : 'lexeme',
      input,
      output,
      existing,
      collision,
      action
    })
  }
  return rows
}

export interface ApplyOptions {
  /** 复制义项与标签到新词 */
  copySenses: boolean
  /** 更新已派生词的词头（否则只新建） */
  updateExisting: boolean
  /** 有词头冲突时也新建（否则跳过） */
  createOnCollision: boolean
}

export function applyEvolution(
  project: Project,
  rows: EvolveRow[],
  o: EvolveOptions,
  a: ApplyOptions
): { created: number; updated: number; skipped: number } {
  let created = 0
  let updated = 0
  let skipped = 0
  const stamp = now()
  for (const r of rows) {
    if (!r.output) {
      skipped++
      continue
    }
    if (r.existing) {
      if (a.updateExisting && r.existing.lemma !== r.output) {
        r.existing.lemma = r.output
        if (!r.existing.etymology.stages.some((x) => x.form === r.input))
          r.existing.etymology.stages.unshift({
            id: crypto.randomUUID(),
            form: r.input,
            type: 'soundChange',
            notes: ''
          })
        r.existing.updatedAt = stamp
        updated++
      } else skipped++
      continue
    }
    if (r.collision && !a.createOnCollision) {
      skipped++
      continue
    }
    const l = createLexeme(o.targetLanguageId, r.output)
    if (r.sourceKind === 'lexeme') {
      const src = r.source as Lexeme
      l.posId = src.posId
      l.features = { ...src.features }
      l.etymology = {
        type: 'inherited',
        sources: [{ kind: 'lexeme', id: src.id }],
        stages:
          r.input === src.lemma
            ? []
            : [{ id: crypto.randomUUID(), form: r.input, type: 'soundChange', notes: '' }],
        notes: o.ruleSet.name
      }
      if (a.copySenses) {
        l.senses = src.senses.map((s) => ({
          ...s,
          id: crypto.randomUUID(),
          definition: { ...s.definition },
          tags: [...s.tags],
          dialectIds: [],
          examples: []
        }))
        l.tags = [...src.tags]
      }
    } else {
      const src = r.source as Morpheme
      l.etymology = {
        type: 'inherited',
        sources: [{ kind: 'morpheme', id: src.id }],
        stages:
          r.input === src.form
            ? []
            : [{ id: crypto.randomUUID(), form: r.input, type: 'soundChange', notes: '' }],
        notes: o.ruleSet.name
      }
      if (a.copySenses) {
        if (Object.values(src.meaning).some(Boolean)) l.senses[0].definition = { ...src.meaning }
        l.tags = [...src.tags]
      }
    }
    project.lexemes.push(l)
    created++
  }
  return { created, updated, skipped }
}
