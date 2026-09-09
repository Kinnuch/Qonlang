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
  exclude: RegExp | null
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
  exception: Context | null
  /** 目标里第一个音类（用于替换侧一一对应） */
  targetClass: ClassRef | null
  /** 该音类在目标正则里的捕获组序号 */
  targetGroup: number
  compiled: CompiledContext[]
  /** 替换文本中的音类引用已按 pos 展开时用到 */
  replacementParts: ReplacementPart[]
}

export type ReplacementPart = { kind: 'text'; text: string } | { kind: 'class'; ref: ClassRef }

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
  exception: Context | null
  comment: string
}

export function formatRule(d: RuleDraft): string {
  let s = `${d.target.trim()} > ${d.replacement.trim()}`.trimEnd()
  const ctxs = d.contexts.filter((c) => c.left.trim() || c.right.trim())
  if (ctxs.length) s += ' / ' + ctxs.map((c) => `${c.left.trim()}_${c.right.trim()}`).join(' , ')
  if (d.exception && (d.exception.left.trim() || d.exception.right.trim())) {
    if (!ctxs.length) s += ' / _'
    s += ` - ${d.exception.left.trim()}_${d.exception.right.trim()}`
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
  const members =
    key.length === 1 ? dedupe(Array.from(m[2].replace(/\s+/g, ''))) : dedupe(splitMembers(m[2]))
  return { name: key.replace(/^\{|\}$/g, ''), members }
}

/** 解析多合字母声明行；不是则返回 null */
export function parseReplacementLine(raw: string): { from: string; to: string } | null {
  const content = stripComment(raw)
  if (content.includes('>')) return null
  const m = REPL_LINE.exec(content)
  return m ? { from: m[1], to: m[2] } : null
}

function stripComment(raw: string): string {
  const semi = raw.indexOf(';')
  return (semi >= 0 ? raw.slice(0, semi) : raw).trim()
}

function commentOf(raw: string): string {
  const semi = raw.indexOf(';')
  return semi >= 0 ? raw.slice(semi + 1).trim() : ''
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

/** 应用多合字母替换，并去掉用于隔开字母的点号 */
export function applyReplacements(text: string, replacements: [string, string][]): string {
  let t = text
  for (const [from, to] of replacements) t = t.split(from).join(to)
  return t.split('.').join('')
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
  opts: { boundary: '^' | '$' | null; captureFirst: boolean; warn: (m: string) => void }
): ExpandResult {
  let out = ''
  let firstClass: ClassRef | null = null
  let groupIndex = 0
  let capturing = 0
  let i = 0
  const chars = Array.from(s)
  const pushClass = (ref: ClassRef, raw: string | null): void => {
    const body = raw ?? classRegex(ref.members)
    if (opts.captureFirst && !firstClass) {
      firstClass = ref
      capturing++
      groupIndex = capturing
      out += '(' + body + ')'
    } else out += body
  }
  while (i < chars.length) {
    const c = chars[i]
    if (c === '#' && opts.boundary) {
      out += opts.boundary
    } else if (c === '?') {
      out += '.*'
    } else if (c === '(') {
      let j = i + 1
      while (j < chars.length && chars[j] !== ')') j++
      const inner = expand(chars.slice(i + 1, j).join(''), classes, {
        ...opts,
        captureFirst: false
      })
      out += '(?:' + inner.re + ')?'
      i = j
    } else if (c === '{') {
      let j = i + 1
      while (j < chars.length && chars[j] !== '}') j++
      const name = chars.slice(i + 1, j).join('')
      const members = classes.get('{' + name + '}')
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
      pushClass({ name: '[' + inner + ']', members: Array.from(inner) }, '[' + inner + ']')
      i = j
    } else if (c >= 'A' && c <= 'Z' && classes.has(c)) {
      pushClass({ name: c, members: classes.get(c)! }, null)
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
    if (c === '{') {
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
    } else if (c >= 'A' && c <= 'Z' && classes.has(c)) {
      if (text) parts.push({ kind: 'text', text })
      text = ''
      parts.push({ kind: 'class', ref: { name: c, members: classes.get(c)! } })
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

function compile(left: string, target: string, right: string): RegExp {
  const src = (left ? `(?<=${left})` : '') + `(${target})` + (right ? `(?=${right})` : '')
  try {
    return new RegExp(src, 'gu')
  } catch {
    return new RegExp(src, 'g')
  }
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
    let content = raw
    const semi = content.indexOf(';')
    if (semi >= 0) content = content.slice(0, semi)
    content = content.trim()
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
      const key = cm[1]
      const members =
        key.length === 1
          ? dedupe(Array.from(cm[2].replace(/\s+/g, '')))
          : dedupe(splitMembers(cm[2]))
      classes.set(key, members)
      kinds.push('class')
      return
    }
    if (!content.includes('>')) {
      const rm = REPL_LINE.exec(content)
      if (rm) {
        replacements.push([rm[1], rm[2]])
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
      const name = content.slice(2).trim()
      const m: MarkerLine = { kind: 'marker', line, raw, comment, name }
      lines.push(m)
      steps.push(m)
      if (!markers.includes(name)) markers.push(name)
      return
    }
    const warn = (message: string): void => {
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
        if (!ctx) return fail(`环境「${piece.trim()}」缺少 _`)
        contexts.push(ctx)
      }
    } else contexts.push({ left: '', right: '' })
    let exception: Context | null = null
    if (exceptionPart) {
      exception = splitContext(applyReplacements(exceptionPart, replacements))
      if (!exception) return fail(`排除环境「${exceptionPart}」缺少 _`)
      if (!exception.left && !exception.right) exception = null
    }

    const t = expand(target, classes, { boundary: null, captureFirst: true, warn })
    const compiled: CompiledContext[] = []
    try {
      for (const ctx of contexts) {
        const l = expand(ctx.left, classes, { boundary: '^', captureFirst: false, warn }).re
        const r = expand(ctx.right, classes, { boundary: '$', captureFirst: false, warn }).re
        const main = compile(l, t.re, r)
        let exclude: RegExp | null = null
        if (exception) {
          const el = expand(exception.left, classes, {
            boundary: '^',
            captureFirst: false,
            warn
          }).re
          const er = expand(exception.right, classes, {
            boundary: '$',
            captureFirst: false,
            warn
          }).re
          exclude = compile(el, t.re, er)
        }
        compiled.push({ main, exclude })
      }
    } catch (e) {
      return fail(`正则无法编译：${(e as Error).message}`)
    }

    const rule: ParsedRule = {
      kind: 'rule',
      line,
      raw,
      comment,
      target,
      replacement,
      contexts,
      exception,
      targetClass: t.firstClass,
      targetGroup: t.groupIndex,
      compiled,
      replacementParts: parseReplacement(replacement, classes)
    }
    lines.push(rule)
    steps.push(rule)
  })

  return { classes, replacements, lines, steps, markers, diagnostics }
}
