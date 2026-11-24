import { describe, expect, it } from 'vitest'
import { makeCollator, makeLexiconLetters } from '$lib/core/collate'

describe('lexicon complete-letter groups and reverse dictionary order', () => {
  it('keeps declared alphabet labels and case for the default initial group', () => {
    const letters = makeLexiconLetters(['a', 'Th', 't', 'Ng', 'n', 'g'])
    expect(letters.initial('THara')).toBe('Th')
    expect(letters.initial('nga')).toBe('Ng')
    expect(letters.final('fang')).toBe('Ng')
    expect(letters.final('tha')).toBe('a')
  })
  it('segments once from the left rather than greedily matching a different ending', () => {
    const letters = makeLexiconLetters(['ab', 'bc', 'a', 'b', 'c'])
    expect(letters.initial('abc')).toBe('ab')
    expect(letters.final('abc')).toBe('c')
    expect(letters.final('xbc')).toBe('bc')
    expect(letters.compareFromEnd('abc', 'xbc')).toBeGreaterThan(0)
  })
  it('compares whole multi-character alphabet letters from the end without re-tokenizing their concatenation', () => {
    const letters = makeLexiconLetters(['a', 'b', 'c', 'ch', 'x'])
    const input = ['xa', 'bach', 'ca', 'ch', 'ba', 'x', 'ach', 'cba', 'a']
    expect(input.toSorted(letters.compareFromEnd)).toEqual([
      'a',
      'ba',
      'cba',
      'ca',
      'xa',
      'ch',
      'ach',
      'bach',
      'x'
    ])
    const overlap = makeLexiconLetters(['sh', 's', 'h', 'a'])
    // hs 是两字母，反转后不能悄悄变成单字母 sh。
    expect(overlap.compareFromEnd('hs', 'sh')).toBeGreaterThan(0)
  })
  it('uses shorter words first when they share a complete suffix', () => {
    const { compareFromEnd } = makeLexiconLetters(['a', 'b', 'c'])
    expect(['cba', 'ba', 'a', 'bba'].toSorted(compareFromEnd)).toEqual(['a', 'ba', 'bba', 'cba'])
  })
  it('keeps canonical combining accents together and matches composed/decomposed alphabet entries', () => {
    const letters = makeLexiconLetters(['a', 'á', 'x\u0301y', 'x\u0301', 'y'])
    expect(letters.initial('a\u0301ra')).toBe('á')
    expect(letters.final('ara\u0301')).toBe('á')
    expect(letters.compareFromEnd('ará', 'ara\u0301')).toBe(0)
    expect(letters.final('x\u0301y')).toBe('x\u0301y')
    expect(makeLexiconLetters(['x']).final('x\u0301')).toBe('X\u0301')
  })
  it('preserves the first original label when alphabet entries normalize to the same letter', () => {
    const letters = makeLexiconLetters(['a\u0301', 'á', 'TH', 'th'])
    expect(letters.initial('Ára')).toBe('a\u0301')
    expect(letters.final('path')).toBe('TH')
  })
  it('unifies g and IPA ɡ without rewriting input words or alphabet entries', () => {
    const alphabet = ['ɡ', 'g', 'a', 'ng', 'nɡ'],
      before = JSON.stringify(alphabet),
      letters = makeLexiconLetters(alphabet)
    expect(letters.initial('ga')).toBe('ɡ')
    expect(letters.initial('ɡa')).toBe('ɡ')
    expect(letters.final('ang')).toBe('ng')
    expect(letters.final('anɡ')).toBe('ng')
    expect(letters.compareFromEnd('ga', 'ɡa')).toBe(0)
    expect(letters.compareFromEnd('ang', 'anɡ')).toBe(0)
    expect(JSON.stringify(alphabet)).toBe(before)
    const accented = makeLexiconLetters(['ǵ'])
    expect(accented.final('aɡ\u0301')).toBe('ǵ')
  })
  it('has full-grapheme uppercase fallback without an alphabet', () => {
    const letters = makeLexiconLetters([])
    expect(letters.initial('kaso')).toBe('K')
    expect(letters.final('kaso')).toBe('O')
    expect(letters.initial('e\u0301ra')).toBe('É')
    expect(letters.final('are\u0301')).toBe('É')
    expect(letters.initial('ɡara')).toBe('G')
    expect(letters.final('araɡ')).toBe('G')
    expect(letters.initial('👩‍💻word')).toBe('👩‍💻')
    expect(letters.final('word👩‍💻')).toBe('👩‍💻')
  })
  it('retains locale base ordering ahead of full case ordering when there is no alphabet', () => {
    const letters = makeLexiconLetters([])
    expect(letters.compareFromEnd('za', 'aA')).toBeGreaterThan(0)
    expect(letters.compareFromEnd('ba', 'cA')).toBeLessThan(0)
    expect(letters.compareFromEnd('baré', 'bare\u0301')).toBe(0)
    const full = new Intl.Collator()
    expect(Math.sign(letters.compareFromEnd('ba', 'bA'))).toBe(Math.sign(full.compare('a', 'A')))
  })
  it('places custom alphabet letters before unknown complete graphemes, with Unicode fallback', () => {
    const letters = makeLexiconLetters(['a', 'b'])
    expect(letters.compareFromEnd('ba', 'xa')).toBeLessThan(0)
    expect(letters.compareFromEnd('x\u0301', 'x\u0302')).toBeLessThan(0)
    expect(letters.final('aZ')).toBe('Z')
  })
  it('keeps the existing explicit exact-case alphabet precedence for comparison', () => {
    const letters = makeLexiconLetters(['a', 'A', 'b'])
    expect(letters.initial('Ab')).toBe('a')
    expect(letters.final('bA')).toBe('a')
    expect(letters.compareFromEnd('ba', 'bA')).toBeLessThan(0)
  })
  it('ignores only outer whitespace and conventional affix boundaries, keeping internal symbols', () => {
    const letters = makeLexiconLetters([])
    expect(letters.initial('-=*·kaso')).toBe('K')
    expect(letters.final('kaso-=*·')).toBe('O')
    expect(letters.initial('-ka-')).toBe('K')
    expect(letters.final('-ka-')).toBe('A')
    expect(letters.compareFromEnd('-ka-', 'ka')).toBe(0)
    expect(letters.compareFromEnd('ka·na', 'na')).toBeGreaterThan(0)
  })
  it('handles empty words, boundary-only forms and empty alphabet entries', () => {
    for (const alphabet of [[], [''], ['', 'a', '']]) {
      const letters = makeLexiconLetters(alphabet)
      for (const word of ['', ' \t\n ', '-=*·']) {
        expect(letters.initial(word)).toBe('')
        expect(letters.final(word)).toBe('')
      }
      expect(letters.compareFromEnd('', 'a')).toBeLessThan(0)
      expect(letters.compareFromEnd('', '  ')).toBe(0)
    }
  })
  it('does not mutate caller alphabets and leaves ordinary forward collation unchanged', () => {
    const alphabet = ['a', 'th', 't', 'e'],
      snapshot = JSON.stringify(alphabet),
      input = ['te', 'the', 'ta', 'tha', 'a', 'ez', 'e'],
      forward = makeCollator(alphabet),
      before = input.toSorted(forward),
      letters = makeLexiconLetters(alphabet)
    input.toSorted(letters.compareFromEnd)
    input.forEach((word) => {
      letters.initial(word)
      letters.final(word)
    })
    expect(input.toSorted(forward)).toEqual(before)
    expect(before).toEqual(['a', 'tha', 'the', 'ta', 'te', 'e', 'ez'])
    expect(JSON.stringify(alphabet)).toBe(snapshot)
  })
  it('keeps every visible final-letter group contiguous, including accent and unknown-case groups', () => {
    const samples = [
      'ba',
      'á',
      'ca',
      'dá',
      'ax',
      'bX',
      'aZ',
      'cx',
      'ZX',
      'aß',
      'SS',
      'bSS',
      'x\u0301',
      'X\u0301'
    ]
    for (const alphabet of [[], ['a'], ['SS', 'x', 'z']]) {
      const letters = makeLexiconLetters(alphabet),
        ordered = samples.toSorted(letters.compareFromEnd),
        closed = new Set<string>()
      let previous: string | undefined
      for (const word of ordered) {
        const group = letters.final(word)
        if (group !== previous) {
          expect(closed.has(group), `${alphabet}: ${ordered}`).toBe(false)
          if (previous !== undefined) closed.add(previous)
          previous = group
        }
      }
      expect(ordered.filter((word) => letters.final(word) === letters.final('ba'))).toEqual([
        'ba',
        'ca'
      ])
    }
  })
  it('keeps longer complete-letter suffix subgroups adjacent inside a final group', () => {
    const letters = makeLexiconLetters([]),
      samples = ['xba', 'áa', 'ba', 'za', 'cba', 'báa', 'a', 'dba'],
      ordered = samples.toSorted(letters.compareFromEnd)
    const positions = ordered.map((word, i) => (word.endsWith('ba') ? i : -1)).filter((i) => i >= 0)
    expect(positions.at(-1)! - positions[0] + 1).toBe(positions.length)
    expect(ordered.indexOf('ba')).toBeLessThan(ordered.indexOf('cba'))
  })
  it('is repeatable, antisymmetric and transitive across letters, marks, case and unknowns', () => {
    const samples = [
      '',
      'a',
      'A',
      'th',
      'ath',
      'ha',
      'ɡa',
      'ga',
      'a\u0301',
      'á',
      'z',
      'x\u0301',
      '👩‍💻',
      'ß',
      'SS',
      'bSS',
      'aß',
      'ba',
      'bA',
      'bá',
      'ca',
      'xX',
      'ax',
      'aZ'
    ]
    for (const alphabet of [[], ['a', 'th', 'h', 'g', 'á'], ['SS', 'x', 'z']]) {
      const { compareFromEnd: cmp } = makeLexiconLetters(alphabet)
      for (const a of samples)
        for (const b of samples) {
          expect(Math.sign(cmp(a, b)) + Math.sign(cmp(b, a))).toBe(0)
          expect(cmp(a, b)).toBe(cmp(a, b))
        }
      for (const a of samples)
        for (const b of samples)
          for (const c of samples)
            if (cmp(a, b) <= 0 && cmp(b, c) <= 0) expect(cmp(a, c)).toBeLessThanOrEqual(0)
      expect(samples.toSorted(cmp)).toEqual(samples.toSorted(cmp))
    }
  })
})
