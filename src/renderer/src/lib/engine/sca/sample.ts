/**
 * 为一条规则生成一个能命中它的示例词（预览动画用）。
 * 做法：把左环境 + 目标 + 右环境里的音类换成第一个成员，可选段丢弃，词界与跨位置记号去掉。
 */
import type { ParsedRule, RuleProgram } from './parse'

function concretize(s: string, classes: Map<string, string[]>): string {
  const chars = Array.from(s)
  let out = ''
  let i = 0
  // 多选：只取第一个分支（按顶层 | 切）
  let depth = 0
  const firstAlt: string[] = []
  for (const c of chars) {
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (c === '|' && depth === 0) break
    firstAlt.push(c)
  }
  const cs = firstAlt
  while (i < cs.length) {
    const c = cs[i]
    if (c === '(') {
      let j = i + 1
      while (j < cs.length && cs[j] !== ')') j++
      i = j + 1
      continue
    }
    if (c === '[') {
      let j = i + 1
      while (j < cs.length && cs[j] !== ']') j++
      const inner = cs.slice(i + 1, j)
      if (inner[0] === '^') out += pickNotIn(inner.slice(1), classes)
      else if (inner.length) out += inner[0]
      i = j + 1
      continue
    }
    if (c === '{') {
      let j = i + 1
      while (j < cs.length && cs[j] !== '}') j++
      const name = cs.slice(i + 1, j).join('')
      out += classes.get('{' + name + '}')?.[0] ?? ''
      i = j + 1
      continue
    }
    if (c >= 'A' && c <= 'Z' && classes.has(c)) {
      out += classes.get(c)![0] ?? ''
      i++
      continue
    }
    if ('#?*+^$'.includes(c)) {
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

function pickNotIn(excluded: string[], classes: Map<string, string[]>): string {
  const pool = [...(classes.get('V') ?? []), ...(classes.get('C') ?? []), ...'aeioukt']
  return pool.find((x) => !excluded.includes(x)) ?? 'a'
}

export function sampleForRule(program: RuleProgram, rule: ParsedRule): string {
  const ctx = rule.contexts[0] ?? { left: '', right: '' }
  const left = concretize(ctx.left, program.classes)
  const right = concretize(ctx.right, program.classes)
  const target = concretize(rule.target, program.classes)
  return left + target + right
}

/** 前后形的公共前后缀之外的部分，用于高亮 */
export function diffSpan(
  before: string,
  after: string
): { prefix: string; beforeMid: string; afterMid: string; suffix: string } {
  const a = Array.from(before)
  const b = Array.from(after)
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
