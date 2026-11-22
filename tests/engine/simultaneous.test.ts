import { describe, expect, it } from 'vitest'
import {
  changedRuleResult,
  formatSimultaneousStart,
  parseRuleText,
  runRules,
  runRulesOnText,
  runSingleRule,
  type ParsedRule
} from '$lib/engine/sca'
import {
  firstChangedExample,
  sampleProgramForRule,
  syntheticExample
} from '$lib/engine/sca/lexiconSample'

const group = (body: string) => `-( Swap\n${body}\n-)`
const compile = (text: string) => {
  const p = parseRuleText(text)
  expect(p.diagnostics).toEqual([])
  return p
}
describe('explicit simultaneous sound changes', () => {
  it('sends only the selected group and survives separately cloned worker rule identities', () => {
    const p = compile('x > y\n' + group('a > b\nb > a') + '\ny > z')
    const member = p.steps.find(
      (step): step is ParsedRule => step.kind === 'rule' && step.target === 'a'
    )!
    const thin = structuredClone(sampleProgramForRule(p, member))
    const selected = structuredClone(member)
    expect(thin.steps).toHaveLength(2)
    expect(thin.lines).toEqual([])
    const words = [{ word: 'ab', lemma: 'ab' }]
    expect(firstChangedExample(thin, selected, words)).toEqual(
      firstChangedExample(p, member, words)
    )
    expect(firstChangedExample(thin, selected, words)).toEqual({
      sample: 'ab',
      after: 'ba',
      lemma: 'ab'
    })
    const generated = syntheticExample(thin, selected)
    expect(generated.sample).not.toBe('')
    expect(changedRuleResult(p, member, generated.sample)).toBe(generated.after)
  })
  it('composes many non-overlapping matches without scanning all earlier accepted spans', () => {
    const p = compile(group('a > b\nb > a'))
    expect(runRules(p, 'ab'.repeat(10000), { trace: false }).output).toBe('ba'.repeat(10000))
  })
  it('round-trips names containing source punctuation without turning them into rule syntax', () => {
    const name = 'gɡ > x; \\ label'
    const p = compile(formatSimultaneousStart(name) + '\na > b\n-)')
    const marker = p.lines.find((line) => line.kind === 'simultaneous-start')
    expect(marker?.kind === 'simultaneous-start' && marker.group.name).toBe(name)
    expect(runRules(p, 'a').output).toBe('b')
  })
  it('swaps in one pass without text placeholders and keeps ungrouped legacy cascades', () => {
    const p = compile(group('a > b\nb > a'))
    expect(runRules(p, 'abba@0①\uE000').output).toBe('baab@0①\uE000')
    expect(runRules(compile('a > b\nb > a'), 'abba').output).toBe('aaaa')
    expect(runRulesOnText(p, 'ab ba')).toBe('ba ab')
  })
  it('tests all environments against the original group input', () => {
    expect(runRules(compile(group('a > b\nc > d / b_')), 'ac bc').output).toBe('bc bd')
    expect(runRules(compile(group('a > b\nb > c / _a')), 'ba aa').output).toBe('cb bb')
  })
  it('chooses leftmost nonoverlapping spans then source rule order at the same start', () => {
    expect(runRules(compile(group('b > X\nab > Y')), 'ab').output).toBe('Y')
    expect(runRules(compile(group('a > X\nab > Y')), 'ab').output).toBe('Xb')
    expect(runRules(compile(group('ab > Y\na > X')), 'ab').output).toBe('Y')
  })
  it('handles insertion and deletion by original offsets', () => {
    expect(runRules(compile(group('a >\nb > x')), 'abba').output).toBe('xx')
    expect(runRules(compile(group(' > x / #_\na > b')), 'a').output).toBe('xa')
  })
  it('keeps exclusions and if/else branches on the same input', () => {
    expect(runRules(compile(group('a > x / _ - _b\nb > c')), 'ab ac').output).toBe('ac xc')
    expect(runRules(compile(group('a > b?c / #_\nb > a')), 'aba').output).toBe('bac')
  })
  it('keeps feature alignment, numbered captures, digraphs and g glyphs', () => {
    const text = 'V=ae\n[+asp]=ph th\n[-asp]=p t\n' + group('V_[+asp] > Vː_[-asp] / _s\ns > z')
    expect(runRules(compile(text), 'aphs eths').output).toBe('aːpz eːtz')
    expect(runRules(compile('C=g k\n' + group('C1aC1 > C1\nx > y')), 'ɡag g aɡ').output).toBe(
      'ɡ g aɡ'
    )
    expect(runRules(compile('th|θ\n' + group('th > s\ns > th')), 'thsa').output).toBe('stha')
  })
  it('keeps group traces atomic and stopping at a member applies the whole group', () => {
    const p = compile(group('a > b\nb > a') + '\nc > d'),
      result = runRules(p, 'abc')
    expect(result.output).toBe('bad')
    expect(result.trace.slice(0, 2).map((e) => [e.before, e.after, e.simultaneous?.name])).toEqual([
      ['abc', 'bac', 'Swap'],
      ['abc', 'bac', 'Swap']
    ])
    expect(runRules(p, 'abc', { stopAtLine: 2 }).output).toBe('bac')
    const member = p.steps.find((s) => s.kind === 'rule') as ParsedRule
    expect(runSingleRule(p, member, 'ab')).toBe('ba')
    expect(changedRuleResult(p, member, 'ab')).toBe('ba')
  })
  it('reports unmatched, nested, unclosed and forbidden group members without running invalid groups', () => {
    for (const text of [
      '-)',
      '-( Missing\na > b',
      '-( Outer\n-( Inner\na > b\n-)',
      '-( X\na > b\n-* Stage\n-)',
      '-( X\na > b\nˈ = 1\n-)'
    ]) {
      const p = parseRuleText(text)
      expect(
        p.diagnostics.some((d) => d.severity === 'error'),
        text
      ).toBe(true)
      expect(runRules(p, 'a').output, text).toBe('a')
    }
  })
  it('continues through stages and referenced grouped programs with the same semantics', () => {
    const source = '-* In\n' + group('a > b\nb > a') + '\n-* Out'
    const p = compile(source)
    expect(runRules(p, 'ab').stages.map((s) => s.form)).toEqual(['ab', 'ba'])
    const included = parseRuleText('-@ Swap', { resolveInclude: () => ({ text: source }) })
    expect(included.diagnostics).toEqual([])
    expect(runRules(included, 'ab').output).toBe('ba')
  })
  it('supports existing stress and syllable-boundary matching without dropping marks', () => {
    const p = compile('V=ai\nC=pt\nˈ = 1\n' + group('p > b / σ_\nt > d / σ_'))
    expect(runRules(p, 'pata').output).toBe('ˈbada')
  })
  it('is serializable for the example worker and does not mutate source or programs', () => {
    const text = group('a > b\nb > a'),
      p = compile(text),
      before = p.lines.map((l) => l.raw).join('\n')
    expect(runRules(structuredClone(p), 'ab').output).toBe('ba')
    expect(p.lines.map((l) => l.raw).join('\n')).toBe(before)
    expect(before).toBe(text)
  })
})
