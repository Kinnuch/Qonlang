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
  /** 纯欣赏模式：导入后只能阅览，不能改动也不会保存 */
  readOnly?: boolean
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
  /** 词库列表显示的列（键见 Lexicon 页）；空则用默认 */
  lexiconColumns: string[]
  /** 词条配图的统一尺寸（像素） */
  imageSize: { width: number; height: number }
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
  /** 自定义文字（书写系统），可多套 */
  scripts: Script[]
}

// ───────────────────────── 文字 ─────────────────────────

export type ScriptType =
  'alphabet' | 'abjad' | 'abugida' | 'syllabary' | 'logographic' | 'featural' | 'mixed' | 'other'

export interface Glyph {
  id: Id
  /** 字符本身（可含组合符号，PUA 亦可） */
  char: string
  /** 名称（来自字体 post 表或用户填写） */
  name: string
  /** 转写值：主正字法里对应的拼写；映射规则由此自动生成 */
  value: string
  /** 分类（字母 / 元音符号 / 附标 / 数字 / 标点……用户可改） */
  category: string
  notes: string
}

export interface Script {
  id: Id
  name: string
  type: ScriptType
  direction: TextDirection
  /** 字体：family 为系统字体名；dataUrl 非空时为内嵌字体文件（注册为 FontFace） */
  font: { family: string; dataUrl: string | null; fileName: string }
  glyphs: Glyph[]
  /**
   * 转写 → 文字 的规则文本（与音变共用规则语言）。
   * 其中一行 `@glyphs` 会展开为由字形表自动生成的映射（按转写值长度降序）。
   */
  rules: string
  notes: string
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

export type StressPosition =
  'initial' | 'second' | 'final' | 'penult' | 'antepenult' | 'weight' | 'manual'

export interface ProsodySettings {
  type: ProsodyType
  /** 重音位置（type 为 stress / pitch 时） */
  stressPosition: StressPosition
  /** 重音 / 音高的补充说明或例外表 */
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
  'root' | 'prefix' | 'suffix' | 'infix' | 'circumfix' | 'clitic' | 'pattern' | 'particle'

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
  etymology: Etymology
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
  /** 合并同形词条后叠加的其他词类 */
  extraPosIds?: Id[]
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
  /** scriptId → 手工指定的文字写法（覆盖自动映射）；缺省时按文字规则自动生成 */
  scriptForms: Record<Id, string>
  /** 配图（data URL，尺寸统一为 settings.imageSize） */
  images: LexemeImage[]
  /** 用户标注的词间关系（同义、反义、参见……种类自定义） */
  relations: LexemeRelation[]
  notes: string
  createdAt: string
  updatedAt: string
}

export interface LexemeImage {
  id: Id
  dataUrl: string
  caption: string
}

export interface LexemeRelation {
  kind: string
  lexemeId: Id
}

export interface Sense {
  id: Id
  definition: LocalizedText
  tags: string[]
  dialectIds: Id[]
  register: string
  examples: Id[]
}

/** 内置词源类别；用户也可以填任意自定义文本 */
export const ETYMOLOGY_TYPES = [
  'root',
  'compound',
  'derivation',
  'soundChange',
  'borrowing',
  'inherited',
  'unknown'
] as const
export type EtymologyType = (typeof ETYMOLOGY_TYPES)[number]

/** 词源链上的一个中间态：来源与词条之间的历史形式 */
export interface EtymologyStage {
  id: Id
  /** 中间形式 */
  form: string
  /** 走到这一步的类别，留空沿用整体类别 */
  type: string
  notes: string
}

export interface Etymology {
  /** 内置类别键或用户自定义文本 */
  type: string
  sources: EtymologySource[]
  /** 来源与词条之间的中间态，按时间顺序 */
  stages: EtymologyStage[]
  notes: string
  /** @deprecated 旧版原始形，载入时并入 sources */
  protoForm?: string
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

/**
 * 微调：生成之外的自定义小操作，每行一条，依次执行。
 * 速记：`-at` 去掉词尾 at；`+u` 追加 u；`^-e` 去掉词首 e；`^+a` 前置 a。
 * 含 `>` 的行按规则语言解释（如 `at > / _#`）。
 * pre 在拼接之后、跑音变之前执行；post 在最终形式上执行。
 */
export interface Adjust {
  pre?: string
  post?: string
}

export type SlotGenerator =
  | { kind: 'none' }
  | { kind: 'table' }
  | ({
      kind: 'affix'
      stem: string
      prefix: string
      suffix: string
      infix: string
      infixAt: string
    } & Adjust)
  | ({
      kind: 'affix-sca'
      stem: string
      prefix: string
      suffix: string
      ruleSetId: Id | null
      fromStage: string
      toStage: string
    } & Adjust)
  | ({ kind: 'pattern'; stem: string; pattern: string } & Adjust)
  | ({
      kind: 'reduplication'
      stem: string
      scope: 'full' | 'initial' | 'final'
      length: number
    } & Adjust)

// ───────────────────────── 例句 ─────────────────────────

export interface Sentence {
  id: Id
  languageId: Id
  text: string
  /** orthographyId → 文本 */
  orthoTexts: Record<Id, string>
  /** scriptId → 手工指定的文字写法（覆盖自动映射） */
  scriptForms: Record<Id, string>
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
