/**
 * Lexicanter `.lexc`（2.x）导入。
 * 目标是不丢信息：词库、义项、标签、方言（lects）、发音（含不规则标记）、发音规则、
 * 字母表、正字法、词源链接、亲属语言词库、短语簿、文档与屈折表（转成 Markdown 页）。
 */
import type { DocPage, Id, Language, Lexeme, Phrase, Project, RuleSet } from '$lib/core/model'
import { createLanguage, createLexeme, createProject, createRuleSet, createSense, newId, now } from '$lib/core/factory'
import { fromLexicanter } from '$lib/engine/sca/importers'

interface LexcSense {
  definition: string
  lects?: string[]
  tags?: string[]
}
interface LexcPron {
  [lect: string]: { ipa: string; irregular: boolean }
}
interface LexcWord {
  pronunciations?: LexcPron
  Senses?: LexcSense[]
}
interface LexcPhrase {
  pronunciations?: LexcPron
  description?: string
  lects?: string[]
  tags?: string[]
  variants?: Record<string, { pronunciations?: LexcPron; description?: string }>
}
interface EditorBlock {
  type: string
  data: Record<string, unknown>
}
export interface LexcFile {
  Version?: string
  Name?: string
  Lexicon?: Record<string, LexcWord>
  Etymologies?: Record<string, { descendants: { name: string; source: string }[]; source: string }>
  Relatives?: Record<string, Record<string, LexcWord>>
  Inflections?: { tags: string[]; filter: string; tables: { blocks?: EditorBlock[] }; categories: string }[]
  Phrasebook?: Record<string, Record<string, LexcPhrase>>
  Alphabet?: string
  Pronunciations?: Record<string, string>
  Orthographies?: { name: string; font: string; root: string; lect: string; rules: string; display: boolean }[]
  Phonotactics?: Record<string, { Onsets: string; Medials: string; Codas: string; Vowels: string; Illegals: string }>
  Lects?: string[]
  Docs?: { blocks?: EditorBlock[] }
  CaseSensitive?: boolean
  IgnoreDiacritics?: boolean
}

export interface LexicanterImportOptions {
  /** 义项文本放到哪个释义语言下 */
  definitionLang: string
  uiLocale: string
  appVersion: string
}

export interface LexicanterReport {
  languages: string[]
  lexemes: number
  phrases: number
  ruleSets: number
  docs: number
  warnings: string[]
}

const THIS = '<< THIS LANGUAGE >>'

export function parseLexc(text: string): LexcFile {
  const obj = JSON.parse(text) as LexcFile
  if (!obj || typeof obj !== 'object' || !('Lexicon' in obj)) throw new Error('不是 Lexicanter 文件')
  return obj
}

/** 新建一个项目并导入 */
export function lexicanterToProject(file: LexcFile, opts: LexicanterImportOptions): { project: Project; report: LexicanterReport } {
  const project = createProject({ name: file.Name || 'Lexicanter', template: 'lexicanter', appVersion: opts.appVersion, uiLocale: opts.uiLocale })
  project.languages = []
  project.settings.defaultLanguageId = null
  const report = mergeLexicanter(project, file, opts)
  return { project, report }
}

/** 把文件内容并入已有项目：主语言新建（或按名合并），亲属语言各建一门 */
export function mergeLexicanter(project: Project, file: LexcFile, opts: LexicanterImportOptions): LexicanterReport {
  const report: LexicanterReport = { languages: [], lexemes: 0, phrases: 0, ruleSets: 0, docs: 0, warnings: [] }
  const lang = createLanguage({ name: file.Name || 'Lexicanter' })
  project.languages.push(lang)
  if (!project.settings.defaultLanguageId) project.settings.defaultLanguageId = lang.id
  report.languages.push(lang.name)

  // 方言
  const lects = (file.Lects ?? ['General']).filter(Boolean)
  const dialectIds = new Map<string, Id>()
  for (const l of lects) {
    const id = newId()
    lang.dialects.push({ id, name: l, abbr: '' })
    dialectIds.set(l, id)
  }
  const mainLect = lects[0] ?? 'General'
  const primaryOrtho = lang.orthographies.find((o) => o.isPrimary)!

  // 字母表
  if (file.Alphabet) lang.alphabet = file.Alphabet.split(/\s+/).filter(Boolean)

  // 发音规则：主方言的进正字法转写；其余各成一套规则集
  for (const [lect, rules] of Object.entries(file.Pronunciations ?? {})) {
    if (!rules.trim()) continue
    const converted = fromLexicanter(rules)
    if (lect === mainLect) primaryOrtho.rulesToIpa = converted
    else {
      const rs = createRuleSet(`${lang.name} · ${lect} 发音`, converted)
      rs.notes = `Lexicanter 方言「${lect}」的发音规则`
      project.ruleSets.push(rs)
      report.ruleSets++
    }
  }

  // 正字法（Lexicanter 的规则把罗马化转成文字，存到 rulesFromIpa 并注明）
  for (const o of file.Orthographies ?? []) {
    if (o.name === 'Romanization' && o.root === 'rom') {
      primaryOrtho.font = o.font ?? ''
      continue
    }
    lang.orthographies.push({
      id: newId(),
      name: o.name,
      font: o.font ?? '',
      direction: 'ltr',
      rulesToIpa: '',
      rulesFromIpa: o.rules && !/^Your romanized/.test(o.rules) ? fromLexicanter(o.rules) : '',
      isPrimary: false
    })
  }

  // 音位配列
  const pt = file.Phonotactics?.[mainLect]
  if (pt) {
    const split = (s: string): string[] => s.split(/\s+/).filter(Boolean)
    lang.phonotactics.onsets = split(pt.Onsets)
    lang.phonotactics.nuclei = split(pt.Vowels)
    lang.phonotactics.codas = split(pt.Codas)
    lang.phonotactics.illegal = split(pt.Illegals)
    if (pt.Medials?.trim()) lang.notes += `\nLexicanter 词中辅音（Medials）：${pt.Medials}`
  }

  // 词库
  const idByWord = new Map<string, Id>()
  const importLexicon = (target: Language, lexicon: Record<string, LexcWord>, map: Map<string, Id>): void => {
    for (const [word, entry] of Object.entries(lexicon)) {
      const lx = wordToLexeme(target, word, entry, opts.definitionLang, dialectIds, mainLect, primaryOrtho.id)
      project.lexemes.push(lx)
      map.set(word, lx.id)
      report.lexemes++
    }
  }
  importLexicon(lang, file.Lexicon ?? {}, idByWord)

  // 亲属语言（各自一门语言）
  const relativeMaps = new Map<string, Map<string, Id>>()
  for (const [relName, lexicon] of Object.entries(file.Relatives ?? {})) {
    const rel = createLanguage({ name: relName })
    project.languages.push(rel)
    report.languages.push(relName)
    const m = new Map<string, Id>()
    importLexicon(rel, lexicon, m)
    relativeMaps.set(relName, m)
  }

  // 词源：parent.descendants → 子词的 sources 指向父词
  for (const [parentWord, ety] of Object.entries(file.Etymologies ?? {})) {
    const parentId = ety.source === THIS ? idByWord.get(parentWord) : relativeMaps.get(ety.source)?.get(parentWord)
    for (const d of ety.descendants ?? []) {
      const childId = d.source === THIS ? idByWord.get(d.name) : relativeMaps.get(d.source)?.get(d.name)
      const child = childId ? project.lexemes.find((l) => l.id === childId) : undefined
      if (!child) continue
      if (parentId) child.etymology.sources.push({ kind: 'lexeme', id: parentId })
      else child.etymology.sources.push({ kind: 'external', language: ety.source === THIS ? lang.name : ety.source, form: parentWord, meaning: '' })
      if (child.etymology.type === 'unknown') child.etymology.type = 'derivation'
    }
  }

  // 短语簿
  for (const [category, phrases] of Object.entries(file.Phrasebook ?? {})) {
    for (const [text, p] of Object.entries(phrases)) {
      const ph: Phrase = {
        id: newId(),
        languageId: lang.id,
        category,
        text,
        translation: { [opts.definitionLang]: p.description ?? '' },
        pronunciations: pronToRecord(p.pronunciations, mainLect, primaryOrtho.id),
        variants: Object.entries(p.variants ?? {}).map(([v, d]) => ({ text: v, note: d.description ?? '' })),
        tags: [...(p.tags ?? []), ...(p.lects ?? []).map((l) => `lect:${l}`)]
      }
      project.phrasebook.push(ph)
      report.phrases++
    }
  }

  // 文档与屈折表 → Markdown 页
  const docMd = blocksToMarkdown(file.Docs?.blocks ?? [])
  if (docMd.trim()) {
    project.docs.push(page(lang.id, `${lang.name} · Lexicanter 文档`, docMd))
    report.docs++
  }
  for (const inf of file.Inflections ?? []) {
    const md = blocksToMarkdown(inf.tables?.blocks ?? [])
    if (!md.trim()) continue
    const title = [inf.filter, inf.tags?.join(' ')].filter(Boolean).join(' · ') || 'Inflection'
    project.docs.push(page(lang.id, `屈折表 · ${title}`, (inf.categories ? `${inf.categories}\n\n` : '') + md))
    report.docs++
  }

  if (file.IgnoreDiacritics === false || file.CaseSensitive) report.warnings.push('Lexicanter 的大小写 / 变音符敏感设置未迁移')
  project.meta.updatedAt = now()
  return report
}

function pronToRecord(p: LexcPron | undefined, mainLect: string, orthoId: Id): Lexeme['pronunciations'] {
  const main = p?.[mainLect] ?? (p ? Object.values(p)[0] : undefined)
  return main && main.ipa ? { [orthoId]: { ipa: main.ipa, irregular: !!main.irregular } } : {}
}

function wordToLexeme(lang: Language, word: string, entry: LexcWord, defLang: string, dialectIds: Map<string, Id>, mainLect: string, orthoId: Id): Lexeme {
  const lx = createLexeme(lang.id, word)
  lx.senses = (entry.Senses ?? []).map((s) => {
    const sense = createSense()
    sense.definition[defLang] = s.definition ?? ''
    sense.tags = [...(s.tags ?? [])]
    sense.dialectIds = (s.lects ?? []).map((l) => dialectIds.get(l)).filter((x): x is Id => !!x)
    return sense
  })
  if (!lx.senses.length) lx.senses = [createSense()]
  lx.tags = [...new Set(lx.senses.flatMap((s) => s.tags))]
  lx.pronunciations = pronToRecord(entry.pronunciations, mainLect, orthoId)
  // 其他方言的发音不丢：写进备注
  const extra = Object.entries(entry.pronunciations ?? {}).filter(([l, v]) => l !== mainLect && v.ipa)
  if (extra.length) lx.notes = extra.map(([l, v]) => `发音（${l}）：${v.ipa}${v.irregular ? '（不规则）' : ''}`).join('\n')
  return lx
}

function page(languageId: Id, title: string, markdown: string): DocPage {
  return { id: newId(), languageId, title, markdown, updatedAt: now() }
}

/** EditorJS 块 → Markdown（标题、段落、列表、表格；其余原样 JSON） */
export function blocksToMarkdown(blocks: EditorBlock[]): string {
  const strip = (s: unknown): string =>
    String(s ?? '')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<\/?b>/g, '**')
      .replace(/<\/?i>/g, '*')
      .replace(/<[^>]+>/g, '')
  const out: string[] = []
  for (const b of blocks) {
    const d = b.data
    switch (b.type) {
      case 'header':
        out.push('#'.repeat(Number(d.level ?? 2)) + ' ' + strip(d.text))
        break
      case 'paragraph':
        out.push(strip(d.text))
        break
      case 'list': {
        const items = (d.items as unknown[]) ?? []
        const ordered = d.style === 'ordered'
        out.push(items.map((it, i) => `${ordered ? `${i + 1}.` : '-'} ${strip(typeof it === 'object' && it ? (it as { content?: string }).content : it)}`).join('\n'))
        break
      }
      case 'table': {
        const rows = (d.content as string[][]) ?? []
        if (!rows.length) break
        const line = (r: string[]): string => '| ' + r.map(strip).join(' | ') + ' |'
        out.push([line(rows[0]), '|' + rows[0].map(() => ' --- ').join('|') + '|', ...rows.slice(1).map(line)].join('\n'))
        break
      }
      default:
        out.push('```json\n' + JSON.stringify(b, null, 2) + '\n```')
    }
  }
  return out.join('\n\n')
}

export type { RuleSet }
