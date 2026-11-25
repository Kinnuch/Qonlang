import { describe, expect, it } from 'vitest'
import { formatClassLine, parseClassLine, parseRuleText, runRules } from '$lib/engine/sca'

const run = (text: string, input: string) => runRules(parseRuleText(text), input).output
const rules = (h: string, m: string) => `H=${h}\nM=${m}\nP>Q/_CH\nP>R/_CM`

describe('SCA单字母音类的完整多字母成员', () => {
  it('接受带空格的冒号声明，保留字面冒号规则及单个多字母成员', () => {
    const text = 'H: á áu ú\nM: a au u\nP > Q / _CH\nP > R / _CM'
    expect(['PCá', 'PCa', 'PCu'].map((word) => run(text, word))).toEqual(['QCá', 'RCa', 'RCu'])
    expect(parseClassLine('P: > R')).toBeNull()
    expect(parseClassLine(formatClassLine('H', ['áu']))?.members).toEqual(['áu'])
  })
  it('空格分隔的双元音不把自己的尾字母收入音类', () => {
    expect(parseClassLine('H=á áu ú')?.members).toEqual(['á', 'áu', 'ú'])
    expect(parseClassLine('M=a au u')?.members).toEqual(['a', 'au', 'u'])
    expect(run(rules('á áu ú', 'a au u'), 'PCu')).toBe('RCu')
    expect(run(rules('á áu ú', 'a au u'), 'PCáu')).toBe('QCáu')
  })

  it('未分隔的旧紧凑类仍逐字拆，显式分隔和旧语义不混用', () => {
    expect(parseClassLine('H=ááuú')?.members).toEqual(['á', 'á', 'u', 'ú'])
    expect(run(rules('ááuú', 'aauu'), 'PCu')).toBe('QCu')
    expect(run('C=ptk\nC>z', 'pkt')).toBe('zzz')
  })

  it('逗号分隔、两端格式空格和多字母成员位置替换正确', () => {
    expect(parseClassLine('H = á,áu,ú')?.members).toEqual(['á', 'áu', 'ú'])
    expect(parseClassLine('V = aeiou  ')?.members).toEqual(['a', 'e', 'i', 'o', 'u'])
    expect(run('H=á áu ú\nM=a au u\nH>M', 'áuú')).toBe('auu')
  })

  it('组合重音作为完整成员保留，不产生临时符号碰撞', () => {
    const decomposed = 'á'.normalize('NFD')
    expect(parseClassLine(`H=${decomposed} ${decomposed}u ú`)?.members).toEqual([
      decomposed,
      decomposed + 'u',
      'ú'
    ])
    expect(run(rules(`${decomposed} ${decomposed}u ú`, 'a au u'), 'PCu')).toBe('RCu')
    expect(run(`H=${decomposed} ${decomposed}u\nM=a au\nH>M`, decomposed + 'u')).toBe('au')
    expect(run('H=á áu ú\nM=a au u\nH>M', '\uE000áu\uFDD1')).toBe('\uE000au\uFDD1')
  })

  it('多合字母声明与转义成员照旧，长名与单字母类口径一致', () => {
    expect(run('au|ω\nH=á áu ú\nM=a au u\nH>M', 'áu')).toBe('au')
    expect(parseClassLine('H=á \\; ú')?.members).toEqual(['á', ';', 'ú'])
    expect(parseClassLine('{High}=á áu ú')?.members).toEqual(parseClassLine('H=á áu ú')?.members)
  })
})
