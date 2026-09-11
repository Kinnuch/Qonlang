/**
 * 统计面板的纯函数：词库 / 语素 / 语料各一份。
 * 只算数，不管怎么画；标签文字由界面按 key 翻译。
 */
import { affixTexts, parseAffixRef } from './morph'
import type { Id, Lexeme, Morpheme, Project, Sentence } from '$lib/core/model'
import { ETYMOLOGY_TYPES } from '$lib/core/model'

export interface Bucket {
  key: string
  label: string
  n: number
}

function pick(text: Record<string, string>, langs: string[]): string {
  for (const l of langs) if (text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}

function bucketize(entries: [string, string][]): Bucket[] {
  const m = new Map<string, Bucket>()
  for (const [key, label] of entries) {
    const b = m.get(key)
    if (b) b.n++
    else m.set(key, { key, label, n: 1 })
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
}

/** 首字母：按字母表里的多合字母切，字母表为空就取第一个字符 */
export function initialLetter(word: string, alphabet: string[]): string {
  const w = word.replace(/^[-=*·(]+/, '')
  for (const a of [...alphabet].sort((x, y) => y.length - x.length))
    if (a && w.toLowerCase().startsWith(a.toLowerCase())) return a
  return Array.from(w)[0]?.toUpperCase() ?? ''
}

/** 词长：按字母表的多合字母数，没字母表就按码点 */
export function wordLength(word: string, alphabet: string[]): number {
  const w = word.replace(/[-=*·'\s]/g, '')
  if (!alphabet.length) return Array.from(w).length
  const sorted = [...alphabet].filter(Boolean).sort((x, y) => y.length - x.length)
  let i = 0
  let n = 0
  const lower = w.toLowerCase()
  while (i < lower.length) {
    const hit = sorted.find((a) => lower.startsWith(a.toLowerCase(), i))
    i += hit ? hit.length : 1
    n++
  }
  return n
}

function daysAgo(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? (Date.now() - t) / 86400000 : Infinity
}

export interface LexiconStats {
  total: number
  withDefinition: number
  withPronunciation: number
  withEtymology: number
  withForms: number
  overriddenForms: number
  withImages: number
  withRelations: number
  withNotes: number
  usedInCorpus: number
  sensesTotal: number
  avgLength: number
  duplicateLemmas: number
  added7d: number
  added30d: number
  byPos: Bucket[]
  byTag: Bucket[]
  byEtymologyType: Bucket[]
  byInitial: Bucket[]
  byLength: Bucket[]
  byDialect: Bucket[]
  byFeature: { categoryId: Id; category: string; buckets: Bucket[] }[]
  /** 语料里用得最多的词条 */
  topUsed: { lexemeId: Id; lemma: string; n: number }[]
  /** 从没在语料里出现过的词条数 */
  unusedInCorpus: number
}

export function lexiconStats(project: Project, languageId: Id): LexiconStats {
  const langs = project.settings.glossLanguages
  const lang = project.languages.find((l) => l.id === languageId)
  const alphabet = lang?.alphabet ?? []
  const lexemes = project.lexemes.filter((l) => l.languageId === languageId)
  const posLabel = (id: Id | null): string => {
    const p = project.posList.find((x) => x.id === id)
    return p ? pick(p.name, langs) || p.abbr : ''
  }
  const used = new Map<Id, number>()
  for (const s of project.sentences) {
    if (s.languageId !== languageId) continue
    for (const t of s.tokens) {
      const a = t.analyses[t.chosen]
      if (a?.lexemeId) used.set(a.lexemeId, (used.get(a.lexemeId) ?? 0) + 1)
    }
  }
  const lemmaCount = new Map<string, number>()
  for (const l of lexemes) {
    const k = l.lemma.trim().toLowerCase()
    if (k) lemmaCount.set(k, (lemmaCount.get(k) ?? 0) + 1)
  }
  const lengths = lexemes.map((l) => wordLength(l.lemma, alphabet)).filter((n) => n > 0)
  const etyLabel = (type: string): string =>
    (ETYMOLOGY_TYPES as readonly string[]).includes(type) ? type : type || 'unknown'
  const features: { categoryId: Id; category: string; buckets: Bucket[] }[] = []
  for (const cat of project.categories) {
    const entries: [string, string][] = []
    for (const l of lexemes) {
      const vid = l.features[cat.id]
      if (!vid) continue
      const v = cat.values.find((x) => x.id === vid)
      entries.push([vid, v ? pick(v.name, langs) || v.abbr : '?'])
    }
    if (entries.length)
      features.push({
        categoryId: cat.id,
        category: pick(cat.name, langs),
        buckets: bucketize(entries)
      })
  }
  return {
    total: lexemes.length,
    withDefinition: lexemes.filter((l) =>
      l.senses.some((s) => Object.values(s.definition).some((d) => d.trim()))
    ).length,
    withPronunciation: lexemes.filter((l) => Object.values(l.pronunciations).some((p) => p?.ipa))
      .length,
    withEtymology: lexemes.filter((l) => l.etymology.sources.length || l.etymology.stages.length)
      .length,
    withForms: lexemes.filter((l) => Object.keys(l.forms).length).length,
    overriddenForms: lexemes.reduce(
      (a, l) => a + Object.values(l.forms).filter((f) => f.override).length,
      0
    ),
    withImages: lexemes.filter((l) => l.images.length).length,
    withRelations: lexemes.filter((l) => l.relations.length).length,
    withNotes: lexemes.filter((l) => l.notes.trim()).length,
    usedInCorpus: lexemes.filter((l) => used.has(l.id)).length,
    sensesTotal: lexemes.reduce((a, l) => a + l.senses.length, 0),
    avgLength: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
    duplicateLemmas: [...lemmaCount.values()].filter((n) => n > 1).length,
    added7d: lexemes.filter((l) => daysAgo(l.createdAt) <= 7).length,
    added30d: lexemes.filter((l) => daysAgo(l.createdAt) <= 30).length,
    byPos: bucketize(lexemes.map((l) => [l.posId ?? '', posLabel(l.posId)])),
    byTag: bucketize(lexemes.flatMap((l) => l.tags.map((t): [string, string] => [t, t]))),
    byEtymologyType: bucketize(
      lexemes
        .filter((l) => l.etymology.sources.length || l.etymology.stages.length)
        .map((l): [string, string] => [etyLabel(l.etymology.type), etyLabel(l.etymology.type)])
    ),
    byInitial: bucketize(
      lexemes.map((l) => [initialLetter(l.lemma, alphabet), initialLetter(l.lemma, alphabet)])
    ).sort((a, b) => a.label.localeCompare(b.label)),
    byLength: bucketize(
      lengths.map((n): [string, string] => [String(n).padStart(3, '0'), String(n)])
    ).sort((a, b) => a.key.localeCompare(b.key)),
    byDialect: bucketize(
      lexemes.flatMap((l) =>
        l.dialectIds.map((d): [string, string] => [
          d,
          lang?.dialects.find((x) => x.id === d)?.name ?? '?'
        ])
      )
    ),
    byFeature: features,
    topUsed: [...used.entries()]
      .map(([lexemeId, n]) => ({
        lexemeId,
        lemma: project.lexemes.find((l) => l.id === lexemeId)?.lemma ?? '?',
        n
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 30),
    unusedInCorpus: lexemes.filter((l) => !used.has(l.id)).length
  }
}

export interface MorphemeStats {
  total: number
  withGloss: number
  withMeaning: number
  withAllomorphs: number
  withEtymology: number
  usedInCorpus: number
  usedInEtymology: number
  usedInParadigms: number
  unused: { id: Id; form: string }[]
  duplicateForms: number
  byType: Bucket[]
  byTag: Bucket[]
  byInitial: Bucket[]
  topUsed: { morphemeId: Id; form: string; n: number }[]
}

export function morphemeStats(project: Project, languageId: Id | null): MorphemeStats {
  const lang = project.languages.find((l) => l.id === languageId)
  const alphabet = lang?.alphabet ?? []
  const morphemes = project.morphemes.filter((m) => !languageId || m.languageId === languageId)
  const inCorpus = new Map<Id, number>()
  for (const s of project.sentences)
    for (const t of s.tokens) {
      const a = t.analyses[t.chosen]
      if (!a) continue
      for (const m of a.morphs)
        if (m.morphemeId) inCorpus.set(m.morphemeId, (inCorpus.get(m.morphemeId) ?? 0) + 1)
    }
  const inEty = new Set<Id>()
  for (const l of [...project.lexemes, ...project.morphemes])
    for (const s of l.etymology.sources) if (s.kind === 'morpheme') inEty.add(s.id)
  // 构形生成器里以 @形式 / @gloss 引用的语素：与推导用同一个解析（前后可以带中点、空格）
  const inPara = new Set<Id>()
  const langs = languageId ? [languageId] : project.languages.map((l) => l.id)
  for (const p of project.paradigms)
    for (const g of Object.values(p.generators))
      for (const text of affixTexts(g)) {
        if (!text?.includes('@')) continue
        for (const lid of langs) {
          const r = parseAffixRef(text, project.morphemes, lid)
          if (r?.morpheme) inPara.add(r.morpheme.id)
        }
      }
  const formCount = new Map<string, number>()
  for (const m of morphemes) {
    const k = `${m.type}:${m.form.trim().toLowerCase()}`
    if (m.form.trim()) formCount.set(k, (formCount.get(k) ?? 0) + 1)
  }
  return {
    total: morphemes.length,
    withGloss: morphemes.filter((m) => m.gloss.trim()).length,
    withMeaning: morphemes.filter((m) => Object.values(m.meaning).some((x) => x.trim())).length,
    withAllomorphs: morphemes.filter((m) => m.allomorphs.length).length,
    withEtymology: morphemes.filter((m) => m.etymology.sources.length || m.etymology.stages.length)
      .length,
    usedInCorpus: morphemes.filter((m) => inCorpus.has(m.id)).length,
    usedInEtymology: morphemes.filter((m) => inEty.has(m.id)).length,
    usedInParadigms: morphemes.filter((m) => inPara.has(m.id)).length,
    unused: morphemes
      .filter((m) => !inCorpus.has(m.id) && !inEty.has(m.id) && !inPara.has(m.id))
      .map((m) => ({ id: m.id, form: m.form })),
    duplicateForms: [...formCount.values()].filter((n) => n > 1).length,
    byType: bucketize(morphemes.map((m) => [m.type, m.type])),
    byTag: bucketize(morphemes.flatMap((m) => m.tags.map((t): [string, string] => [t, t]))),
    byInitial: bucketize(
      morphemes.map((m) => [initialLetter(m.form, alphabet), initialLetter(m.form, alphabet)])
    ).sort((a, b) => a.label.localeCompare(b.label)),
    topUsed: [...inCorpus.entries()]
      .filter(([id]) => morphemes.some((m) => m.id === id))
      .map(([morphemeId, n]) => ({
        morphemeId,
        form: project.morphemes.find((m) => m.id === morphemeId)?.form ?? '?',
        n
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 30)
  }
}

export interface CorpusStatsFull {
  sentences: number
  tokens: number
  types: number
  hapax: number
  avgTokens: number
  confirmedTokens: number
  resolvedTokens: number
  fullyConfirmedSentences: number
  withTranslation: number
  withSource: number
  withScriptForm: number
  lexemeCoverage: number
  morphemeCoverage: number
  frequency: { surface: string; n: number }[]
  unresolved: string[]
  bySource: Bucket[]
  byTag: Bucket[]
  byGloss: Bucket[]
  byLength: Bucket[]
  topLexemes: { lexemeId: Id; lemma: string; n: number }[]
}

export function corpusStatsFull(project: Project, languageId: Id): CorpusStatsFull {
  const sentences = project.sentences.filter((s) => s.languageId === languageId)
  const freq = new Map<string, number>()
  const unresolved = new Set<string>()
  const usedLexemes = new Map<Id, number>()
  const usedMorphemes = new Set<Id>()
  const glosses: [string, string][] = []
  let tokens = 0
  let confirmed = 0
  let resolved = 0
  let fully = 0
  for (const s of sentences) {
    let allOk = s.tokens.length > 0
    for (const t of s.tokens) {
      tokens++
      freq.set(t.surface, (freq.get(t.surface) ?? 0) + 1)
      const a = t.analyses[t.chosen]
      const ok = !!a && !a.morphs.some((m) => m.gloss === '?')
      if (!ok) unresolved.add(t.surface)
      else resolved++
      if (t.confirmed) confirmed++
      else allOk = false
      if (a?.lexemeId) usedLexemes.set(a.lexemeId, (usedLexemes.get(a.lexemeId) ?? 0) + 1)
      for (const m of a?.morphs ?? []) {
        if (m.morphemeId) usedMorphemes.add(m.morphemeId)
        // gloss 里的大写缩写（NOM、PL、3SG…）
        for (const g of m.gloss.split(/[.\-=:~]/))
          if (/^[A-Z0-9]{1,6}$/.test(g)) glosses.push([g, g])
      }
    }
    if (allOk) fully++
  }
  const totalLex = project.lexemes.filter((l) => l.languageId === languageId).length
  const totalMorph = project.morphemes.filter((m) => m.languageId === languageId).length
  const hasTr = (s: Sentence): boolean => Object.values(s.translation).some((x) => x.trim())
  return {
    sentences: sentences.length,
    tokens,
    types: freq.size,
    hapax: [...freq.values()].filter((n) => n === 1).length,
    avgTokens: sentences.length ? tokens / sentences.length : 0,
    confirmedTokens: confirmed,
    resolvedTokens: resolved,
    fullyConfirmedSentences: fully,
    withTranslation: sentences.filter(hasTr).length,
    withSource: sentences.filter((s) => s.source.trim()).length,
    withScriptForm: sentences.filter((s) => Object.values(s.scriptForms).some((x) => x.trim()))
      .length,
    lexemeCoverage: totalLex ? usedLexemes.size / totalLex : 0,
    morphemeCoverage: totalMorph
      ? [...usedMorphemes].filter(
          (id) => project.morphemes.find((m) => m.id === id)?.languageId === languageId
        ).length / totalMorph
      : 0,
    frequency: [...freq.entries()]
      .map(([surface, n]) => ({ surface, n }))
      .sort((a, b) => b.n - a.n),
    unresolved: [...unresolved],
    bySource: bucketize(sentences.map((s) => [s.source.trim(), s.source.trim() || '—'])),
    byTag: bucketize(sentences.flatMap((s) => s.tags.map((t): [string, string] => [t, t]))),
    byGloss: bucketize(glosses).slice(0, 40),
    byLength: bucketize(
      sentences.map((s): [string, string] => [
        String(s.tokens.length).padStart(3, '0'),
        String(s.tokens.length)
      ])
    ).sort((a, b) => a.key.localeCompare(b.key)),
    topLexemes: [...usedLexemes.entries()]
      .map(([lexemeId, n]) => ({
        lexemeId,
        lemma: project.lexemes.find((l) => l.id === lexemeId)?.lemma ?? '?',
        n
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 30)
  }
}

export type { Lexeme, Morpheme }
