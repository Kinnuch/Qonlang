import { describe, expect, it } from 'vitest'
import { createLanguage, createProject } from '$lib/core/factory'
import { analyzeWord, languageParseOptions, syllableOnsets } from '$lib/engine/phon'
import { transcribe } from '$lib/core/pronounce'
import { inferFeatures } from '$lib/ipa/features'
import { parseProject, serializeProject } from '$lib/core/serialize'
import { annotate, BOUNDARY, parseRuleText, runRules } from '$lib/engine/sca'

const spellings = ['mecha', 'meha', 'meca', 'mapha', 'mabha', 'madha']
const ipa = ['mexa', 'meha', 'meka', 'mafa', 'mava', 'maða']
const expected = ['me.xa', 'me.ha', 'me.ka', 'ma.fa', 'ma.va', 'ma.ða']
function fixture() {
  const lang = createLanguage({ name: 'Screenshot 7 QA' }),
    ortho = lang.orthographies[0]
  lang.phonemes = ['m', 'e', 'a', 'x', 'h', 'k', 'f', 'v', 'ð', 's', 't', 'r'].map((symbol, i) => ({
    id: 'p' + i,
    symbol,
    features: inferFeatures(symbol),
    graphemes: {},
    notes: ''
  }))
  lang.syllable = { enabled: true, strategy: 'template', template: 'CVC' }
  lang.phonotactics = {
    onsets: ['m', 'f', 'v'],
    nuclei: ['a', 'e'],
    codas: [],
    illegal: [],
    weights: {},
    minSyllables: 1,
    maxSyllables: 3
  }
  ortho.rulesToIpa = 'ch > x\nph > f\nbh > v\ndh > ð\nc > k'
  return { lang, ortho }
}
const scaText = (lang: ReturnType<typeof fixture>['lang'], word: string) => {
  const program = parseRuleText('', languageParseOptions(lang))
  return annotate(word, program).text.replaceAll(BOUNDARY, '.')
}
describe('template syllables with an explicit IPA onset whitelist', () => {
  it('reopens old CVC settings without silently applying an incomplete word-generation table', () => {
    const { lang, ortho } = fixture(),
      before = JSON.stringify(lang)
    expect(spellings.map((w) => transcribe(lang, ortho, w))).toEqual(ipa)
    expect(ipa.map((w) => analyzeWord(lang, w).text)).toEqual(expected)
    expect(syllableOnsets(lang)).toEqual([])
    expect(JSON.stringify(lang)).toBe(before)
    expect(lang.syllable.useOnsetWhitelist).toBeUndefined()
  })
  it('reproduces the screenshot when the same IPA whitelist is explicitly enabled', () => {
    const { lang } = fixture()
    lang.syllable.useOnsetWhitelist = true
    expect(ipa.map((w) => analyzeWord(lang, w).text)).toEqual([
      'mex.a',
      'meh.a',
      'mek.a',
      'ma.fa',
      'ma.va',
      'mað.a'
    ])
    lang.syllable.useOnsetWhitelist = false
    expect(ipa.map((w) => analyzeWord(lang, w).text)).toEqual(expected)
  })
  it('does not treat the separate spelling-mode list as an IPA whitelist', () => {
    const { lang } = fixture()
    lang.syllable.useOnsetWhitelist = true
    lang.phonotactics.notation = 'spelling'
    lang.phonotactics.spelling = {
      ...lang.phonotactics,
      onsets: ['ch', 'h', 'c', 'ph', 'bh', 'dh']
    }
    expect(analyzeWord(lang, 'mexa').text).toBe('mex.a')
    expect(syllableOnsets(lang)).toEqual(['m', 'f', 'v'])
    lang.syllable.useOnsetWhitelist = false
    expect(analyzeWord(lang, 'mexa').text).toBe('me.xa')
  })
  it('keeps the maximal-onset strategy’s old whitelist behavior for either checkbox value', () => {
    const { lang } = fixture()
    lang.syllable.strategy = 'maximal-onset'
    for (const flag of [undefined, false, true]) {
      lang.syllable.useOnsetWhitelist = flag
      expect(analyzeWord(lang, 'mexa').text).toBe('mex.a')
    }
  })
  it('uses the same settings for phonology and SCA syllable boundaries and stress', () => {
    const { lang } = fixture()
    for (const flag of [undefined, false, true]) {
      lang.syllable.useOnsetWhitelist = flag
      for (const word of ipa) expect(scaText(lang, word)).toBe(analyzeWord(lang, word).text)
      const program = parseRuleText('x > z / σ_\nˈ = -1', languageParseOptions(lang))
      expect(runRules(program, 'mexa').output).toBe(flag ? 'mexˈa' : 'meˈza')
    }
  })
  it('retains legal consonant clusters and original length, combining marks, stress and separators', () => {
    const { lang } = fixture()
    expect(analyzeWord(lang, 'kastra').text).toBe('kast.ra')
    lang.syllable.template = 'CCVC'
    expect(analyzeWord(lang, 'kastra').text).toBe('kas.tra')
    for (const [word, division] of [
      ['meːxa', 'meː.xa'],
      ['meˑxa', 'meˑ.xa'],
      ['me\u0303ːxa', 'me\u0303ː.xa'],
      ['ˌmeːˈxa', 'ˌmeː.ˈxa'],
      ['mexa-meha', 'me.xa-me.ha']
    ]) {
      expect(analyzeWord(lang, word).text).toBe(division)
      expect(scaText(lang, word).replaceAll('.-.', '-')).toBe(division)
    }
  })
  it('counts a declared tied affricate as one onset without removing its tie bar', () => {
    const { lang } = fixture()
    lang.phonemes.push({
      id: 'tied',
      symbol: 't͡s',
      features: inferFeatures('t͡s'),
      graphemes: {},
      notes: ''
    })
    expect(analyzeWord(lang, 'mat͡sa').text).toBe('ma.t͡sa')
    expect(scaText(lang, 'mat͡sa')).toBe('ma.t͡sa')
    lang.syllable.useOnsetWhitelist = true
    lang.phonotactics.onsets = ['t͡s']
    expect(analyzeWord(lang, 'mat͡sa').text).toBe('ma.t͡sa')
  })
  it('does not force a forbidden or overlong onset when the template cannot fit both ends', () => {
    const { lang } = fixture()
    expect(analyzeWord(lang, 'kastra').text).toBe('kast.ra')
    lang.syllable.template = 'CV'
    lang.syllable.useOnsetWhitelist = true
    expect(analyzeWord(lang, 'mexa').text).toBe('mex.a')
    expect(scaText(lang, 'mexa')).toBe('mex.a')
    lang.syllable.template = 'CVC'
    lang.phonotactics.onsets = ['tr']
    expect(analyzeWord(lang, 'katra').text).toBe('katr.a')
    expect(scaText(lang, 'katra')).toBe('katr.a')
    lang.syllable.template = 'CCVC'
    expect(analyzeWord(lang, 'katra').text).toBe('ka.tra')
    expect(scaText(lang, 'katra')).toBe('ka.tra')
  })
  it('keeps an empty explicitly selected list unrestricted and preserves the optional setting on save', () => {
    const { lang } = fixture()
    lang.syllable.useOnsetWhitelist = true
    lang.phonotactics.onsets = []
    expect(analyzeWord(lang, 'mexa').text).toBe('me.xa')
    const p = createProject({ name: 'Syllable persistence', template: 'blank', uiLocale: 'zh' })
    p.languages = [lang]
    expect(parseProject(serializeProject(p)).languages[0].syllable.useOnsetWhitelist).toBe(true)
    delete lang.syllable.useOnsetWhitelist
    const loaded = parseProject(serializeProject(p)).languages[0]
    expect(loaded.syllable.useOnsetWhitelist).toBeUndefined()
    expect(analyzeWord(loaded, 'mexa').text).toBe('me.xa')
  })
})
