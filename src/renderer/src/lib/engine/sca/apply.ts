import {
  applyReplacements,
  BOUNDARY,
  revertReplacements,
  type CompiledContext,
  type ParsedRule,
  type RuleBranch,
  type RuleProgram
} from './parse'
import { annotate, assignStress, plainAnnotated, type Annotated } from './syllables'

export interface TraceEntry {
  line: number
  /** 所在阶段（最近一个 -* 标记名，没有则为空串） */
  stage: string
  before: string
  after: string
  target: string
  replacement: string
  /** stress：这一步是重音规则（target 是 ˈ 或 ˌ，replacement 是规则原文） */
  kind?: 'rule' | 'stress'
}

/** 去掉重音记号（有重音规则的规则集，输出要当拼写用时） */
export function stripStress(s: string): string {
  return s.replace(/[ˈˌ]/g, '')
}

export interface StageForm {
  name: string
  form: string
}

/** 这个词自己带给重音规则的信息（词库、语素里勾了「对重音影响」时才有） */
export interface WordStress {
  /** 词类的各种叫法（名称、缩写，语素还有类型）；重音规则里 <名词> 这样的条目按它对 */
  pos?: readonly string[]
  /** 特殊重音：第几个音节（负数从后数，0 不重读）；重音规则写了 @ 时整个词按它 */
  stress?: number | null
}

export interface RunOptions {
  /** 输入里的点号按字面保留（文字转写时句号是标点）；默认去掉，点号只用来隔开字母 */
  keepDots?: boolean
  /** 输入已经是该阶段的形式：跳过它之前的规则 */
  startAt?: string
  /** 推到该阶段为止 */
  stopAt?: string
  /** 只应用到该文本行号（含）为止的规则 */
  stopAtLine?: number
  trace?: boolean
  /** 多合字母里内部符号在这张表里的，输出时不换回写法（正字法转音标：θ 本来就是音标，不该变回 th） */
  keepUnits?: readonly string[]
  /** 这个词的词类与特殊重音，交给重音规则 */
  word?: WordStress
}

export interface RunResult {
  input: string
  output: string
  stages: StageForm[]
  trace: TraceEntry[]
}

function reverseText(s: string): string {
  return Array.from(s).reverse().join('')
}

/** 替换要用到的：替换文本（`\` 换位、`2` 双写）、目标里第一个音类、拆好的替换 */
type Substitution = Pick<ParsedRule, 'replacement' | 'targetClass' | 'replacementParts'>

function substitute(
  rule: Substitution,
  match: string,
  named: Record<string, string> | undefined
): string {
  if (rule.replacement === '\\') return reverseText(match)
  if (rule.replacement === '2') return match + match
  if (rule.replacement === '') return ''
  let pos = 0
  if (rule.targetClass) {
    // 目标里第一个音类是命名组 tc（见 parse.ts 的 expand）
    const captured = named?.tc ?? ''
    pos = rule.targetClass.members.indexOf(captured)
    if (pos < 0) pos = 9999
  }
  let out = ''
  for (const part of rule.replacementParts) {
    if (part.kind === 'text') out += part.text
    else if (part.kind === 'ref') out += named?.['n' + part.name] ?? ''
    else out += part.ref.members[pos] ?? ''
  }
  return out
}

/** 各个排除环境命中的范围 */
function exclusionRanges(excludes: RegExp[], input: string): [number, number][] {
  return excludes.flatMap((re) =>
    [...input.matchAll(re)].map((m): [number, number] => [m.index, m.index + m[0].length])
  )
}

/** 这个匹配有没有整个落在排除范围里 */
const excluded = (ranges: [number, number][], start: number, end: number): boolean =>
  ranges.some(([s, e]) => start >= s && end <= e)

/**
 * if-else 规则：满足环境的 x1 改成 a，其余位置的 x2 改成 b。两路都按改之前的词判断、一次改完，
 * 满足环境那一路先占位置，另一路跟它重叠的不改。
 */
function applyBranches(branches: NonNullable<ParsedRule['branches']>, input: string): string {
  const spans: { start: number; end: number; out: string }[] = []
  const free = (start: number, end: number): boolean =>
    spans.every((x) =>
      start === end
        ? !(x.start < start && start < x.end)
        : x.start === x.end
          ? !(start < x.start && x.start < end)
          : end <= x.start || start >= x.end
    )
  const take = (branch: RuleBranch, m: RegExpExecArray | RegExpMatchArray): void => {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (!free(start, end)) return
    spans.push({ start, end, out: substitute(branch, m[0], m.groups) })
  }
  const inContext = (c: CompiledContext): RegExpMatchArray[] => {
    const ranges = exclusionRanges(c.excludes, input)
    return [...input.matchAll(c.main)].filter(
      (m) => !excluded(ranges, m.index ?? 0, (m.index ?? 0) + m[0].length)
    )
  }
  for (const c of branches.then.compiled) for (const m of inContext(c)) take(branches.then, m)
  // x2 满足环境的位置：留给上面那一路（改不改看 x1），这里不动
  const inside = new Set<number>()
  for (const c of branches.otherwise.compiled)
    for (const m of inContext(c)) inside.add(m.index ?? 0)
  for (const m of input.matchAll(branches.otherwise.anywhere))
    if (m[0].length && !inside.has(m.index ?? 0)) take(branches.otherwise, m)
  if (!spans.length) return input
  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  let out = ''
  let pos = 0
  for (const s of spans) {
    out += input.slice(pos, s.start) + s.out
    pos = s.end
  }
  return out + input.slice(pos)
}

/** 按音节、重音匹配时的一处命中：位置是原词里的，text 去掉了中间的记号 */
interface Hit {
  start: number
  end: number
  text: string
  groups: Record<string, string> | undefined
  /** 命中范围里被跳过的重音记号：[去掉记号后的位置, 记号] */
  marks: [number, string][]
}

const MARKS_RE = new RegExp(`[${BOUNDARY}ˈˌ]`, 'g')

function hitsOf(re: RegExp, ann: Annotated, word: string): Hit[] {
  const out: Hit[] = []
  let lastEmpty = -1
  for (const m of ann.text.matchAll(re)) {
    const a = m.index ?? 0
    const start = ann.source(a)
    const end = ann.source(a + m[0].length)
    let text = ''
    const marks: [number, string][] = []
    for (const ch of word.slice(start, end)) {
      if (ch === 'ˈ' || ch === 'ˌ') marks.push([text.length, ch])
      else text += ch
    }
    // 空的命中（增生）：同一个音前后隔着记号的几个位置只算一次
    if (start === end) {
      const plain = start - (word.slice(0, start).match(/[ˈˌ]/g)?.length ?? 0)
      if (plain === lastEmpty) continue
      lastEmpty = plain
    }
    const groups = m.groups
      ? Object.fromEntries(
          Object.entries(m.groups).map(([k, v]) => [k, v?.replace(MARKS_RE, '') ?? v])
        )
      : undefined
    out.push({ start, end, text, groups, marks })
  }
  return out
}

/** 被规则换掉的那段里原来有重音记号的，按原来的位置放回去（规则自己写了 ˈ ˌ 的不放） */
function keepMarks(out: string, hit: Hit, explicit: boolean): string {
  if (explicit || !hit.marks.length) return out
  let res = out
  hit.marks.forEach(([at, mark], i) => {
    const pos = Math.min(at, out.length) + i
    res = res.slice(0, pos) + mark + res.slice(pos)
  })
  return res
}

function applyMarked(rule: ParsedRule, input: string, program: RuleProgram): string {
  const annotated = (w: string): Annotated =>
    rule.sigma ? annotate(w, program) : plainAnnotated(w)
  if (rule.branches) {
    const b = rule.branches
    const ann = annotated(input)
    const spans: { start: number; end: number; out: string }[] = []
    const free = (start: number, end: number): boolean =>
      spans.every((x) =>
        start === end
          ? !(x.start < start && start < x.end)
          : x.start === x.end
            ? !(start < x.start && x.start < end)
            : end <= x.start || start >= x.end
      )
    const take = (branch: RuleBranch, h: Hit): void => {
      if (!free(h.start, h.end)) return
      spans.push({
        start: h.start,
        end: h.end,
        out: keepMarks(substitute(branch, h.text, h.groups), h, rule.explicitStress)
      })
    }
    const inContext = (c: CompiledContext): Hit[] => {
      const ranges = c.excludes.flatMap((re) =>
        hitsOf(re, ann, input).map((h): [number, number] => [h.start, h.end])
      )
      return hitsOf(c.main, ann, input).filter((h) => !excluded(ranges, h.start, h.end))
    }
    for (const c of b.then.compiled) for (const h of inContext(c)) take(b.then, h)
    const inside = new Set<number>()
    for (const c of b.otherwise.compiled) for (const h of inContext(c)) inside.add(h.start)
    for (const h of hitsOf(b.otherwise.anywhere, ann, input))
      if (h.end > h.start && !inside.has(h.start)) take(b.otherwise, h)
    if (!spans.length) return input
    spans.sort((x, y) => x.start - y.start || x.end - y.end)
    let out = ''
    let pos = 0
    for (const x of spans) {
      out += input.slice(pos, x.start) + x.out
      pos = x.end
    }
    return out + input.slice(pos)
  }
  let current = input
  for (const c of rule.compiled) {
    const ann = annotated(current)
    const ranges = c.excludes.flatMap((re) =>
      hitsOf(re, ann, current).map((h): [number, number] => [h.start, h.end])
    )
    let out = ''
    let pos = 0
    for (const h of hitsOf(c.main, ann, current)) {
      if (h.start < pos || excluded(ranges, h.start, h.end)) continue
      out +=
        current.slice(pos, h.start) +
        keepMarks(substitute(rule, h.text, h.groups), h, rule.explicitStress)
      pos = h.end
    }
    current = out + current.slice(pos)
  }
  return current
}

function applyRule(rule: ParsedRule, input: string, program: RuleProgram): string {
  if (rule.literal && !input.includes(rule.literal)) return input
  if (rule.marks) return applyMarked(rule, input, program)
  if (rule.branches) return applyBranches(rule.branches, input)
  let current = input
  for (const { main, excludes } of rule.compiled) {
    const ranges = exclusionRanges(excludes, current)
    current = current.replace(main, (...args: unknown[]) => {
      const match = args[0] as string
      // 最后两个（或三个，若有命名组）参数是 offset 与整串
      let offsetIdx = args.length - 2
      if (typeof args[args.length - 1] === 'object') offsetIdx = args.length - 3
      const offset = args[offsetIdx] as number
      const named =
        typeof args[args.length - 1] === 'object'
          ? (args[args.length - 1] as Record<string, string>)
          : undefined
      if (ranges.length) {
        const end = offset + match.length
        for (const [s, e] of ranges) if (offset >= s && end <= e) return match
      }
      return substitute(rule, match, named)
    })
  }
  return current
}

/** 对一个词运行整套规则 */
export function runRules(program: RuleProgram, word: string, options: RunOptions = {}): RunResult {
  const keep = options.keepUnits?.length ? new Set(options.keepUnits) : null
  const replacements = keep
    ? program.replacements.filter(([, to]) => !keep.has(to))
    : program.replacements
  let current = applyReplacements(word, program.replacements, options.keepDots)
  const stages: StageForm[] = []
  const trace: TraceEntry[] = []
  let stage = ''
  let active = !options.startAt

  for (const step of program.steps) {
    if (options.stopAtLine != null && step.line > options.stopAtLine) break
    if (step.kind === 'marker') {
      if (!active) {
        if (step.name === options.startAt) {
          active = true
          stage = step.name
          stages.push({ name: step.name, form: revertReplacements(current, replacements) })
        }
        continue
      }
      stage = step.name
      stages.push({ name: step.name, form: revertReplacements(current, replacements) })
      if (options.stopAt && step.name === options.stopAt) break
      continue
    }
    if (!active) continue
    const next =
      step.kind === 'stress'
        ? assignStress(step, current, program, options.word)
        : applyRule(step, current, program)
    if (next !== current) {
      if (options.trace !== false) {
        trace.push(
          step.kind === 'stress'
            ? {
                line: step.line,
                stage,
                before: current,
                after: next,
                target: step.level === 'secondary' ? 'ˌ' : 'ˈ',
                replacement: step.text,
                kind: 'stress'
              }
            : {
                line: step.line,
                stage,
                before: current,
                after: next,
                target: step.target,
                replacement: step.replacement
              }
        )
      }
      current = next
    }
  }
  return { input: word, output: revertReplacements(current, replacements), stages, trace }
}

/** 词两头的标点（逗号、句号、引号……）：单独过规则，不挡住词首、词末（`kam,` 里的逗号） */
const EDGE_PUNCT =
  /^([.,;:!?…“”"«»‹›—–「」『』，。！？；：、]*)(.*?)([.,;:!?…“”"«»‹›—–「」『』，。！？；：、]*)$/su

/**
 * 一段可能有好几个词的文字：按空白切开，每个词单独跑一遍规则——`#` 是每个词自己的词首、词尾
 * （`A B` 里 A 的末尾也是词尾），空白原样留着；词两头的标点单独跑。只要输出文字时用它。
 */
export function runRulesOnText(
  program: RuleProgram,
  text: string,
  options: RunOptions = {}
): string {
  const conv = (x: string): string =>
    x ? runRules(program, x, { ...options, trace: false }).output : ''
  return text.replace(/\S+/gu, (w) => {
    const m = EDGE_PUNCT.exec(w)
    if (!m || (!m[1] && !m[3]) || !m[2]) return conv(w)
    return conv(m[1]) + conv(m[2]) + conv(m[3])
  })
}

/** 只应用一条规则（预览用）。输入输出都是书写形式（经多合字母替换与还原）。 */
export function runSingleRule(program: RuleProgram, rule: ParsedRule, word: string): string {
  const inner = applyReplacements(word, program.replacements)
  return revertReplacements(applyRule(rule, inner, program), program.replacements)
}

/** 规则序号（第 1 条起，不计标记与注释）：文本行号 → 序号 */
export function ruleOrdinals(program: RuleProgram): Map<number, number> {
  const m = new Map<number, number>()
  let n = 0
  for (const s of program.steps) if (s.kind === 'rule') m.set(s.line, ++n)
  return m
}

/** 批量运行；每个词独立 */
export function runRulesBatch(
  program: RuleProgram,
  words: string[],
  options: RunOptions = {}
): RunResult[] {
  return words.map((w) => runRules(program, w, options))
}
