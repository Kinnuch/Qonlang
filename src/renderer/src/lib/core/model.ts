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
  /** 词条检视器里用户自己加的模块（异体字、文化注释……），在「词类与维度」里定义 */
  customFields: CustomField[]
  settings: ProjectSettings
  /** 语言页上的语系 / 语族 / 语支节点（0.9.4 起；旧文件没有） */
  languageGroups?: LanguageGroup[]
}

/** 语言分类节点的层级：语系 / 语族 / 语支 */
export type LanguageGroupLevel = 'family' | 'branch' | 'subbranch'
export const LANGUAGE_GROUP_LEVELS: LanguageGroupLevel[] = ['family', 'branch', 'subbranch']

/** 语系树上的分类节点：语言和下一级节点挂在它下面；可以指一门原始语当它的代表 */
export interface LanguageGroup {
  id: Id
  name: string
  abbr: string
  level: LanguageGroupLevel
  /** 上一级节点；null 是最外层 */
  parentId: Id | null
  protoLanguageId?: Id | null
  notes: string
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

export type TokenizerMode = 'whitespace' | 'character' | 'custom'
export const TOKENIZER_MODES: TokenizerMode[] = ['whitespace', 'character', 'custom']

export interface ProjectSettings {
  /** 主界面默认显示的语言 */
  defaultLanguageId: Id | null
  /** 释义等多语言字段的首选语言顺序 */
  glossLanguages: string[]
  /** 例句分词时视为语素边界的符号 */
  morphemeBoundaries: string[]
  /**
   * 例句怎么切成词：
   * whitespace 按空白（默认）；character 逐字（汉语式、日语式这种不用空格的表记）；
   * custom 用 tokenizerPattern 当分隔符正则。
   */
  tokenizer: TokenizerMode
  /** tokenizer 为 custom 时的分隔符正则（JS 写法，不带两边的斜杠） */
  tokenizerPattern: string
  /** 算作字母、不当标点剥掉的符号（阿拉伯语转写里的 `'` 这类）；词库里以它开头结尾的词自动算上 */
  tokenizerLetters?: string
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
  /** 音变、构形页签的分组（像浏览器的标签页分组，可以收起）；没写时按默认分法显示 */
  tabGroups?: { ruleSets?: TabGroupSet; paradigms?: TabGroupSet }
  /**
   * 构形的槽位算法：默认简洁——维度多的槽位（时-体-人称）没写法时，自动接着维度少的那个（时-体）往下变；
   * 勾了复杂模式就各算各的，维度多的不写就没有
   */
  complexSlots?: boolean
  /** 打了记号的词前面加什么符号；不写就是 * */
  markSymbol?: string
}

/** 一排页签的分组：分组本身按顺序排，members 记每个页签（规则集 / 构形 id）在哪个组 */
export interface TabGroupSet {
  groups: TabGroup[]
  members: Record<Id, Id>
}

export interface TabGroup {
  id: Id
  name: string
  /** TAB_GROUP_COLORS 里的一个 */
  color: string
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
  /** 挂在哪个语系 / 语族 / 语支节点下 */
  groupId?: Id | null
  /** 语言内部的历时阶段（上古 → 中古 → 现代），按时间先后排；音变的阶段标记可以绑到某一阶段 */
  stages?: LanguageStage[]
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
  /**
   * 模糊匹配时忽略的字符（关系图跨语言找词、词源来源搜索用）：
   * 比如喉音 H1 / H2 / H3 里的数字、词根里分音节的点。变音符与大小写总是忽略。
   */
  matchIgnore?: string
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
  /** 转写值：文字「转写来源」那一栏里对应的写法（默认是单词的拼写，意音文字可以是字号）；映射规则由此自动生成 */
  value: string
  /** 分类（字母 / 元音符号 / 附标 / 数字 / 标点……用户可改） */
  category: string
  notes: string
  /** 手写板上画的字：有它时软件把它做成字体挂在这套文字最前面，字符没填时自动分一个私用区码位 */
  drawing?: GlyphDrawing
}

/**
 * 手写的字：笔画是字体单位下的点列（一个 em = 1000，基线 y = 0、向上为正），带笔画粗细；advance 是字宽。
 * contours 是填实的闭合轮廓（从字体载入的、画板里拉出来的形状），路径命令同样是字体单位、y 向上；
 * 外轮廓逆时针、内洞顺时针，跟笔画叠在一起按非零规则填。
 */
export interface GlyphDrawing {
  strokes: { points: [number, number][]; width: number }[]
  contours?: {
    cmds: (
      | ['M', number, number]
      | ['L', number, number]
      | ['Q', number, number, number, number]
      | ['C', number, number, number, number, number, number]
      | ['Z']
    )[]
  }[]
  advance: number
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
  /** 音节拼合（CV / VC 音节文字用），不填就只按规则走 */
  packing?: ScriptPacking
  /** 竖排显示（默认关）：语料、短语、词库里的文字都竖着写；列的走向跟书写方向 */
  vertical?: boolean
  /**
   * 括号怎么转写：keep 括号照留、里外分开转写（默认）；
   * include 去掉括号、内容并进词里（可省音）；omit 连括号带内容都不写。
   */
  parens?: ParenMode
  /**
   * 文字写法按哪一栏转写：`lemma`（默认，单词）、`stem:<词干名>`、`form:<槽位名>`、
   * `pron:<正字法 id>`、`custom:<检视器模块 id>`；那一栏是空的就回落到单词。
   */
  from?: string
}

/**
 * 音节文字的拼合设置。可拼的格子直接从字形读音里推，
 * 这里只补软件推不出来的几件事：消音符、清浊对、元音长度。
 */
export interface ScriptPacking {
  enabled: boolean
  /** 消音符（特殊功能符号）的读音值，用来标清音或去掉元音 */
  killer: string
  /** 写法 → 字形字母，每行「dh=th」；用来把浊音、二合字母折成字形表里的字母 */
  letterMap: string
  /** 需要靠重复或消音符标出来的字母，空格分隔（一般是有清浊对立的清音） */
  marked: string
  /** 元音写几份，每行「á é = 2」 */
  lengths: string
  /** 长元音对应的基础元音，每行「á = a」 */
  baseVowels: string
  /** 辅音没有元音可拼时借用的元音 */
  dummyVowel: string
  /** 转写的切分单位，空格分隔（含二合字母）；留空则用语言的音位表 */
  letters: string
  /** 哪些单位算元音，空格分隔；留空则用语言的元音音位 */
  vowels: string
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
export type ParenMode = 'keep' | 'include' | 'omit'

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
  'initial' | 'second' | 'final' | 'penult' | 'antepenult' | 'weight' | 'manual' | 'custom'

export interface ProsodySettings {
  type: ProsodyType
  /** 重音位置（type 为 stress / pitch 时） */
  stressPosition: StressPosition
  /** 重音 / 音高的补充说明或例外表 */
  rules: string
  /** stressPosition 为 custom 时的重音规则（规则语法「重音规则」里 = 后面那一截） */
  stressRule?: string
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

/** 语言内部的一个历时阶段：只是名字与缩写，音系、词库还是整门语言一套 */
export interface LanguageStage {
  id: Id
  name: string
  abbr: string
  notes: string
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
  /** `-* 阶段` 标记名 → 绑定语言里的哪个历时阶段（那门语言分了阶段时才有） */
  stageLanguageStages?: Record<string, Id | null>
  /** 测试台里的词，随项目保存 */
  testWords: string
  updatedAt: string
}

// ───────────────────────── 语法维度与词类 ─────────────────────────

export interface GrammaticalCategory {
  id: Id
  name: LocalizedText
  values: CategoryValue[]
  /** 只给这几个词类用（词条录入时只列出对得上的）；空着或没写就是所有词类 */
  posIds?: Id[]
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
  /** 绑定的范式；孤立语词类可为 null。绑了几个时这是默认的那个 */
  paradigmId: Id | null
  /** 这个词类另外可选的构形（变位法二、三……）；词条在录入模式里挑，没挑的用 paradigmId */
  extraParadigmIds?: Id[]
  /**
   * 这个词类的词干槽（比如强形 / 中形 / 弱形）：构形流水线的「词干」从这里挑，
   * 词条录入时逐个填；没填的词条回落到词头。
   */
  stemSlots?: StemSlot[]
  /**
   * 复合词类由哪几个词类组成（比如名词兼动词）；不到两个就是普通词类。
   * 词条选了复合词类后，每个义项可以各自选其中一个。
   */
  components?: Id[]
}

export interface StemSlot {
  name: string
  /** 说明：这个词干是什么、从哪来 */
  notes: string
}

// ───────────────────────── 语素 ─────────────────────────

export type MorphemeType =
  'root' | 'prefix' | 'suffix' | 'infix' | 'circumfix' | 'clitic' | 'pattern' | 'particle'

/**
 * 词条、语素「对重音影响」的设置：勾上以后，音变、正字法里的重音规则能拿到这个词的词类
 * （条目写 <名词> 只对这个词类生效）和它自己的特殊重音（规则写了 @ 时整个词按它标）。
 */
export interface StressSettings {
  affects: boolean
  /** 把词类交给重音规则 */
  passPos: boolean
  /** 把下面的特殊重音交给重音规则 */
  passSpecial: boolean
  /** 特殊重音落在第几个音节：正数从前数、负数从后数，0 不重读 */
  special: number
  /** 语素用：算作哪个词类（语素自己没有词类，不选时只传它的类型） */
  posId?: Id | null
}

export interface Morpheme {
  id: Id
  languageId: Id
  /** 属于这门语言的哪个历时阶段；没有就是最新的阶段 */
  stageId?: Id | null
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
  /** 对重音影响（没勾过就没有这个字段） */
  stress?: StressSettings
}

export interface Allomorph {
  form: string
  /** 出现环境，规则语言写法 */
  environment: string
  /**
   * 只在这些维度取值下用（取值 id）：要全都在正在生成的那一格的取值里这一条才算数。
   * 没写（或者是空的）就是任何取值都行；跟 environment 都写了时两边都要对上。
   */
  values?: Id[]
}

// ───────────────────────── 词位 ─────────────────────────

export interface Lexeme {
  id: Id
  languageId: Id
  /** 属于这门语言的哪个历时阶段；没有就是最新的阶段 */
  stageId?: Id | null
  lemma: string
  posId: Id | null
  /** 指定用哪个构形推导；留空则按词类绑定 */
  paradigmId?: Id | null
  /** 用构形的哪个变体 */
  paradigmVariantId?: Id | null
  /**
   * 另外还用的构形（一个词既是名词又是动词：一个变格、一个变位）。形式照样存进 forms；
   * 槽位名跟前面的构形撞了的，键前面加「构形名·」
   */
  extraParadigms?: { paradigmId: Id; variantId?: Id | null }[]
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
  /** 检视器模块的内容：模块 id → 文字（列表型用顿号隔开）；一个都没填就没有这个字段 */
  custom?: Record<Id, string>
  /** 对重音影响（没勾过就没有这个字段） */
  stress?: StressSettings
  /** 收藏（列表左边的五角星）：自己挑出来的一批词，随手筛 */
  favorite?: boolean
  /** 记号：显示时单词前面加一个符号（符号是 settings.markSymbol） */
  marked?: boolean
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

/** 检视器模块的内容怎么录：text 一段文字（可以换行）；list 几项（顿号、逗号、分号隔开，词条卡里一项一个框） */
export type CustomFieldKind = 'text' | 'list'
export const CUSTOM_FIELD_KINDS: CustomFieldKind[] = ['text', 'list']
/** 模块在词条卡里放在哪：释义上方 / 释义与词源之间（默认）/ 词源下方 / 最下面 */
export type CustomFieldPosition = 'beforeSenses' | 'afterSenses' | 'afterEtymology' | 'end'
export const CUSTOM_FIELD_POSITIONS: CustomFieldPosition[] = [
  'beforeSenses',
  'afterSenses',
  'afterEtymology',
  'end'
]

/**
 * 检视器模块：用户给词条加的一块内容（异体字、文化注释、地域分布……），不用为每门语言往软件里加字段。
 * 词条卡按 position 排进去；CSV 导入时列名跟标题或别名一样就对上这一列。
 */
export interface CustomField {
  id: Id
  /** 标题（按释义语言写） */
  name: LocalizedText
  kind: CustomFieldKind
  position: CustomFieldPosition
  /** 只给这几门语言的词条用；空着是所有语言 */
  languageIds: Id[]
  /** 内容用哪套文字的字体显示（异体字这类）；null 用正文字体 */
  scriptId: Id | null
  /** 导入时除了标题还认这些列名 */
  aliases: string[]
}

export interface Sense {
  id: Id
  definition: LocalizedText
  tags: string[]
  dialectIds: Id[]
  /** 语域，可以有几个（古语、文学……） */
  registers: string[]
  /** 这个义项自己的词类（复合词类的词条里各义项分属不同词类时用）；没有就跟词条 */
  posId?: Id | null
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
  /** 绑到音变里的哪个阶段标记（历史形式链上手改这一步时记下来，后面几步从它接着推） */
  stage?: string
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
  /** 构形里勾了「影响发音」的槽位推出来的发音（基于正字法的 IPA 再经那一格的发音流水线） */
  ipa?: string
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

/** 构形变体：同一个槽位的另一套写法，显示时可切换 */
export interface ParadigmVariant {
  id: Id
  name: string
}

export interface Paradigm {
  id: Id
  name: LocalizedText
  /** 变体列表；空表示只有一套形式 */
  variants: ParadigmVariant[]
  /** 没选变体时那一套的名字；空着显示「通用」 */
  baseVariantName?: string
  /** 参与笛卡尔积的维度 */
  dimensionIds: Id[]
  /** 被屏蔽的组合，键为槽位 key */
  disabledSlots: string[]
  /** 槽位 key → 生成器；变体的键是「槽位key#变体id」 */
  generators: Record<string, SlotGenerator>
  /** 继承自哪个范式，只覆盖差异槽位 */
  inheritsFrom: Id | null
  /**
   * 维度上了锁：点维度只是筛选要看哪些槽位，不再改动构形的槽位范围（见 lockedSlots）。
   * 没上锁时点维度跟以前一样，直接改这个构形的维度
   */
  slotsLocked?: boolean
  /** 固定下来的槽位（上锁时把当时的槽位记下来）：维度怎么筛都还在，写法也一直有效 */
  lockedSlots?: string[]
  /**
   * 作用于所有词（词首音变、连读变化这类）：不绑定词类、不往词条里写屈折形，
   * 语料分词时拿它反推（见 engine/morph/mutation.ts）。
   */
  appliesToAll?: boolean
  /** 作用于所有词时只管这门语言；空表示项目里所有语言 */
  appliesToLanguageId?: Id | null
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

/**
 * 构形的一步。起点只有词干，要加什么就添一步，按顺序依次作用。
 * 词缀文本可以直接写形式，也可以写 `@语素` 引用语素表（按环境挑异体形）。
 */
export type MorphStep =
  | { id: Id; kind: 'prefix'; text: string }
  | { id: Id; kind: 'suffix'; text: string }
  | { id: Id; kind: 'infix'; text: string; at: string }
  | { id: Id; kind: 'circumfix'; text: string; text2: string }
  | { id: Id; kind: 'sca'; ruleSetId: Id | null; fromStage: string; toStage: string }
  | { id: Id; kind: 'pattern'; pattern: string }
  | { id: Id; kind: 'reduplication'; scope: 'full' | 'initial' | 'final'; length: number }
  | { id: Id; kind: 'adjust'; text: string }
  /** 构形套构形：把到这一步为止的形式当成词干，套另一个构形的某个槽位 */
  | { id: Id; kind: 'paradigm'; paradigmId: Id | null; slotKey: string; variantId?: Id | null }

export type MorphStepKind = MorphStep['kind']

/** 槽位继承的起点：哪个构形（null 是本构形）的哪一格，挑了变体时用那个变体的写法 */
export interface SlotBase {
  paradigmId: Id | null
  slotKey: string
  variantId?: Id | null
}

/** 槽位的发音流水线：从这一格拼写按正字法转出来的 IPA（form）或词条的发音（lemma）开始 */
export interface SlotPron {
  on: boolean
  from: 'form' | 'lemma'
  steps: MorphStep[]
}

export type SlotGenerator =
  | { kind: 'none' }
  | { kind: 'table' }
  /** 交给插件算这一格的形式（插件用 rules.registerGenerator 注册；插件没装时这一格推不出来） */
  | { kind: 'plugin'; pluginGeneratorId: string; stem: string }
  | {
      kind: 'pipeline'
      stem: string
      steps: MorphStep[]
      /** 起点不从词干开始，而是另一个槽位推出来的形式（继承那一格的写法，再接着加步骤） */
      base?: SlotBase
      /** 对「基于正字法的 IPA」有影响：这一格另写一条流水线改发音（on 为 false 时不显示、不推导，写过的留着） */
      pron?: SlotPron
    }
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
  /** 隔开写的词（`ma…gò`）：这个词是它的第几段、一共几段 */
  part?: { i: number; n: number }
  /**
   * lexemeId：手动指定给这一段的词条（悬浮卡里「没有找到」时挑的）；
   * sep：这一段前面的分隔符（`-` 或 `=`），没写就按语素类型定。
   */
  morphs: {
    form: string
    gloss: string
    morphemeId: Id | null
    lexemeId?: Id | null
    sep?: '-' | '='
  }[]
  /** 猜出来的（去掉附加符才对上、拆成了两个词）：没确认之前不算认出 */
  guess?: 'fold' | 'split'
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
