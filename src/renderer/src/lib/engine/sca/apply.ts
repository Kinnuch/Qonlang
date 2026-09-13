import {
  applyReplacements,
  revertReplacements,
  type CompiledContext,
  type ParsedRule,
  type RuleBranch,
  type RuleProgram
} from './parse'

export interface TraceEntry {
  line: number
  /** 所在阶段（最近一个 -* 标记名，没有则为空串） */
  stage: string
  before: string
  after: string
  target: string
  replacement: string
}

export interface StageForm {
  name: string
  form: string
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

function applyRule(rule: ParsedRule, input: string): string {
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
  const { replacements } = program
  let current = applyReplacements(word, replacements, options.keepDots)
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
    const next = applyRule(step, current)
    if (next !== current) {
      if (options.trace !== false) {
        trace.push({
          line: step.line,
          stage,
          before: current,
          after: next,
          target: step.target,
          replacement: step.replacement
        })
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
  return revertReplacements(applyRule(rule, inner), program.replacements)
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
