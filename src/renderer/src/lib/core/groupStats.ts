/**
 * 语系 / 语族 / 语支节点下各语言的统计与对比：数量、音位对照、同源比例、对应词表。
 * 同源按词源判断：两个词追上去有同一个词根来源（词条、非词缀语素、祖语里的形式），或者一个是另一个的来源。
 * 都是纯函数，不写死任何语言。
 */
import type { Id, Language, Lexeme, Project } from './model'
import {
  ancestorsOf,
  compareContext,
  lexemeRef,
  type CompareContext,
  type RootRef
} from './compare'
import { inferFeatures } from '$lib/ipa/features'

export interface CountRow {
  language: Language
  lexemes: number
  morphemes: number
  sentences: number
  phrases: number
}

export function groupCounts(project: Project, languages: Language[]): CountRow[] {
  const count = <T extends { languageId: Id | null }>(list: T[], id: Id): number =>
    list.reduce((n, x) => n + (x.languageId === id ? 1 : 0), 0)
  return languages.map((language) => ({
    language,
    lexemes: count(project.lexemes, language.id),
    morphemes: count(project.morphemes, language.id),
    sentences: count(project.sentences, language.id),
    phrases: count(project.phrasebook, language.id)
  }))
}

export interface PhonemeRow {
  symbol: string
  kind: 'consonant' | 'vowel' | 'other'
  /** 有这个音位的语言 id */
  in: Set<Id>
}

/** 几门语言音位表的并集：辅音在前、元音在后，同类里按出现的语言多少、再按符号排 */
export function phonemeTable(languages: Language[]): PhonemeRow[] {
  const rows = new Map<string, PhonemeRow>()
  for (const l of languages)
    for (const p of l.phonemes) {
      const sym = p.symbol.trim()
      if (!sym) continue
      let r = rows.get(sym)
      if (!r) {
        const type = p.features?.type ?? inferFeatures(sym).type
        r = {
          symbol: sym,
          kind: type === 'vowel' || type === 'consonant' ? type : 'other',
          in: new Set()
        }
        rows.set(sym, r)
      }
      r.in.add(l.id)
    }
  const order = { consonant: 0, vowel: 1, other: 2 }
  return [...rows.values()].sort(
    (a, b) =>
      order[a.kind] - order[b.kind] || b.in.size - a.in.size || a.symbol.localeCompare(b.symbol)
  )
}

/** 每门语言：词条 → 它的词根来源 key（含自己，一个词是另一个的来源时也算同源） */
function rootsByLanguage(
  ctx: CompareContext,
  project: Project,
  languages: Language[]
): Map<Id, { lexeme: Lexeme; roots: string[]; depth: Map<string, number> }[]> {
  const out = new Map<Id, { lexeme: Lexeme; roots: string[]; depth: Map<string, number> }[]>()
  const ids = new Set(languages.map((l) => l.id))
  for (const l of project.lexemes) {
    if (!ids.has(l.languageId)) continue
    const key = `l:${l.id}`
    const anc = ancestorsOf(ctx, key)
    const roots = [key, ...anc.keys()]
    let list = out.get(l.languageId)
    if (!list) out.set(l.languageId, (list = []))
    list.push({ lexeme: l, roots, depth: anc })
  }
  return out
}

export interface CognateCell {
  /** A 里有同源词在 B 里的词条数 */
  shared: number
  /** shared / A 的词条数 */
  ratio: number
}

/** 同源比例矩阵：行语言 A、列语言 B，A 的词条里有多少在 B 里找得到同源词 */
export function cognateMatrix(project: Project, languages: Language[]): Map<string, CognateCell> {
  const ctx = compareContext(project, project.settings.glossLanguages)
  const byLang = rootsByLanguage(ctx, project, languages)
  const rootSets = new Map<Id, Set<string>>()
  for (const [lid, list] of byLang) rootSets.set(lid, new Set(list.flatMap((x) => x.roots)))
  const out = new Map<string, CognateCell>()
  for (const a of languages) {
    const list = byLang.get(a.id) ?? []
    for (const b of languages) {
      if (a.id === b.id) continue
      const other = rootSets.get(b.id)
      const shared = other ? list.filter((x) => x.roots.some((r) => other.has(r))).length : 0
      out.set(`${a.id}|${b.id}`, { shared, ratio: list.length ? shared / list.length : 0 })
    }
  }
  return out
}

export interface CorrespondenceRow {
  root: RootRef
  /** 语言 id → 这个词根下的词 */
  cells: Map<Id, Lexeme[]>
  /** 有几门语言有 */
  coverage: number
}

/**
 * 对应词表：几门语言共有的词根来源，一行一个，格子里是各语言里从它来的词。
 * 至少两门语言有才列；覆盖的语言多的排前面，最多 limit 行
 */
export function correspondenceTable(
  project: Project,
  languages: Language[],
  limit = 300
): { rows: CorrespondenceRow[]; total: number } {
  const ctx = compareContext(project, project.settings.glossLanguages)
  const byLang = rootsByLanguage(ctx, project, languages)
  const rows = new Map<string, Map<Id, Lexeme[]>>()
  /** 词根离这些词最近隔几层：同一批词挂在几层词根下时留最近的那层 */
  const nearest = new Map<string, number>()
  for (const [lid, list] of byLang)
    for (const { lexeme, roots, depth } of list)
      for (const r of roots) {
        nearest.set(r, Math.min(nearest.get(r) ?? Infinity, depth.get(r) ?? 0))
        let cells = rows.get(r)
        if (!cells) rows.set(r, (cells = new Map()))
        const words = cells.get(lid)
        if (words) {
          if (!words.includes(lexeme)) words.push(lexeme)
        } else cells.set(lid, [lexeme])
      }
  const lexemeById = new Map(project.lexemes.map((l) => [l.id, l]))
  const out: CorrespondenceRow[] = []
  for (const [key, cells] of rows) {
    if (cells.size < 2) continue
    const root = key.startsWith('l:')
      ? lexemeById.get(key.slice(2)) && lexemeRef(ctx, lexemeById.get(key.slice(2))!)
      : ctx.refs.get(key)
    if (!root) continue
    out.push({ root, cells, coverage: cells.size })
  }
  // 同一批词挂在一串词根下（*kasu ← 更早的 *kasue）时只留离词最近的那一行，不然整行重复
  const bySig = new Map<string, CorrespondenceRow>()
  const sig = (r: CorrespondenceRow): string =>
    [...r.cells.entries()]
      .map(
        ([lid, ws]) =>
          lid +
          ':' +
          ws
            .map((w) => w.id)
            .sort()
            .join(',')
      )
      .sort()
      .join(';')
  for (const r of out) {
    const k = sig(r)
    const hit = bySig.get(k)
    if (!hit || (nearest.get(r.root.key) ?? 0) < (nearest.get(hit.root.key) ?? 0)) bySig.set(k, r)
  }
  const rowsOut = [...bySig.values()].sort(
    (a, b) => b.coverage - a.coverage || a.root.label.localeCompare(b.root.label)
  )
  return { rows: rowsOut.slice(0, limit), total: rowsOut.length }
}
