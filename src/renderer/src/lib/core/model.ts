/**
 * 千语集 · 项目数据模型（schema v1）
 *
 * 原则：软件不内置任何一门语言的术语。词类、语法维度、方言、标签、缩写
 * 全部是项目内的用户数据；这里只定义容器的形状。
 *
 * 所有集合都用有序数组而不是对象映射：顺序本身是用户数据，且 diff 友好。
 */

export const SCHEMA_VERSION = 1

export type Id = string

/** 多语言文本：键为 BCP-47 标签（zh、en、…），值为文本。允许只填一种。 */
export type LocalizedText = Record<string, string>

// ───────────────────────── 项目 ─────────────────────────

export interface Project {
  schemaVersion: number
  meta: ProjectMeta
  languages: Language[]
  ruleSets: RuleSet[]
  categories: GrammaticalCategory[]
  posList: PartOfSpeech[]
  morphemes: Morpheme[]
  lexemes: Lexeme[]
  paradigms: Paradigm[]
  sentences: Sentence[]
  phrasebook: Phrase[]
  abbreviations: Abbreviation[]
  docs: DocPage[]
  settings: ProjectSettings
}

export interface ProjectMeta {
  id: Id
  name: string
  description: string
  author: string
  createdAt: string // ISO 8601
  updatedAt: string
  /** 创建时使用的起步模板，仅作记录 */
  template: ProjectTemplate
  /** 写入该文件的软件版本 */
  appVersion: string
}

export type ProjectTemplate = 'blank' | 'family' | 'lexicanter' | 'csv'

export interface ProjectSettings {
  /** 主界面默认显示的语言 */
  defaultLanguageId: Id | null
  /** 释义等多语言字段的首选语言顺序 */
  glossLanguages: string[]
  /** 例句分词时视为语素边界的符号 */
  morphemeBoundaries: string[]
  /** gloss 缩写风格：leipzig = 大写英文缩写；native = 缩写表里的本地名 */
  abbreviationStyle: 'leipzig' | 'native'
  /** 用户自定义导出模板 */
  exportTemplates: ExportTemplate[]
  /** 语言数据默认字体（IPA 需完整覆盖） */
  dataFont: string
}

export interface ExportTemplate {
  id: Id
  name: string
  kind: 'entry' | 'gloss' | 'dictionary'
  template: string
}

// ───────────────────────── 语言 ─────────────────────────

export interface Language {
  id: Id
  name: string
  abbr: string
  color: string
  /** 语系树的父语言；null 表示根或平行语言 */
  parentId: Id | null
  notes: string
  phonemes: Phoneme[]
  /** 音类 / 自然类。名称不限单字母；引擎里按最长匹配处理。 */
  classes: PhonemeClass[]
  /** 多合字母替换表：规则匹配前把 from 换成 to，输出时换回 */
  digraphs: Digraph[]
  orthographies: Orthography[]
  syllable: SyllableSettings
  prosody: ProsodySettings
  phonotactics: Phonotactics
  /** 自定义字母表顺序，用于排序；空则按 Unicode */
  alphabet: string[]
  /** 方言 / 语域标签（用户自定义） */
  dialects: Dialect[]
}

export interface Phoneme {
  id: Id
  /** IPA 或任意符号 */
  symbol: string
  /** 特征维度 → 值，维度由用户自定义 */
  features: Record<string, string>
  /** 各正字法中的默认写法：orthographyId → grapheme */
  graphemes: Record<Id, string>
  notes: string
}

export interface PhonemeClass {
  id: Id
  name: string
  members: string[]
  /** 若由特征自动生成，记录生成条件；否则为 null */
  featureQuery: Record<string, string> | null
}

export interface Digraph {
  from: string
  to: string
}

export type TextDirection = 'ltr' | 'rtl' | 'ttb'

export interface Orthography {
  id: Id
  name: string
  font: string
  direction: TextDirection
  /** 正字法 → IPA 的规则文本（与音变共用规则语言） */
  rulesToIpa: string
  /** IPA → 正字法的规则文本 */
  rulesFromIpa: string
  /** 词条输入使用的基准正字法 */
  isPrimary: boolean
}

export interface SyllableSettings {
  enabled: boolean
  /** 如 "(C)(C)V(C)"，引用音类名 */
  template: string
  strategy: 'template' | 'maximal-onset'
}

export type ProsodyType = 'none' | 'stress' | 'pitch' | 'tone'

export interface ProsodySettings {
  type: ProsodyType
  /** 重音 / 音高：规则文本或类别表 */
  rules: string
  /** 声调：声调清单（名称、标记、数字） */
  tones: Tone[]
}

export interface Tone {
  id: Id
  name: string
  /** 调符或声调字母，如 ˧˥ */
  letter: string
  /** 数字标法，如 35 */
  digits: string
}

export interface Phonotactics {
  onsets: string[]
  nuclei: string[]
  codas: string[]
  illegal: string[]
  /** 造词时的权重，成分 → 权重 */
  weights: Record<string, number>
  minSyllables: number
  maxSyllables: number
}

export interface Dialect {
  id: Id
  name: string
  abbr: string
}

// ───────────────────────── 音变 ─────────────────────────

/**
 * 一套规则文本：音类声明、多合字母声明、`-* 阶段` 标记和规则行混写在一个文本里，
 * 语法见 docs/rules.md。文本本身是唯一真值，界面只是编辑器。
 * 一个项目可以有多套（例如同一祖语通往不同子语言的两条链）。
 */
export interface RuleSet {
  id: Id
  name: string
  notes: string
  text: string
  /** `-* 阶段` 标记名 → 该阶段对应的语言；未绑定为 null */
  stageLanguages: Record<string, Id | null>
  /** 测试台里的词，随项目保存 */
  testWords: string
  updatedAt: string
}

// ───────────────────────── 语法维度与词类 ─────────────────────────

export interface GrammaticalCategory {
  id: Id
  name: LocalizedText
  values: CategoryValue[]
}

export interface CategoryValue {
  id: Id
  name: LocalizedText
  /** gloss 缩写，如 NOM、PL */
  abbr: string
}

export interface PartOfSpeech {
  id: Id
  name: LocalizedText
  abbr: string
  /** 绑定的范式；孤立语词类可为 null */
  paradigmId: Id | null
}

// ───────────────────────── 语素 ─────────────────────────

export type MorphemeType =
  | 'root'
  | 'prefix'
  | 'suffix'
  | 'infix'
  | 'circumfix'
  | 'clitic'
  | 'pattern'
  | 'particle'

export interface Morpheme {
  id: Id
  languageId: Id
  type: MorphemeType
  form: string
  /** 环缀的第二部分；中缀的插入位置描述等 */
  form2: string
  allomorphs: Allomorph[]
  /** gloss 缩写或释义 */
  gloss: string
  meaning: LocalizedText
  features: Record<Id, Id>
  tags: string[]
  notes: string
}

export interface Allomorph {
  form: string
  /** 出现环境，规则语言写法 */
  environment: string
}

// ───────────────────────── 词位 ─────────────────────────

export interface Lexeme {
  id: Id
  languageId: Id
  lemma: string
  posId: Id | null
  /** 名词类别、动词类别等任意维度：categoryId → valueId */
  features: Record<Id, Id>
  tags: string[]
  dialectIds: Id[]
  senses: Sense[]
  etymology: Etymology
  /** 用户自定义的词干槽：名称 → 形式 */
  stems: Record<string, string>
  /** 范式槽位 → 形式 */
  forms: Record<string, InflectedForm>
  /** orthographyId → 发音 */
  pronunciations: Record<Id, Pronunciation>
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Sense {
  id: Id
  definition: LocalizedText
  tags: string[]
  dialectIds: Id[]
  register: string
  examples: Id[]
}

export type EtymologyType = 'root' | 'compound' | 'borrowing' | 'derivation' | 'unknown'

export interface Etymology {
  type: EtymologyType
  sources: EtymologySource[]
  protoForm: string
  notes: string
}

export type EtymologySource =
  | { kind: 'morpheme'; id: Id }
  | { kind: 'lexeme'; id: Id }
  | { kind: 'external'; language: string; form: string; meaning: string }

export interface InflectedForm {
  surface: string
  /** 是否由范式推导；false 表示手填 */
  derived: boolean
  /** 用户覆盖了推导值 */
  override: boolean
  /** 推导轨迹（各阶段中间形与命中规则） */
  trace: string[]
}

export interface Pronunciation {
  ipa: string
  irregular: boolean
}

// ───────────────────────── 范式 ─────────────────────────

export interface Paradigm {
  id: Id
  name: LocalizedText
  /** 参与笛卡尔积的维度 */
  dimensionIds: Id[]
  /** 被屏蔽的组合，键为槽位 key */
  disabledSlots: string[]
  /** 槽位 key → 生成器 */
  generators: Record<string, SlotGenerator>
  /** 继承自哪个范式，只覆盖差异槽位 */
  inheritsFrom: Id | null
}

export type SlotGenerator =
  | { kind: 'none' }
  | { kind: 'table' }
  | { kind: 'affix'; stem: string; prefix: string; suffix: string; infix: string; infixAt: string }
  | { kind: 'affix-sca'; stem: string; prefix: string; suffix: string; ruleSetId: Id | null; fromStage: string; toStage: string }
  | { kind: 'pattern'; stem: string; pattern: string }
  | { kind: 'reduplication'; stem: string; scope: 'full' | 'initial' | 'final'; length: number }

// ───────────────────────── 例句 ─────────────────────────

export interface Sentence {
  id: Id
  languageId: Id
  text: string
  /** orthographyId → 文本 */
  orthoTexts: Record<Id, string>
  translation: LocalizedText
  source: string
  tags: string[]
  tokens: Token[]
  /** 自由行：如逐字直译、注释 */
  extraLines: { label: string; text: string }[]
  notes: string
}

export interface Token {
  surface: string
  analyses: Analysis[]
  chosen: number
  confirmed: boolean
}

export interface Analysis {
  lexemeId: Id | null
  slot: string | null
  morphs: { form: string; gloss: string; morphemeId: Id | null }[]
}

// ───────────────────────── 其他 ─────────────────────────

export interface Phrase {
  id: Id
  languageId: Id
  category: string
  text: string
  translation: LocalizedText
  pronunciations: Record<Id, Pronunciation>
  variants: { text: string; note: string }[]
  tags: string[]
}

export interface Abbreviation {
  abbr: string
  name: LocalizedText
}

export interface DocPage {
  id: Id
  languageId: Id | null
  title: string
  markdown: string
  updatedAt: string
}
