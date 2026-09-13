import { describe, it, expect } from 'vitest'
import { createLanguage, newId } from '$lib/core/factory'
import { inferFeatures } from '$lib/ipa/features'
import { nucleusSet, segment, syllabify } from '$lib/engine/phon'
import { generateNaturalWords, MIN_LEXICON, type LexiconWord } from '$lib/engine/phon/wordgen'

function language() {
  const L = createLanguage({ name: 'T' })
  L.phonemes = 'p t k m n s l a i u'.split(' ').map((s) => ({
    id: newId(),
    symbol: s,
    features: inferFeatures(s),
    graphemes: {},
    notes: ''
  }))
  L.phonotactics = {
    onsets: ['p', 't', 'k', 'm', 'n', 's', 'l'],
    nuclei: ['a', 'i', 'u'],
    codas: ['n', 's'],
    illegal: [],
    weights: {},
    minSyllables: 1,
    maxSyllables: 3
  }
  return L
}

/** 一个很有规律的小词库：两个音节，词首是 k / t，第二个音节是响音开头，只有词尾可能带 n */
function lexicon(): LexiconWord[] {
  const firsts = ['ka', 'ta', 'ku', 'ti', 'ki', 'tu']
  const seconds = ['la', 'na', 'ma', 'lu', 'nu', 'si', 'li']
  const out: LexiconWord[] = []
  for (let i = 0; i < 42; i++) {
    const w = firsts[i % 6] + seconds[i % 7] + (i % 3 === 0 ? 'n' : '')
    out.push({ ipa: w, label: w })
  }
  return out
}

describe('word generator that learns from the lexicon', () => {
  it('follows the shape of existing words without copying them', () => {
    const L = language()
    const lex = lexicon()
    const opts = { count: 30, minSyllables: 1, maxSyllables: 3, lexicon: lex, seed: 7 }
    const out = generateNaturalWords(L, opts)
    expect(out).toHaveLength(30)
    expect(generateNaturalWords(L, opts)).toEqual(out)
    const known = new Set(lex.map((w) => w.ipa))
    const inv = L.phonemes.map((p) => p.symbol)
    const parse = (w: string) =>
      syllabify(segment(w, inv), { nuclei: nucleusSet(L), onsets: new Set(L.phonotactics.onsets) })
    let startsKT = 0
    let twoSyl = 0
    let innerCoda = 0
    for (const g of out) {
      expect(known.has(g.ipa)).toBe(false)
      expect(/^[ptkmnslaiu]+$/.test(g.ipa)).toBe(true)
      expect(g.like.length).toBeGreaterThan(0)
      const sylls = parse(g.ipa)
      if (/^[kt]/.test(g.ipa)) startsKT++
      if (sylls.length === 2) twoSyl++
      if (sylls.slice(0, -1).some((s) => s.coda.length)) innerCoda++
    }
    expect(startsKT / out.length).toBeGreaterThanOrEqual(0.6)
    expect(twoSyl / out.length).toBeGreaterThanOrEqual(0.6)
    expect(innerCoda / out.length).toBeLessThanOrEqual(0.15)
  })

  it('without enough words it still follows the phonotactics', () => {
    const L = language()
    const few = lexicon().slice(0, MIN_LEXICON - 1)
    const out = generateNaturalWords(L, {
      count: 20,
      minSyllables: 1,
      maxSyllables: 3,
      lexicon: few,
      exclude: new Set(['ka']),
      seed: 3
    })
    expect(out).toHaveLength(20)
    for (const g of out) {
      expect(/^[ptkmnslaiu]+$/.test(g.ipa)).toBe(true)
      expect(g.ipa).not.toBe('ka')
      expect(g.like).toEqual([])
      expect(/(.)\1\1/.test(g.ipa)).toBe(false)
    }
  })

  it('returns nothing when there is no nucleus to build with', () => {
    const L = language()
    L.phonotactics.nuclei = []
    expect(
      generateNaturalWords(L, { count: 5, minSyllables: 1, maxSyllables: 2, lexicon: [], seed: 1 })
    ).toEqual([])
  })
})
