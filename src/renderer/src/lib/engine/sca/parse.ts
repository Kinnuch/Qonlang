/**
 * 规则语言解析器。语法见 docs/rules.md。
 *
 * 一段文本里可以混写：
 *   V=aeiou            单字母音类
 *   {Vlong}=ā ē ī ō ū  长名音类（成员用空格/逗号分隔；不分隔则按字符拆）
 *   th|θ               多合字母：匹配前把 th 换成 θ，输出时换回
 *   [+送气]=ph th kh    特征：从这一行起有效，后面可以重新定义；规则里写 [+送气]、[-送气]
 *   ˈ = -2 / _CC , -3  重音规则：到这一行时给词标上重音，管到下一条重音规则
 *   -* 阶段名           快照标记
 *   目标 > 替换 / 环境   规则
 *   ; 注释   或   # 行首注释
 */

export interface ClassRef {
  name: string
  members: string[]
}

export interface Context {
  left: string
  right: string
}

export interface CompiledContext {
  main: RegExp
  /** 各个排除环境（`- 排除 , 排除`）：落在任何一个里的匹配都不改 */
  excludes: RegExp[]
  /** 左环境里编号音类占掉的捕获组个数（目标的捕获组要往后数这么多） */
  offset: number
}

export interface ParsedRule {
  kind: 'rule'
  line: number
  raw: string
  /** 行尾 ; 之后的注释 */
  comment: string
  target: string
  replacement: string
  contexts: Context[]
  /** 排除环境，可以几个（`- 排除 , 排除`） */
  exceptions: Context[]
  /** 目标里第一个音类（用于替换侧一一对应） */
  targetClass: ClassRef | null
  /** 该音类在目标正则里的捕获组序号 */
  targetGroup: number
  compiled: CompiledContext[]
  /** 替换文本中的音类引用已按 pos 展开时用到 */
  replacementParts: ReplacementPart[]
  /**
   * 满足 / 不满足环境两路（`x1?x2 > a?b / 环境`）：满足环境的 x1 改成 a，其余位置的 x2 改成 b。
   * 目标、替换两边只写一边带 `?` 时，另一边两路共用。没有 `?` 的普通规则没有这一项。
   */
  branches?: { then: RuleBranch; otherwise: RuleBranch & { anywhere: RegExp } }
  /** 音与音之间允许隔着重音记号、音节边界（在重音规则之后，或规则里用了 σ） */
  marks: boolean
  /** 规则里用了 σ：匹配前要先划音节 */
  sigma: boolean
  /** 目标里自己写了 ˈ ˌ：被这条规则吃掉的重音记号不再放回去 */
  explicitStress: boolean
  /** 规则里引用到的特征成员（给示例用）：方括号里的原文 → 成员 */
  featureMembers?: Record<string, string[]>
}

/** if-else 规则的一路：要改的目标、改成什么，以及编好的匹配 */
export interface RuleBranch {
  target: string
  replacement: string
  targetClass: ClassRef | null
  targetGroup: number
  replacementParts: ReplacementPart[]
  /** then：目标在环境里的匹配；otherwise：目标满足环境的位置（这些位置不改） */
  compiled: CompiledContext[]
}

export type ReplacementPart =
  | { kind: 'text'; text: string }
  | { kind: 'class'; ref: ClassRef }
  /** 编号音类 C1：输出目标或环境里同编号匹配到的那个音 */
  | { kind: 'ref'; name: string }

export interface MarkerLine {
  kind: 'marker'
  line: number
  raw: string
  comment: string
  name: string
}

export interface OtherLine {
  kind: 'blank' | 'comment' | 'class' | 'replacement' | 'error'
  line: number
  raw: string
  comment: string
  message?: string
}

/** 特征定义 `[+送气] = ph th kh`：从这一行起有效 */
export interface FeatureLine {
  kind: 'feature'
  line: number
  raw: string
  comment: string
  name: string
  sign: '+' | '-'
  members: string[]
}

/** 一门语言、一段规则里切音节用的设置（ParseOptions.syllables）；都能按 JSON 存 */
export interface SyllableScheme {
  /** 切音段用的单位（多字母的音位、多合字母的内部符号） */
  units: string[]
  /** 可作音节核的音 */
  nuclei: string[]
  /** 确定是辅音的音（不再按 IPA 表推断） */
  consonants: string[]
  /** 允许的起首；空表示不限 */
  onsets: string[]
  maxOnset: number | null
  maxCoda: number | null
}

/** 重音规则里一条的匹配：音节核里有 target，左环境在核前、右环境在核后 */
export interface ClauseMatcher {
  target: RegExp | null
  left: RegExp | null
  right: RegExp | null
}

/** 重音规则里的一条：`(2) -1 {双元音} / _C - ...` */
export interface StressClause {
  raw: string
  /** 词（这一段）的音节数要恰好是 count，orMore 时至少是 count；null 不限 */
  count: number | null
  orMore: boolean
  /** 第几个音节：正数从前数、负数从后数；first / last 是从前、从后找第一个符合条件的 */
  position: number | 'first' | 'last'
  /** 条件原文（显示用） */
  target: string
  context: Context
  exception: Context | null
  match: ClauseMatcher
  except: ClauseMatcher | null
}

/** 重音规则 `ˈ = 条件 , 条件 … | 分段符号 主重音在第几段`：到这一行时重新标重音 */
export interface StressLine {
  kind: 'stress'
  line: number
  raw: string
  comment: string
  /** ˈ 主重音（先去掉原有的主次重音）；ˌ 次重音（只加次重音） */
  level: 'primary' | 'secondary'
  /** = 后面的原文 */
  text: string
  clauses: StressClause[]
  /** 按这些符号把词分成几段各算各的；空表示整个词算一段 */
  split: string
  /** 分段时主重音落在第几段：正数从前数，负数从后数 */
  head: number
}

/** 规则的可编辑表示（列表视图用） */
export interface RuleDraft {
  target: string
  replacement: string
  contexts: Context[]
  exceptions: Context[]
  comment: string
}

export function formatRule(d: RuleDraft): string {
  let s = `${d.target.trim()} > ${d.replacement.trim()}`.trimEnd()
  const ctxs = d.contexts.filter((c) => c.left.trim() || c.right.trim())
  if (ctxs.length) s += ' / ' + ctxs.map((c) => `${c.left.trim()}_${c.right.trim()}`).join(' , ')
  const excs = d.exceptions.filter((c) => c.left.trim() || c.right.trim())
  if (excs.length) {
    if (!ctxs.length) s += ' / _'
    s += ' - ' + excs.map((c) => `${c.left.trim()}_${c.right.trim()}`).join(' , ')
  }
  if (d.comment.trim()) s += `  ; ${d.comment.trim()}`
  return s
}

export function formatMarker(name: string, comment = ''): string {
  return `-* ${name.trim()}` + (comment.trim() ? `  ; ${comment.trim()}` : '')
}

export function formatClassLine(name: string, members: string[]): string {
  const key = name.length === 1 ? name : `{${name.replace(/^\{|\}$/g, '')}}`
  const multi = members.some((m) => Array.from(m).length > 1)
  return `${key}=${multi ? members.join(' ') : members.join('')}`
}

export function formatReplacementLine(from: string, to: string): string {
  return `${from.trim()}|${to.trim()}`
}

/** 解析音类声明行；不是则返回 null */
export function parseClassLine(raw: string): { name: string; members: string[] } | null {
  const content = stripComment(raw)
  const m = CLASS_LINE.exec(content)
  if (!m) return null
  const key = m[1]
  return { name: key.replace(/^\{|\}$/g, ''), members: classMembers(key, m[2]) }
}

/** 解析多合字母声明行；不是则返回 null */
export function parseReplacementLine(raw: string): { from: string; to: string } | null {
  const content = stripComment(raw)
  if (content.includes('>')) return null
  const m = REPL_LINE.exec(content)
  return m ? { from: literalEscapes(m[1]), to: literalEscapes(m[2]) } : null
}

/** 去掉注释后的内容（转义已换成占位字符，`\;` 不算注释开头） */
function stripComment(raw: string): string {
  const enc = encodeEscapes(raw)
  const semi = enc.indexOf(';')
  return (semi >= 0 ? enc.slice(0, semi) : enc).trim()
}

function commentOf(raw: string): string {
  const enc = encodeEscapes(raw)
  const semi = enc.indexOf(';')
  return semi >= 0 ? decodeEscapes(enc.slice(semi + 1).trim()) : ''
}

/** 音类声明的成员：单字母音类按字符拆，长名音类按空白 / 逗号拆；转义过的字符是字面成员 */
function classMembers(key: string, value: string): string[] {
  const parts = key.length === 1 ? Array.from(value.replace(/\s+/g, '')) : splitMembers(value)
  return dedupe(parts.map(literalEscapes))
}

export type ParsedLine = ParsedRule | MarkerLine | OtherLine | FeatureLine | StressLine

export interface Diagnostic {
  line: number
  severity: 'error' | 'warning'
  message: string
}

export interface RuleProgram {
  classes: Map<string, string[]>
  replacements: [string, string][]
  lines: ParsedLine[]
  /** 只含规则、重音规则和标记，按出现顺序 */
  steps: (ParsedRule | MarkerLine | StressLine)[]
  markers: string[]
  diagnostics: Diagnostic[]
  /** 切音节用的设置：语言给的加上规则文本里的音类 */
  syllables: SyllableScheme
  /** 有重音规则：输出里会带 ˈ ˌ */
  hasStress: boolean
}

export interface ParseOptions {
  /** 外部提供的音类（如来自语言的音系页） */
  classes?: Record<string, string[]>
  /** 外部提供的多合字母 */
  replacements?: [string, string][]
  /** 可用 @名 引用的语素：名（gloss 或去掉连字符的形式）→ 各异体形 */
  morphemes?: Record<string, string[]>
  /** 切音节用的设置（σ、重音规则）；不给时只靠规则里的音类和 IPA 表推断 */
  syllables?: SyllableScheme
}

/**
 * 反斜杠转义：`\?`、`\.`、`\#`、`\C` 这样写表示字面上的那个字符——不当通配、不当音类，
 * 也不当分隔符。解析一开始就把「反斜杠 + 字符」换成私用区里一一对应的占位字符，
 * 切行、找注释、多合字母替换都碰不到它；编正则、拼替换文本时再换回字面字符。
 * 反斜杠后面是空白、斜杠或行尾时不算转义：单独一个 `\` 仍是换位（`ab > \ / _#`）。
 */
const ESCAPE_BASE = 0x10ff00
const ESCAPABLE = /^[\\?#()[\]{}@|.*+^$_>,\-;=~!%&'"A-Z0-9σ]$/
const HAS_PLACEHOLDER = /[\u{10FF00}-\u{10FF7F}]/u
/** 不在 ASCII 里的可转义字符占用控制字符那几个位置（它们本身不会被转义） */
const WIDE_ESCAPES = ['σ']

export function encodeEscapes(s: string): string {
  if (!s.includes('\\')) return s
  let out = ''
  const chars = Array.from(s)
  for (let i = 0; i < chars.length; i++) {
    const next = chars[i + 1]
    if (chars[i] === '\\' && next !== undefined && ESCAPABLE.test(next)) {
      const wide = WIDE_ESCAPES.indexOf(next)
      out += String.fromCodePoint(ESCAPE_BASE + (wide >= 0 ? wide + 1 : next.charCodeAt(0)))
      i++
    } else out += chars[i]
  }
  return out
}

/** 占位字符对应的字面字符；不是占位字符返回 null */
function escapedChar(c: string): string | null {
  const cp = c.codePointAt(0) ?? 0
  if (cp < ESCAPE_BASE || cp >= ESCAPE_BASE + 0x80) return null
  const code = cp - ESCAPE_BASE
  return code >= 1 && code <= WIDE_ESCAPES.length
    ? WIDE_ESCAPES[code - 1]
    : String.fromCharCode(code)
}

function mapPlaceholders(s: string, to: (lit: string) => string): string {
  if (!HAS_PLACEHOLDER.test(s)) return s
  return Array.from(s)
    .map((c) => {
      const lit = escapedChar(c)
      return lit === null ? c : to(lit)
    })
    .join('')
}

/** 占位字符换回「反斜杠 + 字符」（给界面显示、再写回文本用） */
export function decodeEscapes(s: string): string {
  return mapPlaceholders(s, (lit) => '\\' + lit)
}

/** 占位字符换成字面字符（音类成员、多合字母声明用） */
function literalEscapes(s: string): string {
  return mapPlaceholders(s, (lit) => lit)
}

/**
 * 让一段文字在规则里按字面匹配：`?` `.` `#` 这类符号前面加反斜杠；
 * 大写字母只有跟 classNames 里的音类同名时才加（其余大写字母本来就是字面字符）。
 */
export function escapeRuleText(s: string, classNames?: ReadonlySet<string>): string {
  return Array.from(s)
    .map((c) => {
      if (c >= 'A' && c <= 'Z') return classNames?.has(c) ? '\\' + c : c
      if (c >= '0' && c <= '9') return c
      return ESCAPABLE.test(c) ? '\\' + c : c
    })
    .join('')
}

const CLASS_LINE = /^(\{[^}]+\}|[A-Z])\s*=(.*)$/
const REPL_LINE = /^(\S+)\s*\|\s*(\S+)$/
/** 重音规则行：ˈ = …（打不出 ˈ 可以写 '），次重音 ˌ = … */
const STRESS_LINE = /^([ˈˌ'])\s*=(.*)$/su
/** 特征定义行：[+送气] = ph th kh */
const FEATURE_LINE = /^\[\s*([+-])\s*(\p{L}[^\]\s]*)\s*\]\s*=(.*)$/su
/** 方括号里是特征引用（[+送气]、[-浊 +塞]），而不是临时音类 */
const FEATURE_REF = /^\s*[+-]\s*\p{L}[^\s\]]*(?:\s+[+-]\s*\p{L}[^\s\]]*)*\s*$/u
const VOWEL_CLASS = /^(V|Vowel|Vowels|元音|N|Nucleus)$/i
const CONSONANT_CLASS = /^(C|Consonant|Consonants|辅音)$/i

/** 音节边界：规则里写 σ，匹配时临时插在词里各音节之间（Unicode 非字符，任何文字里都不会有） */
export const BOUNDARY = '\uFDD0'
/** 按音节、重音匹配时，两个音之间可以隔着的记号 */
const SKIP = `[${BOUNDARY}ˈˌ]*`
/** 组合附标（一个音后面可以跟着几个） */
const COMBINING = '[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]*'

export interface FeatureDef {
  plus: string[] | null
  minus: string[] | null
}
export type FeatureTable = Map<string, FeatureDef>

/** 第一个不在 [] {} () 里的某个字符的位置；没有返回 -1 */
function topLevelIndex(s: string, ch: string, from = 0): number {
  let depth = 0
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (c === '[' || c === '{' || c === '(') depth++
    else if ((c === ']' || c === '}' || c === ')') && depth > 0) depth--
    else if (c === ch && depth === 0) return i
  }
  return -1
}

/** 按顶层的某个字符切开（[] {} () 里的不算） */
function splitTopLevel(s: string, ch: string): string[] {
  const out: string[] = []
  let from = 0
  for (let at = topLevelIndex(s, ch); at >= 0; at = topLevelIndex(s, ch, from)) {
    out.push(s.slice(from, at))
    from = at + 1
  }
  out.push(s.slice(from))
  return out
}

/**
 * 特征引用 `+送气 -浊` 解出来的范围：有 + 的取交集成一张成员表；
 * 只写了没有列成员的那一面（[-送气] 而只定义了 [+送气]）时是「除了这些以外的任何一个音」。
 */
function resolveFeatures(
  text: string,
  table: FeatureTable | undefined
): { members: string[] | null; except: string[] | null; missing: string[] } {
  let members: string[] | null = null
  const except = new Set<string>()
  const missing: string[] = []
  for (const term of text
    .replace(/([+-])\s+/g, '$1')
    .trim()
    .split(/\s+/)) {
    const sign = term[0]
    const name = term.slice(1)
    const def = table?.get(name)
    const own = sign === '+' ? def?.plus : def?.minus
    const other = sign === '+' ? def?.minus : def?.plus
    if (own) members = members ? members.filter((m) => own.includes(m)) : [...own]
    else if (other) for (const m of other) except.add(m)
    else missing.push(`[${sign}${name}]`)
  }
  if (members) return { members: members.filter((m) => !except.has(m)), except: null, missing }
  return { members: null, except: except.size ? [...except] : null, missing }
}

/** 特征的成员总是用空格或逗号隔开（ph 是一个成员，不拆成 p、h） */
function featureMembers(value: string): string[] {
  return value
    .trim()
    .split(/[\s,，、]+/)
    .filter(Boolean)
}

function splitMembers(value: string): string[] {
  const v = value.trim()
  if (!v) return []
  if (/[\s,]/.test(v)) return v.split(/[\s,]+/).filter(Boolean)
  return Array.from(v)
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)]
}

/** 音类名 {Vlong} 与语素引用 @定指 里的字母不算多合字母，也不去点号 */
const PROTECTED = /\{[^}]*\}|@[^\s>/,_#()[\]{}]+/g

/**
 * 应用多合字母替换，并去掉用于隔开字母的点号（音类名、@引用原样留着）。
 * keepDots：点号按字面留着（转写成文字时句号是标点，不是隔开字母的记号）。
 */
export function applyReplacements(
  text: string,
  replacements: [string, string][],
  keepDots = false
): string {
  const one = (s: string): string => {
    let t = s
    for (const [from, to] of replacements) t = t.split(from).join(to)
    return keepDots ? t : t.split('.').join('')
  }
  let out = ''
  let last = 0
  for (const m of text.matchAll(PROTECTED)) {
    const at = m.index ?? 0
    out += one(text.slice(last, at)) + m[0]
    last = at + m[0].length
  }
  return out + one(text.slice(last))
}

export function revertReplacements(text: string, replacements: [string, string][]): string {
  let t = text
  for (let i = replacements.length - 1; i >= 0; i--) {
    const [from, to] = replacements[i]
    t = t.split(to).join(from)
  }
  return t
}

const CLASS_ESCAPE = /[\\\]^-]/g
const RE_ESCAPE = /[\\^$.*+?()[\]{}|/]/g

function classRegex(members: string[], marks = false): string {
  if (members.length === 0) return '(?:)'
  if (members.every((m) => Array.from(m).length === 1)) {
    return '[' + members.map((m) => m.replace(CLASS_ESCAPE, '\\$&')).join('') + ']'
  }
  const sorted = [...members].sort((a, b) => b.length - a.length)
  const one = (m: string): string =>
    marks
      ? Array.from(m)
          .map((ch) => ch.replace(RE_ESCAPE, '\\$&'))
          .join(SKIP)
      : m.replace(RE_ESCAPE, '\\$&')
  return '(?:' + sorted.map(one).join('|') + ')'
}

interface ExpandResult {
  re: string
  firstClass: ClassRef | null
  groupIndex: number
}

interface ExpandOptions {
  boundary: '^' | '$' | null
  captureFirst: boolean
  warn: (m: string) => void
  /** 编号音类第 k 次出现时是定义捕获组还是回指（见 planNumbered） */
  numbered?: (name: string, k: number) => 'def' | 'ref'
  /** 编号音类已经出现过几次（嵌套的括号里接着数） */
  seen?: Map<string, number>
  /** 音与音之间允许隔着重音记号、音节边界（重音规则之后，或规则里用了 σ） */
  marks?: boolean
  /** 第一个音前面不加跳过：目标的开头，跳过的记号算在左环境那边 */
  noLeadSkip?: boolean
  /** 这一行起有效的特征 */
  features?: FeatureTable
  /** 解析出来的特征成员（示例用）：方括号里的原文 → 成员 */
  featureHits?: Record<string, string[]>
}

/**
 * 把目标 / 环境文本翻译为正则片段。
 * - `{Name}` 与单大写字母引用音类；`[abc]` 临时音类原样保留；`[+特征]` 引用特征
 * - `#` 词界，`?` 跨位置，`(x)` 可选，`σ` 音节边界（词首词尾、分隔符两边也算）
 * - 其余字符原样进入正则（与音变姬一致，`|` 等因此可用）
 */
function expand(s: string, classes: Map<string, string[]>, opts: ExpandOptions): ExpandResult {
  let out = ''
  let firstClass: ClassRef | null = null
  let groupIndex = 0
  let capturing = 0
  let i = 0
  const chars = Array.from(s)
  const seen = opts.seen ?? new Map<string, number>()
  let lead = !!opts.noLeadSkip
  /** 一个音：按音节、重音匹配时前面可以隔着记号（整个包起来，后面跟 * + 这类量词时一起重复） */
  const unit = (re: string): void => {
    if (!opts.marks) out += re
    else out += lead ? `(?:${re})` : `(?:${SKIP}${re})`
    lead = false
  }
  const pushClass = (ref: ClassRef, raw: string | null): void => {
    const body = raw ?? classRegex(ref.members, opts.marks)
    if (opts.captureFirst && !firstClass) {
      firstClass = ref
      capturing++
      groupIndex = capturing
      // 命名组：替换时按名字取，目标里音类前面有别的字（kV、s[ptk]）或编号音类时也对得上
      unit('(?<tc>' + body + ')')
    } else unit(body)
  }
  while (i < chars.length) {
    const c = chars[i]
    const lit = escapedChar(c)
    if (lit !== null) {
      unit(lit.replace(RE_ESCAPE, '\\$&'))
    } else if (c === '#' && opts.boundary) {
      out += opts.boundary
      lead = false
    } else if (c === 'σ') {
      out += `(?:${BOUNDARY}|^|$)`
      lead = false
    } else if (c === '?') {
      out += '.*'
      lead = false
    } else if (c === '(') {
      let j = i + 1
      while (j < chars.length && chars[j] !== ')') j++
      const inner = expand(chars.slice(i + 1, j).join(''), classes, {
        ...opts,
        seen,
        captureFirst: false,
        noLeadSkip: lead
      })
      out += '(?:' + inner.re + ')?'
      lead = false
      i = j
    } else if (c === '{') {
      let j = i + 1
      while (j < chars.length && chars[j] !== '}') j++
      const name = chars.slice(i + 1, j).join('')
      // 长名音类存成 {名字}；@语素 也常被写成 {@名字}，两种键都试
      const members = classes.get('{' + name + '}') ?? classes.get(name)
      if (members) pushClass({ name, members }, null)
      else {
        opts.warn(`未定义的音类 {${name}}`)
        unit('\\{' + name.replace(RE_ESCAPE, '\\$&') + '\\}')
      }
      i = j
    } else if (c === '@') {
      let j = i + 1
      while (j < chars.length && /[\p{L}\p{N}_\-.]/u.test(chars[j])) j++
      const name = chars.slice(i + 1, j).join('')
      const members = classes.get('@' + name)
      if (members) pushClass({ name: '@' + name, members }, null)
      else {
        opts.warn(`未定义的语素 @${name}`)
        unit('@' + name.replace(RE_ESCAPE, '\\$&'))
      }
      i = j - 1
    } else if (c === '[') {
      let j = i + 1
      while (j < chars.length && chars[j] !== ']') j++
      const inner = chars.slice(i + 1, j).join('')
      const shown = decodeEscapes(inner)
      if (FEATURE_REF.test(shown)) {
        const f = resolveFeatures(shown, opts.features)
        for (const m of f.missing) opts.warn(`未定义的特征 ${m}`)
        if (f.members) {
          if (opts.featureHits) opts.featureHits[shown] = f.members
          pushClass({ name: '[' + shown + ']', members: f.members }, null)
        } else if (f.except) {
          // 「其余的音」：不是这些成员开头，也不是多字母成员（ph）中间的那个字母（h）
          const join = (xs: string[]): string => xs.join(opts.marks ? SKIP : '')
          const inside = f.except
            .map((m) => Array.from(m).map((ch) => ch.replace(RE_ESCAPE, '\\$&')))
            .flatMap((cs) =>
              cs
                .slice(1)
                .map((_, k) => `(?!(?<=${join(cs.slice(0, k + 1))})(?=${join(cs.slice(k + 1))}))`)
            )
            .join('')
          const not = classRegex(f.except, opts.marks)
          unit(`(?!${not})${inside}[^\\s${BOUNDARY}ˈˌ]${COMBINING}`)
        } else unit('(?!)')
      } else {
        // 方括号里照旧是正则字符组（[^aeiou]、[a-z] 都能写）；转义过的字符按字面放进去
        let raw = mapPlaceholders(inner, (x) => x.replace(CLASS_ESCAPE, '\\$&'))
        // 按音节、重音匹配时「不是这些」也不能匹配到记号上
        if (opts.marks && raw.startsWith('^')) raw += BOUNDARY + 'ˈˌ'
        pushClass(
          { name: '[' + shown + ']', members: Array.from(literalEscapes(inner)) },
          '[' + raw + ']'
        )
      }
      i = j
    } else if (c >= 'A' && c <= 'Z' && classes.has(c)) {
      let j = i + 1
      while (j < chars.length && chars[j] >= '0' && chars[j] <= '9') j++
      if (j > i + 1 && opts.numbered) {
        // C1、V2：编号相同的是同一个音——第一次定义捕获组，之后回指
        const name = c + chars.slice(i + 1, j).join('')
        const k = seen.get(name) ?? 0
        seen.set(name, k + 1)
        unit(
          opts.numbered(name, k) === 'def'
            ? `(?<n${name}>${classRegex(classes.get(c)!, opts.marks)})`
            : `\\k<n${name}>`
        )
        i = j - 1
      } else pushClass({ name: c, members: classes.get(c)! }, null)
    } else if (opts.marks && '|*+^$})]'.includes(c)) {
      // 正则里的记号原样放；| 后面是另一支，开头同样不加跳过
      out += c
      if (c === '|') lead = !!opts.noLeadSkip
    } else {
      if (c >= 'A' && c <= 'Z') opts.warn(`未定义的音类 ${c}，按字面字符处理`)
      unit(c)
    }
    i++
  }
  return { re: out, firstClass, groupIndex }
}

function parseReplacement(
  s: string,
  classes: Map<string, string[]>,
  features?: FeatureTable,
  warn?: (m: string) => void
): ReplacementPart[] {
  const parts: ReplacementPart[] = []
  let text = ''
  const chars = Array.from(s)
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const lit = escapedChar(c)
    if (lit !== null) {
      text += lit
    } else if (c === '{') {
      let j = i + 1
      while (j < chars.length && chars[j] !== '}') j++
      const name = chars.slice(i + 1, j).join('')
      const members = classes.get('{' + name + '}')
      if (members) {
        if (text) parts.push({ kind: 'text', text })
        text = ''
        parts.push({ kind: 'class', ref: { name, members } })
      } else text += '{' + name + '}'
      i = j
    } else if (c === '[') {
      // 临时音类：与目标里的音类按位置对应（[ptk] > [bdg]）；[-送气] 这样的特征同样按位置对应
      let j = i + 1
      while (j < chars.length && chars[j] !== ']') j++
      if (j >= chars.length) {
        text += c
        continue
      }
      if (text) parts.push({ kind: 'text', text })
      text = ''
      const inner = chars.slice(i + 1, j).join('')
      const shown = decodeEscapes(inner)
      if (FEATURE_REF.test(shown)) {
        const f = resolveFeatures(shown, features)
        for (const m of f.missing) warn?.(`未定义的特征 ${m}`)
        if (!f.members && !f.missing.length)
          warn?.(`替换里的 [${shown.trim()}] 要在特征定义里列出成员，才能按位置对应`)
        parts.push({ kind: 'class', ref: { name: '[' + shown + ']', members: f.members ?? [] } })
      } else
        parts.push({
          kind: 'class',
          ref: { name: '[' + shown + ']', members: Array.from(literalEscapes(inner)) }
        })
      i = j
    } else if (c >= 'A' && c <= 'Z' && classes.has(c)) {
      if (text) parts.push({ kind: 'text', text })
      text = ''
      let j = i + 1
      while (j < chars.length && chars[j] >= '0' && chars[j] <= '9') j++
      if (j > i + 1) {
        parts.push({ kind: 'ref', name: c + chars.slice(i + 1, j).join('') })
        i = j - 1
      } else parts.push({ kind: 'class', ref: { name: c, members: classes.get(c)! } })
    } else if (c === '@') {
      let j = i + 1
      while (j < chars.length && /[\p{L}\p{N}_\-.]/u.test(chars[j])) j++
      const name = chars.slice(i + 1, j).join('')
      const members = classes.get('@' + name)
      if (members) {
        if (text) parts.push({ kind: 'text', text })
        text = ''
        parts.push({ kind: 'class', ref: { name: '@' + name, members } })
      } else text += '@' + name
      i = j - 1
    } else text += c
  }
  if (text) parts.push({ kind: 'text', text })
  return parts
}

/** 一段文本里编号音类（C1、V2…）按出现顺序的名字；{长名}、[临时音类]、@语素 里的不算 */
function numberedNames(s: string, classes: Map<string, string[]>): string[] {
  const clean = s
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/@[\p{L}\p{N}_\-.]+/gu, ' ')
  const out: string[] = []
  for (const m of clean.matchAll(/([A-Z])(\d+)/g)) if (classes.has(m[1])) out.push(m[1] + m[2])
  return out
}

type NumberedPlan = Record<'left' | 'target' | 'right', (name: string, k: number) => 'def' | 'ref'>

/**
 * 编号音类在哪一次出现时定义捕获组：正则按「左环境 → 目标 → 右环境」的顺序匹配，
 * 先匹配到的那次定义，后面的回指；左环境是往回匹配的，所以左边取最右的那一次。
 */
function planNumbered(
  left: string,
  target: string,
  right: string,
  classes: Map<string, string[]>
): NumberedPlan {
  const defined = new Set<string>()
  const decide = (names: string[], fromEnd: boolean): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
    const defAt = new Map<string, number>()
    for (const [n, total] of counts) {
      if (defined.has(n)) continue
      defAt.set(n, fromEnd ? total - 1 : 0)
      defined.add(n)
    }
    return defAt
  }
  const l = decide(numberedNames(left, classes), true)
  const t = decide(numberedNames(target, classes), false)
  const r = decide(numberedNames(right, classes), false)
  const by =
    (m: Map<string, number>) =>
    (name: string, k: number): 'def' | 'ref' =>
      m.get(name) === k ? 'def' : 'ref'
  return { left: by(l), target: by(t), right: by(r) }
}

function compile(left: string, target: string, right: string): RegExp {
  const src = (left ? `(?<=${left})` : '') + `(${target})` + (right ? `(?=${right})` : '')
  try {
    return new RegExp(src, 'gu')
  } catch {
    return new RegExp(src, 'g')
  }
}

/**
 * 目标或替换里顶层的 `?`（不在 [] {} () 里、没被反斜杠转义）：if-else 规则的「满足 ? 不满足」。
 * 没有返回 null，不止一个返回 'many'。
 */
export function splitBranches(s: string): [string, string] | 'many' | null {
  const chars = Array.from(s)
  let depth = 0
  let at = -1
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '[' || c === '{' || c === '(') depth++
    else if ((c === ']' || c === '}' || c === ')') && depth > 0) depth--
    else if (c === '?' && depth === 0) {
      if (at >= 0) return 'many'
      at = i
    }
  }
  if (at < 0) return null
  return [
    chars.slice(0, at).join('').trim(),
    chars
      .slice(at + 1)
      .join('')
      .trim()
  ]
}

function splitContext(s: string): Context | null {
  const idx = s.indexOf('_')
  if (idx < 0) return null
  return { left: s.slice(0, idx).trim(), right: s.slice(idx + 1).trim() }
}

// ───────────────────────── 重音规则、特征的写法（列表视图用） ─────────────────────────

/** 重音规则里一条的可编辑表示 */
export interface StressClauseDraft {
  /** 音节数：null 不限 */
  count: number | null
  orMore: boolean
  /** '1'、'-2'、'*'（从前找第一个符合的）、'-*'（从后找） */
  position: string
  /** 音节核要是什么（空：不限） */
  target: string
  left: string
  right: string
  exceptLeft: string
  exceptRight: string
}

export interface StressRuleDraft {
  clauses: StressClauseDraft[]
  /** 分段符号；空表示不分段 */
  split: string
  /** 主重音在第几段 */
  head: number
}

const CLAUSE_HEAD = /^\s*(?:\(\s*(\d+)\s*(\+?)\s*\)\s*)?(-?\*|-?\d+)(.*)$/su
const SPLIT_TAIL = /^\s*(\S+)\s+(-?\d+)\s*$/u

/** 把 = 后面那一截拆成几条（不编译；原文里的转义保持原样） */
export function parseStressText(text: string): StressRuleDraft & { errors: string[] } {
  const enc = encodeEscapes(text)
  const errors: string[] = []
  let body = enc
  let split = ''
  let head = -1
  const bar = body.lastIndexOf('|')
  if (bar >= 0 && topLevelIndex(body, '|', bar) === bar) {
    const tail = SPLIT_TAIL.exec(body.slice(bar + 1))
    if (tail) {
      split = decodeEscapes(tail[1])
      head = Number(tail[2]) || -1
      body = body.slice(0, bar)
    }
  }
  const clauses: StressClauseDraft[] = []
  for (const piece of splitTopLevel(body, ',')) {
    if (!piece.trim()) continue
    const m = CLAUSE_HEAD.exec(piece)
    if (!m || m[3] === '0' || m[3] === '-0') {
      errors.push(`「${decodeEscapes(piece.trim())}」要以音节位置开头：1、2、-1、-2、* 或 -*`)
      continue
    }
    let rest = m[4]
    let target = rest
    let env = ''
    const slash = topLevelIndex(rest, '/')
    if (slash >= 0) {
      target = rest.slice(0, slash)
      env = rest.slice(slash + 1)
    }
    rest = env
    let exc = ''
    const dash = topLevelIndex(rest, '-')
    if (dash >= 0) {
      exc = rest.slice(dash + 1)
      rest = rest.slice(0, dash)
    }
    const ctx = rest.trim() ? splitContext(rest) : { left: '', right: '' }
    const ex = exc.trim() ? splitContext(exc) : { left: '', right: '' }
    if (!ctx || !ex) {
      errors.push(`「${decodeEscapes(piece.trim())}」的环境缺少 _`)
      continue
    }
    clauses.push({
      count: m[1] ? Number(m[1]) : null,
      orMore: !!m[2],
      position: m[3],
      target: decodeEscapes(target.trim()),
      left: decodeEscapes(ctx.left),
      right: decodeEscapes(ctx.right),
      exceptLeft: decodeEscapes(ex.left),
      exceptRight: decodeEscapes(ex.right)
    })
  }
  return { clauses, split, head, errors }
}

/** 一条写回文本：`(2) -1 {双元音} / _C - #_` */
export function formatStressClause(c: StressClauseDraft): string {
  let out = c.count !== null ? `(${c.count}${c.orMore ? '+' : ''}) ` : ''
  out += c.position.trim() || '1'
  if (c.target.trim()) out += ' ' + c.target.trim()
  const ctx = c.left.trim() || c.right.trim()
  const exc = c.exceptLeft.trim() || c.exceptRight.trim()
  if (ctx || exc) out += ` / ${c.left.trim()}_${c.right.trim()}`
  if (exc) out += ` - ${c.exceptLeft.trim()}_${c.exceptRight.trim()}`
  return out
}

/** = 后面那一截：几条用 , 连起来，分段写在 | 后面 */
export function formatStressText(d: StressRuleDraft): string {
  const body = d.clauses.map(formatStressClause).join(' , ')
  return d.split.trim() ? `${body} | ${d.split.trim()} ${d.head || -1}` : body
}

export function formatStressLine(
  level: 'primary' | 'secondary',
  d: StressRuleDraft,
  comment = ''
): string {
  return (
    `${level === 'secondary' ? 'ˌ' : 'ˈ'} = ${formatStressText(d)}`.trimEnd() +
    (comment.trim() ? `  ; ${comment.trim()}` : '')
  )
}

/** 解析特征定义行；不是则返回 null */
export function parseFeatureLine(
  raw: string
): { name: string; sign: '+' | '-'; members: string[] } | null {
  const m = FEATURE_LINE.exec(stripComment(raw))
  if (!m) return null
  return {
    name: decodeEscapes(m[2]),
    sign: m[1] as '+' | '-',
    members: dedupe(featureMembers(m[3]).map(literalEscapes))
  }
}

export function formatFeatureLine(
  sign: '+' | '-',
  name: string,
  members: string[],
  comment = ''
): string {
  const list = members.map((m) => m.trim()).filter(Boolean)
  return (
    `[${sign}${name.trim()}] = ${list.join(' ')}`.trimEnd() +
    (comment.trim() ? `  ; ${comment.trim()}` : '')
  )
}

// ───────────────────────── 解析 ─────────────────────────

export function parseRuleText(text: string, options: ParseOptions = {}): RuleProgram {
  const classes = new Map<string, string[]>()
  for (const [k, v] of Object.entries(options.classes ?? {}))
    classes.set(k.length === 1 ? k : `{${k.replace(/^\{|\}$/g, '')}}`, v)
  const replacements: [string, string][] = [...(options.replacements ?? [])]
  // @语素 作为一种音类：成员是它的各异体形
  for (const [name, forms] of Object.entries(options.morphemes ?? {}))
    if (forms.length) classes.set('@' + name, forms)
  const rawLines = text.split(/\r?\n/)
  const diagnostics: Diagnostic[] = []

  // 第一遍：收集音类与多合字母（允许写在任何位置）
  const kinds: (
    'blank' | 'comment' | 'class' | 'replacement' | 'marker' | 'rule' | 'stress' | 'feature'
  )[] = []
  const contents: string[] = []
  rawLines.forEach((raw) => {
    const content = stripComment(raw)
    contents.push(content)
    if (!content) {
      kinds.push(raw.trim() ? 'comment' : 'blank')
      return
    }
    if (content.startsWith('#')) {
      kinds.push('comment')
      return
    }
    if (content.startsWith('-*')) {
      kinds.push('marker')
      return
    }
    if (STRESS_LINE.test(content)) {
      kinds.push('stress')
      return
    }
    if (FEATURE_LINE.test(content)) {
      kinds.push('feature')
      return
    }
    const cm = CLASS_LINE.exec(content)
    if (cm) {
      classes.set(cm[1], classMembers(cm[1], cm[2]))
      kinds.push('class')
      return
    }
    if (!content.includes('>')) {
      const rm = REPL_LINE.exec(content)
      if (rm) {
        replacements.push([literalEscapes(rm[1]), literalEscapes(rm[2])])
        kinds.push('replacement')
        return
      }
    }
    kinds.push('rule')
  })
  replacements.sort((a, b) => b[0].length - a[0].length)
  // 音类成员也要过一遍多合字母替换（用户在音类里写 th，等价于写 θ）
  for (const [k, v] of classes)
    classes.set(k, dedupe(v.map((m) => applyReplacements(m, replacements))))

  // 切音节的设置：语言给的，加上规则文本里名为 V / C 的音类、多字母的音类成员、多合字母的内部符号
  const base = options.syllables
  const units = new Set(base?.units ?? [])
  const nuclei = new Set(base?.nuclei ?? [])
  const consonants = new Set(base?.consonants ?? [])
  for (const [, to] of replacements) units.add(to)
  for (const [k, v] of classes) {
    if (k.startsWith('@')) continue
    const name = k.replace(/^\{|\}$/g, '')
    for (const m of v) {
      if (Array.from(m).length > 1) units.add(m)
      if (VOWEL_CLASS.test(name)) nuclei.add(m)
      else if (CONSONANT_CLASS.test(name)) consonants.add(m)
    }
  }
  const syllables: SyllableScheme = {
    units: [...units],
    nuclei: [...nuclei],
    consonants: [...consonants].filter((c) => !nuclei.has(c)),
    onsets: base?.onsets ?? [],
    maxOnset: base?.maxOnset ?? null,
    maxCoda: base?.maxCoda ?? null
  }

  const lines: ParsedLine[] = []
  const steps: (ParsedRule | MarkerLine | StressLine)[] = []
  const markers: string[] = []
  /** 特征按行生效：每遇到一行定义换一张新表，前面的规则仍用旧表 */
  let features: FeatureTable = new Map()
  /** 前面出现过重音规则：之后的规则都要跳过词里的重音记号 */
  let stressScope = false

  rawLines.forEach((raw, idx) => {
    const line = idx + 1
    const kind = kinds[idx]
    const content = contents[idx]
    const comment = commentOf(raw)
    if (kind === 'blank' || kind === 'comment' || kind === 'class' || kind === 'replacement') {
      lines.push({ kind, line, raw, comment })
      return
    }
    if (kind === 'marker') {
      const name = decodeEscapes(content.slice(2).trim())
      const m: MarkerLine = { kind: 'marker', line, raw, comment, name }
      lines.push(m)
      steps.push(m)
      if (!markers.includes(name)) markers.push(name)
      return
    }
    const warn = (message: string): void => {
      if (diagnostics.some((d) => d.line === line && d.message === message)) return
      diagnostics.push({ line, severity: 'warning', message })
    }
    const fail = (message: string): void => {
      diagnostics.push({ line, severity: 'error', message })
      lines.push({ kind: 'error', line, raw, comment, message })
    }

    if (kind === 'feature') {
      const fm = FEATURE_LINE.exec(content)!
      const name = decodeEscapes(fm[2])
      const sign = fm[1] as '+' | '-'
      // 显示、再写回用原来的写法（ng）；匹配用换过多合字母的（ŋ）
      const written = dedupe(featureMembers(fm[3]).map(literalEscapes))
      const members = dedupe(written.map((m) => applyReplacements(m, replacements)))
      if (!members.length) warn(`特征 [${sign}${name}] 没有成员`)
      const prev = features.get(name) ?? { plus: null, minus: null }
      features = new Map(features)
      features.set(name, sign === '+' ? { ...prev, plus: members } : { ...prev, minus: members })
      lines.push({ kind: 'feature', line, raw, comment, name, sign, members: written })
      return
    }

    if (kind === 'stress') {
      const sm = STRESS_LINE.exec(content)!
      const draft = parseStressText(decodeEscapes(sm[2]))
      if (draft.errors.length) return fail(draft.errors[0])
      const clauses: StressClause[] = []
      try {
        for (const c of draft.clauses) {
          const pattern = (x: string): string => applyReplacements(encodeEscapes(x), replacements)
          const common = { captureFirst: false, warn, marks: true, features }
          const matcher = (target: string, ctx: Context): ClauseMatcher => {
            const t = target
              ? expand(pattern(target), classes, { ...common, boundary: null, noLeadSkip: true }).re
              : ''
            const l = ctx.left
              ? expand(pattern(ctx.left), classes, { ...common, boundary: '^' }).re
              : ''
            const r = ctx.right
              ? expand(pattern(ctx.right), classes, { ...common, boundary: '$' }).re
              : ''
            return {
              target: t ? new RegExp(`(?:${t})`, 'u') : null,
              left: l ? new RegExp(`(?<=(?:${l})${SKIP})`, 'uy') : null,
              right: r ? new RegExp(`(?=${r})`, 'uy') : null
            }
          }
          const context = { left: c.left, right: c.right }
          const exception =
            c.exceptLeft || c.exceptRight ? { left: c.exceptLeft, right: c.exceptRight } : null
          clauses.push({
            raw: formatStressClause(c),
            count: c.count,
            orMore: c.orMore,
            position:
              c.position === '*' ? 'first' : c.position === '-*' ? 'last' : Number(c.position),
            target: c.target,
            context,
            exception,
            match: matcher(c.target, context),
            except: exception ? matcher('', exception) : null
          })
        }
      } catch (e) {
        return fail(`正则无法编译：${(e as Error).message}`)
      }
      const st: StressLine = {
        kind: 'stress',
        line,
        raw,
        comment,
        level: sm[1] === 'ˌ' ? 'secondary' : 'primary',
        text: decodeEscapes(sm[2]).trim(),
        clauses,
        split: draft.split,
        head: draft.head
      }
      lines.push(st)
      steps.push(st)
      stressScope = true
      return
    }

    // 目标 > 替换 / 环境 - 排除（[-送气] 里的 - 不算排除）
    let rulePart = content
    let contextPart = ''
    const slash = topLevelIndex(content, '/')
    if (slash >= 0) {
      rulePart = content.slice(0, slash)
      contextPart = content.slice(slash + 1)
    }
    let exceptionPart = ''
    const dash = topLevelIndex(contextPart, '-')
    if (dash >= 0) {
      exceptionPart = contextPart.slice(dash + 1).trim()
      contextPart = contextPart.slice(0, dash)
    }
    const gt = rulePart.indexOf('>')
    if (gt < 0) return fail('缺少 >')
    // 编译用换过多合字母的（th → θ）；留给界面显示、再写回规则的是原来的写法
    const writtenTarget = rulePart.slice(0, gt).trim()
    const writtenReplacement = rulePart.slice(gt + 1).trim()
    const target = applyReplacements(writtenTarget, replacements)
    const replacement = applyReplacements(writtenReplacement, replacements)
    const sigma = content.includes('σ')
    const marks = stressScope || sigma
    const featureHits: Record<string, string[]> = {}

    const contexts: Context[] = []
    const writtenContexts: Context[] = []
    if (contextPart.trim()) {
      for (const piece of splitTopLevel(contextPart, ',')) {
        const ctx = splitContext(applyReplacements(piece.trim(), replacements))
        if (!ctx) return fail(`环境「${decodeEscapes(piece.trim())}」缺少 _`)
        contexts.push(ctx)
        writtenContexts.push(splitContext(piece.trim())!)
      }
    } else {
      contexts.push({ left: '', right: '' })
      writtenContexts.push({ left: '', right: '' })
    }
    // 排除也可以写几个，跟环境一样用 , 隔开
    const exceptions: Context[] = []
    const writtenExceptions: Context[] = []
    if (exceptionPart) {
      for (const piece of splitTopLevel(exceptionPart, ',')) {
        if (!piece.trim()) continue
        const ex = splitContext(applyReplacements(piece.trim(), replacements))
        if (!ex) return fail(`排除环境「${decodeEscapes(piece.trim())}」缺少 _`)
        if (ex.left || ex.right) {
          exceptions.push(ex)
          writtenExceptions.push(splitContext(piece.trim())!)
        }
      }
    }

    const quiet = (): void => {}
    // 左环境里定义了几个编号捕获组：目标的捕获组要往后数这么多
    const groupsIn = (re: string): number => (re.match(/\(\?<n[A-Z]\d+>/g) ?? []).length
    const common = { marks, features, featureHits }
    /** 左环境：按音节、重音匹配时，环境和目标之间也可以隔着记号 */
    const leftOf = (re: string): string => (marks && re ? `(?:${re})${SKIP}` : re)
    /** 某个目标在各个环境里的匹配（带排除）；环境的警告只报一次 */
    const compileFor = (tgt: string, envWarn: (m: string) => void): CompiledContext[] => {
      const out: CompiledContext[] = []
      for (const ctx of contexts) {
        const plan = planNumbered(ctx.left, tgt, ctx.right, classes)
        const l = expand(ctx.left, classes, {
          ...common,
          boundary: '^',
          captureFirst: false,
          warn: envWarn,
          numbered: plan.left
        }).re
        const tt = expand(tgt, classes, {
          ...common,
          boundary: null,
          captureFirst: true,
          warn: quiet,
          numbered: plan.target,
          noLeadSkip: marks
        }).re
        const r = expand(ctx.right, classes, {
          ...common,
          boundary: '$',
          captureFirst: false,
          warn: envWarn,
          numbered: plan.right
        }).re
        const main = compile(leftOf(l), tt, r)
        const excludes: RegExp[] = []
        for (const exception of exceptions) {
          const ep = planNumbered(exception.left, tgt, exception.right, classes)
          const el = expand(exception.left, classes, {
            ...common,
            boundary: '^',
            captureFirst: false,
            warn: envWarn,
            numbered: ep.left
          }).re
          const et = expand(tgt, classes, {
            ...common,
            boundary: null,
            captureFirst: true,
            warn: quiet,
            numbered: ep.target,
            noLeadSkip: marks
          }).re
          const er = expand(exception.right, classes, {
            ...common,
            boundary: '$',
            captureFirst: false,
            warn: envWarn,
            numbered: ep.right
          }).re
          excludes.push(compile(leftOf(el), et, er))
        }
        out.push({ main, excludes, offset: groupsIn(l) })
      }
      return out
    }

    // if-else：目标、替换里顶层的 ? 把规则分成「满足环境」「不满足环境」两路。
    // 替换以 \? 开头、后面还有东西、又写了环境时，读作「满足时换位 ? 不满足时……」（\?2）；
    // 单独一个 \?、没有环境的（文字映射）仍是问号本身
    const qmark = String.fromCodePoint(ESCAPE_BASE + 63)
    const branchText = (rep: string): string =>
      rep.startsWith(qmark) &&
      rep.length > qmark.length &&
      contextPart.trim() &&
      splitBranches(rep) === null
        ? '\\?' + rep.slice(qmark.length)
        : rep
    const replacementText = branchText(replacement)
    const targetSplit = splitBranches(target)
    const replacementSplit = splitBranches(replacementText)
    const writtenTargetSplit = splitBranches(writtenTarget)
    const writtenReplacementSplit = splitBranches(branchText(writtenReplacement))
    const pair = (x: [string, string] | 'many' | null, whole: string): [string, string] =>
      x && x !== 'many' ? x : [whole, whole]
    if (targetSplit === 'many' || replacementSplit === 'many')
      return fail(
        '一条规则的目标、替换里各只能有一个 ?（满足环境 ? 不满足环境）；要写问号本身用 \\?'
      )
    const branching = !!targetSplit || !!replacementSplit
    const [thenTarget, elseTarget] = targetSplit ?? [target, target]
    const [thenReplacement, elseReplacement] = replacementSplit ?? [replacement, replacement]
    /** 目标里第一个音类（编号音类是命名组、不算）：跟编好的正则里 tc 那一组是同一个 */
    const firstClassOf = (tgt: string): ExpandResult =>
      expand(tgt, classes, {
        boundary: null,
        captureFirst: true,
        warn,
        numbered: planNumbered('', tgt, '', classes).target,
        features
      })
    if (branching && !elseTarget) return fail('? 后面（不满足环境时）要改的目标不能为空')

    const t = firstClassOf(thenTarget)
    let compiled: CompiledContext[] = []
    let branches: ParsedRule['branches']
    try {
      compiled = compileFor(thenTarget, warn)
      if (branching) {
        const e = firstClassOf(elseTarget)
        const anywherePlan = planNumbered('', elseTarget, '', classes)
        const anywhere = compile(
          '',
          expand(elseTarget, classes, {
            ...common,
            boundary: null,
            captureFirst: true,
            warn: quiet,
            numbered: anywherePlan.target,
            noLeadSkip: marks
          }).re,
          ''
        )
        const [wThenTarget, wElseTarget] = pair(writtenTargetSplit, writtenTarget)
        const [wThenRep, wElseRep] = pair(writtenReplacementSplit, writtenReplacement)
        const branch = (
          rep: string,
          shown: [string, string],
          x: ExpandResult,
          c: CompiledContext[]
        ): RuleBranch => ({
          target: decodeEscapes(shown[0]),
          replacement: decodeEscapes(shown[1]),
          targetClass: x.firstClass,
          targetGroup: x.groupIndex,
          replacementParts: parseReplacement(rep, classes, features, warn),
          compiled: c
        })
        branches = {
          then: branch(thenReplacement, [wThenTarget, wThenRep], t, compiled),
          otherwise: {
            ...branch(elseReplacement, [wElseTarget, wElseRep], e, compileFor(elseTarget, quiet)),
            anywhere
          }
        }
        if (!contexts.some((c) => c.left || c.right) && !exceptions.length)
          warn('没有写环境：处处都算满足，? 后面那一路用不上')
      }
    } catch (e) {
      return fail(`正则无法编译：${(e as Error).message}`)
    }

    // 编译用的是带占位字符的文本；留给界面显示、再写回规则的换回反斜杠写法
    const shown = (c: Context): Context => ({
      left: decodeEscapes(c.left),
      right: decodeEscapes(c.right)
    })
    const rule: ParsedRule = {
      kind: 'rule',
      line,
      raw,
      comment,
      target: decodeEscapes(writtenTarget),
      replacement: decodeEscapes(writtenReplacement),
      contexts: writtenContexts.map(shown),
      exceptions: writtenExceptions.map(shown),
      targetClass: t.firstClass,
      targetGroup: t.groupIndex,
      compiled,
      replacementParts: parseReplacement(thenReplacement, classes, features, warn),
      marks,
      sigma,
      explicitStress: /[ˈˌ]/.test(target),
      ...(branches ? { branches } : {}),
      ...(Object.keys(featureHits).length ? { featureMembers: featureHits } : {})
    }
    lines.push(rule)
    steps.push(rule)
  })

  return {
    classes,
    replacements,
    lines,
    steps,
    markers,
    diagnostics,
    syllables,
    hasStress: steps.some((x) => x.kind === 'stress')
  }
}
