import { describe, it, expect } from 'vitest'
import { segment, syllabify, parseTemplate, stressIndex, renderSyllables, checkWord, generateWords, analyzeWord, nucleusSet } from '$lib/engine/phon'
import { inferFeatures } from '$lib/ipa/features'
import { createLanguage } from '$lib/core/factory'

const V = new Set(['a', 'e', 'i', 'o', 'u'])

describe('segment', () => {
  it('uses longest match against the inventory and attaches combining marks', () => {
    expect(segment('tsatʰa', ['t', 's', 'ts', 'tʰ', 'a'])).toEqual(['ts', 'a', 'tʰ', 'a'])
    expect(segment('ẽk', ['e', 'k'])).toEqual(['ẽ', 'k'])
    expect(segment('xyz', ['a'])).toEqual(['x', 'y', 'z'])
  })
})

describe('syllabify', () => {
  it('maximal onset without restrictions', () => {
    const s = syllabify(['k', 'a', 's', 't', 'r', 'a'], { nuclei: V })
    expect(renderSyllables(s)).toBe('ka.stra')
  })
  it('respects allowed onsets and template limits', () => {
    const s = syllabify(['k', 'a', 's', 't', 'r', 'a'], { nuclei: V, onsets: new Set(['k', 't', 'tr', 's']) })
    expect(renderSyllables(s)).toBe('kas.tra')
    const t = syllabify(['k', 'a', 's', 't', 'r', 'a'], { nuclei: V, maxOnset: 1 })
    expect(renderSyllables(t)).toBe('kast.ra')
  })
  it('merges adjacent nuclei into diphthongs and handles no-nucleus words', () => {
    expect(renderSyllables(syllabify(['k', 'a', 'i', 'n'], { nuclei: V }))).toBe('kain')
    expect(syllabify(['s', 't'], { nuclei: V })).toHaveLength(1)
  })
  it('parses templates', () => {
    expect(parseTemplate('(C)(C)V(C)')).toEqual({ maxOnset: 2, maxCoda: 1 })
    expect(parseTemplate('CV')).toEqual({ maxOnset: 1, maxCoda: 0 })
    expect(parseTemplate('(C){V}(C)(C)')).toEqual({ maxOnset: 1, maxCoda: 2 })
  })
})

describe('stress', () => {
  const s = syllabify(['k', 'a', 't', 'a', 'l', 'i', 'n', 'a'], { nuclei: V })
  it('fixed positions', () => {
    expect(stressIndex(s, 'initial')).toBe(0)
    expect(stressIndex(s, 'final')).toBe(3)
    expect(stressIndex(s, 'penult')).toBe(2)
    expect(stressIndex(s, 'antepenult')).toBe(1)
    expect(renderSyllables(s, 2)).toBe('ka.ta.ˈli.na')
  })
  it('weight-sensitive: heavy penult else antepenult', () => {
    const heavy = syllabify(['k', 'a', 'l', 'i', 'n', 't', 'a'], { nuclei: V, maxOnset: 1 })
    expect(stressIndex(heavy, 'weight')).toBe(1)
    expect(stressIndex(s, 'weight')).toBe(1)
  })
})

describe('phonotactics', () => {
  const pt = { onsets: ['k', 't', 's'], nuclei: ['a', 'i'], codas: ['n'], illegal: ['tt'], weights: {}, minSyllables: 1, maxSyllables: 2 }
  it('reports violations', () => {
    const segs = ['k', 'a', 'r', 'a', 'n']
    const syl = syllabify(segs, { nuclei: new Set(['a', 'i']) })
    expect(checkWord(segs, syl, pt).map((v) => v.kind)).toEqual(['onset'])
    expect(checkWord(['t', 't', 'a'], syllabify(['t', 't', 'a'], { nuclei: new Set(['a']) }), pt).map((v) => v.kind)).toContain('illegal')
    expect(checkWord(['k', 'a', 'k', 'a', 'k', 'a'], syllabify(['k', 'a', 'k', 'a', 'k', 'a'], { nuclei: new Set(['a']) }), pt).map((v) => v.kind)).toContain('syllables')
  })
  it('generates words within the constraints, deterministically for a seed', () => {
    const a = generateWords(pt, { count: 10, seed: 42 })
    const b = generateWords(pt, { count: 10, seed: 42 })
    expect(a).toEqual(b)
    expect(a).toHaveLength(10)
    for (const w of a) {
      expect(w.includes('tt')).toBe(false)
      expect(/^[ktsain]+$/.test(w)).toBe(true)
    }
    expect(generateWords(pt, { count: 5, seed: 1, exclude: new Set(a) }).some((w) => a.includes(w))).toBe(false)
  })
})

describe('language-level analysis', () => {
  it('infers default features from the IPA charts', () => {
    expect(inferFeatures('b')).toMatchObject({ type: 'consonant', voice: 'voiced', place: 'bilabial', manner: 'plosive' })
    expect(inferFeatures('y')).toMatchObject({ type: 'vowel', height: 'close', backness: 'front', round: 'yes' })
    expect(inferFeatures('tʰ')).toMatchObject({ manner: 'plosive', aspirated: 'yes' })
    expect(inferFeatures('ẽ')).toMatchObject({ type: 'vowel', nasal: 'yes' })
  })
  it('analyzeWord uses the language inventory, template and stress setting', () => {
    const L = createLanguage({ name: 'x' })
    L.phonemes = 'k t s a i ts'.split(' ').map((s) => ({ id: s, symbol: s, features: inferFeatures(s), graphemes: {}, notes: '' }))
    L.syllable = { enabled: true, template: '(C)V(C)', strategy: 'template' }
    L.prosody = { type: 'stress', stressPosition: 'penult', rules: '', tones: [] }
    expect([...nucleusSet(L)]).toEqual(['a', 'i'])
    expect(analyzeWord(L, 'tsakita').text).toBe('tsa.ki.ˈta'.replace('ˈta', 'ta').replace('ki', 'ˈki'))
    expect(analyzeWord(L, 'tsakita').segments).toEqual(['ts', 'a', 'k', 'i', 't', 'a'])
  })
})
