/**
 * 语料与短语的导入导出：
 * - 表格（CSV / TSV / 一行一条的纯文本）：逐列挑字段，原文为空或重复的跳过
 * - JSON：千语集自己导出的，整条连分析一起搬过来；换了项目对不上的词条、语素引用会丢掉分析，选中时重新分析
 * - 行间注释文本：莱比锡 / Markdown / HTML / LaTeX，一句接一句
 */
import type { Analysis, Id, Phrase, Project, Sentence, Token } from '$lib/core/model'
import { createPhrase, createSentence } from '$lib/core/factory'
import { normalizeSentence } from '$lib/core/sentenceDedup'
import { interlinear, toHtml, toLatex, toLeipzig, toMarkdown } from '$lib/engine/gloss'

/** 全是 ASCII 字符 */
function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false
  return true
}

/** 表格导入时一列能对应的字段 */
export interface ImportField {
  key: string
  /** 表头里出现这些词就猜是它（拉丁字母的按整词比，汉字按包含） */
  hints: string[]
}

export interface ImportResult {
  created: number
  skipped: number
  /** 新建条目的 id（导入后接着查重用） */
  ids: Id[]
}

const TR_WORDS = ['译文', '翻译', '释义', 'translation']
const LANG_HINTS: Record<string, string[]> = {
  zh: ['中', '汉', 'zh', 'chinese'],
  en: ['英', 'en', 'english'],
  ja: ['日', 'ja', 'japanese'],
  fr: ['法', 'fr', 'french'],
  de: ['德', 'de', 'german']
}
const langHints = (lang: string): string[] => LANG_HINTS[lang] ?? [lang.toLowerCase()]

/** 表头里有没有这个提示词：拉丁字母的要整词出现（translation 里的 tr 不算），其他文字按包含 */
function mentions(header: string, hint: string): boolean {
  if (!isAscii(hint)) return header.includes(hint)
  return header.split(/[^\p{L}\p{N}]+/u).includes(hint)
}

/** 例句能导入的字段：原文、各释义语言的译文、出处、标签、备注 */
export function sentenceFields(glossLangs: string[]): ImportField[] {
  return [
    { key: 'text', hints: ['原文', '例句', '句子', 'text', 'sentence', 'original'] },
    ...glossLangs.map((l) => ({ key: `tr:${l}`, hints: [] })),
    { key: 'source', hints: ['出处', '来源', 'source'] },
    { key: 'tags', hints: ['标签', 'tags', 'tag'] },
    { key: 'notes', hints: ['备注', '注释', 'notes', 'note'] }
  ]
}

/** 短语能导入的字段：原文、各释义语言的译文、分类、标签、变体 */
export function phraseFields(glossLangs: string[]): ImportField[] {
  return [
    { key: 'text', hints: ['原文', '短语', 'text', 'phrase', 'original'] },
    ...glossLangs.map((l) => ({ key: `tr:${l}`, hints: [] })),
    { key: 'category', hints: ['分类', '类别', 'category'] },
    { key: 'tags', hints: ['标签', 'tags', 'tag'] },
    { key: 'variants', hints: ['变体', 'variants', 'variant'] }
  ]
}

/**
 * 按表头猜每列对应的字段：写明了语言的译文列直接对上；只写「译文」的依次给还没占用的释义语言。
 * 没有表头时第一列当原文、第二列当第一释义语言的译文。
 */
export function guessColumns(
  header: string[] | null,
  fields: ImportField[],
  columnCount: number
): string[] {
  const out = Array.from({ length: columnCount }, () => '')
  const trKeys = fields.filter((f) => f.key.startsWith('tr:')).map((f) => f.key)
  if (!header) {
    if (columnCount > 0) out[0] = 'text'
    if (columnCount > 1 && trKeys[0]) out[1] = trKeys[0]
    return out
  }
  const used = new Set<string>()
  const cells = header.map((h) => h.trim().toLowerCase())
  const isTr = (x: string): boolean => TR_WORDS.some((w) => mentions(x, w))
  cells.forEach((x, i) => {
    if (!x || i >= columnCount) return
    for (const f of fields) {
      if (used.has(f.key)) continue
      const hit = f.key.startsWith('tr:')
        ? isTr(x) && langHints(f.key.slice(3)).some((w) => mentions(x, w))
        : !isTr(x) && f.hints.some((w) => mentions(x, w))
      if (hit) {
        out[i] = f.key
        used.add(f.key)
        return
      }
    }
  })
  cells.forEach((x, i) => {
    if (out[i] || i >= columnCount || !isTr(x)) return
    const k = trKeys.find((key) => !used.has(key))
    if (k) {
      out[i] = k
      used.add(k)
    }
  })
  return out
}

/** 按列映射把表格行变成记录；同一个字段挑了几列就用「；」连起来 */
export function rowsToRecords(rows: string[][], columns: string[]): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const row of rows) {
    const rec: Record<string, string> = {}
    columns.forEach((key, i) => {
      const v = (row[i] ?? '').trim()
      if (!key || !v) return
      rec[key] = rec[key] ? `${rec[key]}；${v}` : v
    })
    if (Object.keys(rec).length) out.push(rec)
  }
  return out
}

const splitList = (s: string | undefined, re: RegExp): string[] =>
  (s ?? '')
    .split(re)
    .map((x) => x.trim())
    .filter(Boolean)
const translationOf = (rec: Record<string, string>): Record<string, string> => {
  const tr: Record<string, string> = {}
  for (const [k, v] of Object.entries(rec)) if (k.startsWith('tr:') && v) tr[k.slice(3)] = v
  return tr
}

/**
 * 按原文去重着往列表前面加：原文为空的、这门语言里已经有了的（忽略大小写与多余空白）跳过，
 * 新的按原来的顺序排在最前。
 */
function addUnique<T extends { id: Id; languageId: Id; text: string }>(
  list: T[],
  languageId: Id,
  items: T[]
): ImportResult {
  const seen = new Set(
    list.filter((x) => x.languageId === languageId).map((x) => normalizeSentence(x.text))
  )
  const fresh: T[] = []
  let skipped = 0
  for (const item of items) {
    const k = normalizeSentence(item.text)
    if (!k || seen.has(k)) {
      skipped++
      continue
    }
    seen.add(k)
    fresh.push(item)
  }
  list.unshift(...fresh)
  return { created: fresh.length, skipped, ids: fresh.map((x) => x.id) }
}

/** 记录 → 例句 */
export function importSentenceRecords(
  project: Project,
  languageId: Id,
  records: Record<string, string>[]
): ImportResult {
  const items = records.map((rec) => {
    const s = createSentence(languageId)
    s.text = (rec.text ?? '').trim()
    s.translation = translationOf(rec)
    s.source = rec.source ?? ''
    s.tags = splitList(rec.tags, /[,，;；、|]/)
    s.notes = rec.notes ?? ''
    return s
  })
  return addUnique(project.sentences, languageId, items)
}

/** 记录 → 短语；变体按分号或竖线分开 */
export function importPhraseRecords(
  project: Project,
  languageId: Id,
  records: Record<string, string>[]
): ImportResult {
  const items = records.map((rec) => {
    const p = createPhrase(languageId, rec.category ?? '')
    p.text = (rec.text ?? '').trim()
    p.translation = translationOf(rec)
    p.tags = splitList(rec.tags, /[,，;；、|]/)
    p.variants = splitList(rec.variants, /[;；|]/).map((v) => ({ text: v, note: '' }))
    return p
  })
  return addUnique(project.phrasebook, languageId, items)
}

/**
 * 例句 → 表格：原文、各释义语言译文、出处、标签、备注，外加切分与 gloss 两列（只供查看，导入时不读）。
 * 切分与 gloss 跟行间注释导出一样，附着词用 =。
 */
export function sentencesToRows(
  project: Project,
  sentences: Sentence[],
  glossLangs: string[]
): string[][] {
  const rows: string[][] = [
    [
      'text',
      ...glossLangs.map((l) => `translation:${l}`),
      'source',
      'tags',
      'notes',
      'morphemes',
      'gloss'
    ]
  ]
  for (const s of sentences) {
    const il = interlinear(project, s)
    rows.push([
      s.text,
      ...glossLangs.map((l) => s.translation[l] ?? ''),
      s.source,
      s.tags.join(', '),
      s.notes,
      il.words.map((w) => w.morphs).join(' '),
      il.words.map((w) => w.gloss).join(' ')
    ])
  }
  return rows
}

/** 短语 → 表格 */
export function phrasesToRows(phrases: Phrase[], glossLangs: string[]): string[][] {
  const rows: string[][] = [
    ['category', 'text', ...glossLangs.map((l) => `translation:${l}`), 'tags', 'variants']
  ]
  for (const p of phrases)
    rows.push([
      p.category,
      p.text,
      ...glossLangs.map((l) => p.translation[l] ?? ''),
      p.tags.join(', '),
      p.variants.map((v) => v.text).join('; ')
    ])
  return rows
}

export type InterlinearFormat = 'leipzig' | 'markdown' | 'html' | 'latex'

/** 一句接一句的行间注释文本；译文语言与单句导出一致 */
export function sentencesToText(
  project: Project,
  sentences: Sentence[],
  format: InterlinearFormat,
  glossLang?: string
): string {
  const render = { leipzig: toLeipzig, markdown: toMarkdown, html: toHtml, latex: toLatex }[format]
  return sentences
    .map((s) => render(interlinear(project, s, glossLang)))
    .join(format === 'html' ? '\n' : '\n\n')
}

export const CORPUS_JSON = 'qonlang-corpus'
export const PHRASEBOOK_JSON = 'qonlang-phrasebook'

export function sentencesToJson(sentences: Sentence[]): string {
  return JSON.stringify({ format: CORPUS_JSON, version: 1, sentences }, null, 2)
}

export function phrasesToJson(phrases: Phrase[]): string {
  return JSON.stringify({ format: PHRASEBOOK_JSON, version: 1, phrases }, null, 2)
}

// ── 读回 JSON：别人的文件、手改过的文件都可能缺字段或类型不对，一项项清洗 ──

type Loose = Record<string, unknown>
const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const textMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x
  return out
}

/** 分析整组清洗；有一处不对就整组不要（选中时重新分析） */
function cleanTokens(v: unknown): Token[] {
  if (!Array.isArray(v)) return []
  const out: Token[] = []
  for (const t of v) {
    if (!isObj(t) || typeof t.surface !== 'string' || !Array.isArray(t.analyses)) return []
    const analyses: Analysis[] = []
    for (const a of t.analyses) {
      if (!isObj(a) || !Array.isArray(a.morphs)) return []
      const morphs: Analysis['morphs'] = []
      for (const m of a.morphs) {
        if (!isObj(m)) return []
        const lexemeId = strOrNull(m.lexemeId)
        morphs.push({
          form: str(m.form),
          gloss: str(m.gloss),
          morphemeId: strOrNull(m.morphemeId),
          ...(lexemeId ? { lexemeId } : {})
        })
      }
      analyses.push({ lexemeId: strOrNull(a.lexemeId), slot: strOrNull(a.slot), morphs })
    }
    const chosen =
      typeof t.chosen === 'number' && t.chosen >= 0 && t.chosen < analyses.length ? t.chosen : 0
    out.push({ surface: t.surface, analyses, chosen, confirmed: t.confirmed === true })
  }
  return out
}

function parseBundle(text: string, format: string, key: string): Loose[] | null {
  try {
    const data = JSON.parse(text) as unknown
    if (!isObj(data) || data.format !== format || !Array.isArray(data[key])) return null
    return (data[key] as unknown[]).filter(isObj)
  } catch {
    return null
  }
}

/** 只留下目标语言里存在的键（正字法、文字的 id 属于原来的项目） */
function keepKnown<V>(rec: Record<string, V>, known: Set<string>): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [k, v] of Object.entries(rec)) if (known.has(k)) out[k] = v
  return out
}

/** 读回导出的例句 JSON：换新 id、挂到 languageId；不是千语集导出的返回 null */
export function importSentencesJson(
  project: Project,
  languageId: Id,
  text: string
): ImportResult | null {
  const list = parseBundle(text, CORPUS_JSON, 'sentences')
  if (!list) return null
  const lang = project.languages.find((l) => l.id === languageId)
  const orthos = new Set((lang?.orthographies ?? []).map((o) => o.id))
  const scripts = new Set((lang?.scripts ?? []).map((sc) => sc.id))
  const lexemes = new Set(project.lexemes.map((l) => l.id))
  const morphemes = new Set(project.morphemes.map((m) => m.id))
  const items = list.map((raw) => {
    const tokens = cleanTokens(raw.tokens)
    // 分析里指向的词条、语素这边都有才留着
    const refsOk = tokens.every((tk) =>
      tk.analyses.every(
        (a) =>
          (!a.lexemeId || lexemes.has(a.lexemeId)) &&
          a.morphs.every((m) => !m.morphemeId || morphemes.has(m.morphemeId))
      )
    )
    const s = createSentence(languageId)
    s.text = str(raw.text).trim()
    s.orthoTexts = keepKnown(textMap(raw.orthoTexts), orthos)
    s.scriptForms = keepKnown(textMap(raw.scriptForms), scripts)
    s.translation = textMap(raw.translation)
    s.source = str(raw.source)
    s.tags = strings(raw.tags)
    s.tokens = refsOk ? tokens : []
    s.extraLines = Array.isArray(raw.extraLines)
      ? raw.extraLines.filter(isObj).map((x) => ({ label: str(x.label), text: str(x.text) }))
      : []
    s.notes = str(raw.notes)
    return s
  })
  return addUnique(project.sentences, languageId, items)
}

/** 读回导出的短语 JSON */
export function importPhrasesJson(
  project: Project,
  languageId: Id,
  text: string
): ImportResult | null {
  const list = parseBundle(text, PHRASEBOOK_JSON, 'phrases')
  if (!list) return null
  const lang = project.languages.find((l) => l.id === languageId)
  const orthos = new Set((lang?.orthographies ?? []).map((o) => o.id))
  const items = list.map((raw) => {
    const p = createPhrase(languageId, str(raw.category))
    p.text = str(raw.text).trim()
    p.translation = textMap(raw.translation)
    const prons: Phrase['pronunciations'] = {}
    if (isObj(raw.pronunciations))
      for (const [k, v] of Object.entries(raw.pronunciations))
        if (isObj(v) && typeof v.ipa === 'string')
          prons[k] = { ipa: v.ipa, irregular: v.irregular === true }
    p.pronunciations = keepKnown(prons, orthos)
    p.variants = Array.isArray(raw.variants)
      ? raw.variants.filter(isObj).map((x) => ({ text: str(x.text), note: str(x.note) }))
      : []
    p.tags = strings(raw.tags)
    return p
  })
  return addUnique(project.phrasebook, languageId, items)
}

/** 例句 → 表格导入那样的记录（导入样例拿它显示） */
export function sentenceRecord(s: Sentence): Record<string, string> {
  const rec: Record<string, string> = { text: s.text }
  for (const [lang, v] of Object.entries(s.translation)) if (v) rec[`tr:${lang}`] = v
  if (s.source) rec.source = s.source
  if (s.tags.length) rec.tags = s.tags.join('、')
  if (s.notes) rec.notes = s.notes
  return rec
}

/** 短语 → 记录 */
export function phraseRecord(p: Phrase): Record<string, string> {
  const rec: Record<string, string> = { text: p.text }
  for (const [lang, v] of Object.entries(p.translation)) if (v) rec[`tr:${lang}`] = v
  if (p.category) rec.category = p.category
  if (p.tags.length) rec.tags = p.tags.join('、')
  if (p.variants.length) rec.variants = p.variants.map((v) => v.text).join('；')
  return rec
}

/** 例句 JSON 读成记录，只看不导入；不是千语集导出的返回 null */
export function previewSentencesJson(
  project: Project,
  languageId: Id,
  text: string
): Record<string, string>[] | null {
  const scratch: Project = { ...project, sentences: [] }
  return importSentencesJson(scratch, languageId, text)
    ? scratch.sentences.map(sentenceRecord)
    : null
}

/** 短语 JSON 读成记录，只看不导入 */
export function previewPhrasesJson(
  project: Project,
  languageId: Id,
  text: string
): Record<string, string>[] | null {
  const scratch: Project = { ...project, phrasebook: [] }
  return importPhrasesJson(scratch, languageId, text) ? scratch.phrasebook.map(phraseRecord) : null
}
