/**
 * 规则语言的编号音类：CC 是任意两个辅音，C1C1 是同一个辅音双写；替换里写编号输出那个音。
 */
import { describe, it, expect } from 'vitest'
import { parseRuleText, runRules } from '$lib/engine/sca'

const classes = { C: ['p', 't', 'k', 'm', 'n', 's', 'l', 'r', 'd'], V: ['a', 'e', 'i', 'o', 'u'] }
const run = (rule: string, word: string): string =>
  runRules(parseRuleText(rule, { classes }), word, { trace: false }).output

describe('编号音类', () => {
  it('CC 是任意两个辅音，C1C1 是同一个辅音双写，C1C2 可同可不同', () => {
    expect(run('> ¤ / #_CC', 'ptak')).toBe('¤ptak')
    expect(run('> ¤ / #_CC', 'ppak')).toBe('¤ppak')
    expect(run('> ¤ / #_C1C1', 'ptak')).toBe('ptak')
    expect(run('> ¤ / #_C1C1', 'ppak')).toBe('¤ppak')
    expect(run('> ¤ / #_C1C2', 'ptak')).toBe('¤ptak')
  })

  it('替换里写编号，输出匹配到的那个音', () => {
    expect(run('C1C1 > C1', 'appa')).toBe('apa')
    expect(run('C1C1 > C1', 'apta')).toBe('apta')
    expect(run('C1V1 > V1C1 / #_', 'pak')).toBe('apk')
  })

  it('左环境里的编号（往回匹配）与目标、右环境共用编号', () => {
    expect(run('a > e / C1C1_', 'ppa')).toBe('ppe')
    expect(run('a > e / C1C1_', 'pta')).toBe('pta')
    expect(run('V1 > / V1_', 'aak')).toBe('ak')
    expect(run('V1 > / V1_', 'aek')).toBe('aek')
    expect(run('C1 > / _C1', 'appa')).toBe('apa')
  })

  it('排除环境也认编号；原来的音类对应不受影响', () => {
    expect(run('a > e / C_ - C1C1_', 'pa ppa'.split(' ')[0])).toBe('pe')
    expect(run('a > e / C_ - C1C1_', 'ppa')).toBe('ppa')
    expect(run('[ptk] > [bdg] / V_V', 'apa')).toBe('aba')
    expect(run('V > / _#', 'kasa')).toBe('kas')
  })
})
