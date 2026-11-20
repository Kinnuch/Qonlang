import { describe, expect, it } from 'vitest'
import { createLexeme, createLanguage, createOrthography, createScript } from '$lib/core/factory'
import { parseRuleText, type ParsedRule } from '$lib/engine/sca/parse'
import { ExampleWordIndex, firstChangedExample } from '$lib/engine/sca/lexiconSample'
import { scriptSourceText } from '$lib/script/render'
import { preparePhonemeMapping, syncPhonemeRules } from '$lib/core/phonemeSpelling'
import { ipaUnits, orthoProgram, runOrthography } from '$lib/core/pronounce'
import { changedRuleResult, mapRuleWords, runSingleRule, sampleForRule } from '$lib/engine/sca'

describe('word candidates for a selected sound rule', () => {
  it('uses spelling or the selected orthography’s stored IPA for directional rules', () => {
    const entry = createLexeme('L', 'word')
    entry.pronunciations.first = { ipa: 'tʃa', irregular: true }
    entry.pronunciations.second = { ipa: 'ʃa', irregular: true }
    const entries = [entry, createLexeme('other', 'foreign')]
    const candidates = (index: ExampleWordIndex) => index.batch(0).words.map((item) => item.word)
    expect(candidates(new ExampleWordIndex(entries, 'L', 'spelling'))).toEqual(['word'])
    expect(candidates(new ExampleWordIndex(entries, 'L', 'ipa', 'second'))).toEqual(['ʃa'])
    expect(candidates(new ExampleWordIndex(entries, 'L', 'ipa', 'unknown'))).toEqual([])
    expect(candidates(new ExampleWordIndex(entries, 'L'))).toEqual(['word', 'tʃa', 'ʃa'])
  })

  it('finds a changing stored pronunciation in the selected language, even at the end', () => {
    const bad = createLexeme('other', 'sata'),
      filler = createLexeme('active', 'ana')
    const entry = createLexeme('active', 'atha')
    entry.pronunciations.main = { ipa: 'asa', irregular: true }
    const index = new ExampleWordIndex([bad, ...Array(500).fill(filler), entry], 'active')
    const program = parseRuleText('s > z / a_a')
    const rule = program.steps[0] as ParsedRule
    let at = 0
    for (;;) {
      const batch = index.batch(at)
      const hit = firstChangedExample(program, rule, batch.words)
      if (hit) {
        expect(hit).toEqual({ sample: 'asa', after: 'aza', lemma: 'atha' })
        break
      }
      expect(batch.done).toBe(false)
      at += batch.words.length
    }
    expect(index.batch(0).words.map((w) => w.word)).toEqual(['ana', 'atha', 'asa'])
  })

  it('does not read the rest of a large dictionary to show an early match or recheck cached candidates', () => {
    const source = Array.from({ length: 2000 }, (_, i) => createLexeme('L', 'a' + i))
    let reads = 0
    const indexed = new Proxy(source, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver)
      }
    })
    const index = new ExampleWordIndex(indexed, 'L', 'spelling')
    const batch = index.batch(0)
    expect(batch.done).toBe(false)
    expect(reads).toBeGreaterThan(0)
    expect(reads).toBeLessThanOrEqual(96)
    const program = parseRuleText('a > b')
    expect(firstChangedExample(program, program.steps[0] as ParsedRule, batch.words)?.sample).toBe(
      'a0'
    )
    // 已索引的词可以被另一条规则复用。
    while (index.batch(0).words.length < 96) {
      /* 填满第一批 */
    }
    const firstReads = reads
    expect(index.batch(0).words.length).toBe(96)
    expect(reads).toBe(firstReads)
  })
  it('script candidates read exactly the configured actual field, including blank fallback', () => {
    const entry = createLexeme('L', 'cat'),
      script = createScript('QA')
    entry.pronunciations.first = { ipa: 'kat', irregular: true }
    entry.pronunciations.second = { ipa: 'sat', irregular: true }
    entry.stems.root = 'tat'
    entry.forms.NOM = { surface: 'pat', derived: false }
    entry.custom = { code: 'mat' }
    const candidates = (from: string) => {
      script.from = from
      return new ExampleWordIndex([entry], 'L', 'both', undefined, (word) =>
        scriptSourceText(script, word)
      )
        .batch(0)
        .words.map((word) => word.word)
    }
    for (const [from, want] of [
      ['lemma', 'cat'],
      ['pron:first', 'kat'],
      ['pron:second', 'sat'],
      ['stem:root', 'tat'],
      ['form:NOM', 'pat'],
      ['custom:code', 'mat'],
      ['custom:empty', 'cat'],
      ['pron:unknown', 'cat']
    ])
      expect(candidates(from)).toEqual([want])
    entry.custom.code = '   '
    expect(candidates('custom:code')).toEqual(['cat'])
  })
  it('a new script-source index cannot reuse the cached preview of the previous source', () => {
    const entry = createLexeme('L', 'cat'),
      script = createScript('QA'),
      program = parseRuleText('k > K'),
      rule = program.steps[0] as ParsedRule
    entry.pronunciations.main = { ipa: 'kat', irregular: true }
    script.from = 'pron:main'
    const previous = new ExampleWordIndex([entry], 'L', 'both', undefined, (word) =>
      scriptSourceText(script, word)
    )
    const found = firstChangedExample(program, rule, previous.batch(0).words)!
    previous.results.set(rule, found)
    script.from = 'lemma'
    const current = new ExampleWordIndex([entry], 'L', 'both', undefined, (word) =>
      scriptSourceText(script, word)
    )
    expect(current.results.get(rule)).toBeUndefined()
    expect(firstChangedExample(program, rule, current.batch(0).words)).toBeNull()
  })
  it('the custom source callback is lazy and stays within the existing finite batch', () => {
    const entries = Array.from({ length: 1000 }, (_, i) => createLexeme('L', 'a' + i))
    let reads = 0
    const index = new ExampleWordIndex(entries, 'L', 'both', undefined, (entry) => {
      reads++
      return entry.lemma
    })
    expect(reads).toBe(0)
    index.batch(0)
    expect(reads).toBeGreaterThan(0)
    expect(reads).toBeLessThanOrEqual(96)
  })
  it('orthography previews apply the prepared base table before advanced rules in both directions', () => {
    const lang = createLanguage({ name: 'QA' }),
      ortho = lang.orthographies[0],
      second = createOrthography('Second'),
      entry = createLexeme(lang.id, 'tha')
    lang.orthographies.push(second)
    lang.phonemes = [
      { id: 'theta', symbol: 'θ', features: {}, graphemes: { [ortho.id]: 'th' }, notes: '' }
    ]
    syncPhonemeRules(lang, ortho, { initialize: true, activateAll: true })
    ortho.rulesToIpa = 'θ > f'
    ortho.rulesFromIpa = 'th > t'
    entry.pronunciations[ortho.id] = { ipa: 'θa', irregular: true }
    entry.pronunciations[second.id] = { ipa: 'za', irregular: true }
    for (const direction of ['toIpa', 'fromIpa'] as const) {
      const convert = preparePhonemeMapping(ortho, direction)
      const index = new ExampleWordIndex([entry], lang.id, 'both', undefined, (word) =>
        mapRuleWords(
          direction === 'toIpa' ? word.lemma : (word.pronunciations[ortho.id]?.ipa ?? ''),
          convert
        )
      )
      const program = orthoProgram(lang, ortho, direction)!,
        rule = program.steps[0] as ParsedRule
      const options = direction === 'toIpa' ? { keepUnits: ipaUnits(lang) } : {}
      const sample = firstChangedExample(program, rule, index.batch(0).words, options)!
      expect(sample).toEqual({
        sample: direction === 'toIpa' ? 'θa' : 'tha',
        after: direction === 'toIpa' ? 'fa' : 'ta',
        lemma: 'tha'
      })
      expect(sample.after).toBe(
        runOrthography(lang, ortho, direction, direction === 'toIpa' ? entry.lemma : 'θa').output
      )
    }
  })
  it('single-rule output options preserve IPA units and literal dots, without changing defaults', () => {
    const program = parseRuleText('th|θ\na > e'),
      rule = program.steps[0] as ParsedRule
    expect(runSingleRule(program, rule, 'θa')).toBe('the')
    expect(changedRuleResult(program, rule, 'θa', { keepUnits: ['θ'] })).toBe('θe')
    const dotProgram = parseRuleText('\\. > q'),
      dotRule = dotProgram.steps[0] as ParsedRule
    expect(changedRuleResult(dotProgram, dotRule, '.')).toBeNull()
    expect(changedRuleResult(dotProgram, dotRule, '.', { keepDots: true })).toBe('q')
    expect(
      sampleForRule(dotProgram, dotRule, { runOptions: { keepDots: true }, random: () => 0 })
    ).toBe('.')
  })
})
