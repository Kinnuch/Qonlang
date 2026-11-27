import { describe, expect, it } from 'vitest'
import { createLanguage } from '$lib/core/factory'
import {
  analyzeWord,
  checkWord,
  languageParseOptions,
  nucleusSet,
  phonemeKind,
  renderSyllables,
  syllabify
} from '$lib/engine/phon'
import { annotate, BOUNDARY, parseRuleText, runRules } from '$lib/engine/sca'
import { inferFeatures } from '$lib/ipa/features'
import { spellToIpa } from '$lib/core/pronounce'
import { createNucleusMatcher, prepareUnitMatcher } from '$lib/engine/phon/nuclei'

function fixture() {
  const lang = createLanguage({ name: 'Nucleus priority QA' })
  lang.phonemes = ['a', 'i', 'u', 'p', 'l', 'c', 'm', 'ŋ', 'ɲ', 'ɴ'].map((symbol) => ({
    id: symbol,
    symbol,
    features: inferFeatures(symbol),
    graphemes: {},
    notes: ''
  }))
  lang.syllable = { enabled: true, strategy: 'template', template: 'CVC' }
  lang.phonotactics.nuclei = ['a', 'i', 'u']
  lang.classes = [{ id: 'nasals', name: 'N', members: ['m', 'ŋ', 'ɲ', 'ɴ'], featureQuery: null }]
  return lang
}
function sca(lang: ReturnType<typeof fixture>, word: string) {
  return annotate(word, parseRuleText('', languageParseOptions(lang))).text.replaceAll(
    BOUNDARY,
    '.'
  )
}
function run(lang: ReturnType<typeof fixture>, text: string, word: string) {
  return runRules(parseRuleText(text, languageParseOptions(lang)), word).output
}

describe('声明、IPA 与合法核名单的优先级', () => {
  it('匹配索引是本次分析的快照，不修改标准集合行为', () => {
    const input = new Set(['a']),
      prepared = prepareUnitMatcher(input)
    const matcher = createNucleusMatcher(input, new Set(['m']))
    input.add('m')
    expect(input.has('m')).toBe(true)
    expect(prepared.has('m')).toBe(false)
    expect(matcher.isNucleus('m')).toBe(false)
    expect(createNucleusMatcher(input).isNucleus('m')).toBe(true)
  })
  it.each([
    ['áa', 'áa'],
    ['áa', 'áa']
  ])('复合核 %s 的规范等价形式三路一致', (nucleus, word) => {
    const lang = fixture()
    lang.phonotactics.nuclei = [nucleus]
    expect(analyzeWord(lang, word).text).toBe(word)
    expect(sca(lang, word)).toBe(word)
    const result = analyzeWord(lang, word)
    expect(checkWord(result.segments, result.syllables, lang.phonotactics)).toEqual([])
    expect(
      renderSyllables(syllabify([word.slice(0, -1), 'a'], { nuclei: new Set(['a', nucleus]) }))
    ).toBe(word)
  })
  it.each([
    ['puma', 'pu.ma'],
    ['luŋu', 'lu.ŋu'],
    ['ciŋi', 'ci.ŋi'],
    ['paɲa', 'pa.ɲa'],
    ['puɴu', 'pu.ɴu']
  ])('普通鼻音类 N 不把 %s 中的辅音升级成核', (word, expected) => {
    const lang = fixture(),
      before = JSON.stringify(lang)
    expect(nucleusSet(lang)).toEqual(new Set(['a', 'i', 'u']))
    expect(analyzeWord(lang, word).text).toBe(expected)
    expect(sca(lang, word)).toBe(expected)
    expect(JSON.stringify(lang)).toBe(before)
  })
  it('N 仍是普通音类，σ 和重音使用修正后的边界', () => {
    const lang = fixture()
    expect(run(lang, '{N} > n', 'puma')).toBe('puna')
    expect(run(lang, 'N = m ŋ ɲ ɴ\nN > n', 'luŋu')).toBe('lunu')
    expect(run(lang, 'a > e / σ_', 'puma')).toBe('puma')
    expect(run(lang, 'ˈ = -2', 'puma')).toBe('ˈpuma')
    expect(run(lang, 'N = m ŋ ɲ ɴ\nˈ = -2', 'puma')).toBe('ˈpuma')
    lang.prosody = { ...lang.prosody, type: 'stress', stressPosition: 'penult' }
    expect(analyzeWord(lang, 'puma').text).toBe('ˈpu.ma')
  })
  it.each(['V', 'Vowel', '元音', 'Nucleus'])('明确的 %s 核类仍可声明成音节辅音', (name) => {
    const lang = fixture()
    lang.classes.push({ id: name, name, members: ['m'], featureQuery: null })
    expect(analyzeWord(lang, 'puma').text).toBe('pu.m.a')
    expect(sca(lang, 'puma')).toBe('pu.m.a')
  })
  it('合法核里的 m、显式 syllabic 特征与完整核单位仍有效', () => {
    const lang = fixture()
    lang.phonotactics.nuclei.push('m')
    expect(sca(lang, 'puma')).toBe('pu.m.a')
    lang.phonotactics.nuclei = ['a', 'i', 'u']
    lang.phonemes.find((p) => p.symbol === 'm')!.features.syllabic = 'yes'
    expect(analyzeWord(lang, 'puma').text).toBe('pu.m.a')
    expect(sca(lang, 'puma')).toBe('pu.m.a')
  })
  it('合法核是校验名单，不是抹去其它可识别元音的分类白名单', () => {
    const lang = fixture()
    lang.phonotactics.nuclei = ['ai']
    const result = analyzeWord(lang, 'aia')
    expect(result.text).toBe('ai.a')
    expect(sca(lang, 'aia')).toBe(result.text)
    expect(checkWord(result.segments, result.syllables, lang.phonotactics)).toContainEqual({
      kind: 'nucleus',
      detail: 'a'
    })
  })
  it('空表与部分特征采用相同的 IPA 回退，不猜未知自定义符号', () => {
    const lang = fixture()
    lang.phonemes = []
    lang.classes = []
    lang.phonotactics.nuclei = []
    expect(analyzeWord(lang, 'puma').text).toBe('pu.ma')
    expect(sca(lang, 'puma')).toBe('pu.ma')
    expect(analyzeWord(lang, 'QQ').syllables[0].nucleus).toEqual([])
    lang.phonemes = [
      { id: 'a', symbol: 'a', features: { voice: 'voiced' }, graphemes: {}, notes: '' }
    ]
    expect(nucleusSet(lang).has('a')).toBe(true)
    expect(phonemeKind(lang, lang.phonemes[0])).toBe('vowel')
  })
  it('未列完整单位的成音节/不成音节附标不被基础字母分类吞掉', () => {
    const lang = fixture()
    expect(analyzeWord(lang, 'pm̩').syllables[0].nucleus).toEqual(['m̩'])
    expect(run(lang, 'ˈ = 1', 'pm̩')).toBe('ˈpm̩')
    expect(inferFeatures('i̯').syllabic).toBe('no')
    expect(analyzeWord(lang, 'ai̯a').text).toBe('a.i̯a')
    expect(sca(lang, 'ai̯a')).toBe('a.i̯a')
    expect(run(lang, 'ˈ = -2', 'ai̯a')).toBe('ˈai̯a')
    expect(analyzeWord(lang, '\u0329').syllables[0].nucleus).toEqual([])
    expect(run(lang, 'ˈ = 1', '\u0329')).toBe('\u0329')
  })
  it.each([
    ['á', 'áma'],
    ['á', 'áma']
  ])('完整辅音声明 %s 的规范等价写法仍优先', (symbol, word) => {
    const lang = fixture()
    lang.phonemes.push({
      id: 'accented-c',
      symbol,
      features: { type: 'consonant', syllabic: 'no' },
      graphemes: {},
      notes: ''
    })
    expect(analyzeWord(lang, word).text).toBe(word)
    expect(sca(lang, word)).toBe(word)
    expect(analyzeWord(lang, word).syllables.map((s) => s.nucleus.join(''))).toEqual(['a'])
  })
  it('完整自定义声明优先于附标和 IPA 猜测，保留长度与原码位', () => {
    const lang = fixture()
    lang.phonemes.push({
      id: 'custom',
      symbol: 'aː',
      features: { type: 'consonant', syllabic: 'no' },
      graphemes: {},
      notes: ''
    })
    expect(analyzeWord(lang, 'aːpuma').text).toBe('aːpu.ma')
    expect(sca(lang, 'aːpuma')).toBe('aːpu.ma')
    lang.phonotactics.nuclei.push('ai̯', 'Q', 'Ḿ')
    for (const word of ['ai̯a', 'Qˑma', 'Ḿma']) {
      const direct = analyzeWord(lang, word).text
      expect(direct.replaceAll('.', '')).toBe(word)
      expect(sca(lang, word)).toBe(direct)
    }
    expect(analyzeWord(lang, 'ai̯a').text).toBe('ai̯.a')
    expect(analyzeWord(lang, 'Qˑma').text).toBe('Qˑ.ma')
    expect(analyzeWord(lang, 'Ḿma').text).toBe('Ḿ.ma')
  })
  it('拼写转 IPA、低级分音节和音系测试遵循同一核判断', () => {
    const lang = fixture(),
      ortho = lang.orthographies[0]
    ortho.rulesToIpa = 'ng > ŋ'
    const ipa = spellToIpa(lang, ortho, 'lungu')
    expect(ipa).toBe('luŋu')
    expect(analyzeWord(lang, ipa).text).toBe('lu.ŋu')
    expect(sca(lang, ipa)).toBe('lu.ŋu')
    expect(renderSyllables(syllabify(['l', 'u', 'ŋ', 'u'], { nuclei: nucleusSet(lang) }))).toBe(
      'lu.ŋu'
    )
  })
  it('无核词不凭空加普通或词条特殊重音，混合无核段不占重音序号', () => {
    const lang = fixture()
    lang.prosody = { ...lang.prosody, type: 'stress', stressPosition: 'initial' }
    expect(analyzeWord(lang, 'mŋɲɴ').text).toBe('mŋɲɴ')
    expect(run(lang, 'ˈ = 1', 'mŋɲɴ')).toBe('mŋɲɴ')
    const p = parseRuleText('ˈ = @, 1', languageParseOptions(lang))
    expect(p.diagnostics).toEqual([])
    expect(runRules(p, 'mŋɲɴ', { word: { stress: 1 } }).output).toBe('mŋɲɴ')
    expect(analyzeWord(lang, 'hm·puma').text).toBe('hm·ˈpu.ma')
    expect(run(lang, 'ˈ = 1', 'hm·puma')).toBe('hm·ˈpuma')
    expect(runRules(p, 'hm·puma', { word: { stress: 1 } }).output).toBe('hm·ˈpuma')
  })
})
