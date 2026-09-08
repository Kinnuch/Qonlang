import { applyReplacements, revertReplacements, type ParsedRule, type RuleProgram } from './parse'

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

function substitute(rule: ParsedRule, match: string, groups: string[]): string {
  if (rule.replacement === '\\') return reverseText(match)
  if (rule.replacement === '2') return match + match
  if (rule.replacement === '') return ''
  let pos = 0
  if (rule.targetClass) {
    const captured = groups[rule.targetGroup - 1] ?? ''
    pos = rule.targetClass.members.indexOf(captured)
    if (pos < 0) pos = 9999
  }
  let out = ''
  for (const part of rule.replacementParts) {
    if (part.kind === 'text') out += part.text
    else out += part.ref.members[pos] ?? ''
  }
  return out
}

function applyRule(rule: ParsedRule, input: string): string {
  let current = input
  for (const { main, exclude } of rule.compiled) {
    let ranges: [number, number][] = []
    if (exclude) {
      exclude.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = exclude.exec(current)) !== null) {
        ranges.push([m.index, m.index + m[0].length])
        if (m[0].length === 0) exclude.lastIndex++
      }
    } else ranges = []
    current = current.replace(main, (...args: unknown[]) => {
      const match = args[0] as string
      // 最后两个（或三个，若有命名组）参数是 offset 与整串
      let offsetIdx = args.length - 2
      if (typeof args[args.length - 1] === 'object') offsetIdx = args.length - 3
      const offset = args[offsetIdx] as number
      const groups = args.slice(1, offsetIdx) as string[]
      if (ranges.length) {
        const end = offset + match.length
        for (const [s, e] of ranges) if (offset >= s && end <= e) return match
      }
      return substitute(rule, match, groups)
    })
  }
  return current
}

/** 对一个词运行整套规则 */
export function runRules(program: RuleProgram, word: string, options: RunOptions = {}): RunResult {
  const { replacements } = program
  let current = applyReplacements(word, replacements)
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
