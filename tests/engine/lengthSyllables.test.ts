import { describe, expect, it } from 'vitest'
import { createLanguage } from '$lib/core/factory'
import {
  analyzeWord,
  languageParseOptions,
  renderSyllables,
  syllabify,
  syllableNucleusMatch,
  tokenizeWord
} from '$lib/engine/phon'
import { inferFeatures } from '$lib/ipa/features'
import { parseRuleText, runRules } from '$lib/engine/sca'
import { transcribe } from '$lib/core/pronounce'

function language() {
  const lang = createLanguage({ name: 'Length QA' })
  lang.phonemes = [...'ahlur'].map((symbol) => ({
    id: symbol,
    symbol,
    features: inferFeatures(symbol),
    graphemes: {},
    notes: ''
  }))
  lang.syllable = { enabled: true, strategy: 'maximal-onset', template: '' }
  return lang
}

describe('length and diacritics in syllable nuclei', () => {
  it('syllabifies the reported spelling conversion without losing vowel length', () => {
    const lang = language(),
      ortho = lang.orthographies[0]
    ortho.rulesToIpa = 'á > aː\nth > h'
    const before = JSON.stringify(lang),
      ipa = transcribe(lang, ortho, 'áthalur')!
    expect(ipa).toBe('aːhalur')
    expect(analyzeWord(lang, ipa).text).toBe('aː.ha.lur')
    expect(analyzeWord(lang, ipa).segments).toEqual(['aː', 'h', 'a', 'l', 'u', 'r'])
    expect(JSON.stringify(lang)).toBe(before)
  })
  it.each(['ː', 'ˑ'])('retains the exact %s mark while recognizing the base vowel', (mark) => {
    const lang = language(),
      word = `a${mark}halur`
    expect(
      tokenizeWord(word, new Set(lang.phonemes.map((p) => p.symbol)))
        .filter((t) => t.kind === 'seg')
        .map((t) => t.text)
    ).toEqual([`a${mark}`, 'h', 'a', 'l', 'u', 'r'])
    expect(analyzeWord(lang, word).text).toBe(`a${mark}.ha.lur`)
    expect(
      renderSyllables(
        syllabify([`a${mark}`, 'h', 'a', 'l', 'u', 'r'], { nuclei: new Set(['a', 'u']) })
      )
    ).toBe(`a${mark}.ha.lur`)
    expect(inferFeatures(`a${mark}`).type).toBe('vowel')
  })
  it.each(['a\u0303ː', 'aː\u0303', 'áˑ'])('keeps original diacritic codepoints for %s', (vowel) => {
    expect(analyzeWord(language(), vowel + 'halur').text).toBe(vowel + '.ha.lur')
  })
  it('recognizes length on a custom declared vowel rather than guessing from IPA letters', () => {
    const lang = language()
    lang.phonemes[0] = {
      ...lang.phonemes[0],
      symbol: 'Q',
      features: { type: 'vowel', syllabic: 'yes' }
    }
    const input = 'QːhQlur'
    expect(analyzeWord(lang, input).text).toBe('Qː.hQ.lur')
    const program = parseRuleText('h > x / σ_', languageParseOptions(lang))
    expect(runRules(program, input).output).toBe('QːxQlur')
  })
  it('uses the same length-aware boundaries for SCA and places stress before the full first vowel', () => {
    const lang = language(),
      options = languageParseOptions(lang)
    expect(runRules(parseRuleText('h > x / σ_', options), 'aːhalur').output).toBe('aːxalur')
    expect(runRules(parseRuleText('ˈ = 1', options), 'aːhalur').output).toBe('ˈaːhalur')
    expect(runRules(parseRuleText('h > x / σ_', options), 'aˑhalur').output).toBe('aˑxalur')
  })
  it('honors a complete consonant declaration before reducing length or combining marks', () => {
    const lang = language()
    for (const symbol of ['aː', 'a\u0303'])
      lang.phonemes.push({
        id: symbol,
        symbol,
        features: { type: 'consonant', syllabic: 'no' },
        graphemes: {},
        notes: ''
      })
    expect(analyzeWord(lang, 'aːhalur').text).toBe('aːha.lur')
    expect(analyzeWord(lang, 'a\u0303halur').text).toBe('a\u0303ha.lur')
    const program = parseRuleText('h > x / σ_', languageParseOptions(lang))
    expect(runRules(program, 'aːhalur').output).toBe('aːhalur')
    expect(runRules(program, 'a\u0303halur').output).toBe('a\u0303halur')
  })
  it('also respects explicit custom consonant-class members in both syllabifiers', () => {
    const lang = language()
    lang.classes.push({ id: 'custom-c', name: 'C', members: ['a\u0303'], featureQuery: null })
    expect(analyzeWord(lang, 'a\u0303halur').text).toBe('a\u0303ha.lur')
    expect(
      runRules(parseRuleText('h > x / σ_', languageParseOptions(lang)), 'a\u0303halur').output
    ).toBe('a\u0303halur')
  })
  it('keeps longest custom units and explicitly separate length symbols intact', () => {
    const lang = language()
    lang.phonemes.push({
      id: 'custom',
      symbol: 'aːh',
      features: { type: 'consonant' },
      graphemes: {},
      notes: ''
    })
    expect(analyzeWord(lang, 'aːhalur').segments[0]).toBe('aːh')
    expect(analyzeWord(lang, 'aːhalur').text).toBe('aːha.lur')
    expect(tokenizeWord('aːha', new Set(['a', 'ː', 'h'])).map((t) => t.text)).toEqual([
      'a',
      'ː',
      'h',
      'a'
    ])
    expect(syllableNucleusMatch('aː', new Set(['a']), new Set(['aː']))).toBe(false)
  })
  it('does not remove arbitrary modifier letters or collapse internal custom symbols', () => {
    expect(syllableNucleusMatch('Qʰ', new Set(['Q']))).toBeUndefined()
    expect(syllableNucleusMatch('QːR', new Set(['QR']))).toBeUndefined()
    expect(syllableNucleusMatch('ː', new Set(['a']))).toBeUndefined()
    expect(syllableNucleusMatch('n̩', new Set(['n̩']), new Set(['n']))).toBe(true)
    const word = 'ˈaːhalur · aˑhalur-a\u0303halur'
    expect(analyzeWord(language(), word).text).toBe('ˈaː.ha.lur · aˑ.ha.lur-a\u0303.ha.lur')
  })
})
