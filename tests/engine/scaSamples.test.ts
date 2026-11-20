import { describe, expect, it } from 'vitest'
import {
  changedRuleResult,
  applyReplacements,
  formatRule,
  parseRuleText,
  runRules,
  runSingleRule,
  sampleForRule,
  type ParsedRule,
  type RuleProgram
} from '$lib/engine/sca'

function parsed(source: string): { program: RuleProgram; rule: ParsedRule } {
  const program = parseRuleText(source)
  expect(program.diagnostics).toEqual([])
  const rule = program.steps.filter((step): step is ParsedRule => step.kind === 'rule').at(-1)!
  return { program, rule }
}
const features = 'V=aeiou\n[+送氣]=pʰ tʰ kʰ\n[-送氣]=p t k\n'
const featureRule = 'V_[+送氣] > Vː_[-送氣] / _s'

describe('临时成员表与真实命中的规则示例', () => {
  it('将空格源表与点分隔的多字符输出按成员位置对应', () => {
    const { program, rule } = parsed('V=ae\n[ī ū ȳ] > [ij.uw.yj] / _Vː')
    expect(rule.targetClass?.members).toEqual(['ī', 'ū', 'ȳ'])
    expect(rule.replacementParts[0]).toMatchObject({
      kind: 'class',
      ref: { members: ['ij', 'uw', 'yj'] }
    })
    for (const [word, want] of [
      ['īaː', 'ijaː'],
      ['ūeː', 'uweː'],
      ['ȳaː', 'yjaː'],
      ['ūa', 'ūa']
    ])
      expect(runRules(program, word).output).toBe(want)
    const sample = sampleForRule(program, rule, { random: () => 0 })
    expect(sample).toMatch(/^[īūȳ][ae]ː$/u)
    expect(changedRuleResult(program, rule, sample)).toBe(runSingleRule(program, rule, sample))
  })
  it('临时类支持完整多字符成员，避免生成分隔空格或半个音段', () => {
    const { program, rule } = parsed('[ph th] > [f.s]')
    expect(runRules(program, 'phth').output).toBe('fs')
    for (const random of [() => 0, () => 0.99]) {
      const sample = sampleForRule(program, rule, { random })
      expect(['ph', 'th']).toContain(sample)
      expect(['f', 's']).toContain(changedRuleResult(program, rule, sample))
    }
  })
  it('传统字符组、范围、否定和字面点不改语义', () => {
    expect(runRules(parseRuleText('[ptk] > [bdg]'), 'ptk').output).toBe('bdg')
    expect(runRules(parseRuleText('[a-c] > x'), 'abcd').output).toBe('xxxd')
    expect(runRules(parseRuleText('[^a-c] > x'), 'abdt').output).toBe('abxx')
    expect(runRules(parseRuleText('[ab] > [\\.x]'), 'ab').output).toBe('.x')
    expect(runRules(parseRuleText('[a\\.] > x'), '.', { keepDots: true }).output).toBe('x')
    expect(runRules(parseRuleText('[ab] > [ij\\.uw.yj]'), 'ab').output).toBe('ij.uwyj')
    expect(applyReplacements('[ij.uw]', [])).toBe('[ijuw]')
  })
  it('成对音类/特征段相邻匹配，各自按位置替换并保留实际元音', () => {
    const { program, rule } = parsed(features + featureRule)
    expect(rule.segments).toHaveLength(2)
    for (const [word, want] of [
      ['apʰs', 'aːps'],
      ['etʰs', 'eːts'],
      ['ukʰs', 'uːks'],
      ['ipʰx', 'ipʰx']
    ])
      expect(runRules(program, word).output).toBe(want)
    const sample = sampleForRule(program, rule, { random: () => 0.75 })
    expect(sample).toMatch(/^[aeiou](?:pʰ|tʰ|kʰ)s$/u)
    expect(sample).not.toContain('_')
    expect(changedRuleResult(program, rule, sample)).not.toBeNull()
    expect(formatRule(rule)).toBe(featureRule)
  })
  it('分段规则沿用满足/不满足环境两路，且不改普通或转义下划线', () => {
    const { program } = parsed(features + 'V_[+送氣] > Vː_[-送氣]?V_[-送氣] / _s')
    expect(runRules(program, 'apʰs etʰx').output).toBe('aːps etx')
    const literal = parsed('a_b > x_y')
    expect(literal.rule.segments).toBeUndefined()
    expect(runRules(literal.program, 'a_b ab').output).toBe('x_y ab')
    const escaped = parsed(features + 'V\\_[+送氣] > Vː\\_[-送氣] / _s')
    expect(escaped.rule.segments).toBeUndefined()
    expect(runRules(escaped.program, 'a_pʰs apʰs').output).toBe('aː_ps apʰs')
    const otherwise = parsed('C=pt\nx > x?y / C_')
    expect(sampleForRule(otherwise.program, otherwise.rule, { random: () => 0 })).toBe('x')
  })
  it('重音之后的分段匹配保留记号，当前规则特征仍可生成样例', () => {
    const { program, rule } = parsed(features + 'ˈ = 1\n' + featureRule)
    expect(runRules(program, 'etʰs').output).toBe('ˈeːts')
    const sample = sampleForRule({ ...program, lines: [], steps: [rule] }, rule, {
      random: () => 0
    })
    expect(sample).toBe('apʰs')
    expect(changedRuleResult(program, rule, sample)).toBe('aːps')
  })
  it('示例只需当前规则元数据，不依赖历史定义行，并保留当行有效特征', () => {
    const source = features + featureRule + '\n[+送氣]=h'
    const { program, rule } = parsed(source)
    const thin = { ...program, lines: [], steps: [rule] }
    expect(rule.featureMembers?.['+送氣']).toEqual(['pʰ', 'tʰ', 'kʰ'])
    const sample = sampleForRule(thin, rule, { random: () => 0 })
    expect(sample).toBe('apʰs')
    expect(changedRuleResult(thin, rule, sample)).toBe('aːps')
  })
  it('补集特征从本规则可用成员选取，并交真实排除逻辑验证', () => {
    const { program, rule } = parsed('C=pt\n[+送氣]=pʰ\n[-送氣] > x')
    expect(rule.featureExclusions?.['-送氣']).toEqual(['pʰ'])
    const sample = sampleForRule(program, rule, { random: () => 0 })
    expect(['p', 't']).toContain(sample)
    expect(changedRuleResult(program, rule, sample)).toBe('x')
    const impossible = parsed('[+送氣]=pʰ\n[-送氣] > x')
    expect(sampleForRule(impossible.program, impossible.rule)).toBe('')
  })
  it('无法命中、恒等或未知特征不伪造随机词', () => {
    for (const source of ['C=pt\nC > C', 'C=pt\nC > x / _ - _#']) {
      const { program, rule } = parsed(source)
      expect(sampleForRule(program, rule, { random: () => 0 })).toBe('')
    }
    const unsupported = parseRuleText('V=ae\nV_[+unknown] > Vː_[-unknown] / _s')
    const rule = unsupported.steps.find((step): step is ParsedRule => step.kind === 'rule')!
    expect(sampleForRule(unsupported, rule)).toBe('')
  })
  it('随机候选使用同号实际成员，重试可避开被排除的第一个成员', () => {
    const numbered = parsed('C=pt\nC1C1 > x')
    const word = sampleForRule(numbered.program, numbered.rule, { random: () => 0.99 })
    expect(['pp', 'tt']).toContain(word)
    const excluded = parsed('C=pt\nC > x / _ - #_t')
    const sample = sampleForRule(excluded.program, excluded.rule, { random: () => 0 })
    expect(changedRuleResult(excluded.program, excluded.rule, sample)).not.toBeNull()
  })
  it('预处理带来的点号变化不能冒充规则命中', () => {
    const { program, rule } = parsed('th|θ\nx > y')
    expect(runSingleRule(program, rule, 't.h')).toBe('th')
    expect(changedRuleResult(program, rule, 't.h')).toBeNull()
    const actual = parsed('th|θ\nθ > s')
    expect(changedRuleResult(actual.program, actual.rule, 'th')).toBe('s')
    expect(sampleForRule(actual.program, actual.rule, { random: () => 0 })).toBe('th')
  })
})
