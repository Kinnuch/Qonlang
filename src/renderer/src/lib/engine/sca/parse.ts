/**
 * 规则语言解析器。语法见 docs/rules.md。
 *
 * 一段文本里可以混写：
 *   V=aeiou            单字母音类
 *   {Vlong}=ā ē ī ō ū  长名音类（成员用空格/逗号分隔；不分隔则按字符拆）
 *   th|θ               多合字母：匹配前把 th 换成 θ，输出时换回
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

export type ParsedLine = ParsedRule | MarkerLine | OtherLine

export interface Diagnostic {
  line: number
  severity: 'error' | 'warning'
  message: string
}

export interface RuleProgram {
  classes: Map<string, string[]>
  replacements: [string, string][]
  lines: ParsedLine[]
  /** 只含规则和标记，按出现顺序 */
  steps: (ParsedRule | MarkerLine)[]
  markers: string[]
  diagnostics: Diagnostic[]
}

export interface ParseOptions {
  /** 外部提供的音类（如来自语言的音系页） */
  classes?: Record<string, string[]>
  /** 外部提供的多合字母 */
  replacements?: [string, string][]
  /** 可用 @名 引用的语素：名（gloss 或去掉连字符的形式）→ 各异体形 */
  morphemes?: Record<string, string[]>
}

/**
 * 反斜杠转义：`\?`、`\.`、`\#`、`\C` 这样写表示字面上的那个字符——不当通配、不当音类，
 * 也不当分隔符。解析一开始就把「反斜杠 + 字符」换成私用区里一一对应的占位字符，
 * 切行、找注释、多合字母替换都碰不到它；编正则、拼替换文本时再换回字面字符。
 * 反斜杠后面是空白、斜杠或行尾时不算转义：单独一个 `\` 仍是换位（`ab > \ / _#`）。
 */
const ESCAPE_BASE = 0x10ff00
const ESCAPABLE = /^[\\?#()[\]{}@|.*+^$_>,\-;=~!%&'"A-Z0-9]$/
const HAS_PLACEHOLDER = /[\u{10FF00}-\u{10FF7F}]/u

export function encodeEscapes(s: string): string {
  if (!s.includes('\\')) return s
  let out = ''
  const chars = Array.from(s)
  for (let i = 0; i < chars.length; i++) {
    const next = chars[i + 1]
    if (chars[i] === '\\' && next !== undefined && ESCAPABLE.test(next)) {
      out += String.fromCodePoint(ESCAPE_BASE + next.charCodeAt(0))
      i++
    } else out += chars[i]
  }
  return out
}

/** 占位字符对应的字面字符；不是占位字符返回 null */
function escapedChar(c: string): string | null {
  const cp = c.codePointAt(0) ?? 0
  return cp >= ESCAPE_BASE && cp < ESCAPE_BASE + 0x80 ? String.fromCharCode(cp - ESCAPE_BASE) : null
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

function classRegex(members: string[]): string {
  if (members.length === 0) return '(?:)'
  if (members.every((m) => Array.from(m).length === 1)) {
    return '[' + members.map((m) => m.replace(CLASS_ESCAPE, '\\$&')).join('') + ']'
  }
  const sorted = [...members].sort((a, b) => b.length - a.length)
  return '(?:' + sorted.map((m) => m.replace(RE_ESCAPE, '\\$&')).join('|') + ')'
}

interface ExpandResult {
  re: string
  firstClass: ClassRef | null
  groupIndex: number
}

/**
 * 把目标 / 环境文本翻译为正则片段。
 * - `{Name}` 与单大写字母引用音类；`[abc]` 临时音类原样保留
 * - `#` 词界，`?` 跨位置，`(x)` 可选
 * - 其余字符原样进入正则（与音变姬一致，`|` 等因此可用）
 */
function expand(
  s: string,
  classes: Map<string, string[]>,
  opts: {
    boundary: '^' | '$' | null
    captureFirst: boolean
    warn: (m: string) => void
    /** 编号音类第 k 次出现时是定义捕获组还是回指（见 planNumbered） */
    numbered?: (name: string, k: number) => 'def' | 'ref'
    /** 编号音类已经出现过几次（嵌套的括号里接着数） */
    seen?: Map<string, number>
  }
): ExpandResult {
  let out = ''
  let firstClass: ClassRef | null = null
  let groupIndex = 0
  let capturing = 0
  let i = 0
  const chars = Array.from(s)
  const seen = opts.seen ?? new Map<string, number>()
  const pushClass = (ref: ClassRef, raw: string | null): void => {
    const body = raw ?? classRegex(ref.members)
    if (opts.captureFirst && !firstClass) {
      firstClass = ref
      capturing++
      groupIndex = capturing
      // 命名组：替换时按名字取，目标里音类前面有别的字（kV、s[ptk]）或编号音类时也对得上
      out += '(?<tc>' + body + ')'
    } else out += body
  }
  while (i < chars.length) {
    const c = chars[i]
    const lit = escapedChar(c)
    if (lit !== null) {
      out += lit.replace(RE_ESCAPE, '\\$&')
    } else if (c === '#' && opts.boundary) {
      out += opts.boundary
    } else if (c === '?') {
      out += '.*'
    } else if (c === '(') {
      let j = i + 1
      while (j < chars.length && chars[j] !== ')') j++
      const inner = expand(chars.slice(i + 1, j).join(''), classes, {
        ...opts,
        seen,
        captureFirst: false
      })
      out += '(?:' + inner.re + ')?'
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
        out += '\\{' + name.replace(RE_ESCAPE, '\\$&') + '\\}'
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
        out += '@' + name.replace(RE_ESCAPE, '\\$&')
      }
      i = j - 1
    } else if (c === '[') {
      let j = i + 1
      while (j < chars.length && chars[j] !== ']') j++
      const inner = chars.slice(i + 1, j).join('')
      // 方括号里照旧是正则字符组（[^aeiou]、[a-z] 都能写）；转义过的字符按字面放进去
      const raw = mapPlaceholders(inner, (x) => x.replace(CLASS_ESCAPE, '\\$&'))
      const shown = decodeEscapes(inner)
      pushClass(
        { name: '[' + shown + ']', members: Array.from(literalEscapes(inner)) },
        '[' + raw + ']'
      )
      i = j
    } else if (c >= 'A' && c <= 'Z' && classes.has(c)) {
      let j = i + 1
      while (j < chars.length && chars[j] >= '0' && chars[j] <= '9') j++
      if (j > i + 1 && opts.numbered) {
        // C1、V2：编号相同的是同一个音——第一次定义捕获组，之后回指
        const name = c + chars.slice(i + 1, j).join('')
        const k = seen.get(name) ?? 0
        seen.set(name, k + 1)
        out +=
          opts.numbered(name, k) === 'def'
            ? `(?<n${name}>${classRegex(classes.get(c)!)})`
            : `\\k<n${name}>`
        i = j - 1
      } else pushClass({ name: c, members: classes.get(c)! }, null)
    } else {
      if (c >= 'A' && c <= 'Z') opts.warn(`未定义的音类 ${c}，按字面字符处理`)
      out += c
    }
    i++
  }
  return { re: out, firstClass, groupIndex }
}

function parseReplacement(s: string, classes: Map<string, string[]>): ReplacementPart[] {
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
      // 临时音类：与目标里的音类按位置对应（[ptk] > [bdg]）
      let j = i + 1
      while (j < chars.length && chars[j] !== ']') j++
      if (j >= chars.length) {
        text += c
        continue
      }
      if (text) parts.push({ kind: 'text', text })
      text = ''
      const inner = chars.slice(i + 1, j).join('')
      parts.push({
        kind: 'class',
        ref: { name: '[' + decodeEscapes(inner) + ']', members: Array.from(literalEscapes(inner)) }
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
  const kinds: ('blank' | 'comment' | 'class' | 'replacement' | 'marker' | 'rule')[] = []
  const contents: string[] = []
  rawLines.forEach((raw, idx) => {
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
    void idx
  })
  replacements.sort((a, b) => b[0].length - a[0].length)
  // 音类成员也要过一遍多合字母替换（用户在音类里写 th，等价于写 θ）
  for (const [k, v] of classes)
    classes.set(k, dedupe(v.map((m) => applyReplacements(m, replacements))))

  const lines: ParsedLine[] = []
  const steps: (ParsedRule | MarkerLine)[] = []
  const markers: string[] = []

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

    // 目标 > 替换 / 环境 - 排除
    let rulePart = content
    let contextPart = ''
    const slash = content.indexOf('/')
    if (slash >= 0) {
      rulePart = content.slice(0, slash)
      contextPart = content.slice(slash + 1)
    }
    let exceptionPart = ''
    const dash = contextPart.indexOf('-')
    if (dash >= 0) {
      exceptionPart = contextPart.slice(dash + 1).trim()
      contextPart = contextPart.slice(0, dash)
    }
    const gt = rulePart.indexOf('>')
    if (gt < 0) return fail('缺少 >')
    const target = applyReplacements(rulePart.slice(0, gt).trim(), replacements)
    const replacement = applyReplacements(rulePart.slice(gt + 1).trim(), replacements)

    const contexts: Context[] = []
    if (contextPart.trim()) {
      for (const piece of contextPart.split(',')) {
        const ctx = splitContext(applyReplacements(piece.trim(), replacements))
        if (!ctx) return fail(`环境「${decodeEscapes(piece.trim())}」缺少 _`)
        contexts.push(ctx)
      }
    } else contexts.push({ left: '', right: '' })
    // 排除也可以写几个，跟环境一样用 , 隔开
    const exceptions: Context[] = []
    if (exceptionPart) {
      for (const piece of exceptionPart.split(',')) {
        if (!piece.trim()) continue
        const ex = splitContext(applyReplacements(piece.trim(), replacements))
        if (!ex) return fail(`排除环境「${decodeEscapes(piece.trim())}」缺少 _`)
        if (ex.left || ex.right) exceptions.push(ex)
      }
    }

    const quiet = (): void => {}
    // 左环境里定义了几个编号捕获组：目标的捕获组要往后数这么多
    const groupsIn = (re: string): number => (re.match(/\(\?<n[A-Z]\d+>/g) ?? []).length
    /** 某个目标在各个环境里的匹配（带排除）；环境的警告只报一次 */
    const compileFor = (tgt: string, envWarn: (m: string) => void): CompiledContext[] => {
      const out: CompiledContext[] = []
      for (const ctx of contexts) {
        const plan = planNumbered(ctx.left, tgt, ctx.right, classes)
        const l = expand(ctx.left, classes, {
          boundary: '^',
          captureFirst: false,
          warn: envWarn,
          numbered: plan.left
        }).re
        const tt = expand(tgt, classes, {
          boundary: null,
          captureFirst: true,
          warn: quiet,
          numbered: plan.target
        }).re
        const r = expand(ctx.right, classes, {
          boundary: '$',
          captureFirst: false,
          warn: envWarn,
          numbered: plan.right
        }).re
        const main = compile(l, tt, r)
        const excludes: RegExp[] = []
        for (const exception of exceptions) {
          const ep = planNumbered(exception.left, tgt, exception.right, classes)
          const el = expand(exception.left, classes, {
            boundary: '^',
            captureFirst: false,
            warn: envWarn,
            numbered: ep.left
          }).re
          const et = expand(tgt, classes, {
            boundary: null,
            captureFirst: true,
            warn: quiet,
            numbered: ep.target
          }).re
          const er = expand(exception.right, classes, {
            boundary: '$',
            captureFirst: false,
            warn: envWarn,
            numbered: ep.right
          }).re
          excludes.push(compile(el, et, er))
        }
        out.push({ main, excludes, offset: groupsIn(l) })
      }
      return out
    }

    // if-else：目标、替换里顶层的 ? 把规则分成「满足环境」「不满足环境」两路。
    // 替换以 \? 开头、后面还有东西、又写了环境时，读作「满足时换位 ? 不满足时……」（\?2）；
    // 单独一个 \?、没有环境的（文字映射）仍是问号本身
    const qmark = String.fromCodePoint(ESCAPE_BASE + 63)
    const replacementText =
      replacement.startsWith(qmark) &&
      replacement.length > qmark.length &&
      contextPart.trim() &&
      splitBranches(replacement) === null
        ? '\\?' + replacement.slice(qmark.length)
        : replacement
    const targetSplit = splitBranches(target)
    const replacementSplit = splitBranches(replacementText)
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
        numbered: planNumbered('', tgt, '', classes).target
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
            boundary: null,
            captureFirst: true,
            warn: quiet,
            numbered: anywherePlan.target
          }).re,
          ''
        )
        const branch = (
          tgt: string,
          rep: string,
          x: ExpandResult,
          c: CompiledContext[]
        ): RuleBranch => ({
          target: decodeEscapes(tgt),
          replacement: decodeEscapes(rep),
          targetClass: x.firstClass,
          targetGroup: x.groupIndex,
          replacementParts: parseReplacement(rep, classes),
          compiled: c
        })
        branches = {
          then: branch(thenTarget, thenReplacement, t, compiled),
          otherwise: {
            ...branch(elseTarget, elseReplacement, e, compileFor(elseTarget, quiet)),
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
      target: decodeEscapes(target),
      replacement: decodeEscapes(replacement),
      contexts: contexts.map(shown),
      exceptions: exceptions.map(shown),
      targetClass: t.firstClass,
      targetGroup: t.groupIndex,
      compiled,
      replacementParts: parseReplacement(thenReplacement, classes),
      ...(branches ? { branches } : {})
    }
    lines.push(rule)
    steps.push(rule)
  })

  return { classes, replacements, lines, steps, markers, diagnostics }
}
