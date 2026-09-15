/**
 * 目标是固定一串字的规则先用 includes 筛：记下的那串字要跟编好的正则一致，结果跟不筛一样。
 */
import { describe, it, expect } from 'vitest'
import { parseRuleText, runRules, type ParsedRule } from '$lib/engine/sca'

const rules = (text: string): ParsedRule[] =>
  parseRuleText(text).steps.filter((s): s is ParsedRule => s.kind === 'rule')

describe('固定目标的规则', () => {
  it('只有普通字、转义标点的目标才记下那串字', () => {
    const r = rules(
      [
        'C = p t k',
        'aa01 > x',
        String.raw`a\?b > y`,
        'aC > z',
        '[ptk]a > w',
        'a(b) > v',
        'ˈ = 1',
        'ab > u'
      ].join('\n')
    )
    expect(r.map((x) => x.literal)).toEqual([
      'aa01',
      'a?b',
      undefined,
      undefined,
      undefined,
      undefined
    ])
    // 记下的那串字就是编好的正则要找的
    expect(r[0].compiled[0].main.source).toBe('(aa01)')
    expect(r[1].compiled[0].main.source).toBe(String.raw`(a\?b)`)
  })
  it('筛过之后结果不变：环境、排除、插入', () => {
    const prog = parseRuleText(
      ['ab > X / _#', 'ba > Y / _ - #_', 'q > kw', ' > h / #_a', 'kw > K'].join('\n')
    )
    expect(runRules(prog, 'abab').output).toBe('habX')
    expect(runRules(prog, 'baba').output).toBe('baY')
    expect(runRules(prog, 'aqa').output).toBe('haKa')
    expect(runRules(prog, 'zzz').output).toBe('zzz')
  })
})
