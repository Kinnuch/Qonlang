import { describe, expect, it } from 'vitest'
import { parseRuleText, type ParsedRule, type RuleProgram } from '$lib/engine/sca/parse'
import { changedRuleResult, runRules, runSingleRule } from '$lib/engine/sca/apply'

const enabled = { caseInsensitive: true }
const run = (text: string, word: string): string =>
  runRules(parseRuleText(text), word, enabled).output
const ruleOf = (program: RuleProgram): ParsedRule =>
  program.steps.find((step) => step.kind === 'rule') as ParsedRule

describe('optional case-insensitive orthography matching', () => {
  it('does not miss literal fast paths or lowercase explicit output and unmatched text', () => {
    const program = parseRuleText('th > X')
    expect(runRules(program, 'THA').output).toBe('THA')
    expect(runRules(program, 'THA', enabled).output).toBe('XA')
    expect(runRules(program, 'THA').output).toBe('THA')
    expect(ruleOf(program).compiled[0].main.ignoreCase).toBe(false)
  })
  it('matches contexts and exclusions in the same mode', () => {
    expect(run('b > X / a_a', 'ABA')).toBe('AXA')
    expect(run('b > X / _a - #_', 'BaBa')).toBe('BaXa')
    expect(runRules(parseRuleText('b > X / _a - #_'), 'BaBa').output).toBe('BaBa')
    expect(run('b > X?Y / a_', 'B Ab')).toBe('Y AX')
  })
  it('prefers an exact member before a case-insensitive position and supports Unicode case matching', () => {
    const program = parseRuleText('{Src}=a A b\n{Dst}=x Y Z\n{Src} > {Dst}')
    expect(runRules(program, 'aAbB', enabled).output).toBe('xYZZ')
    expect(runRules(program, 'aAbB').output).toBe('xYZB')
    expect(run('{Src}=s t\n{Dst}=X Y\n{Src} > {Dst}', 'ſT')).toBe('XY')
  })
  it('keeps actual same-class and numbered captures instead of lowercasing them', () => {
    expect(run('C=ab\nC > C', 'AbB')).toBe('AbB')
    expect(run('C=ab\nC1 > C1C1', 'A')).toBe('AA')
    expect(run('C=ab\nC1C1 > x', 'Aa')).toBe('x')
    expect(runRules(parseRuleText('C=ab\nC1C1 > x'), 'Aa').output).toBe('Aa')
  })
  it('maps complete temporary members and paired feature segments by the captured position', () => {
    expect(run('[TH ch] > [X.Y]', 'thCH')).toBe('XY')
    expect(run('[+清]=P T K\n[-清]=b d g\n[+清] > [-清] / a_a', 'apa ata aka')).toBe('aba ada aga')
    const rules = '[+一]=P T\n[-一]=b d\n[+二]=K S\n[-二]=g z\n[+一]_[+二] > [-一]_[-二]'
    expect(run(rules, 'pKTs')).toBe('bgdz')
    expect(runRules(parseRuleText(rules), 'pKTs').output).toBe('pKTs')
  })
  it('applies the same option to single-rule previews and changed examples', () => {
    const program = parseRuleText('[TH ch] > [X.Y]'),
      rule = ruleOf(program)
    expect(runSingleRule(program, rule, 'th', enabled)).toBe('X')
    expect(changedRuleResult(program, rule, 'th', enabled)).toBe('X')
    expect(changedRuleResult(program, rule, 'th')).toBeNull()
  })
  it('supports case-insensitive digraph source preprocessing when both parse and run opt in', () => {
    const text = 'th|θ\nTH > Z',
      program = parseRuleText(text, enabled)
    expect(program.lines.map((line) => line.raw).join('\n')).toBe(text)
    expect(runRules(program, 'Th', enabled).output).toBe('Z')
    expect(runSingleRule(program, ruleOf(program), 'Th', enabled)).toBe('Z')
    expect(changedRuleResult(program, ruleOf(program), 'Th', enabled)).toBe('Z')
    expect(runRules(parseRuleText(text), 'Th').output).toBe('Th')
  })
  it('does not case-normalize an explicit replacement or replacement-class surface', () => {
    expect(runRules(parseRuleText('th|θ\nTH > TH', enabled), 'th', enabled).output).toBe('TH')
    const program = parseRuleText('th|θ\n{Src}=k\n{Dst}=TH,\n{Src} > {Dst}', enabled)
    expect(runRules(program, 'K', enabled).output).toBe('TH')
  })
  it('does not mistake class references or feature names for case-insensitive digraph spelling', () => {
    const program = parseRuleText('c|k\nC=pt\nV=a\nC > Z / V_V', enabled)
    expect(runRules(program, 'aPa', enabled).output).toBe('aZa')
    const numbered = parseRuleText('c|k\nC=pt\nC1 > C1C1', enabled)
    expect(runRules(numbered, 'P', enabled).output).toBe('PP')
    const feature = parseRuleText('c|k\n[+case]=p t\n[+case] > Z', enabled)
    expect(feature.diagnostics).toEqual([])
    expect(runRules(feature, 'P', enabled).output).toBe('Z')
    const literal = parseRuleText('c|k\nC=pt\n\\C > Z', enabled)
    expect(runRules(literal, 'c', enabled).output).toBe('Z')
    expect(runRules(literal, 'P', enabled).output).toBe('P')
    expect(literal.lines[2].raw).toBe('\\C > Z')
    expect(runRules(parseRuleText('c|k\nC=pt\np > \\C', enabled), 'P', enabled).output).toBe('C')
  })
  it('propagates preprocessing into included programs without changing source fields', () => {
    const program = parseRuleText('-@ Other', {
      ...enabled,
      resolveInclude: () => ({ text: 'th|θ\nTH > Z' })
    })
    expect(program.diagnostics).toEqual([])
    expect(runRules(program, 'Th', enabled).output).toBe('Z')
    expect(program.lines[0].raw).toBe('-@ Other')
  })
  it('matches stress conditions, their exclusions and length-aware syllable boundaries', () => {
    const conditional = parseRuleText('V=ae\nC=kt\nˈ = -1 / T_ , 1')
    expect(runRules(conditional, 'kate', enabled).output).toBe('kaˈte')
    expect(runRules(conditional, 'kate').output).toBe('ˈkate')
    const excluded = parseRuleText('V=ae\nC=kt\nˈ = -1 / t_ - T_ , 1')
    expect(runRules(excluded, 'kate', enabled).output).toBe('ˈkate')
    expect(runRules(excluded, 'kate').output).toBe('kaˈte')
    expect(run('V=ae\nC=kt\nT > X / σ_', 'kaTAː')).toBe('kaXAː')
    expect(run('V=ae\nC=kt\nˈ = -1', 'kaTAː')).toBe('kaˈTAː')
  })
  it('keeps distinct classifier caches per mode and survives a worker-style structured clone', () => {
    const program = parseRuleText('V=ae\nC=kt\nT > X / σ_')
    const before = JSON.stringify(program)
    expect(runRules(program, 'kaTAː').output).toBe('kaTAː')
    expect(runRules(program, 'kaTAː', enabled).output).toBe('kaXAː')
    expect(runRules(program, 'kaTAː').output).toBe('kaTAː')
    expect(runRules(structuredClone(program), 'kaTAː', enabled).output).toBe('kaXAː')
    expect(JSON.stringify(program)).toBe(before)
  })
})
