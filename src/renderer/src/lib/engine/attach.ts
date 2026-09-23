/**
 * 译文工作台里「给一个词加东西」：认出这个词的词类，把能跟它搭的东西分门别类找出来，再按挑好的拼出这个词。
 * 纯函数，不碰界面（能单独测），对任何语言都一样——分类、搭不搭、放哪儿，用的全是项目自己的数据：
 *
 * 1. **它自己的构形**：词条用的构形有哪些维度（格、数、焦点……），每个取值推出来是什么形式。
 * 2. **搭伴的构形**：有的语法范畴不在这个词自己的构形里，而在另一个词类的构形里（瑟乌丝林语的式、体、时
 *    在「动词头」上）——维度写明了能给这个词类用、这个词自己没管，就把管它的那个构形请过来。
 * 3. **能附着的语素**：前缀、后缀、中缀、环缀、附着词、小品词，还有释义就是语法标记的虚词。分组先看项目自己的维度
 *    （语素的语法特征、标签叫维度名、gloss 或释义对上维度取值），对不上再按莱比锡缩写归到通用的范畴，
 *    再不行按标签、按语素类型。
 * 4. **作用于所有词的构形**（词首音变、连读变化）：整个词最后过一遍。
 *
 * 搭不搭、贴在词里还是单独成词、放在前面还是后面、离词干多远，都看语料和短语里的分析（确认过的算得重些）。
 */
import type {
  Analysis,
  GrammaticalCategory,
  Id,
  Lexeme,
  LocalizedText,
  Morpheme,
  MorphemeType,
  Paradigm,
  PartOfSpeech,
  Project,
  Token
} from '$lib/core/model'
import { findPos, isCompoundPos, lexemePosIds, posName, posParadigmIds } from '$lib/core/pos'
import { LEIPZIG, lexemeGloss, variants } from './gloss'
import {
  generateForm,
  infixInto,
  lexemeSlots,
  paradigmSlots,
  paradigmsFor,
  selectAllomorph,
  type LexemeParadigm,
  type MorphContext,
  type SlotDef
} from './morph'

// ───────────────────────── 分组 ─────────────────────────

/** 通用的语法范畴：项目里没有对得上的维度时，按莱比锡缩写归到这些类（界面上按 bench.cat.<键> 显示） */
export const UNIVERSAL_KEYS = [
  'tense',
  'aspect',
  'mood',
  'voice',
  'polarity',
  'number',
  'case',
  'person',
  'gender',
  'definiteness',
  'possession',
  'derivation',
  'information',
  'classifier',
  'valency'
] as const
export type UniversalKey = (typeof UNIVERSAL_KEYS)[number]

const UNIVERSAL_OF: Record<string, UniversalKey> = {
  PST: 'tense',
  PRS: 'tense',
  FUT: 'tense',
  PFV: 'aspect',
  IPFV: 'aspect',
  PROG: 'aspect',
  DUR: 'aspect',
  COMPL: 'aspect',
  PRF: 'aspect',
  RES: 'aspect',
  HAB: 'aspect',
  IND: 'mood',
  SBJV: 'mood',
  IMP: 'mood',
  COND: 'mood',
  IRR: 'mood',
  PROH: 'mood',
  OPT: 'mood',
  DECL: 'mood',
  Q: 'mood',
  QUOT: 'mood',
  PASS: 'voice',
  ANTIP: 'voice',
  APPL: 'voice',
  CAUS: 'voice',
  RECP: 'voice',
  REFL: 'voice',
  NEG: 'polarity',
  SG: 'number',
  DU: 'number',
  PL: 'number',
  NOM: 'case',
  ACC: 'case',
  GEN: 'case',
  DAT: 'case',
  LOC: 'case',
  ABL: 'case',
  ALL: 'case',
  ABS: 'case',
  ERG: 'case',
  INS: 'case',
  COM: 'case',
  BEN: 'case',
  VOC: 'case',
  OBL: 'case',
  '1': 'person',
  '2': 'person',
  '3': 'person',
  EXCL: 'person',
  INCL: 'person',
  M: 'gender',
  F: 'gender',
  N: 'gender',
  DEF: 'definiteness',
  INDF: 'definiteness',
  ART: 'definiteness',
  DET: 'definiteness',
  DEM: 'definiteness',
  DIST: 'definiteness',
  PROX: 'definiteness',
  POSS: 'possession',
  NMLZ: 'derivation',
  PTCP: 'derivation',
  INF: 'derivation',
  CVB: 'derivation',
  ADJ: 'derivation',
  ADV: 'derivation',
  AGT: 'derivation',
  TOP: 'information',
  FOC: 'information',
  CLF: 'classifier',
  TR: 'valency',
  INTR: 'valency'
}

/** 拿来比对释义的莱比锡名字：LEIPZIG 那张表之外，再补几个常见的 */
const NAMED: { abbr: string; en: string; zh: string }[] = [
  ...LEIPZIG,
  { abbr: 'HAB', en: 'habitual', zh: '惯常' },
  { abbr: 'OPT', en: 'optative', zh: '希求' },
  { abbr: 'AGT', en: 'agentive', zh: '施事' }
].filter((x) => UNIVERSAL_OF[x.abbr])

/**
 * 通用范畴大致跟哪类词走：体词（名词、代词、数词这类）还是谓词（动词这类）；
 * 人称、派生、话题焦点两边都有，不算。只在语料里分析得少、看不出一个词能搭什么时拿来猜个大概
 */
export type Domain = 'nominal' | 'verbal'
const DOMAIN_OF: Record<UniversalKey, Domain | null> = {
  tense: 'verbal',
  aspect: 'verbal',
  mood: 'verbal',
  voice: 'verbal',
  valency: 'verbal',
  polarity: 'verbal',
  number: 'nominal',
  case: 'nominal',
  gender: 'nominal',
  definiteness: 'nominal',
  possession: 'nominal',
  classifier: 'nominal',
  person: null,
  derivation: null,
  information: null
}

/**
 * 维度叫这些名字时算哪个通用范畴（先看名字，再看取值的缩写）。
 * 是语法范畴在各界面语言里的叫法，不是哪一门造的语言的
 */
const CATEGORY_NAMES: Record<UniversalKey, string[]> = {
  tense: ['时', '时态', '时制', '時制', '시제', 'tense', 'temps', 'tiempo', 'время', 'زمن'],
  aspect: ['体', '体貌', 'アスペクト', '상', 'aspect', 'aspecto', 'вид', 'جهة'],
  mood: [
    '式',
    '语气',
    '情态',
    '叙法',
    '法',
    '서법',
    'mood',
    'modality',
    'mode',
    'modo',
    'наклонение'
  ],
  voice: ['态', '语态', '態', '태', 'voice', 'voix', 'voz', 'залог'],
  polarity: [
    '极性',
    '肯定与否定',
    '極性',
    '극성',
    'polarity',
    'polarité',
    'polaridad',
    'полярность'
  ],
  number: ['数', '수', 'number', 'nombre', 'número', 'число', 'عدد'],
  case: ['格', '격', 'case', 'cas', 'caso', 'падеж', 'حالة'],
  person: ['人称', '인칭', 'person', 'personne', 'persona', 'лицо', 'شخص'],
  gender: [
    '性',
    '性别',
    '名词类',
    '名词类别',
    '성',
    'gender',
    'noun class',
    'genre',
    'género',
    'род'
  ],
  definiteness: [
    '定指',
    '有定性',
    '定指与指示',
    '한정성',
    'definiteness',
    'définitude',
    'definitud'
  ],
  possession: ['领属', '소유', 'possession', 'possessive', 'posesión', 'принадлежность'],
  derivation: ['派生', '파생', 'derivation', 'dérivation', 'derivación', 'деривация'],
  information: ['焦点', '话题', '信息结构', '초점', 'focus', 'topic', 'information structure'],
  classifier: ['量词', '助数詞', '분류사', 'classifier', 'classificateur', 'clasificador'],
  valency: ['及物性', '配价', '타동성', 'transitivity', 'valency', 'valence', 'transitividad']
}

/**
 * 词类名（或缩写）是常见的语言学叫法时，大致是体词还是谓词。只是最后的线索：
 * 构形用到的维度、维度的「适用词类」、语料都说不上来时才看它；认不出来就不猜
 */
const POS_DOMAIN: { domain: Domain; names: string[]; abbrs: string[] }[] = [
  {
    domain: 'verbal',
    names: ['动词', '動詞', '동사', 'verb', 'verbe', 'verbo', 'глагол', 'فعل', '谓词'],
    abbrs: ['v', 'vb', 'vi', 'vt']
  },
  {
    domain: 'nominal',
    names: [
      '名词',
      '名詞',
      '명사',
      'noun',
      'nom',
      'sustantivo',
      'substantif',
      'substantive',
      'существительное',
      'اسم',
      '代词',
      '代名詞',
      '대명사',
      'pronoun',
      'pronom',
      'pronombre',
      'местоимение',
      '数词',
      '数詞',
      '수사',
      'numeral',
      'числительное',
      '人名',
      '地名',
      '专名',
      '名字',
      '姓氏',
      'proper noun',
      'name'
    ],
    abbrs: ['n', 'nn', 'pron', 'num', 'pn']
  }
]

/** 词类名是虚词一类的叫法（小品词、助词、介词、量词、标记……）：这个词类的词都算能附着的 */
const FUNCTION_POS = [
  '助词',
  '小品词',
  '虚词',
  '语气词',
  '标记',
  '词缀',
  '介词',
  '前置词',
  '后置词',
  '量词',
  '冠词',
  '限定词',
  '助詞',
  '冠詞',
  '조사',
  '관사',
  'particle',
  'marker',
  'affix',
  'clitic',
  'preposition',
  'postposition',
  'adposition',
  'classifier',
  'article',
  'determiner',
  'particule',
  'partícula',
  'частица',
  'предлог',
  'послелог',
  'حرف',
  'أداة'
]
const FUNCTION_ABBRS = ['part', 'prt', 'ptcl', 'prep', 'postp', 'adp', 'clf', 'cl', 'art', 'det']

/** 释义里写着这些，说明这个词本身是个语法标记（「完成体标记」「工具格缀」「question particle」） */
const MARKER_WORDS = [
  '标记',
  '助词',
  '小品词',
  '语气词',
  '虚词',
  '缀',
  '助詞',
  '接辞',
  '標識',
  '조사',
  '표지',
  'marker',
  'particle',
  'affix',
  'suffix',
  'prefix',
  'infix',
  'circumfix',
  'clitic',
  'marqueur',
  'particule',
  'marcador',
  'partícula',
  'частица',
  'показатель',
  'маркер',
  'أداة'
]
/** 释义以这些字结尾（「过去时」「工具格」）或带着这些词（「locative case」），又对得上莱比锡名字 */
const CATEGORY_TAILS = ['时', '体', '式', '格', '态']
const CATEGORY_WORDS = ['tense', 'aspect', 'mood', 'case', 'voice']

export interface MarkerGroup {
  /** `dim:<维度 id>` / `u:<通用范畴>` / `pos:<词类 id>` / `tag:<标签>` / `type:<语素类型>` */
  id: string
  kind: 'dim' | 'universal' | 'pos' | 'tag' | 'type'
  /** 维度名、词类名、标签原样；通用范畴与语素类型给键，界面自己翻译 */
  label: string
  categoryId?: Id
}

const norm = (s: string): string => s.normalize('NFC').trim().toLowerCase()
/** 不用空格隔词的文字（汉字、假名、谚文）：按子串比；别的按词比 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const tokens = (s: string): string[] =>
  norm(s)
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)

/**
 * 一段文字里有没有这个说法：汉字这类两个字以上按子串找（单个字要整段就是它，「缀」例外，见 MARKER_WORDS），
 * 拼音文字按整词找（「adv.」里没有「v.」，「inanimate」里没有「in」）
 */
function mentions(text: string, term: string, loose = false): boolean {
  const t = norm(text)
  const w = norm(term)
  if (!t || !w) return false
  if (t === w) return true
  if (CJK.test(w)) return (loose || [...w].length >= 2) && t.includes(w)
  const tw = tokens(t)
  const ww = tokens(w)
  if (!ww.length) return false
  for (let i = 0; i + ww.length <= tw.length; i++)
    if (ww.every((x, j) => tw[i + j] === x)) return true
  return false
}
const pick = (t: LocalizedText | undefined, langs: string[]): string => {
  if (!t) return ''
  for (const l of langs) if (t[l]?.trim()) return t[l].trim()
  return (
    Object.values(t)
      .find((x) => x?.trim())
      ?.trim() ?? ''
  )
}

/** 项目的维度：按 id、按名字（各种语言的）、按取值（缩写与名字）查；外加项目自己的缩写表 */
interface DimIndex {
  byId: Map<Id, GrammaticalCategory>
  byName: Map<string, GrammaticalCategory>
  values: { cat: GrammaticalCategory; abbr: string; names: string[] }[]
  /** 缩写表：缩写 → 各语言的名字（SFOC → 强焦点） */
  abbr: Map<string, string[]>
  /** 维度算哪个通用范畴（算过的记下来） */
  universal: Map<Id, UniversalKey | null>
}

function dimIndex(project: Project): DimIndex {
  const byId = new Map<Id, GrammaticalCategory>()
  const byName = new Map<string, GrammaticalCategory>()
  const values: DimIndex['values'] = []
  for (const c of project.categories) {
    byId.set(c.id, c)
    for (const n of Object.values(c.name))
      if (n?.trim() && !byName.has(norm(n))) byName.set(norm(n), c)
    for (const v of c.values)
      values.push({
        cat: c,
        abbr: v.abbr.trim(),
        names: Object.values(v.name)
          .map((n) => norm(n ?? ''))
          .filter(Boolean)
      })
  }
  const abbr = new Map<string, string[]>()
  for (const a of project.abbreviations ?? []) {
    const names = Object.values(a.name).filter((n): n is string => !!n?.trim())
    if (a.abbr.trim() && names.length) abbr.set(a.abbr.trim(), names)
  }
  return { byId, byName, values, abbr, universal: new Map() }
}

/** 一个语法名字（缩写表、取值、维度的名字）算哪个通用范畴：「强焦点」→ 话题与焦点，「远过去时」→ 时 */
function universalOfName(name: string): UniversalKey | null {
  const n = norm(name)
  if (!n) return null
  for (const x of NAMED) if (norm(x.zh) === n || norm(x.en) === n) return UNIVERSAL_OF[x.abbr]
  const u = universalOfText(n)
  if (u) return u
  for (const k of UNIVERSAL_KEYS) if (CATEGORY_NAMES[k].some((x) => mentions(n, x))) return k
  return null
}

/** gloss 里的一段算哪个通用范畴：莱比锡缩写，或者项目缩写表里这个缩写的名字 */
function universalOfPart(idx: DimIndex, part: string): UniversalKey | null {
  const u = UNIVERSAL_OF[part]
  if (u) return u
  for (const name of idx.abbr.get(part) ?? []) {
    const v = universalOfName(name)
    if (v) return v
  }
  return null
}

/** 项目里的一个维度算哪个通用范畴：先看维度名，再让各取值投票（缩写、名字） */
function universalOfCategory(idx: DimIndex, id: Id | undefined): UniversalKey | null {
  if (!id) return null
  if (idx.universal.has(id)) return idx.universal.get(id) ?? null
  const c = idx.byId.get(id)
  let out: UniversalKey | null = null
  if (c) {
    for (const k of UNIVERSAL_KEYS)
      if (
        !out &&
        Object.values(c.name).some((n) => CATEGORY_NAMES[k].some((x) => mentions(n ?? '', x)))
      )
        out = k
    if (!out) {
      const votes = new Map<UniversalKey, number>()
      for (const v of c.values) {
        const u =
          universalOfPart(idx, v.abbr.trim()) ??
          Object.values(v.name)
            .map((n) => (n ? universalOfName(n) : null))
            .find(Boolean) ??
          null
        if (u) votes.set(u, (votes.get(u) ?? 0) + 1)
      }
      let n = 0
      for (const [u, k] of votes) if (k > n) [out, n] = [u, k]
    }
  }
  idx.universal.set(id, out)
  return out
}

/** 体词、谓词两边的票 */
interface Votes {
  n: number
  v: number
}
const vote = (votes: Votes, d: Domain | null | undefined, w: number): void => {
  if (d === 'nominal') votes.n += w
  else if (d === 'verbal') votes.v += w
}
const winner = (votes: Votes): Domain | null =>
  votes.n > votes.v ? 'nominal' : votes.v > votes.n ? 'verbal' : null

/** gloss 的各段投票（1SG 这种人称加数的算人称，不算「数」：动词的一致、名词的领属都这么写） */
function voteGloss(idx: DimIndex, votes: Votes, gloss: string, w: number): void {
  for (const p of gloss.split(/[.\-=:_/\s<>()（）]+/)) {
    if (!p || /^[123](SG|DU|PL)$/.test(p)) continue
    const u = universalOfPart(idx, p)
    if (u) vote(votes, DOMAIN_OF[u], w)
  }
}

/** 词类按名字、缩写认出来是体词还是谓词（复合词类看组成它的那几个，调用处已经拆开了） */
function posDomainByName(p: PartOfSpeech | undefined): Domain | null {
  if (!p) return null
  const abbrs = p.abbr
    .toLowerCase()
    .split('/')
    .map((a) => a.replace(/[.\s]/g, ''))
    .filter(Boolean)
  for (const d of POS_DOMAIN) {
    if (Object.values(p.name).some((n) => n && d.names.some((x) => mentions(n, x)))) return d.domain
    // 缩写整个相同，或者后面跟的不是拉丁字母（「v况.」算动词，「var.」不算）
    if (
      abbrs.some((a) =>
        d.abbrs.some((x) => a === x || (a.startsWith(x) && !/[a-z]/.test(a.charAt(x.length))))
      )
    )
      return d.domain
  }
  return null
}

/** 词类名是不是虚词一类（小品词、介词、标记……） */
function isFunctionPos(p: PartOfSpeech | undefined): boolean {
  if (!p) return false
  if (Object.values(p.name).some((n) => n && FUNCTION_POS.some((x) => mentions(n, x)))) return true
  return p.abbr
    .toLowerCase()
    .split('/')
    .some((a) => FUNCTION_ABBRS.includes(a.replace(/[.\s]/g, '')))
}

/** gloss 拆成一段段：`2SG.POSS` → 2SG、POSS、2、SG */
export function glossParts(gloss: string): string[] {
  const out: string[] = []
  const whole = gloss.trim()
  if (whole) out.push(whole)
  for (const p of whole.split(/[.\-=:_/\s<>()（）]+/)) {
    if (!p) continue
    if (!out.includes(p)) out.push(p)
    const pn = /^([123])(SG|DU|PL)$/.exec(p)
    if (pn) out.push(pn[1], pn[2])
  }
  return out
}

/**
 * 一段 gloss / 释义对上哪个维度：先比缩写（区分大小写），再比取值名（整个相同、或是取值名的开头——
 * 汉字这类两个字以上就行，「过去」对「过去时」；拼音文字要在词边上断开，「past」对「past tense」，「in」不对「inanimate」）
 */
function dimOfPart(idx: DimIndex, part: string): GrammaticalCategory | null {
  const p = part.trim()
  if (!p) return null
  for (const v of idx.values) if (v.abbr && v.abbr === p) return v.cat
  const n = norm(p)
  for (const v of idx.values) if (v.names.includes(n)) return v.cat
  const cjk = CJK.test(n)
  if (cjk ? [...n].length >= 2 : n.length >= 3)
    for (const v of idx.values)
      if (
        v.names.some((x) => x.startsWith(n) && (cjk || !/[\p{L}\p{N}]/u.test(x.charAt(n.length))))
      )
        return v.cat
  return null
}

/** 释义里写的是不是一个语法标记（「完成体标记」「question particle」）：归到通用范畴 */
function universalOfText(text: string): UniversalKey | null {
  const t = norm(text)
  if (!t) return null
  for (const x of NAMED) {
    if (x.zh && x.zh.length >= 2 && t.includes(x.zh)) return UNIVERSAL_OF[x.abbr]
    if (x.en && new RegExp(`(^|[^a-z])${x.en.toLowerCase()}($|[^a-z])`).test(t))
      return UNIVERSAL_OF[x.abbr]
  }
  return null
}

const dimGroup = (c: GrammaticalCategory, langs: string[]): MarkerGroup => ({
  id: 'dim:' + c.id,
  kind: 'dim',
  label: pick(c.name, langs) || '?',
  categoryId: c.id
})
const uniGroup = (u: UniversalKey): MarkerGroup => ({ id: 'u:' + u, kind: 'universal', label: u })

/**
 * 一个语素归到哪一组。tagCount：这门语言里每个标签用了几次——几个标签都不是维度名时，
 * 挑用得最少的那个（最具体：「感音」比「动词头」具体）
 */
function groupOfMorpheme(
  idx: DimIndex,
  m: Morpheme,
  langs: string[],
  tagCount: ReadonlyMap<string, number>
): MarkerGroup {
  // 1. 语素自己标了语法特征
  for (const catId of Object.keys(m.features ?? {})) {
    const c = idx.byId.get(catId)
    if (c) return dimGroup(c, langs)
  }
  // 2. 标签就叫某个维度的名字（瑟乌丝林语的「体」「时」）
  for (const tag of m.tags) {
    const c = idx.byName.get(norm(tag))
    if (c) return dimGroup(c, langs)
  }
  // 3. gloss、释义一段段看：这一段对得上项目的维度取值就归那个维度，是莱比锡缩写就归通用范畴；
  //    靠前的一段说了算（`DET.SG` 是限定词，不是「数」）
  const texts = [m.gloss, ...Object.values(m.meaning)].filter((x): x is string => !!x?.trim())
  for (const text of texts)
    for (const part of glossParts(text)) {
      const c = dimOfPart(idx, part)
      if (c) return dimGroup(c, langs)
      const u = UNIVERSAL_OF[part]
      if (u) return uniGroup(u)
    }
  // 4. 释义里写着语法术语（「完成体标记」「question particle」）
  for (const text of texts) {
    const u = universalOfText(text)
    if (u) return uniGroup(u)
  }
  // 5. 标签（最具体的那个）、类型
  const tags = m.tags.map((x) => x.trim()).filter(Boolean)
  if (tags.length) {
    const tag = tags.reduce((a, b) => ((tagCount.get(b) ?? 0) < (tagCount.get(a) ?? 0) ? b : a))
    return { id: 'tag:' + tag, kind: 'tag', label: tag }
  }
  return { id: 'type:' + m.type, kind: 'type', label: m.type }
}

/**
 * 词条的第一条释义本身是不是个语法标记。释义里的莱比锡名字不少是常用词（过去、现在、结果、持续、关系……），
 * 光对上名字不算，还得带着「标记」「缀」「particle」这类词、写着大写的莱比锡缩写，或者以「时 体 式 格 态」
 * 收尾（「过去时」「工具格」）。只写人称的（「第一人称（我）」）是代词，不算。
 * key：说得出是哪个范畴的语法标记；marked：写着「标记」「缀」这类词（「表情标记」这种名词也算，
 * 所以只拿来判断一个词类整体是不是虚词一类，不单凭它把一个名词当成标记）
 */
function markerOfDefinition(l: Lexeme): { key: UniversalKey | null; marked: boolean } {
  const defs = Object.values(l.senses[0]?.definition ?? {}).filter((x): x is string => !!x?.trim())
  let marked = false
  for (const text of defs) {
    for (const tk of text.split(/[^\p{L}\p{N}]+/u)) {
      const u = tk.length >= 2 && tk === tk.toUpperCase() ? UNIVERSAL_OF[tk] : undefined
      if (u && u !== 'person') return { key: u, marked: true }
    }
    const u = universalOfText(text)
    const m = MARKER_WORDS.some((x) => mentions(text, x, x === '缀'))
    marked ||= m
    if (!u || u === 'person') continue
    const first = text.split(/[;；,，、/／(（]/)[0].trim()
    if (
      m ||
      CATEGORY_TAILS.some((x) => first.endsWith(x)) ||
      CATEGORY_WORDS.some((x) => mentions(text, x))
    )
      return { key: u, marked: true }
  }
  return { key: null, marked }
}

/** 能附着的词条归到哪一组：释义对得上维度、通用范畴就归那里，否则归它的词类（「缀标记」「小品词」） */
function groupOfWord(
  project: Project,
  idx: DimIndex,
  l: Lexeme,
  key: UniversalKey | null,
  langs: string[]
): MarkerGroup {
  const texts = l.senses.flatMap((s) => Object.values(s.definition)).filter((x) => !!x?.trim())
  const u = key ?? texts.map(universalOfText).find(Boolean) ?? null
  if (u) {
    // 项目里有这个范畴的维度时归到维度那一组（Tsahun 的「完成体标记」→ 体）
    for (const text of texts)
      for (const part of glossParts(text)) {
        const c = dimOfPart(idx, part)
        if (c) return dimGroup(c, langs)
      }
    return uniGroup(u)
  }
  const pos = findPos(project, l.posId)
  return { id: 'pos:' + (pos?.id ?? ''), kind: 'pos', label: pos ? posName(pos, langs) : '' }
}

// ───────────────────────── 能附着的东西与语料里的证据 ─────────────────────────

export interface Marker {
  /** `m:<语素 id>` / `l:<词条 id>` */
  key: string
  morphemeId?: Id
  lexemeId?: Id
  /** 语素表 / 词库里写的样子（-dU、=mU、ta33） */
  form: string
  gloss: string
  /** 语素类型；虚词（词条）是 word */
  type: MorphemeType | 'word'
  group: MarkerGroup
  /** 语素「算作」了哪个词类（加上它词类就变了） */
  becomesPos?: Id | null
  /** 在语素表 / 词库里的先后（没证据的按这个排，照用户自己的顺序） */
  index: number
  /** 大致是给体词还是给谓词用的（gloss、释义、所在的组投票）；说不准是 null */
  domain: Domain | null
  /** 标签里写着的词类（「动词后缀」；虚词自己的词类不算） */
  tagPos: Id[]
  /** 释义、说明里提到的词类（「用在名词后」；「副词化」这种说的是变成什么，不算） */
  textPos: Id[]
  /**
   * 语料里分析得少时能不能先摆出来猜一猜：语素、说得出范畴的虚词都能；
   * 只知道词类的（「名词/缀标记」里的山、湾）不猜，只在语料里见过、写明了才摆
   */
  guessable: boolean
}

interface MarkerStats {
  /** 贴在哪些词类的词里出现过 */
  pos: Map<Id, number>
  /** 单独成词时，紧挨在这个词类的词前面 / 后面 */
  before: Map<Id, number>
  after: Map<Id, number>
  /** 贴在别的词里 / 自己单独成词 */
  inside: number
  alone: number
  /** 离词干第几层（累加与次数，算平均用） */
  dist: number
  distN: number
}

export interface MarkerCatalog {
  markers: Marker[]
  stats: Map<string, MarkerStats>
  /** 各组离词干的平均层数（语料里见过的组才有） */
  groupDist: Map<string, number>
  /** 语料和短语里一共用了几次能附着的东西（少的话，缺证据说明不了什么） */
  uses: number
  /** 各词类的词在语料和短语里出现了几次 */
  posTokens: Map<Id, number>
}

const blankStats = (): MarkerStats => ({
  pos: new Map(),
  before: new Map(),
  after: new Map(),
  inside: 0,
  alone: 0,
  dist: 0,
  distN: 0
})
const bump = (m: Map<Id, number>, k: Id, n: number): void => {
  m.set(k, (m.get(k) ?? 0) + n)
}

/** 分析里的词干在第几段：挂了词条的那段；没挂的话，只有一段没挂语素时就是它 */
function stemIndex(a: Analysis): number {
  const i = a.morphs.findIndex((m) => m.lexemeId)
  if (i >= 0) return i
  const bare = a.morphs.map((m, k) => (m.morphemeId ? -1 : k)).filter((k) => k >= 0)
  return bare.length === 1 ? bare[0] : -1
}
const hostOf = (a: Analysis | undefined): Id | null =>
  a ? (a.lexemeId ?? a.morphs.find((m) => m.lexemeId)?.lexemeId ?? null) : null

/**
 * 这门语言里能附着的全部东西，连同语料和短语里的证据。
 * 语素：词根、模板以外的都算；词条：词类没绑构形、释义就是个语法标记的（小品词、助词这类虚词）
 */
export function markerCatalog(
  project: Project,
  languageId: Id,
  glossLangs: string[]
): MarkerCatalog {
  const idx = dimIndex(project)
  const tagCount = new Map<string, number>()
  for (const m of project.morphemes)
    if (m.languageId === languageId)
      for (const t of m.tags)
        if (t.trim()) tagCount.set(t.trim(), (tagCount.get(t.trim()) ?? 0) + 1)
  /** gloss、释义、所在的组、语法特征各投一票：给体词还是给谓词用的 */
  const domainOf = (
    gloss: string,
    texts: string[],
    group: MarkerGroup,
    features: Record<Id, Id> = {}
  ): Domain | null => {
    const votes: Votes = { n: 0, v: 0 }
    voteGloss(idx, votes, gloss, 1)
    for (const t of texts) {
      const u = universalOfText(t)
      if (u) vote(votes, DOMAIN_OF[u], 0.5)
    }
    const gu =
      group.kind === 'universal'
        ? (group.label as UniversalKey)
        : universalOfCategory(idx, group.categoryId)
    if (gu) vote(votes, DOMAIN_OF[gu], 1)
    for (const c of Object.keys(features)) {
      const u = universalOfCategory(idx, c)
      if (u) vote(votes, DOMAIN_OF[u], 1)
    }
    return winner(votes)
  }
  const markers: Marker[] = []
  for (const m of project.morphemes) {
    if (m.languageId !== languageId || !m.form.trim()) continue
    if (m.type === 'root' || m.type === 'pattern') continue
    const group = groupOfMorpheme(idx, m, glossLangs, tagCount)
    const texts = [...Object.values(m.meaning), m.notes].filter((x): x is string => !!x?.trim())
    markers.push({
      key: 'm:' + m.id,
      morphemeId: m.id,
      form: m.form,
      gloss: m.gloss || pick(m.meaning, glossLangs),
      type: m.type,
      group,
      becomesPos: m.stress?.affects && m.stress.passPos ? (m.stress.posId ?? null) : null,
      index: markers.length,
      domain: domainOf(m.gloss, texts, group, m.features),
      tagPos: posNamedIn(project, m.tags, true),
      textPos: posNamedIn(project, texts, false),
      guessable: true
    })
  }
  // 词条：词类没绑构形的（虚词）。词类本身是虚词一类的——名字叫小品词、介词、标记……，或者这个词类里
  // 三成以上的词释义就是个语法标记——它的词全算；别的词类只算释义说得出是哪个范畴的语法标记的
  const freeWords = project.lexemes.filter(
    (l) =>
      l.languageId === languageId &&
      l.lemma.trim() &&
      !l.paradigmId &&
      !posParadigmIds(project, l.posId).length
  )
  const defKey = new Map<Id, UniversalKey | null>()
  const perPos = new Map<Id, { n: number; g: number }>()
  for (const l of freeWords) {
    const k = markerOfDefinition(l)
    defKey.set(l.id, k.key)
    for (const P of lexemePosIds(project, l)) {
      const s = perPos.get(P) ?? { n: 0, g: 0 }
      s.n++
      if (k.key || k.marked) s.g++
      perPos.set(P, s)
    }
  }
  const functionPos = new Set<Id>()
  for (const p of project.posList) {
    const s = perPos.get(p.id)
    // 按比例算的，名字明摆着是名词、动词、代词这类实词的不算（小项目里三个名词两个像标记也不行）
    if (s && (isFunctionPos(p) || (!posDomainByName(p) && s.n >= 3 && s.g / s.n >= 0.3)))
      functionPos.add(p.id)
  }
  for (const l of freeWords) {
    const k = defKey.get(l.id) ?? null
    const own = lexemePosIds(project, l)
    if (!k && !own.some((p) => functionPos.has(p))) continue
    const group = groupOfWord(project, idx, l, k, glossLangs)
    const texts = [...l.senses.flatMap((s) => Object.values(s.definition)), l.notes].filter(
      (x): x is string => !!x?.trim()
    )
    const pos = findPos(project, l.posId)
    markers.push({
      key: 'l:' + l.id,
      lexemeId: l.id,
      form: l.lemma,
      gloss: lexemeGloss(l, glossLangs),
      type: 'word',
      group,
      index: markers.length,
      domain: domainOf('', texts, group, l.features),
      // 虚词自己的词类不算线索（「疑问小品词」说的是它自己）
      tagPos: posNamedIn(project, l.tags, true).filter((p) => !own.includes(p)),
      textPos: posNamedIn(project, texts, false).filter((p) => !own.includes(p)),
      guessable: group.kind !== 'pos' || (isFunctionPos(pos) && !isCompoundPos(pos))
    })
  }

  // 证据：确认过的算 1，没确认的（自动挑的）算 0.5；存了分析的短语当确认过的
  const byKey = new Map(markers.map((x) => [x.key, x]))
  const stats = new Map<string, MarkerStats>()
  const statOf = (k: string): MarkerStats => {
    let s = stats.get(k)
    if (!s) stats.set(k, (s = blankStats()))
    return s
  }
  const lexById = new Map(project.lexemes.map((l) => [l.id, l]))
  const posCache = new Map<Id, Id[]>()
  const posOf = (lexemeId: Id | null): Id[] => {
    if (!lexemeId) return []
    let p = posCache.get(lexemeId)
    if (!p) {
      const l = lexById.get(lexemeId)
      posCache.set(lexemeId, (p = l ? lexemePosIds(project, l) : []))
    }
    return p
  }
  /** 单独成词的那个词是哪个标记 */
  const aloneMarker = (a: Analysis | undefined): string | null => {
    if (!a) return null
    if (a.lexemeId && byKey.has('l:' + a.lexemeId)) return 'l:' + a.lexemeId
    if (a.morphs.length === 1 && a.morphs[0].morphemeId && byKey.has('m:' + a.morphs[0].morphemeId))
      return 'm:' + a.morphs[0].morphemeId
    return null
  }
  /**
   * 一个词是什么词类：挂了词条看词条；没挂的（瑟乌丝林语不少动词的词干没挂上），
   * 看词里别的语素归在哪些维度、那些维度写明给哪些词类用，取交集——算半个证据
   */
  const posOfWord = (a: Analysis | undefined): { pos: Id[]; w: number } => {
    const own = posOf(hostOf(a))
    if (own.length || !a) return { pos: own, w: 1 }
    let common: Set<Id> | null = null
    for (const m of a.morphs) {
      const c = m.morphemeId ? byKey.get('m:' + m.morphemeId)?.group.categoryId : undefined
      const allowed = c ? idx.byId.get(c)?.posIds : undefined
      if (!allowed?.length) continue
      common = common ? new Set(allowed.filter((p) => common!.has(p))) : new Set(allowed)
    }
    return { pos: common ? [...common] : [], w: 0.5 }
  }
  const groupSum = new Map<string, { d: number; n: number }>()
  let uses = 0
  const posTokens = new Map<Id, number>()
  const learn = (tokens: Token[] | undefined, trusted: boolean): void => {
    if (!tokens?.length) return
    const chosen = tokens.map((tk) => tk.analyses[tk.chosen])
    tokens.forEach((tk, i) => {
      const a = chosen[i]
      if (!a) return
      const w = trusted || tk.confirmed ? 1 : 0.5
      const alone = aloneMarker(a)
      if (alone) {
        const s = statOf(alone)
        s.alone += w
        uses += w
        const prev = posOfWord(chosen[i - 1])
        for (const P of prev.pos) bump(s.after, P, w * prev.w)
        const next = posOfWord(chosen[i + 1])
        for (const P of next.pos) bump(s.before, P, w * next.w)
        return
      }
      const host = posOfWord(a)
      for (const P of host.pos) bump(posTokens, P, w * host.w)
      if (a.morphs.length < 2) return
      const stem = stemIndex(a)
      a.morphs.forEach((m, k) => {
        if (!m.morphemeId || k === stem) return
        const key = 'm:' + m.morphemeId
        const marker = byKey.get(key)
        if (!marker) return
        const s = statOf(key)
        s.inside += w
        uses += w
        for (const P of host.pos) bump(s.pos, P, w * host.w)
        if (stem >= 0) {
          const d = Math.abs(k - stem)
          s.dist += d * w
          s.distN += w
          const g = groupSum.get(marker.group.id) ?? { d: 0, n: 0 }
          g.d += d * w
          g.n += w
          groupSum.set(marker.group.id, g)
        }
      })
    })
  }
  for (const s of project.sentences) if (s.languageId === languageId) learn(s.tokens, false)
  for (const p of project.phrasebook) if (p.languageId === languageId) learn(p.tokens, true)
  const groupDist = new Map<string, number>()
  for (const [k, v] of groupSum) if (v.n > 0) groupDist.set(k, v.d / v.n)

  // 虚词跟同一个写法、同一组的语素是一回事（Tsahun 的 ta33 既是词条又是语素）；小品词、附着词这类
  // 单独成词的语素，写法一样就算一回事，不管归在哪组（Aelith 的 ve「和」）。只留一个：语料里用得多的
  // 那个（一样多留语素），另一个的证据并过去，组取说得更具体的那个。两个语素写法相同是两回事，都留着
  const used = (m: Marker): number => {
    const s = stats.get(m.key)
    return s ? s.inside + s.alone : 0
  }
  const formOf = (m: Marker): string => norm(bare(m.form))
  const keyOf = (m: Marker): string => `${formOf(m)}|${m.group.id}`
  const morphemeByKey = new Map<string, Marker>()
  const freeByForm = new Map<string, Marker>()
  for (const m of markers) {
    if (m.type === 'word') continue
    if (!morphemeByKey.has(keyOf(m))) morphemeByKey.set(keyOf(m), m)
    if ((m.type === 'particle' || m.type === 'clitic') && !freeByForm.has(formOf(m)))
      freeByForm.set(formOf(m), m)
  }
  const specific = (g: MarkerGroup): number =>
    ({ dim: 0, universal: 1, tag: 2, pos: 3, type: 4 })[g.kind]
  const dropped = new Set<string>()
  for (const w of markers) {
    if (w.type !== 'word') continue
    const m = morphemeByKey.get(keyOf(w)) ?? freeByForm.get(formOf(w))
    if (!m || dropped.has(m.key)) continue
    const [keep, lose] = used(w) > used(m) ? [w, m] : [m, w]
    mergeStats(statOf(keep.key), stats.get(lose.key))
    if (specific(lose.group) < specific(keep.group)) keep.group = lose.group
    keep.domain ??= lose.domain
    keep.guessable ||= lose.guessable
    dropped.add(lose.key)
  }
  return {
    markers: markers.filter((m) => !dropped.has(m.key)),
    stats,
    groupDist,
    uses,
    posTokens
  }
}

function mergeStats(into: MarkerStats, from: MarkerStats | undefined): void {
  if (!from) return
  for (const [k, v] of from.pos) bump(into.pos, k, v)
  for (const [k, v] of from.before) bump(into.before, k, v)
  for (const [k, v] of from.after) bump(into.after, k, v)
  into.inside += from.inside
  into.alone += from.alone
  into.dist += from.dist
  into.distN += from.distN
}

// ───────────────────────── 这个词能搭什么 ─────────────────────────

/**
 * 词的一截怎么接上去：贴在词里（前缀、后缀、中缀、环缀），或者单独成词放在前面 / 后面；
 * 隔开写的虚词（`ma…gò`）一段放在词前、一段放在词后（around）
 */
export type AttachMode = 'prefix' | 'suffix' | 'infix' | 'circumfix' | 'before' | 'after' | 'around'

/** 单独成词的几种（不贴进词里） */
export const isWordMode = (m: AttachMode): boolean =>
  m === 'before' || m === 'after' || m === 'around'

export interface HostInfo {
  /** 这个词沾到的全部词类（自己的、组成的、义项的） */
  posIds: Id[]
  /** 这个词自己的构形已经管了的维度 */
  covered: Set<Id>
}

/** 一个词的词类与它自己的构形管了哪些维度；词类可以换成「算作」的那个（加了派生词缀之后） */
export function hostInfo(
  project: Project,
  lexeme: Lexeme | null,
  posOverride?: Id | null
): HostInfo {
  if (!lexeme) return { posIds: posOverride ? [posOverride] : [], covered: new Set() }
  const l = posOverride ? asPos(lexeme, posOverride) : lexeme
  const covered = new Set<Id>()
  for (const lp of paradigmsFor(project, l))
    for (const d of lp.paradigm.dimensionIds) covered.add(d)
  return { posIds: posOverride ? [posOverride] : lexemePosIds(project, lexeme), covered }
}

/** 换个词类看这个词（派生之后）：指名的构形不算了，按新词类走 */
function asPos(l: Lexeme, posId: Id): Lexeme {
  return { ...l, posId, paradigmId: null, extraParadigms: [], extraPosIds: [] }
}

/**
 * 这几段文字里提到了哪些词类（按词类名；标签里还认缩写，要整个词对上：「adv.」里没有「v.」）。
 * 汉字这类后面紧跟着「化」的是说变成什么（「副词化」），不算
 */
function posNamedIn(project: Project, texts: string[], withAbbr: boolean): Id[] {
  const out: Id[] = []
  if (!texts.length) return out
  for (const p of project.posList) {
    if (isCompoundPos(p)) continue
    const names = Object.values(p.name).filter((x): x is string => !!x && x.trim().length >= 2)
    const abbr = p.abbr.trim().toLowerCase().replace(/\.+$/, '')
    const hit = texts.some(
      (t) =>
        names.some((n) => mentions(t, n) && !(CJK.test(n) && norm(t).includes(norm(n) + '化'))) ||
        (withAbbr && !!abbr && tokens(t).includes(abbr))
    )
    if (hit) out.push(p.id)
  }
  return out
}

/**
 * 语料里这个标记跟这个词类一起用过几次：贴在词里的看是哪个词类的词；单独成词的只看它惯常挨着的那一边
 * （Tsahun 的 ta33 总跟在动词后面，「kwe51 ta33 sip51」里它后面那个名词不算）
 */
function evidence(catalog: MarkerCatalog, marker: Marker, posIds: Id[]): number {
  const s = catalog.stats.get(marker.key)
  if (!s) return 0
  let n = 0
  for (const P of posIds) n += s.pos.get(P) ?? 0
  let before = 0
  let after = 0
  for (const v of s.before.values()) before += v
  for (const v of s.after.values()) after += v
  for (const P of posIds) {
    if (after >= before) n += s.after.get(P) ?? 0
    if (before >= after) n += s.before.get(P) ?? 0
  }
  return n
}

export interface ScoredMarker {
  marker: Marker
  /** 越大越该摆在前面；不到 0 的归到「其余」 */
  score: number
  mode: AttachMode
  /** 只是猜的：语料里没跟这类词一起见过，维度、标签也没写明给它（一组里有见过的就先收起来） */
  weak: boolean
}

/** 隔开写的虚词用的省略号（`ma…gò`、`bo…`） */
const GAP = /…|\.{3}/
/** 按省略号切成几段（去掉空段）：`ma…gò` → ma、gò，`bo…` → bo */
export const gapParts = (form: string): string[] =>
  form
    .split(GAP)
    .map((x) => x.trim())
    .filter(Boolean)

/** 词头里常见的写法：括号里是可省的（`(le)kùti`），斜线、逗号隔开的是几种写法（`moh / goh`）：取最简的第一种 */
function plainForm(form: string): string {
  const f = form.replace(/\([^)]*\)|（[^）]*）/g, '').trim() || form.trim()
  return variants(f)[0] ?? f
}

/**
 * 单独成词的标记放进句子里写成什么：可省的部分不要、几种写法取第一种、去掉省略号；
 * 隔开写的（around）给前后两段（`ma…gò` → ma、gò）
 */
export function particleWords(form: string, mode: AttachMode): string[] {
  const parts = gapParts(plainForm(form)).map(bare).filter(Boolean)
  if (!parts.length) return [bare(form)]
  return mode === 'around' && parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]]
}

/** 这个标记跟这个词怎么接：语素类型定贴不贴、语料定放前放后 */
export function modeOf(catalog: MarkerCatalog, marker: Marker, posIds: Id[]): AttachMode {
  const s = catalog.stats.get(marker.key)
  const side = (): 'before' | 'after' => {
    let b = 0
    let a = 0
    for (const P of posIds) {
      b += s?.before.get(P) ?? 0
      a += s?.after.get(P) ?? 0
    }
    if (a === b && s) {
      for (const v of s.before.values()) b += v
      for (const v of s.after.values()) a += v
    }
    return b > a ? 'before' : 'after'
  }
  switch (marker.type) {
    case 'prefix':
    case 'suffix':
    case 'infix':
    case 'circumfix':
      return marker.type
    case 'clitic': {
      // 附着词：语料里多半贴着写就贴，多半分开写就单独成词；前面写 = 的是后附（接在词后）
      const lead = marker.form.trim().startsWith('=')
      const tail = marker.form.trim().endsWith('=')
      if ((s?.inside ?? 0) > (s?.alone ?? 0)) return tail && !lead ? 'prefix' : 'suffix'
      return tail && !lead ? 'before' : lead ? 'after' : side()
    }
    default: {
      const f = plainForm(marker.form)
      // 隔开写的：两头都有字的包在词的两边；只写了前一半（`bo…`）的放在前面，只写了后一半（`…le`）的放在后面
      if (GAP.test(f)) {
        const parts = f.split(GAP).map((x) => x.trim())
        const lead = !!parts[0]
        const tail = !!parts[parts.length - 1]
        if (lead && tail) return 'around'
        if (lead) return 'before'
        if (tail) return 'after'
      }
      // 小品词、虚词写成带连接符的（mae·、dhar·）：跟着连接符贴上去，不单独成词
      if (DOT.test(f.slice(-1)) && !DOT.test(f.slice(0, 1))) return 'prefix'
      if (DOT.test(f.slice(0, 1)) && !DOT.test(f.slice(-1))) return 'suffix'
      return side()
    }
  }
}

/** 中点这类写进词里的连接符（连字符、等号是词缀记号，句点、省略号、括号也不算） */
const DOT = /[^\p{L}\p{N}\p{M}\-=\s.…()（）[\]{}<>]/u

/** 语料里分析过的语素、虚词用法不到这么多次：缺证据说明不了什么，照结构猜 */
const SPARSE_USES = 30
/** 一组全是猜的时候，先摆出来几个（其余点「+N」展开） */
export const WEAK_SHOWN = 6

/**
 * 这个词大致是体词还是谓词：它自己的构形用到的维度、写明给它的维度、语料里它身上见过的东西各投一票；
 * 都说不上来时看词类名是不是常见的叫法（名词、动词……），再不行就是 null（不猜）
 */
export function hostDomain(
  project: Project,
  catalog: MarkerCatalog,
  host: HostInfo
): Domain | null {
  const idx = dimIndex(project)
  const hostSet = new Set(host.posIds)
  const votes: Votes = { n: 0, v: 0 }
  for (const d of host.covered) {
    const u = universalOfCategory(idx, d)
    if (u) vote(votes, DOMAIN_OF[u], 2)
  }
  for (const c of project.categories)
    if (c.posIds?.some((p) => hostSet.has(p))) {
      const u = universalOfCategory(idx, c.id)
      if (u) vote(votes, DOMAIN_OF[u], 1)
    }
  for (const m of catalog.markers) {
    const e = evidence(catalog, m, host.posIds)
    if (e > 0) vote(votes, m.domain, Math.min(e, 3) * 0.5)
  }
  const found = winner(votes)
  if (found) return found
  const byName: Votes = { n: 0, v: 0 }
  for (const P of host.posIds) vote(byName, posDomainByName(findPos(project, P)), 1)
  return winner(byName)
}

/**
 * 这个词能附着的东西，按组摆好：
 * - 语料里跟这类词一起用过的、维度写明给这类词的、标签写着这类词的，排在各组前面；
 * - 同一组有别的跟这类词一起用过的，跟着沾点光（算猜的）；
 * - 语料里几乎没分析过语素、或者从没见过这类词时，缺证据说明不了什么：给体词的配体词、给谓词的配谓词，
 *   说不上来的也先摆出来（都算猜的），只有看着是给别的词类用的才放进「其余」；
 * - 贴进词里、又是这个词自己的构形管着的维度，不列（挑构形那一格就行）。
 */
export function markersFor(
  project: Project,
  catalog: MarkerCatalog,
  host: HostInfo
): {
  groups: { group: MarkerGroup; items: ScoredMarker[]; strong: boolean }[]
  others: ScoredMarker[]
  /** 这回是不是在猜（语料里分析得少、或没见过这类词） */
  guess: boolean
} {
  const hostSet = new Set(host.posIds)
  const domain = hostDomain(project, catalog, host)
  const seenHost = host.posIds.reduce((n, P) => n + (catalog.posTokens.get(P) ?? 0), 0)
  // 虚词自己（小品词、标记……）一般不再加东西：不替它猜
  const functionWord = host.posIds.some((P) => isFunctionPos(findPos(project, P)))
  const guess = !functionWord && (catalog.uses < SPARSE_USES || seenHost === 0)
  const seen = new Map<string, number>()
  // 说得出范畴的组（维度、通用范畴、标签）里有一个见过，同组别的也沾点光；按类型、按词类凑的组是杂烩，不算
  const groupSeen = new Set<string>()
  for (const m of catalog.markers) {
    const e = evidence(catalog, m, host.posIds)
    if (!e) continue
    seen.set(m.key, e)
    if (m.group.kind !== 'type' && m.group.kind !== 'pos') groupSeen.add(m.group.id)
  }
  const scored: ScoredMarker[] = []
  for (const marker of catalog.markers) {
    let score = 0
    let stated = false
    const mode = modeOf(catalog, marker, host.posIds)
    const own = seen.get(marker.key) ?? 0
    const c = marker.group.categoryId
      ? project.categories.find((x) => x.id === marker.group.categoryId)
      : undefined
    if (c) {
      // 贴进词里、又是这个词自己构形管着的维度：挑构形那一格就行，不再单列（单独成词的限定词这类照列）
      if (host.covered.has(c.id) && !isWordMode(mode)) continue
      // 维度写明给这个词类用的加分；写明不给的不藏，只是减一点——
      // 维度的限定是用户自己填的，不一定周全（Aelith 的领属后缀标的是只给动词的「人称」）
      if (c.posIds?.some((p) => hostSet.has(p))) {
        score += 3
        stated = true
      } else if (c.posIds?.length) score -= 1
    }
    if (own > 0) score += 4 + Math.min(own - 1, 4) * 0.5
    else if (groupSeen.has(marker.group.id)) score += 1.5
    if (marker.tagPos.length) {
      if (marker.tagPos.some((p) => hostSet.has(p))) {
        score += 2
        stated = true
      } else score -= 3
    }
    if (marker.textPos.length) score += marker.textPos.some((p) => hostSet.has(p)) ? 1.5 : -1
    if (guess && own === 0 && marker.guessable) {
      if (marker.domain && domain) score += marker.domain === domain ? 1.5 : -1
      else score += 0.5
    }
    scored.push({ marker, score, mode, weak: own === 0 && !stated })
  }
  const byGroup = new Map<string, { group: MarkerGroup; items: ScoredMarker[]; best: number }>()
  const others: ScoredMarker[] = []
  for (const x of scored) {
    if (x.score <= 0) {
      others.push(x)
      continue
    }
    let g = byGroup.get(x.marker.group.id)
    if (!g) byGroup.set(x.marker.group.id, (g = { group: x.marker.group, items: [], best: 0 }))
    g.items.push(x)
    g.best = Math.max(g.best, x.score)
  }
  // 组里：有根据的在前（照分数），猜的在后；一样的按语素表、词库里的先后（用户自己排的）
  const order = (a: ScoredMarker, b: ScoredMarker): number =>
    Number(a.weak) - Number(b.weak) || b.score - a.score || a.marker.index - b.marker.index
  // 组：有根据的组在前，再按分数；一样的按维度表的顺序、通用范畴的顺序
  const rank = (g: MarkerGroup): number => {
    if (g.kind === 'dim') {
      const i = project.categories.findIndex((x) => x.id === g.categoryId)
      return i < 0 ? 999 : i
    }
    if (g.kind === 'universal') return 1000 + UNIVERSAL_KEYS.indexOf(g.label as UniversalKey)
    return { pos: 2000, tag: 3000, type: 4000 }[g.kind]
  }
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, strong: g.items.some((x) => !x.weak) }))
    .sort(
      (a, b) =>
        Number(b.strong) - Number(a.strong) || b.best - a.best || rank(a.group) - rank(b.group)
    )
    .map((g) => ({ group: g.group, items: g.items.sort(order), strong: g.strong }))
  return { groups, others: others.sort(order), guess }
}

// ───────────────────────── 搭伴的构形 ─────────────────────────

export interface Companion {
  /** 构形 id */
  key: string
  paradigm: Paradigm
  posId: Id
  /** 这个词类里能拿来套这个构形的词（瑟乌丝林语的动词头只有一个「·」） */
  lexemes: Lexeme[]
  /** 怎么接到这个词上：推出来的形式以「·」「-」这类连接符结尾的当前缀贴上，开头的当后缀，否则单独成词放前面 */
  mode: AttachMode
  /** 离词干多远：它管的那几个维度的语素在语料里平均第几层 */
  rank: number
}

/** 形式开头 / 结尾是不是连接符（·、-、= 这类不是字母的） */
const JOIN = /[^\p{L}\p{N}\p{M}]/u

export function companionsFor(
  project: Project,
  languageId: Id,
  catalog: MarkerCatalog,
  host: HostInfo
): Companion[] {
  if (!host.posIds.length) return []
  const hostSet = new Set(host.posIds)
  // 维度写明了能给这个词类用、这个词自己的构形没管的
  const wanted = new Set(
    project.categories
      .filter((c) => c.posIds?.some((p) => hostSet.has(p)) && !host.covered.has(c.id))
      .map((c) => c.id)
  )
  if (!wanted.size) return []
  const out: Companion[] = []
  for (const p of project.paradigms) {
    if (p.appliesToAll || !p.dimensionIds.some((d) => wanted.has(d))) continue
    for (const pos of project.posList) {
      if (hostSet.has(pos.id) || !posParadigmIds(project, pos.id).includes(p.id)) continue
      const lexemes = project.lexemes.filter(
        (l) => l.languageId === languageId && l.posId === pos.id && l.lemma.trim()
      )
      if (!lexemes.length || out.some((x) => x.key === p.id)) continue
      // 看这些词存下来的形式：多半以连接符结尾就贴在词前，开头就贴在词后
      let tail = 0
      let lead = 0
      let n = 0
      for (const l of lexemes)
        for (const f of Object.values(l.forms)) {
          const s = f.surface.trim()
          if (!s) continue
          n++
          if (JOIN.test(s.slice(-1))) tail++
          if (JOIN.test(s.slice(0, 1))) lead++
        }
      const mode: AttachMode =
        n && tail > n / 2 ? 'prefix' : n && lead > n / 2 ? 'suffix' : 'before'
      // 只请贴在词上的（动词头这类推出来带连接符的）：单独成词的助动词、代词分不出来，不猜
      if (mode === 'before') continue
      const ds = p.dimensionIds
        .map((d) => catalog.groupDist.get('dim:' + d))
        .filter((x) => x !== undefined)
      const rank = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 1.5
      out.push({ key: p.id, paradigm: p, posId: pos.id, lexemes, mode, rank })
    }
  }
  return out
}

// ───────────────────────── 拼词 ─────────────────────────

export interface PieceSpec {
  id: string
  side: 'prefix' | 'suffix' | 'infix'
  morphemeId?: Id
  /** 搭伴构形推出来的一截（动词头 nó·）：哪个构形、用哪个词、各维度挑了什么 */
  companion?: { paradigmId: Id; lexemeId: Id; picks: Record<Id, Id> }
  groupId: string
  /** 离词干多远：小的在里层 */
  rank: number
  /** 手动拖过的顺序（小的在里层）；这一边有一个拖过就都按它排 */
  order?: number
  /** 加进来的先后：同一层的，后加的在外层 */
  seq: number
}

export interface WordSpec {
  lexemeId?: Id
  morphemeId?: Id
  /** 没挂词条的（手打的）原样 */
  base: string
  /**
   * 放进句子里就写成这样、不用词头：单独成词的虚词可省的部分不要、几种写法取一种，
   * 隔开写的（`ma…gò`）每一段各是一个词（见 particleWords）
   */
  surface?: string
  /** 手打的词算作哪个词类（用户在附着台上挑的）：挑了就按这个词类的构形推、按它找能搭的 */
  posId?: Id | null
  /** 自己构形挑的那一套（构形 + 变体）与各维度的取值；null 是原形 */
  own?: { lpKey: string; picks: Record<Id, Id> } | null
  pieces: PieceSpec[]
  /** 作用于所有词的构形挑了哪一格 */
  mutation?: { paradigmId: Id; slotKey: string } | null
}

/** 手打的词挑了词类时，拿词头当词条推它的构形（不进词库，id 是空的） */
function freeLexeme(spec: WordSpec): Lexeme | undefined {
  if (spec.lexemeId || spec.morphemeId || !spec.posId || !spec.base.trim()) return undefined
  return {
    id: '',
    languageId: '',
    lemma: spec.base.trim(),
    posId: spec.posId,
    paradigmId: null,
    paradigmVariantId: null,
    extraParadigms: [],
    extraPosIds: [],
    features: {},
    tags: [],
    senses: [],
    stems: {},
    forms: {}
  } as unknown as Lexeme
}

/** 拼词、摆附着台用的词条：挂着的那个，手打的挑了词类就用临时的 */
export function specLexeme(project: Project, spec: WordSpec): Lexeme | undefined {
  return spec.lexemeId ? project.lexemes.find((x) => x.id === spec.lexemeId) : freeLexeme(spec)
}

export interface BuiltPiece {
  /** 附加成分的 id；词干那一段是 core */
  id: string
  form: string
  gloss: string
  /** 词干是 core */
  groupId: string
  morphemeId?: Id | null
  lexemeId?: Id | null
}

export interface BuiltWord {
  form: string
  /** 从左到右的各段 */
  parts: BuiltPiece[]
  /** 自己构形挑到的那一格存在词条 forms 的哪个键下（跟分析里的 slot 一个口径）；原形是 null */
  slotKey: string | null
  slotAbbr: string
  /** 挑了但推不出来（这一格没有写法） */
  missing: boolean
}

export interface BuildEnv {
  project: Project
  ctx: MorphContext
  glossLangs: string[]
}

/** 词头、语素写成 `bil-`、`=mU` 的，放进句子时去掉两头的连字符、等号（中点这类是写法的一部分，留着） */
export const bare = (s: string): string => s.trim().replace(/^[-=]+|[-=]+$/g, '')

export const lpKeyOf = (lp: LexemeParadigm): string => `${lp.paradigm.id}#${lp.variantId ?? ''}`

/** 各维度挑的取值 → 槽位（屏蔽了的格子没有） */
export function slotFor(
  project: Project,
  paradigm: Paradigm,
  picks: Record<Id, Id>,
  glossLangs: string[]
): SlotDef | null {
  const n = paradigm.dimensionIds.length
  return (
    paradigmSlots(paradigm, project.categories, glossLangs).find(
      (s) => s.values.length === n && s.values.every((v) => picks[v.categoryId] === v.valueId)
    ) ?? null
  )
}

/** 每个维度的第一个取值：还没挑时拿来补齐 */
export function defaultPicks(project: Project, paradigm: Paradigm): Record<Id, Id> {
  const out: Record<Id, Id> = {}
  for (const d of paradigm.dimensionIds) {
    const c = project.categories.find((x) => x.id === d)
    if (c?.values[0]) out[d] = c.values[0].id
  }
  return out
}

/** 词条某一格的形式：存下来的（有几个异写取第一个），没有就现推；推不出来是 null */
function slotForm(
  env: BuildEnv,
  lexeme: Lexeme,
  lp: LexemeParadigm,
  slot: SlotDef
): { form: string; key: string } | null {
  const ls = lexemeSlots(env.project, lexeme, env.glossLangs).find(
    (s) => lpKeyOf(s.lp) === lpKeyOf(lp) && s.slot.key === slot.key
  )
  const key = ls?.key ?? slot.label
  const stored = lexeme.forms[key]?.surface?.trim()
  if (stored) return { form: variants(stored)[0] ?? stored, key }
  const g = generateForm(env.ctx, lexeme, lp.paradigm, slot, lp.variantId)
  return g?.surface ? { form: g.surface, key } : null
}

/** 词条的某一套构形；key 对不上时用第一套 */
function lpOf(
  project: Project,
  lexeme: Lexeme,
  key: string | undefined
): LexemeParadigm | undefined {
  const all = paradigmsFor(project, lexeme)
  return all.find((x) => lpKeyOf(x) === key) ?? all[0]
}

/** 搭伴构形推出来的那一截 */
function companionForm(
  env: BuildEnv,
  c: NonNullable<PieceSpec['companion']>
): { form: string; abbr: string } | null {
  const l = env.project.lexemes.find((x) => x.id === c.lexemeId)
  const p = env.project.paradigms.find((x) => x.id === c.paradigmId)
  if (!l || !p) return null
  const slot = slotFor(env.project, p, c.picks, env.glossLangs)
  if (!slot) return null
  const lp = paradigmsFor(env.project, l).find((x) => x.paradigm.id === p.id) ?? {
    paradigm: p,
    variantId: null,
    primary: true
  }
  const f = slotForm(env, l, lp, slot)
  return f ? { form: f.form.trim(), abbr: slot.abbr } : null
}

/** 作用于所有词的构形那一格，正着作用在一个形式上（拿只有词头的临时词条推） */
export function applyMutation(
  env: BuildEnv,
  mutation: { paradigmId: Id; slotKey: string },
  form: string
): { form: string; abbr: string } | null {
  const p = env.project.paradigms.find((x) => x.id === mutation.paradigmId)
  if (!p) return null
  const slot = paradigmSlots(p, env.project.categories, env.glossLangs).find(
    (s) => s.key === mutation.slotKey
  )
  if (!slot) return null
  const temp = {
    lemma: form,
    stems: {},
    forms: {},
    features: {},
    paradigmVariantId: null
  } as unknown as Lexeme
  const g = generateForm(env.ctx, temp, p, slot)
  return g ? { form: g.surface, abbr: slot.abbr } : null
}

/** 同一边的附加成分从里到外排：拖过的按拖的，否则按离词干的层数，同层的先加的在里 */
export function innerToOuter(ps: PieceSpec[]): PieceSpec[] {
  const manual = ps.some((p) => p.order !== undefined)
  return [...ps].sort((a, b) =>
    manual ? (a.order ?? 1e9) - (b.order ?? 1e9) || a.seq - b.seq : a.rank - b.rank || a.seq - b.seq
  )
}

/** 按挑好的拼出这个词：自己的屈折形 → 中缀 → 后缀（从里到外）→ 前缀（从里到外）→ 作用于所有词的构形 */
export function buildWord(env: BuildEnv, spec: WordSpec): BuiltWord {
  const { project } = env
  const real = spec.lexemeId ? project.lexemes.find((x) => x.id === spec.lexemeId) : undefined
  // 手打的词挑了词类：拿词头按那个词类的构形推
  const lexeme = real ?? freeLexeme(spec)
  const own = spec.morphemeId ? project.morphemes.find((x) => x.id === spec.morphemeId) : undefined
  let core = bare(spec.surface ?? (lexeme ? lexeme.lemma : own ? own.form : spec.base))
  let coreGloss = real
    ? lexemeGloss(real, env.glossLangs)
    : own
      ? own.gloss || pick(own.meaning, env.glossLangs)
      : ''
  let slotKey: string | null = null
  let slotAbbr = ''
  let missing = false
  if (lexeme && spec.own) {
    const lp = lpOf(project, lexeme, spec.own.lpKey)
    const slot = lp ? slotFor(project, lp.paradigm, spec.own.picks, env.glossLangs) : null
    const f = lp && slot ? slotForm(env, lexeme, lp, slot) : null
    if (f && slot) {
      core = f.form
      slotKey = f.key
      slotAbbr = slot.abbr
      coreGloss = coreGloss ? `${coreGloss}.${slot.abbr}` : slot.abbr
    } else missing = true
  }
  const morph = (id: Id | undefined): Morpheme | undefined =>
    id ? project.morphemes.find((x) => x.id === id) : undefined
  // 中缀插进词干里，不单独成一段，gloss 记在词干后面
  for (const p of spec.pieces.filter((x) => x.side === 'infix')) {
    const m = morph(p.morphemeId)
    if (!m) continue
    core = infixInto(env.ctx, core, m.form, m.form2 || 'V1')
    coreGloss += `<${m.gloss || pick(m.meaning, env.glossLangs)}>`
  }
  const coreLexeme = real?.id ?? null
  let cur = core
  const suffixes: BuiltPiece[] = []
  const prefixes: BuiltPiece[] = []
  const tails: BuiltPiece[] = []
  const pieceOf = (p: PieceSpec, side: 'prefix' | 'suffix'): BuiltPiece | null => {
    if (p.companion) {
      const c = companionForm(env, p.companion)
      return c
        ? {
            id: p.id,
            form: c.form,
            gloss: c.abbr,
            groupId: p.groupId,
            lexemeId: p.companion.lexemeId
          }
        : null
    }
    const m = morph(p.morphemeId)
    if (!m) return null
    const form = bare(selectAllomorph(env.ctx, m, cur, side).form)
    return {
      id: p.id,
      form,
      gloss: m.gloss || pick(m.meaning, env.glossLangs),
      groupId: p.groupId,
      morphemeId: m.id
    }
  }
  for (const p of innerToOuter(spec.pieces.filter((x) => x.side === 'suffix'))) {
    const b = pieceOf(p, 'suffix')
    if (!b || !b.form) continue
    cur += b.form
    suffixes.push(b)
  }
  for (const p of innerToOuter(spec.pieces.filter((x) => x.side === 'prefix'))) {
    const m = morph(p.morphemeId)
    // 环缀：前一截当前缀，后一截接在最外面
    if (m?.type === 'circumfix') {
      const a = bare(m.form)
      const z = bare(m.form2)
      const g = m.gloss || pick(m.meaning, env.glossLangs)
      if (a) {
        cur = a + cur
        prefixes.push({ id: p.id, form: a, gloss: g, groupId: p.groupId, morphemeId: m.id })
      }
      if (z) {
        cur += z
        tails.push({ id: p.id + ':2', form: z, gloss: g, groupId: p.groupId, morphemeId: m.id })
      }
      continue
    }
    const b = pieceOf(p, 'prefix')
    if (!b || !b.form) continue
    cur = b.form + cur
    prefixes.push(b)
  }
  let parts: BuiltPiece[] = [
    ...prefixes.reverse(),
    { id: 'core', form: core, gloss: coreGloss, groupId: 'core', lexemeId: coreLexeme },
    ...suffixes,
    ...tails
  ]
  if (spec.mutation) {
    const mut = applyMutation(env, spec.mutation, cur)
    if (mut) {
      parts = parts.map((x) => (x.id === 'core' ? { ...x, gloss: `${x.gloss}.${mut.abbr}` } : x))
      if (mut.form !== cur) parts = remap(parts, cur, mut.form)
      cur = mut.form
    }
  }
  return { form: cur, parts, slotKey, slotAbbr, missing }
}

/**
 * 整个词过了一遍词首音变之后，各段的写法跟着改：一般只动开头那一段；
 * 后面几段对不上（改的不止开头）就并成一段
 */
function remap(parts: BuiltPiece[], before: string, after: string): BuiltPiece[] {
  const first = parts[0]
  const rest = before.slice(first.form.length)
  if (after.length >= rest.length && after.endsWith(rest))
    return [{ ...first, form: after.slice(0, after.length - rest.length) }, ...parts.slice(1)]
  const core = parts.find((x) => x.id === 'core') ?? first
  return [
    {
      ...core,
      form: after,
      gloss: parts
        .map((x) => x.gloss)
        .filter(Boolean)
        .join('-')
    }
  ]
}

/** 拼好的词记进分析时的各段（跟语料分析一个样子） */
export function morphsOf(w: BuiltWord): Analysis['morphs'] {
  return w.parts.map((p) => ({
    form: p.form,
    gloss: p.gloss || '?',
    morphemeId: p.morphemeId ?? null,
    lexemeId: p.lexemeId ?? null
  }))
}

// ───────────────────────── 给工作台摆出来 ─────────────────────────

export interface DeckValue {
  id: Id
  abbr: string
  name: string
  /** 挑它会是什么形式；这一格推不出来是 null */
  form: string | null
  selected: boolean
}
export interface DeckDim {
  id: Id
  name: string
  groupId: string
  values: DeckValue[]
}
export interface DeckParadigm {
  key: string
  name: string
  dims: DeckDim[]
  /** 已经用上了 */
  active: boolean
}
export interface DeckCompanion extends DeckParadigm {
  posName: string
  lexemes: { id: Id; lemma: string }[]
  lexemeId: Id
  mode: AttachMode
}
export interface DeckMarker {
  key: string
  form: string
  gloss: string
  mode: AttachMode
  selected: boolean
  /** 加上它之后这个词写成什么（单独成词的就是它自己） */
  preview: string
  score: number
  /** 只是猜的（语料里没见过、也没写明） */
  weak: boolean
}
export interface DeckGroup {
  id: string
  kind: MarkerGroup['kind']
  label: string
  markers: DeckMarker[]
  /** 先摆出来几个：有根据的全摆，全是猜的摆 WEAK_SHOWN 个；其余点「+N」展开 */
  shown: number
}
export interface DeckMutation {
  paradigmId: Id
  name: string
  /** 不过这一遍时的样子（「无」那一格写它） */
  base: string
  slots: { key: string; abbr: string; name: string; form: string; selected: boolean }[]
}
export interface DeckModel {
  posIds: Id[]
  /** 大致是体词还是谓词（看不出来是 null） */
  domain: Domain | null
  built: BuiltWord
  own: DeckParadigm[]
  companions: DeckCompanion[]
  groups: DeckGroup[]
  others: DeckGroup[]
  mutations: DeckMutation[]
}

export interface DeckEnv extends BuildEnv {
  languageId: Id
  catalog: MarkerCatalog
}

/** 这个词现在的词类：最后加上的派生词缀「算作」了哪个词类就是哪个 */
export function effectivePos(env: DeckEnv, spec: WordSpec): Id | null {
  const pieces = [...spec.pieces].sort((a, b) => b.seq - a.seq)
  for (const p of pieces) {
    const m = p.morphemeId ? env.project.morphemes.find((x) => x.id === p.morphemeId) : undefined
    if (m?.stress?.affects && m.stress.passPos && m.stress.posId) return m.stress.posId
  }
  return null
}

/** 工作台上一个词的词类与它自己构形管着的维度：挂着的词条、手打时挑的词类、加了派生词缀后算作的词类 */
export function wordHost(env: DeckEnv, spec: WordSpec): HostInfo {
  return hostInfo(env.project, specLexeme(env.project, spec) ?? null, effectivePos(env, spec))
}

/** 维度一行：每个取值挑了会是什么 */
function dimsOf(
  env: BuildEnv,
  paradigm: Paradigm,
  picks: Record<Id, Id>,
  active: boolean,
  formFor: (picks: Record<Id, Id>) => string | null
): DeckDim[] {
  const out: DeckDim[] = []
  for (const d of paradigm.dimensionIds) {
    const c = env.project.categories.find((x) => x.id === d)
    if (!c) continue
    out.push({
      id: c.id,
      name: pick(c.name, env.glossLangs) || '?',
      groupId: 'dim:' + c.id,
      values: c.values.map((v) => ({
        id: v.id,
        abbr: v.abbr,
        name: pick(v.name, env.glossLangs) || v.abbr,
        form: formFor({ ...picks, [c.id]: v.id }),
        selected: active && picks[c.id] === v.id
      }))
    })
  }
  return out
}

/**
 * 工作台上给选中的词摆出来的全部东西。attached：已经单独成词挂在这个词上的标记（小品词）
 */
export function deckModel(env: DeckEnv, spec: WordSpec, attached: ReadonlySet<string>): DeckModel {
  const { project } = env
  const lexeme = specLexeme(project, spec)
  const built = buildWord(env, spec)
  const posOverride = effectivePos(env, spec)
  const host = hostInfo(project, lexeme ?? null, posOverride)
  // 自己的构形（加了改词类的派生词缀之后，按新词类的构形）
  const own: DeckParadigm[] = []
  if (lexeme && !posOverride)
    for (const lp of paradigmsFor(project, lexeme)) {
      const key = lpKeyOf(lp)
      const active = spec.own?.lpKey === key
      const picks = active ? spec.own!.picks : defaultPicks(project, lp.paradigm)
      own.push({
        key,
        name: pick(lp.paradigm.name, env.glossLangs) || '?',
        active,
        dims: dimsOf(env, lp.paradigm, picks, active, (pk) => {
          const slot = slotFor(project, lp.paradigm, pk, env.glossLangs)
          return slot ? (slotForm(env, lexeme, lp, slot)?.form ?? null) : null
        })
      })
    }
  // 搭伴的构形
  const companions: DeckCompanion[] = []
  for (const c of companionsFor(project, env.languageId, env.catalog, host)) {
    const on = spec.pieces.find((p) => p.companion?.paradigmId === c.paradigm.id)
    const lexemeId = on?.companion?.lexemeId ?? c.lexemes[0].id
    const picks = on?.companion?.picks ?? defaultPicks(project, c.paradigm)
    const pos = findPos(project, c.posId)
    companions.push({
      key: c.key,
      name: pick(c.paradigm.name, env.glossLangs) || '?',
      posName: posName(pos, env.glossLangs),
      active: !!on,
      lexemes: c.lexemes.map((l) => ({ id: l.id, lemma: l.lemma })),
      lexemeId,
      mode: c.mode,
      dims: dimsOf(
        env,
        c.paradigm,
        picks,
        !!on,
        (pk) => companionForm(env, { paradigmId: c.paradigm.id, lexemeId, picks: pk })?.form ?? null
      )
    })
  }
  // 能附着的
  const { groups, others, guess } = markersFor(project, env.catalog, host)
  const selectedKeys = new Set([
    ...spec.pieces.filter((p) => p.morphemeId).map((p) => 'm:' + p.morphemeId),
    ...attached
  ])
  const toDeck = (x: ScoredMarker): DeckMarker => {
    const selected = selectedKeys.has(x.marker.key)
    let preview = particleWords(x.marker.form, x.mode).join(' … ')
    if (x.marker.morphemeId && !isWordMode(x.mode)) {
      const next: WordSpec = selected
        ? { ...spec, pieces: spec.pieces.filter((p) => p.morphemeId !== x.marker.morphemeId) }
        : {
            ...spec,
            pieces: [
              ...spec.pieces,
              pieceFor(
                env,
                x.marker,
                x.mode,
                spec.pieces.length ? Math.max(...spec.pieces.map((p) => p.seq)) + 1 : 0
              )
            ]
          }
      preview = buildWord(env, next).form
    }
    return {
      key: x.marker.key,
      form: x.marker.form,
      gloss: x.marker.gloss,
      mode: x.mode,
      selected,
      preview,
      score: x.score,
      weak: x.weak
    }
  }
  const deckGroups: DeckGroup[] = groups.map((g) => {
    const strong = g.items.filter((x) => !x.weak).length
    return {
      id: g.group.id,
      kind: g.group.kind,
      label: g.group.label,
      markers: g.items.map(toDeck),
      // 在猜的时候猜的也先摆几个出来；证据足的时候只摆有根据的，猜的收在「+N」里
      shown: guess
        ? Math.max(strong, Math.min(g.items.length, WEAK_SHOWN))
        : strong || Math.min(g.items.length, WEAK_SHOWN)
    }
  })
  // 「其他」也按组摆，只是默认收着
  const otherMap = new Map<string, DeckGroup>()
  for (const x of others) {
    let g = otherMap.get(x.marker.group.id)
    if (!g)
      otherMap.set(
        x.marker.group.id,
        (g = {
          id: x.marker.group.id,
          kind: x.marker.group.kind,
          label: x.marker.group.label,
          markers: [],
          shown: 0
        })
      )
    g.markers.push(toDeck(x))
  }
  // 作用于所有词的构形
  const mutations: DeckMutation[] = []
  const bareForm = buildWord(env, { ...spec, mutation: null }).form
  for (const p of project.paradigms) {
    if (!p.appliesToAll) continue
    if (p.appliesToLanguageId && p.appliesToLanguageId !== env.languageId) continue
    const slots = paradigmSlots(p, project.categories, env.glossLangs).map((s) => {
      const r = applyMutation(env, { paradigmId: p.id, slotKey: s.key }, bareForm)
      return {
        key: s.key,
        abbr: s.abbr,
        name: s.label,
        form: r?.form ?? bareForm,
        selected: spec.mutation?.paradigmId === p.id && spec.mutation.slotKey === s.key
      }
    })
    if (slots.length)
      mutations.push({
        paradigmId: p.id,
        name: pick(p.name, env.glossLangs) || '?',
        base: bareForm,
        slots
      })
  }
  for (const g of otherMap.values()) g.shown = g.markers.length
  return {
    posIds: host.posIds,
    domain: hostDomain(project, env.catalog, host),
    built,
    own,
    companions,
    groups: deckGroups,
    others: [...otherMap.values()],
    mutations
  }
}

/** 把一个标记做成词里的一截：贴在哪边、离词干多远（语料里它自己的层数，没有就看它那一组，再没有就放最外层） */
export function pieceFor(env: DeckEnv, marker: Marker, mode: AttachMode, seq: number): PieceSpec {
  const s = env.catalog.stats.get(marker.key)
  const rank =
    s && s.distN > 0 ? s.dist / s.distN : (env.catalog.groupDist.get(marker.group.id) ?? 9)
  return {
    id: `${marker.key}#${seq}`,
    side: mode === 'suffix' ? 'suffix' : mode === 'infix' ? 'infix' : 'prefix',
    morphemeId: marker.morphemeId,
    groupId: marker.group.id,
    rank,
    seq
  }
}

/** 把搭伴构形做成词里的一截 */
export function companionPiece(
  c: Companion,
  lexemeId: Id,
  picks: Record<Id, Id>,
  seq: number
): PieceSpec {
  return {
    id: `c:${c.key}#${seq}`,
    side: c.mode === 'suffix' ? 'suffix' : 'prefix',
    companion: { paradigmId: c.paradigm.id, lexemeId, picks },
    groupId: 'dim:' + (c.paradigm.dimensionIds[0] ?? ''),
    rank: c.rank,
    seq
  }
}

/**
 * 手打的词认一认：是哪个词条的词头，或者存下来的哪一格屈折形（认出来就连构形挑的取值一起给）
 */
export function recognize(
  project: Project,
  languageId: Id,
  surface: string,
  glossLangs: string[]
): { lexemeId: Id; own: WordSpec['own'] } | null {
  const w = norm(surface)
  if (!w) return null
  const mine = project.lexemes.filter((l) => l.languageId === languageId)
  for (const l of mine) if (norm(bare(l.lemma)) === w) return { lexemeId: l.id, own: null }
  for (const l of mine)
    for (const s of lexemeSlots(project, l, glossLangs)) {
      const f = l.forms[s.key]?.surface
      if (!f || !variants(f).some((v) => norm(v) === w)) continue
      const picks: Record<Id, Id> = {}
      for (const v of s.slot.values) picks[v.categoryId] = v.valueId
      return { lexemeId: l.id, own: { lpKey: lpKeyOf(s.lp), picks } }
    }
  return null
}
