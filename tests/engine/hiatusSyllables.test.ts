import { describe, expect, it } from 'vitest'
import { createLanguage } from '$lib/core/factory'
import { analyzeWord, languageParseOptions, renderSyllables, syllabify } from '$lib/engine/phon'
import { annotate, BOUNDARY, parseRuleText, runRules } from '$lib/engine/sca'
import { inferFeatures } from '$lib/ipa/features'
import { spellToIpa } from '$lib/core/pronounce'

function fixture() {
  const lang = createLanguage({ name: 'Hiatus QA' })
  lang.phonemes = ['a', 'i', 'u', 't', 'k', 'r'].map((symbol) => ({
    id: symbol,
    symbol,
    features: inferFeatures(symbol),
    graphemes: {},
    notes: ''
  }))
  lang.syllable = { enabled: true, strategy: 'template', template: '(C)(C)V(C)(C)' }
  return lang
}
const sca = (lang: ReturnType<typeof fixture>, word: string) =>
  annotate(word, parseRuleText('', languageParseOptions(lang))).text.replaceAll(BOUNDARY, '.')

describe('相邻独立元音与明确复合音节核', () => {
  it('aa和其他独立相邻元音各成核，不凭相邻猜双元音', () => {
    const lang = fixture()
    expect(analyzeWord(lang, 'aa').text).toBe('a.a')
    expect(analyzeWord(lang, 'aia').text).toBe('a.i.a')
    expect(renderSyllables(syllabify(['k', 'a', 'i', 't'], { nuclei: new Set(['a', 'i']) }))).toBe(
      'ka.it'
    )
    expect(sca(lang, 'aa')).toBe('a.a')
  })
  it('长元音辅音串保持每个元音核和原文本，不凭空造核', () => {
    const lang = fixture(),
      input = 'a'.repeat(32) + 't'.repeat(40) + 'a'.repeat(32),
      result = analyzeWord(lang, input)
    expect(result.syllables).toHaveLength(64)
    expect(result.syllables.every((s) => s.nucleus.length === 1)).toBe(true)
    expect(result.text.replaceAll('.', '')).toBe(input)
    expect(result.syllables[32].onset).toEqual(['t', 't'])
    expect(sca(lang, input)).toBe(result.text)
  })
  it('IPA长音仍是一个音段，连续长音元音各成核', () => {
    const lang = fixture()
    expect(analyzeWord(lang, 'aːaˑ').text).toBe('aː.aˑ')
    expect(analyzeWord(lang, 'ãã').text).toBe('ã.ã')
    expect(sca(lang, 'aːaˑ')).toBe('aː.aˑ')
  })
  it('显式复合元音音位和真正双元音仍按完整单位', () => {
    const lang = fixture()
    lang.phonemes.push({
      id: 'ai',
      symbol: 'ai',
      features: { type: 'vowel', syllabic: 'yes' },
      graphemes: {},
      notes: ''
    })
    expect(analyzeWord(lang, 'aia').text).toBe('ai.a')
    expect(sca(lang, 'aia')).toBe('ai.a')
    lang.phonemes.push({
      id: 'aa',
      symbol: 'aa',
      features: { type: 'vowel', syllabic: 'yes' },
      graphemes: {},
      notes: ''
    })
    expect(analyzeWord(lang, 'aaa').text).toBe('aa.a')
  })
  it('只在配列音节核或V类声明的组合也可显式保留', () => {
    const lang = fixture()
    lang.phonotactics.nuclei = ['ai']
    expect(analyzeWord(lang, 'aia').text).toBe('ai.a')
    expect(sca(lang, 'aia')).toBe('ai.a')
    expect(
      renderSyllables(syllabify(['k', 'a', 'i', 't'], { nuclei: new Set(['a', 'i', 'ai']) }))
    ).toBe('kait')
    lang.phonotactics.nuclei = []
    lang.classes.push({ id: 'v', name: 'V', members: ['a', 'i', 'aa'], featureQuery: null })
    expect(analyzeWord(lang, 'aaa').text).toBe('aa.a')
  })
  it('显式组合按从左至右最长匹配，不能吞掉第三个独立元音', () => {
    const opts = { nuclei: new Set(['a', 'i', 'ai', 'aia']) }
    expect(renderSyllables(syllabify(['a', 'i', 'a', 'i'], opts))).toBe('aia.i')
    expect(renderSyllables(syllabify(['a', 'i', 'a'], { nuclei: new Set(['a', 'i', 'ai']) }))).toBe(
      'ai.a'
    )
  })
  it('拼写转IPA后与直接IPA入口采用相同划分', () => {
    const lang = fixture(),
      ortho = lang.orthographies[0]
    lang.phonemes.find((p) => p.symbol === 'a')!.graphemes[ortho.id] = 'a'
    lang.phonemes.find((p) => p.symbol === 'i')!.graphemes[ortho.id] = 'i'
    const ipa = spellToIpa(lang, ortho, 'aaia')
    expect(analyzeWord(lang, ipa).text).toBe('a.a.i.a')
    expect(analyzeWord(lang, 'aaia').text).toBe(analyzeWord(lang, ipa).text)
  })
  it('SCA重音与σ边界同样区分独立核，明确单位声明仍保留', () => {
    expect(runRules(parseRuleText('V=ai\nˈ = -1'), 'aia').output).toBe('aiˈa')
    expect(runRules(parseRuleText('V=a ai\nˈ = -1'), 'aia').output).toBe('aiˈa')
    expect(runRules(parseRuleText('V=ai\na>x/σ_'), 'aa').output).toBe('xx')
    expect(runRules(parseRuleText('V=ai\n{Long}=aa\nˈ = 1'), 'aa').output).toBe('ˈaa')
  })
  it('旧CVC、介音与起首白名单行为保持', () => {
    const lang = fixture()
    lang.syllable.template = 'CVC'
    expect(analyzeWord(lang, 'katra').text).toBe('kat.ra')
    lang.syllable.template = 'CCVC'
    expect(analyzeWord(lang, 'katra').text).toBe('ka.tra')
    lang.syllable.useOnsetWhitelist = true
    lang.phonotactics.onsets = ['k']
    expect(analyzeWord(lang, 'katra').text).toBe('katr.a')
    lang.syllable.useOnsetWhitelist = false
    lang.phonemes.push({
      id: 'glide',
      symbol: 'i̯',
      features: { type: 'consonant', syllabic: 'no' },
      graphemes: {},
      notes: ''
    })
    expect(analyzeWord(lang, 'ai̯a').text).toBe('a.i̯a')
    lang.phonemes.push({
      id: 'true-diphthong',
      symbol: 'ai̯',
      features: { type: 'vowel', syllabic: 'yes' },
      graphemes: {},
      notes: ''
    })
    expect(analyzeWord(lang, 'ai̯a').text).toBe('ai̯.a')
  })
})
