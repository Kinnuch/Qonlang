import { describe, expect, it } from 'vitest'
import { createLanguage, createProject } from '$lib/core/factory'
import {
  generationInventory,
  generationLanguage,
  generationLists,
  generationNotation,
  generateCandidates,
  hasLegacyReverse,
  setGenerationNotation
} from '$lib/core/wordGeneration'
import { generateNaturalWords } from '$lib/engine/phon/wordgen'
import { parseProject, serializeProject } from '$lib/core/serialize'
import { inferFeatures } from '$lib/ipa/features'

function fixture() {
  const project = createProject({ name: 'Generation QA', template: 'blank', uiLocale: 'zh' }),
    lang = createLanguage({ name: 'Generation QA' })
  project.languages = [lang]
  const ortho = lang.orthographies[0]
  lang.phonemes = [
    ['ɸ', 'f'],
    ['a', 'a'],
    ['i', 'i'],
    ['l', 'l']
  ].map(([symbol, written], i) => ({
    id: 'p' + i,
    symbol,
    features: inferFeatures(symbol),
    graphemes: { [ortho.id]: written },
    notes: ''
  }))
  lang.phonotactics = {
    onsets: ['ɸ'],
    nuclei: ['a', 'i'],
    codas: ['l'],
    illegal: [],
    weights: {},
    minSyllables: 1,
    maxSyllables: 1
  }
  ortho.rulesToIpa = 'f > ɸ'
  return { project, lang, ortho }
}
const options = { count: 10, minSyllables: 1, maxSyllables: 1, learn: false, seed: 42 }
describe('spelling and IPA generation', () => {
  it('keeps old projects in IPA mode with identical generation and reverse output', () => {
    const { project, lang, ortho } = fixture()
    ortho.rulesFromIpa = 'ɸ > ph'
    expect(generationNotation(lang)).toBe('ipa')
    expect(generationLanguage(lang)).toBe(lang)
    const before = JSON.stringify(lang)
    const expected = generateNaturalWords(lang, {
      ...options,
      lexicon: [],
      exclude: new Set()
    }).map((w) => ({ ipa: w.ipa, spelt: w.ipa.replaceAll('ɸ', 'ph'), like: w.like }))
    expect(generateCandidates(project, lang, options)).toEqual(expected)
    expect(JSON.stringify(lang)).toBe(before)
    expect(hasLegacyReverse(ortho)).toBe(true)
  })
  it('stores two independent lists and generates spellings with forward-derived IPA', () => {
    const { project, lang, ortho } = fixture()
    const old = structuredClone(lang.phonotactics)
    setGenerationNotation(lang, 'spelling')
    Object.assign(generationLists(lang), { onsets: ['f'], nuclei: ['a', 'i'], codas: ['l'] })
    const words = generateCandidates(project, lang, options)
    expect(words.length).toBeGreaterThan(0)
    for (const word of words) {
      expect(word.spelt).not.toBeNull()
      expect(word.spelt).not.toContain('ɸ')
      expect(word.ipa).toBe(word.spelt!.replaceAll('f', 'ɸ'))
    }
    expect(hasLegacyReverse(ortho)).toBe(false)
    expect(lang.phonotactics.onsets).toEqual(old.onsets)
    setGenerationNotation(lang, 'ipa')
    expect(generationLists(lang).onsets).toEqual(['ɸ'])
    setGenerationNotation(lang, 'spelling')
    expect(generationLists(lang).onsets).toEqual(['f'])
    const loaded = parseProject(serializeProject(project)).languages[0]
    expect(generationNotation(loaded)).toBe('spelling')
    expect(generationLists(loaded).onsets).toEqual(['f'])
    expect(loaded.phonotactics.onsets).toEqual(['ɸ'])
  })
  it('fills the active notation from the inventory without inventing reverse rules', () => {
    const { lang, ortho } = fixture()
    expect(generationInventory(lang).onsets).toContain('ɸ')
    setGenerationNotation(lang, 'spelling')
    expect(generationInventory(lang).onsets).toContain('f')
    expect(ortho.rulesFromIpa).toBe('')
  })
  it('returns an explicit absent spelling for IPA output without reverse rules', () => {
    const { project, lang } = fixture()
    const words = generateCandidates(project, lang, options)
    expect(words.length).toBeGreaterThan(0)
    expect(words.every((word) => word.spelt === null)).toBe(true)
  })
})
