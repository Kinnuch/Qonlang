import { describe, it, expect } from 'vitest'
import { createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import {
  composeSuggestions,
  composeCandidates,
  prepareComposeIndex,
  composeSuggestionsFrom
} from '$lib/engine/compose'
import {
  expandComposeCandidates,
  loadComposeTray,
  planComposeAddAll,
  claimComposeCandidate,
  partitionComposeTray,
  restoreComposeCandidate
} from '$lib/engine/composeTray'
import { prepareComposeApprox, matchComposeApprox } from '$lib/engine/composeApprox'

function fixture() {
  return createProject({
    name: 'Approximate compose QA',
    template: 'blank',
    uiLocale: 'en',
    appVersion: '1.1.1'
  })
}
function word(p: ReturnType<typeof fixture>, surface: string, meaning: string) {
  const w = createLexeme(p.languages[0].id, surface)
  w.senses[0].definition = { zh: meaning, en: meaning }
  p.lexemes.push(w)
  return w
}
const query = (p: ReturnType<typeof fixture>, text: string) =>
  composeSuggestions(p, p.languages[0].id, text, ['zh', 'en'])
describe('conservative approximate gloss recall', () => {
  it('recalls a whole-word fragment of a longer spaced gloss without matching inside unrelated compounds', () => {
    const p = fixture()
    word(p, 'shine', 'to shine')
    word(p, 'moon', 'moonshine')
    const c = query(p, 'shine').candidates
    expect(c.find((c) => c.surface === 'shine')?.approximate).toMatchObject({
      kind: 'partial',
      source: 'shine'
    })
    expect(c.some((c) => c.surface === 'moon')).toBe(false)
  })
  it.each([
    ['ligth', 'light'],
    ['brigt', 'bright'],
    ['shimmeer', 'shimmer'],
    ['shimer', 'shimmer'],
    ['shinx', 'shine']
  ])('recalls one edit/transposition %s for %s as a manual suggestion', (source, meaning) => {
    const p = fixture()
    word(p, 'qa', meaning)
    const result = query(p, source)
    expect(result.candidates[0]).toMatchObject({
      matched: meaning,
      at: 0,
      end: source.length,
      approximate: { kind: 'typo', source, distance: 1 }
    })
    expect(result.gaps).toEqual([{ text: source, at: 0 }])
    expect(
      planComposeAddAll(
        expandComposeCandidates(result.candidates, source),
        loadComposeTray(null, source)
      )
    ).toEqual([])
  })
  it('keeps exact candidates ahead of approximate ones even when later in the translation', () => {
    const p = fixture()
    word(p, 'near', 'light')
    word(p, 'exact', 'shadow')
    const c = query(p, 'ligth shadow').candidates
    expect(c.map((x) => x.surface)).toEqual(['exact', 'near'])
    expect(c[0].approximate).toBeUndefined()
  })
  it.each([
    ['lumiere', 'lumière'],
    ['lumière', 'lumière'],
    ['ＬＩＧＨＴ', 'light'],
    ['МАЯК', 'маяк']
  ])('normalizes %s against %s while keeping raw source spans', (source, meaning) => {
    const p = fixture()
    word(p, 'norm', meaning)
    const c = query(p, '🌟 ' + source).candidates[0]
    expect(c).toMatchObject({ at: 3, end: 3 + source.length })
    if (source === 'МАЯК') expect(c.approximate).toBeUndefined()
    else expect(c.approximate).toMatchObject({ kind: 'normalized', source })
  })
  it('recalls a meaningful two-Han fragment contained in a longer gloss, not single common characters', () => {
    const p = fixture()
    word(p, 'shine', '闪烁发光')
    const c = query(p, '星星闪烁。').candidates.find((c) => c.surface === 'shine')!
    expect(c).toMatchObject({ at: 2, end: 4, approximate: { kind: 'partial', source: '闪烁' } })
    expect(query(p, '星星发。').candidates).toEqual([])
  })
  it('supports one changed character in longer unspaced glosses but rejects two/three-character typo guesses', () => {
    const p = fixture()
    word(p, 'long', '微风轻抚')
    word(p, 'short', '明亮')
    expect(
      query(p, '微风轻拂').candidates.some(
        (c) => c.surface === 'long' && c.approximate?.kind === 'typo'
      )
    ).toBe(true)
    expect(query(p, '明朗').candidates.some((c) => c.surface === 'short')).toBe(false)
  })
  it.each([
    ['see', 'seed'],
    ['seed', 'see'],
    ['cat', 'cut'],
    ['light', 'night'],
    ['alpha2', 'alpha3']
  ])('does not promote a weak short/numeric/unrelated match %s / %s', (source, meaning) => {
    const p = fixture()
    word(p, 'weak', meaning)
    const result = query(p, source)
    if (source === 'light' && meaning === 'night') {
      expect(result.candidates[0]?.approximate).toBeDefined()
      expect(
        planComposeAddAll(
          expandComposeCandidates(result.candidates, source),
          loadComposeTray(null, source)
        )
      ).toEqual([])
    } else expect(result.candidates).toEqual([])
  })
  it('keeps frame matching exact and independent from its inner word', () => {
    const p = fixture()
    word(p, 'frame', 'in ... light')
    word(p, 'light', 'light')
    expect(query(p, 'in blue ligth').candidates.some((c) => c.surface === 'frame')).toBe(false)
    const exact = query(p, 'in blue light').candidates
    expect(exact.some((c) => c.surface === 'frame' && !c.approximate)).toBe(true)
  })
  it('keeps repeated typo occurrences separate, manual claims never stash another approximate or exact alternative', () => {
    const p = fixture()
    word(p, 'a', 'light')
    word(p, 'b', 'light')
    const text = 'ligth ligth',
      c = expandComposeCandidates(query(p, text).candidates, text)
    expect(c.map((x) => [x.surface, x.at])).toEqual([
      ['a', 0],
      ['b', 0],
      ['a', 6],
      ['b', 6]
    ])
    expect(c.every((x) => x.group === null)).toBe(true)
    let state = claimComposeCandidate(loadComposeTray(null, text), c[0], 'w:one')
    expect(partitionComposeTray(c, state).stashed).toEqual([])
    expect(partitionComposeTray(c, state).floating).toHaveLength(3)
    state = restoreComposeCandidate(state, c[0].id)
    expect(partitionComposeTray(c, state).floating).toHaveLength(4)
  })
  it('an entry matching exact and typo positions labels each occurrence independently', () => {
    const p = fixture()
    word(p, 'light', 'light')
    const text = 'light ligth',
      c = expandComposeCandidates(query(p, text).candidates, text)
    expect(c).toHaveLength(2)
    expect(c[0].approximate).toBeUndefined()
    expect(c[1].approximate?.kind).toBe('typo')
    expect(planComposeAddAll(c, loadComposeTray(null, text))).toEqual([c[0]])
  })
  it('also recalls morpheme meanings without admitting unrelated language records or feature abbreviations', () => {
    const p = fixture(),
      m = createMorpheme(p.languages[0].id, 'prefix')
    m.form = 'qa-'
    m.meaning = { en: 'bright' }
    m.gloss = 'PL'
    p.morphemes.push(m)
    const foreign = word(p, 'foreign', 'bright')
    foreign.languageId = 'other'
    const c = query(p, 'brigt').candidates
    expect(c).toHaveLength(1)
    expect(c[0].morphemeId).toBe(m.id)
    expect(query(p, 'PL').candidates).toEqual([])
  })
  it('does not create weaker inner approximate bubbles inside an exact phrase match', () => {
    const p = fixture()
    word(p, 'long', '闪烁发光')
    const c = expandComposeCandidates(query(p, '闪烁发光').candidates, '闪烁发光')
    expect(c).toHaveLength(1)
    expect(c[0].approximate).toBeUndefined()
  })
  it('is deterministic, bounded and immutable for many synonyms and long/repeated input', () => {
    const p = fixture()
    for (let i = 0; i < 10000; i++) word(p, 'qa' + i, 'shimmer')
    const before = JSON.stringify(p),
      index = prepareComposeIndex(p, p.languages[0].id, ['en']),
      text = Array.from({ length: 80 }, () => 'shimer').join(' '),
      one = composeSuggestionsFrom(index, text),
      two = composeSuggestionsFrom(index, text)
    expect(one).toEqual(two)
    expect(one.candidates).toHaveLength(40)
    expect(expandComposeCandidates(one.candidates, text).length).toBeLessThanOrEqual(240)
    expect(JSON.stringify(p)).toBe(before)
    const raw = matchComposeApprox(prepareComposeApprox(['shimmer']), 'x '.repeat(3000))
    expect(raw.truncated).toBe(true)
  })
  it('preserves the existing forward exact candidate API and position rules', () => {
    const p = fixture()
    word(p, 'known', 'light')
    expect(composeCandidates(p, p.languages[0].id, 'light', ['en'])[0]).toMatchObject({
      at: 0,
      end: 5
    })
    expect(query(p, 'light').gaps).toEqual([])
  })
})
