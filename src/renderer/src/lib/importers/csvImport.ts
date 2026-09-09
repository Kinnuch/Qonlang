/**
 * CSV 映射导入：把表格的列映射到词位或语素的字段。
 * 不预设任何列名；映射由用户在向导里指定，可存为预设。
 */
import type {
  GrammaticalCategory,
  Id,
  Lexeme,
  Morpheme,
  MorphemeType,
  PartOfSpeech,
  Project
} from '$lib/core/model'
import { createLexeme, createMorpheme, createSense, newId, now } from '$lib/core/factory'
import { etymologyOrigin } from '$lib/core/etymology'

export type FieldSpec =
  | { kind: 'ignore' }
  | { kind: 'lemma' }
  | { kind: 'pos' }
  | { kind: 'definition'; lang: string }
  | { kind: 'tags' }
  | { kind: 'notes' }
  | { kind: 'protoForm' }
  | { kind: 'etymologyNotes' }
  | { kind: 'stem'; name: string }
  | { kind: 'form'; slot: string }
  | { kind: 'pronunciation' }
  | { kind: 'feature'; category: string }
  | { kind: 'register' }
  | { kind: 'senseTags' }
  // 语素专用
  | { kind: 'gloss' }
  | { kind: 'morphemeType' }

export const FIELD_KINDS: FieldSpec['kind'][] = [
  'ignore',
  'lemma',
  'pos',
  'definition',
  'tags',
  'notes',
  'protoForm',
  'etymologyNotes',
  'stem',
  'form',
  'pronunciation',
  'feature',
  'register',
  'senseTags',
  'gloss',
  'morphemeType'
]

export interface CsvMapping {
  target: 'lexemes' | 'morphemes'
  languageId: Id
  hasHeader: boolean
  /** 按列序号 */
  columns: FieldSpec[]
  tagSeparator: string
  /** 词头为空的行跳过 */
  skipEmptyKey: boolean
  /** 语素导入时的默认类型 */
  defaultMorphemeType: MorphemeType
  /** 词头列里出现「a > b」时取 > 之后的部分作词头、之前的作原始形 */
  splitProtoArrow: boolean
  /** 释义列里的中英文分号拆成多个义项 */
  splitSenses: boolean
}

export interface ImportReport {
  created: number
  skipped: number
  duplicates: string[]
  newPos: string[]
  newCategories: string[]
  warnings: string[]
}

export function defaultMapping(languageId: Id, columnCount: number): CsvMapping {
  return {
    target: 'lexemes',
    languageId,
    hasHeader: true,
    columns: Array.from({ length: columnCount }, () => ({ kind: 'ignore' })),
    tagSeparator: ',',
    skipEmptyKey: true,
    defaultMorphemeType: 'root',
    splitProtoArrow: false,
    splitSenses: true
  }
}

/** 猜一个起手映射：常见表头名 → 字段（中英各给一些同义词，全部可改） */
export function guessMapping(header: string[], mapping: CsvMapping): CsvMapping {
  const cols = header.map((h): FieldSpec => {
    const k = h.trim().toLowerCase()
    if (!k) return { kind: 'ignore' }
    if (/^(词头|词|单词|词位|词条|词根|字典形|word|lemma|entry|headword|root|form)$/.test(k))
      return { kind: 'lemma' }
    if (/^(词类|词性|pos|part of speech|category)$/.test(k)) return { kind: 'pos' }
    if (/^(释义|意思|意义|定义|中文|汉语|meaning|definition|gloss_zh|definition_zh)$/.test(k))
      return { kind: 'definition', lang: 'zh' }
    if (/^(english|definition_en|gloss_en|英文)$/.test(k)) return { kind: 'definition', lang: 'en' }
    if (/^(标签|tags?)$/.test(k)) return { kind: 'tags' }
    if (/^(备注|注|注释|notes?|comment)$/.test(k)) return { kind: 'notes' }
    if (/^(原始形|祖语|原始.*语|proto|etymon|source)$/.test(k)) return { kind: 'protoForm' }
    if (/^(发音|音标|ipa|pronunciation)$/.test(k)) return { kind: 'pronunciation' }
    if (/^(gloss|缩写)$/.test(k)) return { kind: 'gloss' }
    if (/^(类型|type)$/.test(k)) return { kind: 'morphemeType' }
    return { kind: 'ignore' }
  })
  return { ...mapping, columns: cols }
}

function ensurePos(project: Project, name: string, report: ImportReport): PartOfSpeech {
  const found = project.posList.find(
    (p) => Object.values(p.name).some((n) => n === name) || p.abbr === name
  )
  if (found) return found
  const pos: PartOfSpeech = {
    id: newId(),
    name: { [guessLang(name)]: name },
    abbr: '',
    paradigmId: null
  }
  project.posList.push(pos)
  report.newPos.push(name)
  return pos
}

function ensureCategoryValue(
  project: Project,
  categoryName: string,
  valueName: string,
  report: ImportReport
): [Id, Id] {
  let cat = project.categories.find((c) => Object.values(c.name).includes(categoryName))
  if (!cat) {
    cat = {
      id: newId(),
      name: { [guessLang(categoryName)]: categoryName },
      values: []
    } satisfies GrammaticalCategory
    project.categories.push(cat)
    report.newCategories.push(categoryName)
  }
  let val = cat.values.find(
    (v) => Object.values(v.name).includes(valueName) || v.abbr === valueName
  )
  if (!val) {
    val = { id: newId(), name: { [guessLang(valueName)]: valueName }, abbr: '' }
    cat.values.push(val)
  }
  return [cat.id, val.id]
}

function guessLang(s: string): string {
  return /[㐀-鿿]/.test(s) ? 'zh' : 'en'
}

/** 释义按中英文分号拆成多条，顺带去掉原有的「1、」编号 */
export function splitSenseText(s: string): string[] {
  return s
    .split(/[;；]/)
    .map((x) => x.trim().replace(/^\d+\s*[、.．)）]\s*/, ''))
    .filter(Boolean)
}

function splitTags(s: string, sep: string): string[] {
  return s
    .split(sep === ' ' ? /\s+/ : new RegExp(`[${sep.replace(/[\\\]^-]/g, '\\$&')}，、;；]`))
    .map((x) => x.trim())
    .filter(Boolean)
}

const MORPHEME_TYPE_ALIASES: Record<string, MorphemeType> = {
  root: 'root',
  词根: 'root',
  prefix: 'prefix',
  前缀: 'prefix',
  suffix: 'suffix',
  后缀: 'suffix',
  infix: 'infix',
  中缀: 'infix',
  circumfix: 'circumfix',
  环缀: 'circumfix',
  clitic: 'clitic',
  附着词: 'clitic',
  pattern: 'pattern',
  模板: 'pattern',
  particle: 'particle',
  小品词: 'particle'
}

/** 执行导入；直接修改 project，返回报告。 */
export function applyCsvImport(
  project: Project,
  rows: string[][],
  mapping: CsvMapping
): ImportReport {
  const report: ImportReport = {
    created: 0,
    skipped: 0,
    duplicates: [],
    newPos: [],
    newCategories: [],
    warnings: []
  }
  const data = mapping.hasHeader ? rows.slice(1) : rows
  const keyCol = mapping.columns.findIndex((c) => c.kind === 'lemma')
  if (keyCol < 0) {
    report.warnings.push('没有指定词头列')
    return report
  }
  const existingLemmas = new Set(
    mapping.target === 'lexemes'
      ? project.lexemes.filter((l) => l.languageId === mapping.languageId).map((l) => l.lemma)
      : project.morphemes.filter((m) => m.languageId === mapping.languageId).map((m) => m.form)
  )

  for (const row of data) {
    let key = (row[keyCol] ?? '').trim()
    let protoFromArrow = ''
    if (mapping.splitProtoArrow && key.includes('>')) {
      const idx = key.lastIndexOf('>')
      protoFromArrow = key.slice(0, idx).trim()
      key = key.slice(idx + 1).trim()
    }
    if (!key) {
      if (mapping.skipEmptyKey) {
        report.skipped++
        continue
      }
    }
    if (existingLemmas.has(key)) report.duplicates.push(key)
    existingLemmas.add(key)

    if (mapping.target === 'lexemes') {
      const lx = createLexeme(mapping.languageId, key)
      const sense = lx.senses[0]
      const defs: Record<string, string[]> = {}
      if (protoFromArrow)
        lx.etymology.sources.push({
          kind: 'external',
          language: '',
          form: protoFromArrow,
          meaning: ''
        })
      mapping.columns.forEach((spec, ci) => {
        const raw = (row[ci] ?? '').trim()
        if (!raw || spec.kind === 'ignore' || spec.kind === 'lemma') return
        switch (spec.kind) {
          case 'pos':
            lx.posId = ensurePos(project, raw, report).id
            break
          case 'definition': {
            const parts = mapping.splitSenses ? splitSenseText(raw) : [raw]
            defs[spec.lang] = [...(defs[spec.lang] ?? []), ...parts]
            break
          }
          case 'tags':
            lx.tags.push(...splitTags(raw, mapping.tagSeparator))
            break
          case 'senseTags':
            sense.tags.push(...splitTags(raw, mapping.tagSeparator))
            break
          case 'notes':
            lx.notes = lx.notes ? `${lx.notes}\n${raw}` : raw
            break
          case 'protoForm':
            lx.etymology.sources.push({ kind: 'external', language: '', form: raw, meaning: '' })
            if (lx.etymology.type === 'unknown') lx.etymology.type = 'inherited'
            break
          case 'etymologyNotes':
            lx.etymology.notes = raw
            break
          case 'stem':
            lx.stems[spec.name] = raw
            break
          case 'form':
            lx.forms[spec.slot] = { surface: raw, derived: false, override: true, trace: [] }
            break
          case 'pronunciation': {
            const ortho = project.languages
              .find((l) => l.id === mapping.languageId)
              ?.orthographies.find((o) => o.isPrimary)
            if (ortho) lx.pronunciations[ortho.id] = { ipa: raw, irregular: true }
            break
          }
          case 'feature': {
            const [cid, vid] = ensureCategoryValue(project, spec.category, raw, report)
            lx.features[cid] = vid
            break
          }
          case 'register':
            sense.register = raw
            break
          case 'gloss':
          case 'morphemeType':
            report.warnings.push(`列 ${ci + 1} 的字段类型只适用于语素，已忽略`)
            break
        }
      })
      // 组装义项：各释义语言按序号对齐，第一条写进已有的义项
      const defLangs = Object.keys(defs)
      const senseCount = Math.max(1, ...defLangs.map((g) => (defs[g] ?? []).length))
      for (let i = 0; i < senseCount; i++) {
        const s = i === 0 ? sense : createSense()
        for (const g of defLangs) {
          const d = defs[g]?.[i]
          if (d) s.definition[g] = d
        }
        if (i > 0) lx.senses.push(s)
      }
      lx.tags = [...new Set(lx.tags)]
      project.lexemes.push(lx)
    } else {
      const m = createMorpheme(mapping.languageId, mapping.defaultMorphemeType)
      m.form = key
      mapping.columns.forEach((spec, ci) => {
        const raw = (row[ci] ?? '').trim()
        if (!raw || spec.kind === 'ignore' || spec.kind === 'lemma') return
        switch (spec.kind) {
          case 'definition':
            m.meaning[spec.lang] = m.meaning[spec.lang] ? `${m.meaning[spec.lang]}; ${raw}` : raw
            break
          case 'gloss':
            m.gloss = raw
            break
          case 'morphemeType': {
            const mt = MORPHEME_TYPE_ALIASES[raw.toLowerCase()]
            if (mt) m.type = mt
            else m.tags.push(raw)
            break
          }
          case 'tags':
          case 'senseTags':
            m.tags.push(...splitTags(raw, mapping.tagSeparator))
            break
          case 'pos':
            m.tags.push(raw)
            break
          case 'notes':
          case 'etymologyNotes':
            m.notes = m.notes ? `${m.notes}\n${raw}` : raw
            break
          case 'feature': {
            const [cid, vid] = ensureCategoryValue(project, spec.category, raw, report)
            m.features[cid] = vid
            break
          }
          default:
            report.warnings.push(`列 ${ci + 1} 的字段类型只适用于词位，已忽略`)
        }
      })
      m.tags = [...new Set(m.tags)]
      project.morphemes.push(m)
    }
    report.created++
  }
  project.meta.updatedAt = now()
  return report
}

/** 从已有词位反推一个 CSV（导出） */
export function lexemesToRows(
  project: Project,
  lexemes: Lexeme[],
  glossLanguages: string[]
): string[][] {
  const posName = (id: Id | null): string => {
    const p = project.posList.find((x) => x.id === id)
    return p ? (Object.values(p.name)[0] ?? '') : ''
  }
  const header = [
    'lemma',
    'pos',
    ...glossLanguages.map((l) => `definition_${l}`),
    'tags',
    'proto',
    'notes'
  ]
  const rows = lexemes.map((l) => [
    l.lemma,
    posName(l.posId),
    ...glossLanguages.map((g) =>
      l.senses
        .map((s) => s.definition[g] ?? '')
        .filter(Boolean)
        .join(' | ')
    ),
    l.tags.join(','),
    etymologyOrigin(project, l.etymology),
    l.notes
  ])
  return [header, ...rows]
}

export function morphemesToRows(morphemes: Morpheme[], glossLanguages: string[]): string[][] {
  const header = [
    'form',
    'type',
    'gloss',
    ...glossLanguages.map((l) => `meaning_${l}`),
    'tags',
    'notes'
  ]
  return [
    header,
    ...morphemes.map((m) => [
      m.form,
      m.type,
      m.gloss,
      ...glossLanguages.map((g) => m.meaning[g] ?? ''),
      m.tags.join(','),
      m.notes
    ])
  ]
}

export { createSense }
