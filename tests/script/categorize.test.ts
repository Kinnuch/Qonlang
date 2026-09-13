/**
 * 字形自动分类按转写值分出元音符号、辅音、音节、标点、数字；看不出来的按字符本身分。
 */
import { describe, it, expect } from 'vitest'
import { createLanguage, createScript } from '$lib/core/factory'
import { glyphCategorizer } from '$lib/script/categorize'
import { inferFeatures } from '$lib/ipa/features'

function setup() {
  const lang = createLanguage({ name: 'T' })
  lang.phonemes = 'p t k s n j a i u aː'
    .split(' ')
    .map((s) => ({ id: s, symbol: s, features: inferFeatures(s), graphemes: {}, notes: '' }))
  const sc = createScript('S')
  lang.scripts.push(sc)
  return { lang, sc }
}

const g = (char: string, value: string) => ({ char, value })

describe('glyphCategorizer', () => {
  it('sorts by the sound of the transcription value', () => {
    const { lang, sc } = setup()
    const cat = glyphCategorizer(lang, sc)
    expect(cat(g('ᚨ', 'a'))).toBe('vowel')
    expect(cat(g('ᚲ', 'k'))).toBe('consonant')
    expect(cat(g('ᚦ', 'th'))).toBe('consonant')
    expect(cat(g('', 'ka'))).toBe('syllable')
    expect(cat(g('', 'ai'))).toBe('vowel')
    expect(cat(g('́', 'aː'))).toBe('vowel')
    expect(cat(g('᛫', '.'))).toBe('punct')
    expect(cat(g('', '?'))).toBe('punct')
    expect(cat(g('', '7'))).toBe('number')
  })

  it('falls back to the character itself without a usable value', () => {
    const { lang, sc } = setup()
    const cat = glyphCategorizer(lang, sc)
    expect(cat(g('ᚠ', ''))).toBe('letter')
    expect(cat(g('́', ''))).toBe('mark')
    expect(cat(g('', ''))).toBe('glyph')
    expect(cat(g('', '˥'))).toBe('glyph')
    expect(cat(g('̀', '˨'))).toBe('mark')
  })

  it('reads the value through the primary orthography', () => {
    const { lang, sc } = setup()
    lang.orthographies[0].rulesToIpa = 'y > j'
    const cat = glyphCategorizer(lang, sc)
    expect(cat(g('ᛃ', 'y'))).toBe('consonant')
    expect(cat(g('ᛃ', 'Y'))).toBe('consonant')
  })

  it('takes the value as sound when the script reads pronunciations, and honours packing vowels', () => {
    const { lang, sc } = setup()
    lang.orthographies[0].rulesToIpa = 'y > j'
    sc.from = `pron:${lang.orthographies[0].id}`
    expect(glyphCategorizer(lang, sc)(g('ᛃ', 'y'))).toBe('vowel')
    sc.from = undefined
    sc.packing = {
      enabled: true,
      killer: '',
      letterMap: '',
      marked: '',
      lengths: '',
      baseVowels: '',
      dummyVowel: '',
      letters: '',
      vowels: 'a i u w'
    } as never
    expect(glyphCategorizer(lang, sc)(g('ᚹ', 'w'))).toBe('vowel')
  })
})
