/**
 * 两处规则引擎的小修：
 * 1. 音类成员不去重——放在替换一侧按位置对应时，并音（t、d 都变 r）要写两个 r；
 * 2. 构形「微调」里写的音类定义、多合字母声明对这一步的每条规则都生效。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseRuleText, runRules } from '$lib/engine/sca'
import { parseProject } from '$lib/core/serialize'
import { applyAdjust, makeContext } from '$lib/engine/morph'

const run = (text: string, word: string): string => runRules(parseRuleText(text), word).output

describe('音类按位置对应：重复的成员不去掉', () => {
  it('并音：t、d 都变 r，后面的成员不往前串', () => {
    const rules = '{甲}=t d s\n{乙}=r r z\n{甲} > {乙} / #_'
    expect(run(rules, 'tal')).toBe('ral')
    expect(run(rules, 'dal')).toBe('ral')
    expect(run(rules, 'sal')).toBe('zal')
  })
  it('单字母音类也一样（音变姬写法）', () => {
    expect(run('P=pbt\nF=ffs\nP > F / #_', 'bak')).toBe('fak')
    expect(run('P=pbt\nF=ffs\nP > F / #_', 'tak')).toBe('sak')
  })
})

describe('微调里的声明对这一步的每条规则生效', () => {
  const p = parseProject(
    readFileSync(join(__dirname, '..', '..', 'examples', 'Aelith.laim.json'), 'utf8')
  )
  const ctx = makeContext(p, p.languages[0])
  it('长名音类 + 多合字母：th 不会被当成 t', () => {
    const text = [
      '; 词首的 t、d 变擦音，th 不动',
      'th|θ',
      '{起}=t d',
      '{止}=s z',
      '{起} > {止} / #_'
    ].join('\n')
    const trace: string[] = []
    expect(applyAdjust(ctx, 'tal', text, trace, '微调')).toBe('sal')
    expect(applyAdjust(ctx, 'dal', text, [], '微调')).toBe('zal')
    expect(applyAdjust(ctx, 'thal', text, [], '微调')).toBe('thal')
    // 声明行不当成看不懂的行记进轨迹
    expect(trace.some((l) => l.includes('?'))).toBe(false)
  })
  it('声明跟加减词缀的写法混着用', () => {
    expect(applyAdjust(ctx, 'tal', '{起}=t\n{止}=d\n{起} > {止} / #_\n+a', [], '微调')).toBe('dala')
  })
})
