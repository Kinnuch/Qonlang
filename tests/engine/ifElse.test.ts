/**
 * 满足 / 不满足环境两路的规则（`x1?x2 > a?b / 环境`）、几个排除环境，以及目标里音类前面还有别的字时的音类对应。
 */
import { describe, it, expect } from 'vitest'
import { formatRule, parseRuleText, runRules, type ParsedRule } from '$lib/engine/sca'

const run = (rules: string, word: string): string => runRules(parseRuleText(rules), word).output
const words = (rules: string, text: string): string =>
  text
    .split(' ')
    .map((w) => run(rules, w))
    .join(' ')
const firstRule = (rules: string): ParsedRule =>
  parseRuleText(rules).steps.find((s): s is ParsedRule => s.kind === 'rule')!

describe('class correspondence with more than the class in the target', () => {
  it('pairs the first class of the target even after other letters', () => {
    expect(words('V=aeiou\nU=AEIOU\nkV > kU', 'ka ki')).toBe('kA kI')
    expect(words('[ptk]a > [bdg]a', 'pa ta ka')).toBe('ba da ga')
    expect(words('s[ptk] > s[bdg]', 'spa ska')).toBe('sba sga')
    expect(words('C=ptk\nV=aeiou\nW=AEIOU\nC1V > C1W / #_', 'pa ki')).toBe('pA kI')
  })
})

describe('if-else rules', () => {
  it('x > a?b / Y: inside the environment x > a, everywhere else x > b', () => {
    expect(words('a > e?o / _#', 'kala aba a')).toBe('kole obe e')
  })

  it('x1?x2 > a?b / Y: x1 > a inside, x2 > b outside', () => {
    // i 前面的 t 变 s；不在 i 前面的 d 变 z；i 前面的 d、不在 i 前面的 t 都不动
    expect(words('t?d > s?z / _i', 'tidi tada diti')).toBe('sidi taza disi')
  })

  it('x1?x2 > a / Y: both branches share the replacement', () => {
    expect(words('V=aeiou\np?b > f / V_V', 'apa aba bab')).toBe('afa aba faf')
  })

  it('branches can swap (\\) or double (2)', () => {
    expect(run('ab?cd > \\?2 / #_', 'abcd')).toBe('bacdcd')
    expect(run('ab?cd > \\?2 / #_', 'cdab')).toBe('cdab')
  })

  it('keeps class correspondence in each branch', () => {
    expect(words('V=aeiou\n[ptk] > [bdg]?[fθx] / V_V', 'apa atak ka')).toBe('aba adax xa')
  })

  it('treats several environments as one condition and honours exceptions', () => {
    expect(words('a > e?o / _# , _i', 'kaba kaia')).toBe('kobe keie')
    expect(words('a > e?o / _# - k_', 'kaka kala')).toBe('koko kole')
  })

  it('decides every position from the word before the rule ran', () => {
    // 满足环境那一路改出来的 b 不会再被另一路当成「不在词尾的 b」
    expect(run('a?b > b?a / _#', 'ba')).toBe('ab')
    expect(run('a?a > b?c / _a', 'aa')).toBe('bc')
  })

  it('keeps the rule text as written for the editor', () => {
    const r = firstRule('t?d > s?z / _i - #_')
    expect(r.target).toBe('t?d')
    expect(r.replacement).toBe('s?z')
    expect(r.branches?.then.target).toBe('t')
    expect(r.branches?.otherwise.replacement).toBe('z')
    expect(formatRule({ ...r, comment: '' })).toBe('t?d > s?z / _i - #_')
  })

  it('reports mistakes and leaves escaped question marks alone', () => {
    const many = parseRuleText('a?b?c > x / _#')
    expect(many.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    const emptyElse = parseRuleText('a? > x / _#')
    expect(emptyElse.diagnostics.some((d) => d.severity === 'error')).toBe(true)
    const noEnv = parseRuleText('a > e?o')
    expect(noEnv.diagnostics.some((d) => d.severity === 'warning')).toBe(true)
    expect(run('\\? > ⸮', 'ka?')).toBe('ka⸮')
    expect(firstRule('\\? > ⸮').branches).toBeUndefined()
    // 替换里单独一个 \?、或者没写环境（文字映射那样）时，仍是问号本身
    expect(run('q > \\? / _#', 'aq')).toBe('a?')
    expect(run('q > \\?2', 'aq')).toBe('a?2')
  })
})

describe('several exceptions', () => {
  it('skips a match inside any of the exception environments', () => {
    const rules = 'V=aeiou\np > b / V_V - a_a , o_o'
    expect(words(rules, 'apa opo epe')).toBe('apa opo ebe')
    const r = firstRule(rules)
    expect(r.exceptions).toHaveLength(2)
    expect(formatRule({ ...r, comment: '' })).toBe('p > b / V_V - a_a , o_o')
  })
})
