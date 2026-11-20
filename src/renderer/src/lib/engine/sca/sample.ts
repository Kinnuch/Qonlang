/** 从本条规则的实际成员构造示例，再交给真实引擎核实；不凭空拼无关词。 */
import {
  decodeEscapes,
  encodeEscapes,
  revertReplacements,
  temporaryClassMembers,
  type ParsedRule,
  type RuleProgram
} from './parse'
import { changedRuleResult } from './apply'
import type { RunOptions } from './apply'

export interface RuleSampleOptions {
  random?: () => number
  maxAttempts?: number
  runOptions?: RunOptions
}
interface Choice {
  variant: number
  random: () => number
  numbered: Map<string, string>
  pool: string[]
}
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))]
const literal = (char: string): string => {
  const decoded = decodeEscapes(char)
  return decoded === char ? char : decoded.slice(1)
}
function choose(values: string[], state: Choice): string | null {
  const options = unique(values)
  if (!options.length) return null
  const random = state.random()
  const start = Number.isFinite(random)
    ? Math.min(options.length - 1, Math.max(0, Math.floor(random * options.length)))
    : 0
  const index = (start + (state.variant % options.length)) % options.length
  state.variant = Math.floor(state.variant / options.length)
  return options[index]
}

/** 顶层多选只选一支，括号、音类和转义中的竖线不是分隔符。 */
function firstAlternative(source: string, state: Choice): string {
  const parts: string[] = []
  let depth = 0,
    start = 0
  const chars = Array.from(source)
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === '|' && depth === 0) {
      parts.push(chars.slice(start, i).join(''))
      start = i + 1
    }
  }
  parts.push(chars.slice(start).join(''))
  return choose(parts, state) ?? ''
}
function bracketCandidates(inner: string, rule: ParsedRule, state: Choice): string[] {
  const shown = decodeEscapes(inner)
  if (/^\s*[+-]\s*\p{L}/u.test(shown)) {
    const members = rule.featureMembers?.[shown]
    if (members) return members
    const excluded = rule.featureExclusions?.[shown]
    return excluded ? state.pool.filter((member) => !excluded.includes(member)) : []
  }
  const members = temporaryClassMembers(inner)
  if (members) return members
  try {
    const expression = new RegExp(`^(?:[${shown}])$`, 'u')
    const fromPattern = shown.startsWith('^') ? [] : Array.from(inner).map(literal)
    return unique([...state.pool, ...fromPattern]).filter((member) => expression.test(member))
  } catch {
    return []
  }
}

function concretize(
  source: string,
  program: RuleProgram,
  rule: ParsedRule,
  state: Choice,
  aligned = false
): string | null {
  const chars = Array.from(firstAlternative(encodeEscapes(source), state))
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const decoded = literal(c)
    if (decoded !== c) {
      out += decoded
      continue
    }
    if (c === '(') {
      let depth = 1
      while (depth && ++i < chars.length) {
        if (chars[i] === '(') depth++
        else if (chars[i] === ')') depth--
      }
      continue
    }
    if (c === '[') {
      let end = i + 1
      while (end < chars.length && chars[end] !== ']') end++
      if (end === chars.length) return null
      const member = choose(bracketCandidates(chars.slice(i + 1, end).join(''), rule, state), state)
      if (member === null) return null
      out += member
      i = end
      continue
    }
    if (c === '{') {
      let end = i + 1
      while (end < chars.length && chars[end] !== '}') end++
      const name = chars.slice(i + 1, end).join('')
      const member = choose(
        program.classes.get('{' + name + '}') ?? program.classes.get(name) ?? [],
        state
      )
      if (member === null || end === chars.length) return null
      out += member
      i = end
      continue
    }
    if (c >= 'A' && c <= 'Z' && program.classes.has(c)) {
      let end = i + 1
      while (end < chars.length && /[0-9]/.test(chars[end])) end++
      const number = chars.slice(i + 1, end).join(''),
        key = c + number
      const member =
        number && state.numbered.has(key)
          ? state.numbered.get(key)!
          : choose(program.classes.get(c)!, state)
      if (member === null) return null
      if (number) state.numbered.set(key, member)
      out += member
      i = end - 1
      continue
    }
    if (c === '@') {
      let end = i + 1
      while (end < chars.length && /[\p{L}\p{N}_\-.]/u.test(chars[end])) end++
      const name = chars.slice(i, end).join('')
      const member = choose(program.classes.get(name) ?? [], state)
      if (member === null) return null
      out += member
      i = end - 1
      continue
    }
    if ('#?*+^$σ'.includes(c) || (aligned && c === '_')) continue
    out += c
  }
  return out
}

export function sampleForRule(
  program: RuleProgram,
  rule: ParsedRule,
  options: RuleSampleOptions = {}
): string {
  const random = options.random ?? Math.random
  const limit = Number.isFinite(options.maxAttempts)
    ? Math.min(128, Math.max(1, Math.floor(options.maxAttempts!)))
    : 64
  const contexts = rule.contexts.length ? rule.contexts : [{ left: '', right: '' }]
  const target = rule.branches?.then.target ?? rule.target
  const aligned = !!(rule.branches?.then.segments ?? rule.segments)
  const encodedTarget = encodeEscapes(target)
  // 看似分段但无法识别的特征表达式，不用带字面下划线的假词冒充示例。
  if (!aligned && encodedTarget.includes('_') && /\[\s*[+-]/u.test(encodedTarget)) return ''
  const plans = contexts.map((context) => ({ ...context, target, aligned }))
  if (rule.branches)
    plans.push({
      left: '',
      right: '',
      target: rule.branches.otherwise.target,
      aligned: !!rule.branches.otherwise.segments
    })
  const sourceLiterals = [
    ...plans.map((plan) => plan.target),
    ...contexts.flatMap((context) => [context.left, context.right])
  ].flatMap((text) =>
    Array.from(text.replace(/\[[^\]]*\]|\{[^}]*\}|@[\p{L}\p{N}_\-.]+/gu, '')).filter((char) =>
      /[\p{Ll}\p{N}]/u.test(char)
    )
  )
  const pool = unique(
    [...program.classes.values()]
      .flat()
      .concat(Object.values(rule.featureMembers ?? {}).flat(), sourceLiterals)
  )
  for (let attempt = 0; attempt < limit; attempt++) {
    const state: Choice = {
      variant: Math.floor(attempt / plans.length),
      random,
      numbered: new Map(),
      pool
    }
    const context = plans[attempt % plans.length]
    const left = concretize(context.left, program, rule, state)
    const match = concretize(context.target, program, rule, state, context.aligned)
    const right = concretize(context.right, program, rule, state)
    if (left === null || match === null || right === null) continue
    const candidate = revertReplacements(left + match + right, program.replacements)
    if (candidate && changedRuleResult(program, rule, candidate, options.runOptions) !== null)
      return candidate
  }
  return ''
}

/** 前后形的公共前后缀之外的部分，用于高亮 */
export function diffSpan(
  before: string,
  after: string
): { prefix: string; beforeMid: string; afterMid: string; suffix: string } {
  const a = Array.from(before),
    b = Array.from(after)
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  return {
    prefix: a.slice(0, p).join(''),
    beforeMid: a.slice(p, a.length - s).join(''),
    afterMid: b.slice(p, b.length - s).join(''),
    suffix: a.slice(a.length - s).join('')
  }
}
