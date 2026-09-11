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
  Project,
  Sense
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

/** 方括号标记（【专】〔古〕[arch.]）的处理方式 */
export const MARKER_ACTIONS = ['register', 'tag', 'drop', 'keep'] as const

export interface MarkerRule {
  /** register 设成义项的语域；tag 加成义项标签；drop 只去掉标记；keep 原样留在文字里 */
  action: (typeof MARKER_ACTIONS)[number]
  /** 语域名或标签名，留空就用括号里的字 */
  value: string
}

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
  /**
   * 义项前缀映射，每行「编码=标签」：释义开头出现这些编码（可连写，如 01 = 0 + 1）时
   * 从释义里拿掉，变成这个义项的标签。空表示不处理。
   */
  sensePrefixMap: string
  /**
   * 方括号标记 → 处理方式，键是括号里的字（【专】的「专」）。序号（1、 2. 3)）后面紧跟的第一组括号也算，圆括号也一样。
   * 释义里的标记管到下一个标记或分号为止，前后拆成不同义项；备注里以标记开头的一段变成新义项；
   * 单词前的标记管整个词条。没列出的标记原样留着。
   */
  senseMarkers?: Record<string, MarkerRule>
}

export interface ImportReport {
  created: number
  skipped: number
  duplicates: string[]
  newPos: string[]
  newCategories: string[]
  warnings: string[]
  /** 按标记设了语域或标签的义项数 */
  marked?: number
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
    splitSenses: true,
    sensePrefixMap: '',
    senseMarkers: {}
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

/** 去掉「1、」「2.」这类编号 */
export const stripNumbering = (s: string): string => s.replace(/^\d+\s*[、.．)）]\s*/, '')

/**
 * 释义按中英文分号拆成多条，顺带去掉原有的「1、」编号。
 * keepNumbering：设了义项前缀映射时先留着，等认过编码再去（「1、离开」的 1 可能就是价态编码）。
 */
export function splitSenseText(s: string, keepNumbering = false): string[] {
  return s
    .split(/[;；]/)
    .map((x) => (keepNumbering ? x.trim() : stripNumbering(x.trim())))
    .filter(Boolean)
}

/** 「编码=标签」一行一条 → 表；标签留空就用编码本身 */
export function parsePrefixMap(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of (text ?? '').split(/\r?\n/)) {
    const i = line.search(/[=＝]/)
    const code = (i >= 0 ? line.slice(0, i) : line).trim()
    const label = (i >= 0 ? line.slice(i + 1) : '').trim()
    if (code) out.set(code, label || code)
  }
  return out
}

/**
 * 把义项开头的编码拆成标签：按最长的编码贪心匹配，可以连写多个（01 → 0、1），
 * 编码后面可以跟「、. ) :」之类的分隔符。整条都是编码时不动它。
 */
export function extractSensePrefix(
  text: string,
  map: Map<string, string>
): { text: string; tags: string[] } {
  if (!map.size) return { text, tags: [] }
  const codes = [...map.keys()].sort((a, b) => b.length - a.length)
  let rest = text.trimStart()
  const tags: string[] = []
  // 编码后面得换一类字符（数字接汉字、字母接标点）或者紧跟下一个编码（01 = 0 + 1），
  // 免得 n=名词 把 night 吃成 ight、1=一价 把 12 吃成 2
  const fits = (c: string): boolean => {
    if (rest.slice(0, c.length).toLowerCase() !== c.toLowerCase()) return false
    const last = c[c.length - 1]
    const next = rest[c.length]
    if (next === undefined) return true
    const after = rest.slice(c.length)
    if (/\d/.test(last))
      return !/\d/.test(next) || codes.some((x) => /^\d/.test(x) && after.startsWith(x))
    if (/[A-Za-z]/.test(last)) return !/[A-Za-z]/.test(next)
    return true
  }
  for (;;) {
    const hit = codes.find(fits)
    if (!hit) break
    tags.push(map.get(hit)!)
    rest = rest.slice(hit.length)
  }
  rest = rest.replace(/^[\s、.．)）:：,，]+/, '')
  if (!tags.length || !rest) return { text, tags: [] }
  return { text: rest, tags: [...new Set(tags)] }
}

const BRACKET_PAIRS = ['【】', '〔〕', '〖〗', '［］', '[]', '〈〉']
const ROUND_PAIRS = ['（）', '()']
const esc = (c: string): string => (/[()[\]]/.test(c) ? `\\${c}` : c)
/** 一组括号，括号里 1–12 个字、不能有空白与分隔符；每种括号一个捕获组 */
const bracketGroups = (pairs: string[]): string =>
  pairs.map(([o, c]) => `${esc(o)}([^${esc(o)}${esc(c)}\\s;；,，]{1,12})${esc(c)}`).join('|')
/** 能当标记的括号：【专】〔古〕〖神〗［文］[arch.]〈口〉 */
const MARKER_RE = new RegExp(bracketGroups(BRACKET_PAIRS), 'gu')
/** 序号（1、 2. 3)）后面紧跟的第一组括号，圆括号也算；序号前面不能紧挨字母或数字（第2、 不算） */
const NUMBERED_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])\\d{1,3}\\s*[、.．)）]\\s*(?:${bracketGroups([...ROUND_PAIRS, ...BRACKET_PAIRS])})`,
  'gu'
)
/** 开头的数字编码已经拿掉时（1、（古）离开 → （古）离开），开头这组括号也算序号后的 */
const LEADING_RE = new RegExp(`^\\s*(?:${bracketGroups([...ROUND_PAIRS, ...BRACKET_PAIRS])})`, 'u')
const EDGE_SEPARATORS = /^[\s，,、:：]+|[\s，,、:：]+$/g

export interface MarkedSegment {
  text: string
  /** 管这一段的标记（括号里的字），按出现顺序 */
  markers: string[]
}

interface MarkerHit {
  /** 前一段到这里为止：序号后的括号从序号开头算，序号留给新的一段 */
  cut: number
  /** 括号本身的起止 */
  at: number
  end: number
  label: string
}

/**
 * 文字里算得上标记的括号：后面还得有文字（行尾的 [kat] 多半是音标），纯数字（脚注 [1]）不算，
 * 方括号 [] 前面不能紧挨拉丁字母或数字（colo[u]r 不算）。给了 rules 时只要其中处理方式不是 keep 的。
 * leadingIsNumbered：开头原本是个数字编码（已经拿掉了），开头那组括号按序号后的算。
 */
function scanMarkers(
  text: string,
  rules?: Record<string, MarkerRule>,
  leadingIsNumbered = false
): MarkerHit[] {
  const hits: MarkerHit[] = []
  const labelOf = (m: RegExpMatchArray): string => m.slice(1).find((x) => x !== undefined) ?? ''
  const accept = (label: string, end: number): boolean => {
    if (/^\d+$/.test(label) || !/[^\s，,、:：]/.test(text.slice(end))) return false
    const rule = rules?.[label]
    return !rules || (!!rule && rule.action !== 'keep')
  }
  const push = (cut: number, end: number, label: string): void => {
    // 括号都是单个字符：括号里的字前后各一个
    const at = end - label.length - 2
    if (!hits.some((h) => h.at === at) && accept(label, end)) hits.push({ cut, at, end, label })
  }
  if (leadingIsNumbered) {
    const m = text.match(LEADING_RE)
    if (m) push(0, m[0].length, labelOf(m))
  }
  for (const m of text.matchAll(NUMBERED_RE)) {
    const cut = m.index ?? 0
    push(cut, cut + m[0].length, labelOf(m))
  }
  for (const m of text.matchAll(MARKER_RE)) {
    const at = m.index ?? 0
    if (m[0][0] === '[' && at > 0 && /[A-Za-z0-9]/.test(text[at - 1])) continue
    push(at, at + m[0].length, labelOf(m))
  }
  return hits.sort((a, b) => a.at - b.at)
}

/** 一段文字里的标记（括号里的字），分号两边各算各的 */
export function markerLabels(text: string): string[] {
  return text.split(/[;；]/).flatMap((part) => scanMarkers(part).map((m) => m.label))
}

/**
 * 按标记切开一段（不含分号的）文字：标记管到下一个标记为止，标记前面的文字自成一段，连着的几个标记管同一段。
 * 序号后的括号拿掉、序号留在新的一段开头（之后照常去编号）。不在 rules 里、或者处理方式是 keep 的标记原样留着。
 */
export function splitByMarkers(
  text: string,
  rules: Record<string, MarkerRule>,
  leadingIsNumbered = false
): MarkedSegment[] {
  const out: MarkedSegment[] = []
  let markers: string[] = []
  let buf = ''
  let last = 0
  for (const m of scanMarkers(text, rules, leadingIsNumbered)) {
    const cut = Math.max(last, m.cut)
    buf += text.slice(last, cut)
    const before = buf.replace(EDGE_SEPARATORS, '')
    if (before) {
      out.push({ text: before, markers })
      markers = []
    }
    buf = text.slice(cut, Math.max(cut, m.at))
    markers.push(m.label)
    last = m.end
  }
  const rest = (buf + text.slice(last)).replace(EDGE_SEPARATORS, '')
  if (rest || markers.length) out.push({ text: rest, markers })
  return out
}

/** 不拆开，只把标记（括号本身）从文字里拿掉 */
export function removeMarkers(
  text: string,
  rules: Record<string, MarkerRule>,
  leadingIsNumbered = false
): MarkedSegment {
  let out = ''
  let last = 0
  const markers: string[] = []
  for (const m of scanMarkers(text, rules, leadingIsNumbered)) {
    out += text.slice(last, Math.max(last, m.at))
    markers.push(m.label)
    last = m.end
  }
  return { text: (out + text.slice(last)).trim(), markers }
}

const mapsToSense = (r: MarkerRule | undefined): boolean =>
  r?.action === 'register' || r?.action === 'tag'

/**
 * 把标记落到义项上：设语域的第一个生效（义项已经有别的语域时记成标签），设标签的加标签。返回用上了没有。
 */
export function applyMarkers(
  sense: Sense,
  labels: readonly string[],
  rules: Record<string, MarkerRule>
): boolean {
  let used = false
  for (const label of labels) {
    const rule = rules[label]
    if (!rule || (rule.action !== 'register' && rule.action !== 'tag')) continue
    const value = rule.value.trim() || label
    if (rule.action === 'register' && !sense.register) sense.register = value
    else if (sense.register !== value && !sense.tags.includes(value)) sense.tags.push(value)
    used = true
  }
  return used
}

export interface MarkerStat {
  /** 括号里的字 */
  label: string
  /** 第一次见到时的写法（带括号） */
  raw: string
  count: number
  /** 在哪几列见到（列序号） */
  columns: number[]
  /** 第一次见到时所在的那一段 */
  sample: string
}

/** 表里单词、释义、备注列出现的标记，按次数从多到少 */
export function findMarkers(rows: string[][], mapping: CsvMapping): MarkerStat[] {
  const cols = mapping.columns.flatMap((c, i) =>
    c.kind === 'lemma' || c.kind === 'definition' || c.kind === 'notes' ? [i] : []
  )
  if (!cols.length) return []
  const stats = new Map<string, MarkerStat>()
  for (const row of mapping.hasHeader ? rows.slice(1) : rows)
    for (const ci of cols)
      for (const part of (row[ci] ?? '').split(/[;；]/))
        for (const m of scanMarkers(part)) {
          const st = stats.get(m.label)
          if (!st) {
            stats.set(m.label, {
              label: m.label,
              raw: part.slice(m.at, m.end),
              count: 1,
              columns: [ci],
              sample: part.trim()
            })
            continue
          }
          st.count++
          if (!st.columns.includes(ci)) st.columns.push(ci)
        }
  return [...stats.values()].sort((a, b) => b.count - a.count)
}

/** 预设里读来的标记表：只留认得的处理方式 */
export function cleanMarkerRules(raw: unknown): Record<string, MarkerRule> {
  const out: Record<string, MarkerRule> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [label, r] of Object.entries(raw as Record<string, unknown>)) {
    const { action, value } = (r ?? {}) as { action?: unknown; value?: unknown }
    if (label && (MARKER_ACTIONS as readonly unknown[]).includes(action))
      out[label] = {
        action: action as MarkerRule['action'],
        value: typeof value === 'string' ? value : ''
      }
  }
  return out
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
  const markerRules = mapping.senseMarkers ?? {}
  const hasMarkers = Object.values(markerRules).some((r) => r.action !== 'keep')
  const defSpec = mapping.columns.find(
    (c): c is Extract<FieldSpec, { kind: 'definition' }> => c.kind === 'definition'
  )
  /** 备注里拆出来的义项写进哪种释义语言 */
  const noteLang = defSpec?.lang ?? project.settings.glossLanguages[0] ?? 'en'
  let marked = 0
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
    // 单词前的标记管整个词条（语素照旧）
    let entryMarkers: string[] = []
    if (mapping.target === 'lexemes' && hasMarkers) {
      const r = removeMarkers(key, markerRules)
      key = r.text
      entryMarkers = r.markers
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
      /** 按义项序号记下从前缀里拆出来的标签 */
      const senseTags: string[][] = []
      /** 按义项序号记下管它的标记；备注里以标记开头的段落另起义项 */
      const senseMarks: string[][] = []
      const noteSenses: MarkedSegment[] = []
      const prefixMap = parsePrefixMap(mapping.sensePrefixMap ?? '')
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
            // 有标记要处理时先留着编号：序号后面紧跟的括号也是标记
            const parts = mapping.splitSenses
              ? splitSenseText(raw, prefixMap.size > 0 || hasMarkers)
              : [raw]
            const base = (defs[spec.lang] ?? []).length
            const cleaned: string[] = []
            for (const d of parts) {
              const r = extractSensePrefix(d, prefixMap)
              const numbered = r.tags.length > 0
              // 标记再把一段切成几个义项；不拆义项时只把标记拿掉，都算这一个义项的
              const segs: MarkedSegment[] = !hasMarkers
                ? [{ text: r.text, markers: [] }]
                : mapping.splitSenses
                  ? splitByMarkers(r.text, markerRules, numbered)
                  : [removeMarkers(r.text, markerRules, numbered)]
              segs.forEach((seg, k) => {
                const at = base + cleaned.length
                if (numbered) senseTags[at] = [...new Set([...(senseTags[at] ?? []), ...r.tags])]
                if (seg.markers.length) senseMarks[at] = [...(senseMarks[at] ?? []), ...seg.markers]
                const keepNumber = !mapping.splitSenses || (numbered && k === 0)
                cleaned.push(keepNumber ? seg.text : stripNumbering(seg.text))
              })
            }
            defs[spec.lang] = [...(defs[spec.lang] ?? []), ...cleaned]
            break
          }
          case 'tags':
            lx.tags.push(...splitTags(raw, mapping.tagSeparator))
            break
          case 'senseTags':
            sense.tags.push(...splitTags(raw, mapping.tagSeparator))
            break
          case 'notes': {
            // 备注里以标记开头的一段（【人】某某、1、（古）某某）是另一个义项，其余照旧进备注
            let kept = raw
            if (hasMarkers) {
              const rest: string[] = []
              let touched = false
              for (const part of raw.split(/[;；]/))
                for (const seg of splitByMarkers(part.trim(), markerRules)) {
                  if (seg.markers.length) touched = true
                  if (!seg.text) continue
                  if (seg.markers.some((mk) => mapsToSense(markerRules[mk])))
                    noteSenses.push({ ...seg, text: stripNumbering(seg.text) })
                  else rest.push(seg.text)
                }
              if (touched) kept = rest.join(raw.includes('；') ? '；' : '; ')
            }
            if (kept) lx.notes = lx.notes ? `${lx.notes}\n${kept}` : kept
            break
          }
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
        if (senseTags[i]?.length) s.tags = [...new Set([...s.tags, ...senseTags[i]])]
        if (senseMarks[i]?.length && applyMarkers(s, senseMarks[i], markerRules)) marked++
        if (i > 0) lx.senses.push(s)
      }
      // 备注里拆出来的义项接在后面；词条原本没有释义时顶替空着的第一条
      for (const seg of noteSenses) {
        const empty = lx.senses.length === 1 && !Object.values(sense.definition).some(Boolean)
        const s = empty ? sense : createSense()
        s.definition[noteLang] = seg.text
        if (applyMarkers(s, seg.markers, markerRules)) marked++
        if (!empty) lx.senses.push(s)
      }
      // 单词前的标记：语域落到每个义项上，标签记在词条上
      for (const label of entryMarkers) {
        const rule = markerRules[label]
        if (rule?.action === 'tag') lx.tags.push(rule.value.trim() || label)
      }
      const entryRegisters = entryMarkers.filter((mk) => markerRules[mk]?.action === 'register')
      if (entryRegisters.length)
        for (const s of lx.senses) if (applyMarkers(s, entryRegisters, markerRules)) marked++
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
  if (marked) report.marked = marked
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
