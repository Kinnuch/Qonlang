import { describe, expect, it } from 'vitest'
import { createLanguage, createScript, newId } from '$lib/core/factory'
import { languageParseOptions } from '$lib/engine/phon'
import { parseRuleText } from '$lib/engine/sca/parse'
import { runRules } from '$lib/engine/sca/apply'
import { inferFeatures } from '$lib/ipa/features'
import { renderScript } from '$lib/script/render'

function language(symbol: 'g' | 'ɡ' = 'ɡ') {
  const lang = createLanguage({ name: 'Test' })
  lang.phonemes = ['p', symbol, 'a'].map((letter) => ({
    id: newId(),
    symbol: letter,
    features: inferFeatures(letter),
    graphemes: {},
    notes: ''
  }))
  for (const [name, type] of [
    ['C', 'consonant'],
    ['V', 'vowel']
  ]) {
    const members = lang.phonemes.filter((p) => p.features.type === type).map((p) => p.symbol)
    lang.classes.push({ id: newId(), name, members, featureQuery: { type } })
  }
  return lang
}

function apply(rule: string, words: string[], lang = language()): string[] {
  const program = parseRuleText(rule, languageParseOptions(lang))
  expect(program.diagnostics).toEqual([])
  return words.map((word) => runRules(program, word).output)
}

describe('keyboard g in IPA-derived sound classes', () => {
  it.each(['C', '{C}'])(
    'recognises either spelling in %s without changing the stored members',
    (cls) => {
      const lang = language()
      expect(apply(`${cls} > / _#`, ['ag', 'aɡ', 'ga', 'ɡa', 'gɡ', 'ɡg'], lang)).toEqual([
        'a',
        'a',
        'ga',
        'ɡa',
        'g',
        'ɡ'
      ])
      expect(lang.classes[0].members).toEqual(['p', 'ɡ'])
      expect(lang.phonemes.map((p) => p.symbol)).toEqual(['p', 'ɡ', 'a'])
    }
  )

  it('matches named classes in either environment and uses the original replacement position', () => {
    const lang = language()
    lang.classes[0].name = 'Consonant'
    expect(apply('a > o / {Consonant}_{Consonant}', ['gag', 'ɡaɡ', 'apa'], lang)).toEqual([
      'gog',
      'ɡoɡ',
      'apa'
    ])
    expect(apply('{Consonant} > [bt]', ['p', 'g', 'ɡ'], lang)).toEqual(['b', 't', 't'])
  })

  it('matches literal spellings equally while preserving explicit outputs and actual captures', () => {
    expect(apply('ɡ > t', ['g', 'ɡ'])).toEqual(['t', 't'])
    expect(apply('[g] > t', ['g', 'ɡ'])).toEqual(['t', 't'])
    expect(apply('C > C', ['g', 'ɡ'])).toEqual(['g', 'ɡ'])
    expect(apply('C > [pɡ]', ['g', 'ɡ'])).toEqual(['ɡ', 'ɡ'])
    expect(apply('C1 > C1C1', ['g', 'ɡ'])).toEqual(['gg', 'ɡɡ'])
    expect(apply('C1C1 > t', ['gg', 'ɡɡ', 'gɡ', 'ɡg'])).toEqual(['t', 't', 't', 't'])
    expect(apply('[gɡ] > [bt]', ['g', 'ɡ'])).toEqual(['b', 'b'])
  })

  it('recognises both glyphs in source classes, manual classes and inventories containing both', () => {
    expect(apply('C=pɡ\nC > t', ['g', 'ɡ'])).toEqual(['t', 't'])
    expect(apply('g|x\nC > t', ['g', 'ɡ'])).toEqual(['t', 't'])
    const lang = language()
    lang.classes[0].featureQuery = null
    expect(apply('C > t', ['g', 'ɡ'], lang)).toEqual(['t', 't'])
    const distinct = language()
    distinct.phonemes.push({ ...distinct.phonemes[1], id: newId(), symbol: 'g' })
    expect(apply('C > t', ['g', 'ɡ'], distinct)).toEqual(['t', 't'])
    expect(apply('C=gɡp\nC > [btd]', ['g', 'ɡ', 'p'], distinct)).toEqual(['b', 'b', 'd'])
  })

  it('also recognises IPA ɡ when the generated class uses keyboard g', () => {
    expect(apply('C > / _#', ['ag', 'aɡ'], language('g'))).toEqual(['a', 'a'])
  })

  it('keeps equivalence after switching to manual membership and invalidates changed members', () => {
    const lang = language()
    const script = createScript('Test script')
    script.rules = 'C > t'
    expect(renderScript(lang, script, 'gɡ')).toBe('tt')
    lang.classes[0].featureQuery = null
    expect(renderScript(lang, script, 'gɡ')).toBe('tt')
    lang.classes[0].members = ['p']
    expect(renderScript(lang, script, 'gɡ')).toBe('gɡ')
  })
})
