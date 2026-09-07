import { describe, it, expect } from 'vitest'
import { parseRuleText, runRules, fromLexicanter, fromSca2 } from '$lib/engine/sca'

function run(rules: string, word: string, opts = {}) {
  return runRules(parseRuleText(rules), word, opts).output
}

describe('rule language basics', () => {
  it('simple change with context', () => {
    expect(run('a > e / _i', 'kaim')).toBe('keim')
    expect(run('a > e / _i', 'kama')).toBe('kama')
  })
  it('no context applies everywhere', () => {
    expect(run('k > c', 'kaka')).toBe('caca')
    expect(run('k > c / _', 'kaka')).toBe('caca')
  })
  it('deletion and insertion', () => {
    expect(run('h > / V_V\nV=aeiou', 'aha')).toBe('aa')
    expect(run('> e / #_[nm]C\nC=ptkmn', 'mta')).toBe('emta')
    expect(run('> e / #_[nm]C\nC=ptkmn', 'ata')).toBe('ata')
  })
  it('word boundaries', () => {
    expect(run('s > h / _#', 'sas')).toBe('sah')
    expect(run('s > h / #_', 'sas')).toBe('has')
  })
  it('class to class maps by position', () => {
    expect(run('V=aeiou\nL=āēīōū\nV > L / _#', 'kata')).toBe('katā')
    expect(run('V=aeiou\nL=āēīōū\nL > V / _C\nC=tk', 'kāta')).toBe('kata')
    expect(run('Q=ptk\nZ=bdg\n[bdg] > Q / _', 'gēs')).toBe('kēs')
  })
  it('temporary class in target and context', () => {
    expect(run('[td] > s / _t', 'atta')).toBe('asta')
    expect(run('a > o / _[mn]', 'kan kat')).toBe('kon kat')
  })
  it('optional element and alternation in context', () => {
    // 输入整体视为一个词，# 只匹配串首串尾（与音变姬一致）
    expect(run('i > e / _C(C)a#\nC=ptkr', 'kitra')).toBe('ketra')
    expect(run('i > e / _C(C)a#\nC=ptkr', 'kita')).toBe('keta')
    expect(run('i > e / _C(C)a#\nC=ptkr', 'kiti')).toBe('kiti')
    expect(run('C=ptk\nh > / #|C_', 'hapha')).toBe('apa')
  })
  it('cross-position match', () => {
    expect(run('n > l / #_?m', 'nokam nokat')).toBe('lokam nokat')
  })
  it('metathesis and gemination', () => {
    expect(run('bm > \\ / _', 'abma')).toBe('amba')
    expect(run('t > 2 / V_V\nV=aeiou', 'ata')).toBe('atta')
  })
  it('multiple contexts apply in order', () => {
    expect(run('e > a / _h , h_', 'ehe')).toBe('aha')
  })
  it('exception environment', () => {
    expect(run('p > f / _ - s_', 'papa spa')).toBe('fafa sfa'.replace('sfa', 'spa'))
    expect(run('h > a / #_ - #_V\nV=aeiou', 'hta ha')).toBe('ata ha')
  })
  it('compound boundary is an ordinary symbol', () => {
    expect(run('¢ > / _', 'as¢kes')).toBe('askes')
  })
  it('digraphs are matched as units and restored', () => {
    const rules = 'th|θ\nθ > s / _#'
    expect(run(rules, 'bath')).toBe('bas')
    expect(run('th|θ\nt > d / _h', 'bath')).toBe('bath')
    expect(run('th|θ\nt > d / _h', 'bat.h')).toBe('badh')
  })
  it('long-named classes with multi-character members', () => {
    const rules = '{Stop}=p t k\n{Aff}=pf ts kx\n{Stop} > {Aff} / #_'
    expect(run(rules, 'kata')).toBe('kxata')
    expect(run('{Vlong}=ā ē\nV=ae\n{Vlong} > V / _', 'kātē')).toBe('kate')
  })
  it('comments are ignored', () => {
    expect(run('; comment\n# legacy comment\nk > c ; trailing', 'ka')).toBe('ca')
  })
  it('reports diagnostics for broken lines', () => {
    const p = parseRuleText('a b c\nx > y / a\nQ > z')
    expect(p.diagnostics.map((d) => d.severity)).toEqual(['error', 'error', 'warning'])
    expect(p.steps).toHaveLength(1)
  })
})

describe('stages', () => {
  const rules = ['-* Proto', 'k > c', '-* Middle', 'c > s / _i', '-* Modern'].join('\n')
  it('records a snapshot at every marker', () => {
    const r = runRules(parseRuleText(rules), 'kiki')
    expect(r.stages).toEqual([
      { name: 'Proto', form: 'kiki' },
      { name: 'Middle', form: 'cici' },
      { name: 'Modern', form: 'sisi' }
    ])
    expect(r.output).toBe('sisi')
    expect(r.trace.map((t) => [t.line, t.stage, t.before, t.after])).toEqual([
      [2, 'Proto', 'kiki', 'cici'],
      [4, 'Middle', 'cici', 'sisi']
    ])
  })
  it('stopAt and startAt', () => {
    expect(runRules(parseRuleText(rules), 'kiki', { stopAt: 'Middle' }).output).toBe('cici')
    const r = runRules(parseRuleText(rules), 'cici', { startAt: 'Middle' })
    expect(r.output).toBe('sisi')
    expect(r.stages.map((s) => s.name)).toEqual(['Middle', 'Modern'])
  })
})

describe('importers', () => {
  it('converts Lexicanter rules', () => {
    expect(fromLexicanter('th > θ\n{a,e} > x / ^_\nk > ∅ / _#')).toBe('th > θ\n[ae] > x / #_\nk >  / _#')
  })
  it('converts SCA² rules', () => {
    expect(fromSca2('V=aeiou\ns/z/V_V\na//_#\nx/y/_z/_w')).toBe('V=aeiou\ns > z / V_V\na > / _#\nx > y / _z - _w')
  })
})
