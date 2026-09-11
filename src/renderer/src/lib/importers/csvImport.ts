/**
 * CSV 映射导入：把表格的列映射到词位或语素的字段。
 * 不预设任何列名；映射由用户在向导里指定，可存为预设。
 */
import type {
  Dialect,
  Etymology,
  EtymologyType,
  GrammaticalCategory,
  Id,
  Language,
  Lexeme,
  Morpheme,
  MorphemeType,
  PartOfSpeech,
  Project,
  Sense
} from '$lib/core/model'
import { createLexeme, createMorpheme, createSense, newId, now } from '$lib/core/factory'
import { etymologyOrigin } from '$lib/core/etymology'
import { ensureCompoundPos, posName, posParadigmId, sensePos } from '$lib/core/pos'

export type FieldSpec =
  | { kind: 'ignore' }
  | { kind: 'lemma' }
  | { kind: 'pos' }
  | { kind: 'definition'; lang: string }
  | { kind: 'tags' }
  /** label：写进备注时加在前面的说明（比如列名），空着不加 */
  | { kind: 'notes'; label?: string }
  /** language：来源语言；是项目里的语言时按单词、语素链接过去 */
  | { kind: 'protoForm'; language?: string }
  | { kind: 'etymologyNotes' }
  | { kind: 'etymologyType' }
  /** label：这个中间态的说明（比如哪个时期） */
  | { kind: 'etymologyStage'; label?: string }
  | { kind: 'stem'; name: string }
  | { kind: 'form'; slot: string }
  /** orthography：正字法名，空着是主正字法 */
  | { kind: 'pronunciation'; orthography?: string }
  | { kind: 'feature'; category: string }
  | { kind: 'register' }
  | { kind: 'senseTags' }
  | { kind: 'language' }
  // 词条专用
  | { kind: 'dialects' }
  /** relKind：关系种类（synonym、antonym、related、词源类别或自定义文字） */
  | { kind: 'relation'; relKind: string }
  /** script：文字名，空着是第一套文字 */
  | { kind: 'scriptForm'; script?: string }
  | { kind: 'paradigm' }
  | { kind: 'paradigmVariant' }
  // 语素专用
  | { kind: 'gloss' }
  | { kind: 'morphemeType' }
  | { kind: 'form2' }
  | { kind: 'allomorphs' }

/** 导入成词条时能选的字段（跟录入页面上能填的一一对应） */
export const LEXEME_FIELDS: FieldSpec['kind'][] = [
  'ignore',
  'lemma',
  'language',
  'pos',
  'definition',
  'register',
  'senseTags',
  'tags',
  'dialects',
  'feature',
  'pronunciation',
  'scriptForm',
  'etymologyType',
  'protoForm',
  'etymologyStage',
  'etymologyNotes',
  'relation',
  'stem',
  'form',
  'paradigm',
  'paradigmVariant',
  'notes'
]

/** 导入成语素时能选的字段 */
export const MORPHEME_FIELDS: FieldSpec['kind'][] = [
  'ignore',
  'lemma',
  'language',
  'morphemeType',
  'form2',
  'gloss',
  'definition',
  'allomorphs',
  'feature',
  'tags',
  'etymologyType',
  'protoForm',
  'etymologyStage',
  'etymologyNotes',
  'notes'
]

export const FIELD_KINDS: FieldSpec['kind'][] = [...new Set([...LEXEME_FIELDS, ...MORPHEME_FIELDS])]

/** 释义开头数字编码（动词价态这类）的处理方式 */
export const CODE_ACTIONS = ['tag', 'drop', 'keep'] as const

export interface CodeRule {
  /** tag 拿掉编码、变成义项标签；drop 只拿掉编码；keep 原样留着 */
  action: (typeof CODE_ACTIONS)[number]
  /** 标签名，留空就用编码本身 */
  value: string
}

/** 方括号标记（【专】〔古〕[arch.]）的处理方式 */
export const MARKER_ACTIONS = ['register', 'tag', 'drop', 'keep'] as const

export interface MarkerRule {
  /** register 设成义项的语域；tag 加成义项标签；drop 只去掉标记；keep 原样留在文字里 */
  action: (typeof MARKER_ACTIONS)[number]
  /** 语域名或标签名，留空就用括号里的字 */
  value: string
}

/** 义项开头的词类标记（n. v. adj.）的处理方式 */
export const POS_ACTIONS = ['pos', 'tag', 'drop', 'keep'] as const

export interface PosRule {
  /** pos 设成义项的词类；tag 加成义项标签；drop 只去掉标记；keep 原样留在释义里 */
  action: (typeof POS_ACTIONS)[number]
  /** 词类名（已有词类的名字或缩写也行，几个用斜杠连起来就是复合词类）或标签名；留空就用标记本身 */
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
  /** 旧版的义项前缀映射（每行「编码=标签」），老预设里还会有；新的写在 senseCodes */
  sensePrefixMap: string
  /**
   * 释义开头紧挨着文字的数字编码 → 处理方式（「1离开；2前往」这种），键是单个数字，连写的 01 算 0 和 1。
   * 设成标签的从释义里拿掉、变成义项标签；只去掉的拿掉不留；没列出的原样留着。
   */
  senseCodes?: Record<string, CodeRule>
  /**
   * 方括号标记 → 处理方式，键是括号里的字（【专】的「专」）。序号（1、 2. 3)）后面紧跟的第一组括号也算，圆括号也一样。
   * 释义里的标记管到下一个标记或分号为止，前后拆成不同义项；备注里以标记开头的一段变成新义项；
   * 单词前的标记管整个词条。没列出的标记原样留着。
   */
  senseMarkers?: Record<string, MarkerRule>
  /**
   * 词类标记 → 处理方式，键是去掉末尾点的标记（n. 的「n」、v因. 的「v因」）。
   * 释义里每个义项开头（序号、方括号标记后面也行）「拉丁字母 + 几个字 + 点」的写法都算，n./v. 这样隔开的算几个；
   * 一个词类标记管到同一格里下一个词类标记为止。词类列里整格是这种写法的也按这张表。没列出的原样留着。
   */
  posMarkers?: Record<string, PosRule>
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
  /** 按词类标记设了词类的义项数 */
  posMarked?: number
  /** 方言列里新建的方言 */
  newDialects?: string[]
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
    senseCodes: {},
    senseMarkers: {},
    posMarkers: {}
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
    if (/^(释义|含义|意思|意义|定义|中文|汉语|meaning|definition|gloss_zh|definition_zh)$/.test(k))
      return { kind: 'definition', lang: 'zh' }
    if (/^(english|definition_en|gloss_en|英文)$/.test(k)) return { kind: 'definition', lang: 'en' }
    // 带语言代码的释义列：导出的 definition_ja、语素导出的 meaning_zh 都认得
    const langCol =
      /^(?:definition|meaning|gloss|释义|意义)[_:\s(（-]+([a-z]{2,3}(?:-[a-z]{2,4})?)[)）]?$/.exec(
        k
      )
    if (langCol) return { kind: 'definition', lang: langCol[1] }
    if (/^(标签|tags?)$/.test(k)) return { kind: 'tags' }
    if (/^(备注|注|注释|notes?|comment)$/.test(k)) return { kind: 'notes' }
    if (/^(原始形|祖语|原始.*语|proto|etymon|source)$/.test(k)) return { kind: 'protoForm' }
    if (/^(语言|language|lang)$/.test(k)) return { kind: 'language' }
    if (/^(方言|dialects?)$/.test(k)) return { kind: 'dialects' }
    if (/^(词源类别|词源类型|etymology type|etymology_type)$/.test(k))
      return { kind: 'etymologyType' }
    if (/^(词源说明|词源备注|etymology|etym|ety)$/.test(k)) return { kind: 'etymologyNotes' }
    if (/^(中间态|中间形式|stages?)$/.test(k)) return { kind: 'etymologyStage' }
    if (/^(同义词?|近义词|synonyms?)$/.test(k)) return { kind: 'relation', relKind: 'synonym' }
    if (/^(反义词?|antonyms?)$/.test(k)) return { kind: 'relation', relKind: 'antonym' }
    if (/^(关系|参见|relations?|see also|related)$/.test(k))
      return { kind: 'relation', relKind: 'related' }
    if (/^(构形|paradigm)$/.test(k)) return { kind: 'paradigm' }
    if (/^(构形变体|paradigm variant)$/.test(k)) return { kind: 'paradigmVariant' }
    if (/^(文字|文字写法|script)$/.test(k)) return { kind: 'scriptForm' }
    if (/^(异体形|allomorphs?)$/.test(k)) return { kind: 'allomorphs' }
    if (/^(form2|第二形式)$/.test(k)) return { kind: 'form2' }
    if (/^(发音|读音|音标|ipa|pronunciation)$/.test(k)) return { kind: 'pronunciation' }
    if (/^(gloss|缩写)$/.test(k)) return { kind: 'gloss' }
    if (/^(类型|type)$/.test(k)) return { kind: 'morphemeType' }
    return { kind: 'ignore' }
  })
  return { ...mapping, columns: cols }
}

/** 名字或缩写对得上的词类（名字优先）；缩写末尾的点可有可无 */
export function findPosByText(
  project: Pick<Project, 'posList'>,
  text: string
): PartOfSpeech | undefined {
  const s = text.trim()
  if (!s) return undefined
  const bare = s.replace(/\.$/, '')
  return (
    project.posList.find((p) => Object.values(p.name).some((n) => n?.trim() === s)) ??
    project.posList.find((p) => !!p.abbr.trim() && p.abbr.trim().replace(/\.$/, '') === bare)
  )
}

/**
 * 常见的词类缩写 → 词类名（中文 / 英文）：向导里没设过的词类标记拿它当默认值。
 * 只是起手的建议，每一个都能在向导里改。
 */
export const POS_PRESETS: readonly { labels: readonly string[]; zh: string; en: string }[] = [
  { labels: ['n', 'noun'], zh: '名词', en: 'noun' },
  { labels: ['v', 'verb'], zh: '动词', en: 'verb' },
  { labels: ['vt', 'v.t'], zh: '及物动词', en: 'transitive verb' },
  { labels: ['vi', 'v.i'], zh: '不及物动词', en: 'intransitive verb' },
  { labels: ['adj', 'a'], zh: '形容词', en: 'adjective' },
  { labels: ['adv', 'ad'], zh: '副词', en: 'adverb' },
  { labels: ['pron'], zh: '代词', en: 'pronoun' },
  { labels: ['prep'], zh: '介词', en: 'preposition' },
  { labels: ['postp'], zh: '后置词', en: 'postposition' },
  { labels: ['conj'], zh: '连词', en: 'conjunction' },
  { labels: ['num'], zh: '数词', en: 'numeral' },
  { labels: ['int', 'interj'], zh: '感叹词', en: 'interjection' },
  { labels: ['part', 'ptcl'], zh: '小品词', en: 'particle' },
  { labels: ['art'], zh: '冠词', en: 'article' },
  { labels: ['det'], zh: '限定词', en: 'determiner' },
  { labels: ['aux'], zh: '助动词', en: 'auxiliary' },
  { labels: ['cl', 'clf', 'mw'], zh: '量词', en: 'classifier' },
  { labels: ['onom'], zh: '拟声词', en: 'onomatopoeia' },
  { labels: ['abbr'], zh: '缩略语', en: 'abbreviation' },
  { labels: ['phr'], zh: '词组', en: 'phrase' },
  { labels: ['pref'], zh: '前缀', en: 'prefix' },
  { labels: ['suf', 'suff'], zh: '后缀', en: 'suffix' }
]

const presetOf = (label: string): (typeof POS_PRESETS)[number] | undefined =>
  POS_PRESETS.find((p) => p.labels.includes(label)) ??
  POS_PRESETS.find((p) => p.labels.includes(label.toLowerCase()))

/**
 * 没设过的词类标记默认怎么处理：项目里已经有这个缩写或名字的词类就用它；是常见缩写就用对应的词类名
 * （项目里有这个中文或英文名字的词类时用项目里的）；都不是时，短的先设成词类（名字就是标记本身），长的先原样留着。
 */
export function defaultPosRule(label: string, posList: PartOfSpeech[], locale: string): PosRule {
  const own = findPosByText({ posList }, label)
  if (own) return { action: 'pos', value: posName(own) }
  const preset = presetOf(label)
  // 不认得的：短的（不超过四个字、中间没有点）先当词类；house、e.g 这样的多半是正文，先原样留着
  if (!preset)
    return { action: [...label].length <= 4 && !label.includes('.') ? 'pos' : 'keep', value: '' }
  const same = posList.find((p) =>
    Object.values(p.name).some((n) => n === preset.zh || n === preset.en)
  )
  return {
    action: 'pos',
    value: same ? posName(same) : locale.startsWith('zh') ? preset.zh : preset.en
  }
}

/**
 * 词类标记设成的词类：名字或缩写对得上的已有词类；斜杠、加号连着的几个是它们组成的复合词类；
 * 都没有就新建，缩写取常见缩写表里这个名字对应的（名词 → n.），不在表里就用标记本身加点。
 */
function resolvePos(
  project: Project,
  value: string,
  label: string,
  report: ImportReport
): PartOfSpeech {
  const found = findPosByText(project, value)
  if (found) return found
  const pieces = value.split(/\s*[/+]\s*/).filter(Boolean)
  if (pieces.length > 1) {
    const r = ensureCompoundPos(
      project,
      pieces.map((x) => resolvePos(project, x, label ? x : '', report).id)
    )!
    if (r.created) report.newPos.push(posName(r.pos))
    return r.pos
  }
  const preset = POS_PRESETS.find((p) => p.zh === value || p.en === value)
  const abbr = preset ? `${preset.labels[0]}.` : /^[A-Za-z]/.test(label) ? `${label}.` : ''
  const pos: PartOfSpeech = {
    id: newId(),
    name: { [guessLang(value)]: value },
    abbr,
    paradigmId: null
  }
  project.posList.push(pos)
  report.newPos.push(value)
  return pos
}

/** 名字、缩写或 id 对得上的语言（不分大小写） */
function findLanguage(project: Project, text: string): Language | undefined {
  const s = text.trim().toLowerCase()
  if (!s) return undefined
  return project.languages.find(
    (l) =>
      l.id === text.trim() ||
      l.name.trim().toLowerCase() === s ||
      (!!l.abbr && l.abbr.trim().toLowerCase() === s)
  )
}

/** 名字或 id 对得上的一项（正字法、文字） */
function byName<T extends { id: Id; name: string }>(list: T[], text: string): T | undefined {
  const s = text.trim().toLowerCase()
  return s ? list.find((x) => x.id === text.trim() || x.name.trim().toLowerCase() === s) : undefined
}

/** 这门语言里名字或缩写对得上的方言，没有就新建一个 */
function ensureDialect(
  lang: Language | undefined,
  name: string,
  report: ImportReport
): Dialect | null {
  const s = name.trim()
  if (!lang || !s) return null
  const found = lang.dialects.find(
    (d) => d.id === s || d.name.trim() === s || (!!d.abbr && d.abbr.trim() === s)
  )
  if (found) return found
  const d: Dialect = { id: newId(), name: s, abbr: '' }
  lang.dialects.push(d)
  ;(report.newDialects ??= []).push(s)
  return d
}

/** 词源类别的常见写法（中英文名字、说法）→ 内置类别 */
const ETYMOLOGY_ALIASES: Record<string, EtymologyType> = {
  root: 'root',
  词根: 'root',
  compound: 'compound',
  compounding: 'compound',
  复合: 'compound',
  合成: 'compound',
  derivation: 'derivation',
  derived: 'derivation',
  派生: 'derivation',
  soundchange: 'soundChange',
  'sound change': 'soundChange',
  音变: 'soundChange',
  borrowing: 'borrowing',
  borrowed: 'borrowing',
  loan: 'borrowing',
  loanword: 'borrowing',
  借词: 'borrowing',
  借用: 'borrowing',
  inherited: 'inherited',
  inherit: 'inherited',
  native: 'inherited',
  继承: 'inherited',
  固有: 'inherited',
  unknown: 'unknown',
  未知: 'unknown',
  不明: 'unknown'
}

/** 词源类别：认得的写法转成内置类别，认不出的原样当自定义类别 */
export function etymologyTypeOf(text: string): string {
  const s = text.trim()
  return ETYMOLOGY_ALIASES[s.toLowerCase()] ?? s
}

/** 备注前面加上说明（列名之类）：「出处：……」 */
function withLabel(label: string | undefined, text: string): string {
  const l = (label ?? '').trim()
  return !l ? text : `${l}${/[\u3400-\u9fff]/.test(l) ? '：' : ': '}${text}`
}

function ensurePos(project: Project, name: string, report: ImportReport): PartOfSpeech {
  const found = findPosByText(project, name)
  if (found) return found
  // 「名词/动词」这样斜杠连着的是复合词类（导出时复合词类就这么写）
  if (name.split(/\s*[/+]\s*/).filter(Boolean).length > 1)
    return resolvePos(project, name, '', report)
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
  map: Map<string, string | null>
): { text: string; tags: string[] } {
  if (!map.size) return { text, tags: [] }
  const codes = [...map.keys()].sort((a, b) => b.length - a.length)
  let rest = text.trimStart()
  // 一长串数字（2020年）是正文，不是连写的编码
  if ((/^\d+/.exec(rest)?.[0].length ?? 0) > 3) return { text, tags: [] }
  const tags: string[] = []
  let hits = 0
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
    // 只去掉的编码记成 null：拿掉，不留标签
    const label = map.get(hit)
    if (label) tags.push(label)
    hits++
    rest = rest.slice(hit.length)
  }
  rest = rest.replace(/^[\s、.．)）:：,，]+/, '')
  if (!hits || !rest) return { text, tags: [] }
  return { text: rest, tags: [...new Set(tags)] }
}

/** 释义开头紧挨着文字的数字：「1离开」「01出发」算，「1、离开」「2. 前往」这种序号和「2020年」不算 */
const CODE_RE = /^\s*(\d{1,3})\s?(?=[^\d\s、.．)）:：,，;；])/u

export interface CodeStat {
  /** 单个数字 */
  code: string
  count: number
  /** 在哪几列见到（列序号） */
  columns: number[]
  /** 第一次见到时所在的那一段 */
  sample: string
}

/** 释义列里义项开头的数字编码，按单个数字列出（连写的 01 算 0 和 1） */
export function findPrefixCodes(rows: string[][], mapping: CsvMapping): CodeStat[] {
  if (mapping.target !== 'lexemes') return []
  const cols = mapping.columns.flatMap((c, i) => (c.kind === 'definition' ? [i] : []))
  const stats = new Map<string, CodeStat>()
  for (const row of mapping.hasHeader ? rows.slice(1) : rows)
    for (const ci of cols)
      for (const part of mapping.splitSenses ? (row[ci] ?? '').split(/[;；]/) : [row[ci] ?? '']) {
        const m = CODE_RE.exec(part)
        if (!m) continue
        for (const code of new Set(m[1])) {
          const st = stats.get(code)
          if (!st) stats.set(code, { code, count: 1, columns: [ci], sample: part.trim() })
          else {
            st.count++
            if (!st.columns.includes(ci)) st.columns.push(ci)
          }
        }
      }
  return [...stats.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/** 预设里读来的编码表：只留认得的处理方式 */
export function cleanCodeRules(raw: unknown): Record<string, CodeRule> {
  const out: Record<string, CodeRule> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [code, r] of Object.entries(raw as Record<string, unknown>)) {
    const { action, value } = (r ?? {}) as { action?: unknown; value?: unknown }
    if (code && (CODE_ACTIONS as readonly unknown[]).includes(action))
      out[code] = {
        action: action as CodeRule['action'],
        value: typeof value === 'string' ? value : ''
      }
  }
  return out
}

/** 旧版「编码=标签」文字转成编码表（老预设用） */
export function codeRulesFromPrefixMap(text: string): Record<string, CodeRule> {
  const out: Record<string, CodeRule> = {}
  for (const [code, label] of parsePrefixMap(text))
    out[code] = { action: 'tag', value: label === code ? '' : label }
  return out
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
 * 把标记落到义项上：设语域的加进语域（可以几个），设标签的加标签。返回用上了没有。
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
    // 一个义项可以有几个语域：设语域的都加进语域，设标签的加进标签
    const list = rule.action === 'register' ? sense.registers : sense.tags
    if (!list.includes(value)) list.push(value)
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

/** 词类标记里的字：不含空白、点、分隔符、括号 */
const POS_CHAR = String.raw`[^\s.;；,，、:：/&+()（）\[\]【】〔〕〖〗［］〈〉]`
/** 一个词类标记：拉丁字母开头，后面至多七个字，以点结尾；n.f. 这样点后紧跟着字母的连成一个 */
const POS_TOKEN = String.raw`[A-Za-z]${POS_CHAR}{0,7}\.(?:[A-Za-z]${POS_CHAR}{0,7}\.)*`
const POS_TOKEN_RE = new RegExp(POS_TOKEN, 'gu')
/** 开头连着的几个词类标记，中间可以用斜杠、&、加号、逗号、顿号或空白隔开 */
const POS_CHAIN_RE = new RegExp(
  String.raw`^${POS_TOKEN}(?:(?:\s*[/&+,，、]\s*|\s+)${POS_TOKEN})*`,
  'u'
)
/** 词类标记前面可以先有序号（1、 2.）和几组方括号标记 */
const POS_LEAD_RE = new RegExp(
  String.raw`^\s*(?:\d{1,3}\s*[、.．)）]\s*)?(?:(?:${bracketGroups(BRACKET_PAIRS)})\s*)*`,
  'u'
)

export interface PosToken {
  /** 去掉末尾点的标记 */
  label: string
  /** 原样的写法（带点） */
  raw: string
  /** 在文字里的起止 */
  at: number
  end: number
}

const tokensIn = (chain: string, offset: number): PosToken[] =>
  [...chain.matchAll(POS_TOKEN_RE)].map((m) => ({
    label: m[0].slice(0, -1),
    raw: m[0],
    at: offset + (m.index ?? 0),
    end: offset + (m.index ?? 0) + m[0].length
  }))

/** 文字开头（序号、方括号标记之后）连着的词类标记；后面没有正文的不算（整段就是 house. 这样带句点的） */
export function scanPos(text: string): PosToken[] {
  const lead = POS_LEAD_RE.exec(text)?.[0].length ?? 0
  const chain = POS_CHAIN_RE.exec(text.slice(lead))
  if (!chain || !/[^\s，,、:：;；]/u.test(text.slice(lead + chain[0].length))) return []
  return tokensIn(chain[0], lead)
}

/** 词类列里整格都是词类标记（n.、n./v.）时拆出来 */
export function posCellTokens(cell: string): PosToken[] {
  const s = cell.trim()
  const chain = POS_CHAIN_RE.exec(s)
  return chain && chain[0].length === s.length ? tokensIn(s, 0) : []
}

/**
 * 把开头的词类标记从文字里拿掉：只拿 rules 里处理方式不是 keep 的，连着的几个遇到 keep 的就停。
 * 序号、方括号标记留在原处；返回剩下的文字和拿掉的标记。
 */
export function takePos(
  text: string,
  rules: Record<string, PosRule>
): { text: string; labels: string[] } {
  const labels: string[] = []
  let from = -1
  let to = -1
  for (const tok of scanPos(text)) {
    const rule = rules[tok.label]
    if (!rule || rule.action === 'keep') break
    if (from < 0) from = tok.at
    to = tok.end
    labels.push(tok.label)
  }
  if (!labels.length) return { text, labels }
  return { text: text.slice(0, from) + text.slice(to).replace(/^[\s/&+,，、:：]+/, ''), labels }
}

export interface PosStat {
  /** 去掉末尾点的标记 */
  label: string
  /** 第一次见到时的写法（带点） */
  raw: string
  count: number
  /** 在哪几列见到（列序号） */
  columns: number[]
  /** 第一次见到时所在的那一段 */
  sample: string
}

/** 词类列与释义列里出现的词类标记（只对词条），按次数从多到少 */
export function findPosMarkers(rows: string[][], mapping: CsvMapping): PosStat[] {
  if (mapping.target !== 'lexemes') return []
  const cols = mapping.columns.flatMap((c, i) =>
    c.kind === 'definition' || c.kind === 'pos' ? [i] : []
  )
  if (!cols.length) return []
  const stats = new Map<string, PosStat>()
  const note = (tok: PosToken, ci: number, sample: string): void => {
    const st = stats.get(tok.label)
    if (!st) {
      stats.set(tok.label, { label: tok.label, raw: tok.raw, count: 1, columns: [ci], sample })
      return
    }
    st.count++
    if (!st.columns.includes(ci)) st.columns.push(ci)
  }
  for (const row of mapping.hasHeader ? rows.slice(1) : rows)
    for (const ci of cols) {
      const cell = (row[ci] ?? '').trim()
      if (!cell) continue
      if (mapping.columns[ci].kind === 'pos') {
        for (const tok of posCellTokens(cell)) note(tok, ci, cell)
        continue
      }
      for (const part of mapping.splitSenses ? cell.split(/[;；]/) : [cell]) {
        const seen = new Set<number>()
        // 义项开头，以及每个方括号标记后面（标记切出来的一段也可以有自己的词类）
        for (const start of [0, ...scanMarkers(part).map((m) => m.end)])
          for (const tok of scanPos(part.slice(start))) {
            if (seen.has(start + tok.at)) continue
            seen.add(start + tok.at)
            note(tok, ci, part.trim())
          }
      }
    }
  return [...stats.values()].sort((a, b) => b.count - a.count)
}

/** 预设里读来的词类标记表：只留认得的处理方式 */
export function cleanPosRules(raw: unknown): Record<string, PosRule> {
  const out: Record<string, PosRule> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [label, r] of Object.entries(raw as Record<string, unknown>)) {
    const { action, value } = (r ?? {}) as { action?: unknown; value?: unknown }
    if (label && (POS_ACTIONS as readonly unknown[]).includes(action))
      out[label] = {
        action: action as PosRule['action'],
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
  const posRules = mapping.posMarkers ?? {}
  const hasPos =
    mapping.target === 'lexemes' && Object.values(posRules).some((r) => r.action !== 'keep')
  let posMarked = 0
  /** 词类标记 → 词类 id：一次导入里同一个标记只找一次，要新建的也只建一次 */
  const posByLabel = new Map<string, Id | null>()
  const posForLabel = (label: string): Id | null => {
    if (!posByLabel.has(label)) {
      const rule = posRules[label]
      posByLabel.set(
        label,
        rule?.action === 'pos'
          ? resolvePos(project, rule.value.trim() || label, label, report).id
          : null
      )
    }
    return posByLabel.get(label) ?? null
  }
  /** 几个词类落成一个：一个就是它，几个就是它们组成的复合词类 */
  const posOf = (ids: Id[]): Id | null => {
    const r = ids.length ? ensureCompoundPos(project, ids) : null
    if (r?.created) report.newPos.push(posName(r.pos))
    return r ? r.pos.id : null
  }
  /** 词类标记落到义项上：设词类的记成义项的词类，设标签的加进义项标签 */
  const applyPosLabels = (s: Sense, labels: readonly string[]): boolean => {
    const ids: Id[] = []
    for (const label of labels) {
      const rule = posRules[label]
      if (rule?.action === 'tag') {
        const v = rule.value.trim() || label
        if (!s.tags.includes(v)) s.tags.push(v)
      } else if (rule?.action === 'pos') {
        const id = posForLabel(label)
        if (id && !ids.includes(id)) ids.push(id)
      }
    }
    const id = posOf(ids)
    if (id) s.posId = id
    return !!id
  }
  const existingLemmas = new Set(
    mapping.target === 'lexemes'
      ? project.lexemes.filter((l) => l.languageId === mapping.languageId).map((l) => l.lemma)
      : project.morphemes.filter((m) => m.languageId === mapping.languageId).map((m) => m.form)
  )

  /** 释义开头的编码：旧版「编码=标签」加上新的编码表；只去掉的记成 null */
  const prefixMap = new Map<string, string | null>(parsePrefixMap(mapping.sensePrefixMap ?? ''))
  for (const [code, rule] of Object.entries(mapping.senseCodes ?? {}))
    if (rule.action === 'keep') prefixMap.delete(code)
    else prefixMap.set(code, rule.action === 'tag' ? rule.value.trim() || code : null)
  const warnOnce = (msg: string): void => {
    if (!report.warnings.includes(msg)) report.warnings.push(msg)
  }
  /** 这一行属于哪门语言：有语言列就按它找，找不到或者没写就是导入时选的语言 */
  const langCol = mapping.columns.findIndex((c) => c.kind === 'language')
  const baseLang = project.languages.find((l) => l.id === mapping.languageId)
  const langOf = (row: string[]): Language | undefined => {
    const raw = langCol >= 0 ? (row[langCol] ?? '').trim() : ''
    if (!raw) return baseLang
    const hit = findLanguage(project, raw)
    if (!hit) warnOnce(`找不到语言「${raw}」，这些行放进导入时选的语言`)
    return hit ?? baseLang
  }
  /** 词源来源、关系等全部行都建好再挂，好指向这次导入的其他行 */
  const pendingSources: { ety: Etymology; text: string; language: string; ownerId: Id }[] = []
  const pendingRelations: { lx: Lexeme; kind: string; targets: string[] }[] = []
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
      const lang = langOf(row)
      const lx = createLexeme(lang?.id ?? mapping.languageId, key)
      let variantText = ''
      const sense = lx.senses[0]
      const defs: Record<string, string[]> = {}
      /** 按义项序号记下从前缀里拆出来的标签 */
      const senseTags: string[][] = []
      /** 按义项序号记下管它的标记；备注里以标记开头的段落另起义项 */
      const senseMarks: string[][] = []
      /** 按义项序号记下管它的词类标记 */
      const sensePosLabels: string[][] = []
      const noteSenses: MarkedSegment[] = []
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
          case 'pos': {
            // 整格是词类标记（n.、n./v.）时按词类标记表；否则按名字或缩写找，找不到就新建
            const ids = hasPos
              ? posCellTokens(raw)
                  .map((tok) => posForLabel(tok.label))
                  .filter((id): id is Id => !!id)
              : []
            lx.posId = posOf(ids) ?? ensurePos(project, raw, report).id
            break
          }
          case 'definition': {
            // 有标记要处理时先留着编号：序号后面紧跟的括号也是标记
            const parts = mapping.splitSenses
              ? splitSenseText(raw, prefixMap.size > 0 || hasMarkers)
              : [raw]
            const base = (defs[spec.lang] ?? []).length
            const cleaned: string[] = []
            /** 词类标记管到同一格里下一个词类标记为止 */
            let carry: string[] = []
            for (const d of parts) {
              const r = extractSensePrefix(d, prefixMap)
              const numbered = r.tags.length > 0
              // 义项开头的词类标记先拿掉（这样 n.[古]金石 不会切出一个只有 n. 的义项），后面的方括号标记照常切
              const head = hasPos ? takePos(r.text, posRules) : { text: r.text, labels: [] }
              if (head.labels.length) carry = head.labels
              // 标记再把一段切成几个义项；不拆义项时只把标记拿掉，都算这一个义项的
              const segs: MarkedSegment[] = !hasMarkers
                ? [{ text: head.text, markers: [] }]
                : mapping.splitSenses
                  ? splitByMarkers(head.text, markerRules, numbered)
                  : [removeMarkers(head.text, markerRules, numbered)]
              segs.forEach((seg, k) => {
                let text = seg.text
                // 标记切出来的一段开头也可以有自己的词类标记
                if (hasPos && k > 0) {
                  const own = takePos(text, posRules)
                  if (own.labels.length) {
                    carry = own.labels
                    text = own.text
                  }
                }
                const at = base + cleaned.length
                if (numbered) senseTags[at] = [...new Set([...(senseTags[at] ?? []), ...r.tags])]
                if (seg.markers.length) senseMarks[at] = [...(senseMarks[at] ?? []), ...seg.markers]
                if (carry.length && !sensePosLabels[at]) sensePosLabels[at] = carry
                const keepNumber = !mapping.splitSenses || (numbered && k === 0)
                cleaned.push(keepNumber ? text : stripNumbering(text))
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
            if (kept) {
              const line = withLabel(spec.label, kept)
              lx.notes = lx.notes ? `${lx.notes}\n${line}` : line
            }
            break
          }
          case 'protoForm':
            pendingSources.push({
              ety: lx.etymology,
              text: raw,
              language: spec.language ?? '',
              ownerId: lx.id
            })
            break
          case 'etymologyType':
            lx.etymology.type = etymologyTypeOf(raw)
            break
          case 'etymologyStage':
            lx.etymology.stages.push({
              id: newId(),
              form: raw,
              type: '',
              notes: spec.label?.trim() ?? ''
            })
            break
          case 'dialects':
            for (const name of splitTags(raw, mapping.tagSeparator)) {
              const d = ensureDialect(lang, name, report)
              if (d && !lx.dialectIds.includes(d.id)) lx.dialectIds.push(d.id)
            }
            break
          case 'relation':
            pendingRelations.push({
              lx,
              kind: spec.relKind?.trim() || 'related',
              targets: splitTags(raw, mapping.tagSeparator)
            })
            break
          case 'scriptForm': {
            const sc =
              lang && (spec.script?.trim() ? byName(lang.scripts, spec.script) : lang.scripts[0])
            if (sc) lx.scriptForms[sc.id] = raw
            else
              warnOnce(`「${lang?.name ?? ''}」里没有文字「${spec.script ?? ''}」，文字写法没导入`)
            break
          }
          case 'paradigm': {
            const pd = project.paradigms.find(
              (p) => p.id === raw || Object.values(p.name).some((n) => n?.trim() === raw)
            )
            if (pd) lx.paradigmId = pd.id
            else warnOnce(`找不到构形「${raw}」`)
            break
          }
          case 'paradigmVariant':
            variantText = raw
            break
          case 'language':
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
            const ortho =
              lang &&
              (spec.orthography?.trim()
                ? byName(lang.orthographies, spec.orthography)
                : lang.orthographies.find((o) => o.isPrimary))
            if (ortho) lx.pronunciations[ortho.id] = { ipa: raw, irregular: true }
            else
              warnOnce(
                `「${lang?.name ?? ''}」里没有正字法「${spec.orthography ?? ''}」，发音没导入`
              )
            break
          }
          case 'feature': {
            const [cid, vid] = ensureCategoryValue(project, spec.category, raw, report)
            lx.features[cid] = vid
            break
          }
          case 'register':
            // 语域列里几个语域用逗号、顿号隔开
            for (const r of splitTags(raw, mapping.tagSeparator))
              if (!sense.registers.includes(r)) sense.registers.push(r)
            break
          case 'gloss':
          case 'morphemeType':
          case 'form2':
          case 'allomorphs':
            report.warnings.push(`列 ${ci + 1} 的字段类型只适用于语素，已忽略`)
            break
        }
      })
      // 构形变体：在词条指名的构形里找，没指名就在词类绑定的构形里找
      if (variantText) {
        const pid = lx.paradigmId ?? posParadigmId(project, lx.posId)
        const v = project.paradigms
          .filter((p) => !pid || p.id === pid)
          .flatMap((p) => p.variants)
          .find((x) => x.id === variantText || x.name.trim() === variantText)
        if (v) lx.paradigmVariantId = v.id
        else warnOnce(`找不到构形变体「${variantText}」`)
      }
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
        if (sensePosLabels[i]?.length && applyPosLabels(s, sensePosLabels[i])) posMarked++
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
      // 没有词类列时：义项的词类都一样就是词条的，不一样就是它们组成的复合词类；跟词条一样的义项不再单独记
      if (!lx.posId)
        lx.posId = posOf([...new Set(lx.senses.flatMap((s) => (s.posId ? [s.posId] : [])))])
      for (const s of lx.senses) if (s.posId && s.posId === lx.posId) delete s.posId
      lx.tags = [...new Set(lx.tags)]
      project.lexemes.push(lx)
    } else {
      const m = createMorpheme(langOf(row)?.id ?? mapping.languageId, mapping.defaultMorphemeType)
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
          case 'notes': {
            const line = withLabel(spec.label, raw)
            m.notes = m.notes ? `${m.notes}\n${line}` : line
            break
          }
          case 'etymologyNotes':
            m.etymology.notes = raw
            break
          case 'etymologyType':
            m.etymology.type = etymologyTypeOf(raw)
            break
          case 'protoForm':
            pendingSources.push({
              ety: m.etymology,
              text: raw,
              language: spec.language ?? '',
              ownerId: m.id
            })
            break
          case 'etymologyStage':
            m.etymology.stages.push({
              id: newId(),
              form: raw,
              type: '',
              notes: spec.label?.trim() ?? ''
            })
            break
          case 'form2':
            m.form2 = raw
            break
          case 'allomorphs':
            // 几个异体形用分号隔开，形式和环境之间用斜杠：lar / _V；ler / Front_
            for (const item of raw.split(/[;；\n]/)) {
              const [form, ...env] = item.split('/')
              if (form?.trim())
                m.allomorphs.push({ form: form.trim(), environment: env.join('/').trim() })
            }
            break
          case 'language':
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
  // 词源来源与关系：全部行都建好了再挂，可以指向这次导入的其他行
  const lemmaIndex = new Map<string, Lexeme[]>()
  for (const l of project.lexemes) lemmaIndex.set(l.lemma, [...(lemmaIndex.get(l.lemma) ?? []), l])
  const noHyphens = (s: string): string => s.replace(/^[-=]+|[-=]+$/g, '')
  for (const { ety, text, language, ownerId } of pendingSources) {
    const lang = language.trim() ? findLanguage(project, language) : undefined
    for (const piece of text.split(/\s+\+\s+/)) {
      // 「形式 ‘意义’」：引号里的是来源的意义
      const quoted = /^(.*?)\s*[‘'"“](.*)[’'"”]\s*$/u.exec(piece.trim())
      const form = (quoted ? quoted[1] : piece).trim()
      if (!form) continue
      // 来源语言是项目里的语言：先找同形的单词，再找语素，都没有才记成外部来源
      const bare = form.replace(/^\*+/, '')
      const lexeme = lang
        ? (lemmaIndex.get(bare) ?? []).find((l) => l.languageId === lang.id && l.id !== ownerId)
        : undefined
      const morpheme =
        lang && !lexeme
          ? project.morphemes.find(
              (x) =>
                x.languageId === lang.id &&
                x.id !== ownerId &&
                noHyphens(x.form) === noHyphens(bare)
            )
          : undefined
      if (lexeme) ety.sources.push({ kind: 'lexeme', id: lexeme.id })
      else if (morpheme) ety.sources.push({ kind: 'morpheme', id: morpheme.id })
      else
        ety.sources.push({
          kind: 'external',
          language: lang?.name ?? language.trim(),
          form,
          meaning: quoted ? quoted[2].trim() : ''
        })
    }
    if (ety.type === 'unknown') ety.type = 'inherited'
  }
  const missingTargets = new Set<string>()
  for (const { lx, kind, targets } of pendingRelations)
    for (const target of targets) {
      const same = (lemmaIndex.get(target) ?? []).filter((l) => l.id !== lx.id)
      const hit = same.find((l) => l.languageId === lx.languageId) ?? same[0]
      if (!hit) missingTargets.add(target)
      else if (!lx.relations.some((r) => r.kind === kind && r.lexemeId === hit.id))
        lx.relations.push({ kind, lexemeId: hit.id })
    }
  if (missingTargets.size)
    report.warnings.push(
      `关系里这些单词在项目里找不到：${[...missingTargets].slice(0, 20).join('、')}${missingTargets.size > 20 ? '…' : ''}`
    )
  if (marked) report.marked = marked
  if (posMarked) report.posMarked = posMarked
  project.meta.updatedAt = now()
  return report
}

/** 义项之间用分号：有汉字就用全角分号，再导入时照样拆成几个义项 */
const joinSenses = (parts: string[]): string =>
  parts.join(parts.some((p) => /[\u3400-\u9fff]/.test(p)) ? '；' : '; ')

/** 义项的词类写回表格时用的标记：缩写加上点还认得出是词类标记（拉丁字母开头）才写，后面空一格 */
function posMarkerText(p: PartOfSpeech | undefined): string {
  const a = p?.abbr.trim() ?? ''
  if (!a) return ''
  const withDot = a.endsWith('.') ? a : `${a}.`
  return posCellTokens(withDot).length ? `${withDot} ` : ''
}

/**
 * 从已有词位反推一个 CSV（导出）。每种释义语言一列，义项用分号隔开，
 * 义项的语域写在前面成【语域】（几个就连写几个），再导入时向导把它们认成标记、设回语域；
 * 义项自己的词类（跟词条不一样时）写在最前面成 n. 这样的缩写，再导入时认成词类标记。
 */
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
      joinSenses(
        l.senses
          .filter((s) => s.definition[g])
          .map(
            (s) =>
              posMarkerText(sensePos(project, l, s)) +
              s.registers
                .map((r) => r.trim())
                .filter(Boolean)
                .map((r) => `【${r}】`)
                .join('') +
              s.definition[g]
          )
      )
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
