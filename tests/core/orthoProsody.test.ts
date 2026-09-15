import { describe, it, expect } from 'vitest'
import { createLanguage, createLexeme, createProject, newId } from '$lib/core/factory'
import { inferFeatures } from '$lib/ipa/features'
import type { Language, Paradigm } from '$lib/core/model'
import { analyzeWord, spellingUnits, tokenizeWord } from '$lib/engine/phon'
import {
  customStressProgram,
  ipaUnits,
  spellToIpa,
  stressWord,
  transcribe
} from '$lib/core/pronounce'
import { generateForm, makeContext, paradigmSlots } from '$lib/engine/morph'

/** 随手编的小语言：θ 写作 th，ɛʊ̯ 写作 eu，ts 是一个音 */
function lang(): Language {
  const L = createLanguage({ name: 'x' })
  const o = L.orthographies[0]
  const ph = (symbol: string, spelled: string) => ({
    id: newId(),
    symbol,
    features: inferFeatures(symbol),
    graphemes: { [o.id]: spelled },
    notes: ''
  })
  L.phonemes = [
    ph('k', 'c'),
    ph('t', 't'),
    ph('θ', 'th'),
    ph('r', 'r'),
    ph('n', 'n'),
    ph('ts', 'ts'),
    ph('a', 'a'),
    ph('e', 'e'),
    ph('i', 'i'),
    ph('ɛʊ̯', 'eu')
  ]
  L.phonemes[L.phonemes.length - 1].features = { type: 'vowel', syllabic: 'yes' }
  L.digraphs = [
    { from: 'th', to: 'θ' },
    { from: 'ts', to: 'ʦ' }
  ]
  L.syllable = { enabled: true, template: '', strategy: 'maximal-onset' }
  L.prosody = { type: 'stress', stressPosition: 'penult', rules: '', tones: [] }
  o.rulesToIpa = 'c > k\neu > ɛʊ̯'
  return L
}

describe('正字法转音标', () => {
  it('多合字母的内部符号是音标的留着，占位的换回写法', () => {
    const L = lang()
    expect(ipaUnits(L)).toEqual(['θ'])
    expect(transcribe(L, L.orthographies[0], 'ce·theurin')).toBe('ke·θɛʊ̯rin')
    expect(transcribe(L, L.orthographies[0], 'tsatha')).toBe('tsaθa')
  })
  it('没写规则时按各音位的写法换', () => {
    const L = lang()
    L.orthographies[0].rulesToIpa = ''
    expect(spellToIpa(L, L.orthographies[0], 'Theurin')).toBe('θɛʊ̯rin')
  })
})

describe('音节与韵律按正字法', () => {
  it('th 不再被切成 t、h；分隔符两边各自划音节', () => {
    const L = lang()
    const ipa = transcribe(L, L.orthographies[0], 'ce·theurian') ?? ''
    expect(analyzeWord(L, ipa).text).toBe('ke·ˈθɛʊ̯.rian')
  })
  it('音标里已经带的重音记号优先', () => {
    const L = lang()
    expect(analyzeWord(L, 'ˈkatana').text).toBe('ˈka.ta.na')
    expect(analyzeWord(L, 'ˌka·taˈna').text).toBe('ˌka·ta.ˈna')
    expect(analyzeWord(L, 'ˌka·taˈna').stress).toBe(2)
  })
  it('自定义重音规则', () => {
    const L = lang()
    L.prosody.stressPosition = 'custom'
    L.prosody.stressRule = '(2) -1 ɛʊ̯ , 1 | · -1'
    expect(customStressProgram(L)?.diagnostics).toEqual([])
    expect(stressWord(L, 'kaθɛʊ̯')).toBe('kaˈθɛʊ̯')
    expect(stressWord(L, 'ka·tana')).toBe('ˌka·ˈtana')
    expect(analyzeWord(L, stressWord(L, 'ka·tana')).text).toBe('ˌka·ˈta.na')
    // 已经带重音的不动
    expect(stressWord(L, 'kaˈtana')).toBe('kaˈtana')
  })
  it('切词：修饰字母附着在前一个音上，标点不算音', () => {
    const toks = tokenizeWord("ˈkaːn'ta·ro", new Set(['a']))
    expect(toks.map((t) => `${t.kind}:${t.text}`)).toEqual([
      'mark:ˈ',
      'seg:k',
      'seg:aː',
      'seg:n',
      "skip:'",
      'seg:t',
      'seg:a',
      'sep:·',
      'seg:r',
      'seg:o'
    ])
  })
})

describe('构形按拼写单位数音', () => {
  it('中缀、重叠、模板里 th、eu 算一个音', () => {
    const L = lang()
    const { units, isVowel } = spellingUnits(L)
    expect(units).toContain('th')
    expect(isVowel('eu')).toBe(true)
    const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
    p.languages = [L]
    p.categories.push({
      id: 'num',
      name: { zh: '数' },
      values: [
        { id: 'sg', name: { zh: '单数' }, abbr: 'SG' },
        { id: 'pl', name: { zh: '复数' }, abbr: 'PL' }
      ]
    })
    const para: Paradigm = {
      id: 'r',
      name: {},
      dimensionIds: ['num'],
      disabledSlots: [],
      generators: {
        sg: { kind: 'reduplication', stem: '', scope: 'initial', length: 2 },
        pl: { kind: 'affix', stem: '', prefix: '', suffix: '', infix: 'um', infixAt: 'C1' }
      },
      inheritsFrom: null
    }
    p.paradigms.push(para)
    const ctx = makeContext(p, L)
    const w = createLexeme(L.id, 'theurin')
    const slots = paradigmSlots(para, p.categories, ['zh'])
    expect(generateForm(ctx, w, para, slots[0])?.surface).toBe('theutheurin')
    expect(generateForm(ctx, w, para, slots[1])?.surface).toBe('thumeurin')
  })
})
