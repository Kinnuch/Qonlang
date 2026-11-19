import { describe, expect, it } from 'vitest'
import { createLanguage, createMorpheme, createOrthography, createProject } from '$lib/core/factory'
import type { Language, Orthography, Paradigm } from '$lib/core/model'
import {
  activePhonemeRules,
  duplicatePhonemeRules,
  editPhonemeRule,
  phonemeRules,
  resetPhonemeRule,
  suggestedPhonemeRules,
  syncPhonemeRules
} from '$lib/core/phonemeSpelling'
import {
  derivePronunciations,
  runOrthography,
  runOrthographyOnText,
  spellToIpa,
  transcribe
} from '$lib/core/pronounce'
import { inferFeatures } from '$lib/ipa/features'
import { spellingUnits } from '$lib/engine/phon'
import { makeContext, selectAllomorph, generateForm, paradigmSlots } from '$lib/engine/morph'
import { parseProject, serializeProject } from '$lib/core/serialize'
import { createLexeme } from '$lib/core/factory'

function fixture(
  entries: [string, string][] = [
    ['θ', 'th tʰ'],
    ['a', 'a']
  ]
): { lang: Language; ortho: Orthography } {
  const lang = createLanguage({ name: 'Spelling QA' }),
    ortho = lang.orthographies[0]
  lang.phonemes = entries.map(([symbol, grapheme], i) => ({
    id: 'ph-' + i,
    symbol,
    graphemes: { [ortho.id]: grapheme },
    features: inferFeatures(symbol),
    notes: ''
  }))
  return { lang, ortho }
}
const generate = (lang: Language, ortho: Orthography): void => {
  syncPhonemeRules(lang, ortho, { initialize: true, activateAll: true })
}

describe('phoneme spelling entries and actual orthographic conversion', () => {
  it('keeps custom entries attached to their original variant through insertion and reordering', () => {
    const { lang, ortho } = fixture([['θ', 'a b']])
    generate(lang, ortho)
    const second = phonemeRules(ortho, 'toIpa').find((row) => row.from === 'b')!
    editPhonemeRule(lang, ortho, 'toIpa', second.id, { to: 'X' })
    lang.phonemes[0].graphemes[ortho.id] = 'c a b'
    syncPhonemeRules(lang, ortho, { activatePhonemeId: 'ph-0' })
    expect(transcribe(lang, ortho, 'cab')).toBe('θθX')
    expect(phonemeRules(ortho, 'toIpa').find((row) => row.id === second.id)).toMatchObject({
      from: 'b',
      to: 'X',
      generatedFrom: 'b',
      variant: 2
    })
    lang.phonemes[0].graphemes[ortho.id] = 'b c a'
    syncPhonemeRules(lang, ortho, { activatePhonemeId: 'ph-0' })
    expect(transcribe(lang, ortho, 'bca')).toBe('Xθθ')
    expect(new Set(phonemeRules(ortho, 'toIpa').map((row) => row.id)).size).toBe(3)
  })
  it('preserves a single overridden entry when its sole default spelling is renamed', () => {
    const { lang, ortho } = fixture([['θ', 'a']])
    generate(lang, ortho)
    const original = phonemeRules(ortho, 'toIpa')[0]
    editPhonemeRule(lang, ortho, 'toIpa', original.id, { to: 'X' })
    lang.phonemes[0].graphemes[ortho.id] = 'b'
    syncPhonemeRules(lang, ortho, { activatePhonemeId: 'ph-0' })
    expect(phonemeRules(ortho, 'toIpa')[0]).toMatchObject({
      id: original.id,
      from: 'a',
      to: 'X',
      generatedFrom: 'b'
    })
    lang.phonemes[0].graphemes[ortho.id] = 'a b'
    syncPhonemeRules(lang, ortho, { activatePhonemeId: 'ph-0' })
    expect(new Set(phonemeRules(ortho, 'toIpa').map((row) => row.id)).size).toBe(2)
    expect(phonemeRules(ortho, 'toIpa').find((row) => row.generatedFrom === 'b')!.edited).toBe(
      false
    )
    expect(transcribe(lang, ortho, 'ab')).toBe('Xθ')
    expect(phonemeRules(ortho, 'toIpa').find((row) => row.id === original.id)!.to).toBe('X')
  })
  it('recognizes a customized source after live typing temporarily changes a sole spelling', () => {
    const { lang, ortho } = fixture([['θ', 'th']])
    generate(lang, ortho)
    const row = phonemeRules(ortho, 'toIpa')[0]
    editPhonemeRule(lang, ortho, 'toIpa', row.id, { from: 'xh', to: 'X' })
    lang.phonemes[0].graphemes[ortho.id] = 'cth'
    syncPhonemeRules(lang, ortho, { activatePhonemeId: 'ph-0' })
    lang.phonemes[0].graphemes[ortho.id] = 'c th'
    syncPhonemeRules(lang, ortho, { activatePhonemeId: 'ph-0' })
    expect(transcribe(lang, ortho, 'cxh')).toBe('θX')
    expect(phonemeRules(ortho, 'toIpa').find((item) => item.id === row.id)).toMatchObject({
      from: 'xh',
      to: 'X',
      generatedFrom: 'th',
      editedSource: 'th'
    })
  })
  it('generates all forward alternatives and one default reverse spelling', () => {
    const { lang, ortho } = fixture()
    lang.phonemes[0].graphemes[ortho.id] = 'th / tʰ, th'
    generate(lang, ortho)
    expect(phonemeRules(ortho, 'toIpa').map((row) => [row.from, row.to])).toEqual([
      ['th', 'θ'],
      ['tʰ', 'θ'],
      ['a', 'a']
    ])
    expect(transcribe(lang, ortho, 'tha tʰa')).toBe('θa θa')
    expect(runOrthography(lang, ortho, 'fromIpa', 'θa').output).toBe('tha')
  })
  it('performs overlapping mappings simultaneously and matches the longest spelling', () => {
    const { lang, ortho } = fixture([
      ['b', 'a'],
      ['c', 'b'],
      ['θ', 'th'],
      ['t', 't']
    ])
    generate(lang, ortho)
    expect(transcribe(lang, ortho, 'ab tht')).toBe('bc θt')
    expect(runOrthography(lang, ortho, 'fromIpa', 'bc').output).toBe('ab')
  })
  it('keeps a manually edited row while unrelated phonemes gain or change spellings', () => {
    const { lang, ortho } = fixture()
    generate(lang, ortho)
    const manual = phonemeRules(ortho, 'toIpa')[0]
    editPhonemeRule(lang, ortho, 'toIpa', manual.id, { from: 'xh', to: 'ð' })
    lang.phonemes[1].graphemes[ortho.id] = 'e'
    syncPhonemeRules(lang, ortho, { activatePhonemeId: lang.phonemes[1].id })
    lang.phonemes.push({
      id: 'new',
      symbol: 'ʃ',
      graphemes: { [ortho.id]: 'sh' },
      features: inferFeatures('ʃ'),
      notes: ''
    })
    syncPhonemeRules(lang, ortho, { activatePhonemeId: 'new' })
    expect(transcribe(lang, ortho, 'xhe sh')).toBe('ða ʃ')
    expect(phonemeRules(ortho, 'toIpa').find((row) => row.id === manual.id)).toMatchObject({
      from: 'xh',
      to: 'ð',
      edited: true
    })
    expect(runOrthography(lang, ortho, 'fromIpa', 'θaʃ').output).toBe('thesh')
  })
  it('clears automatic rows, retains deliberate edits and can reset a row to its latest source', () => {
    const { lang, ortho } = fixture()
    generate(lang, ortho)
    const manual = phonemeRules(ortho, 'toIpa')[0]
    editPhonemeRule(lang, ortho, 'toIpa', manual.id, { to: 'ð' })
    lang.phonemes[0].graphemes[ortho.id] = ''
    syncPhonemeRules(lang, ortho, { activatePhonemeId: lang.phonemes[0].id })
    expect(phonemeRules(ortho, 'toIpa').filter((row) => row.phonemeId === 'ph-0')).toHaveLength(1)
    expect(transcribe(lang, ortho, 'tha tʰa')).toBe('ða tʰa')
    resetPhonemeRule(lang, ortho, 'toIpa', manual.id)
    expect(phonemeRules(ortho, 'toIpa').some((row) => row.phonemeId === 'ph-0')).toBe(false)
    expect(transcribe(lang, ortho, 'tha')).toBe('tha')
  })
  it('does not revive disabled or explicitly empty rows through the old grapheme fallback', () => {
    const { lang, ortho } = fixture()
    generate(lang, ortho)
    for (const row of phonemeRules(ortho, 'toIpa'))
      editPhonemeRule(lang, ortho, 'toIpa', row.id, { enabled: false })
    expect(spellToIpa(lang, ortho, 'tha')).toBe('tha')
    lang.phonemes[1].graphemes[ortho.id] = 'e'
    syncPhonemeRules(lang, ortho, { activatePhonemeId: 'ph-1' })
    expect(phonemeRules(ortho, 'toIpa').every((row) => !row.enabled)).toBe(true)
    ortho.phonemeRules!.toIpa = []
    expect(spellToIpa(lang, ortho, 'tha')).toBe('tha')
  })
  it('uses stable first-row priority for ambiguous spellings and exposes duplicates', () => {
    const { lang, ortho } = fixture([
      ['θ', 'x'],
      ['ʃ', 'x']
    ])
    generate(lang, ortho)
    expect(activePhonemeRules(ortho, 'toIpa')).toHaveLength(1)
    expect(duplicatePhonemeRules(ortho, 'toIpa').size).toBe(1)
    expect(transcribe(lang, ortho, 'xx')).toBe('θθ')
  })
  it('previews an old project without modifying its data or existing advanced rules', () => {
    const { lang, ortho } = fixture()
    ortho.rulesToIpa = 'th > z'
    const before = JSON.stringify(lang),
      preview = suggestedPhonemeRules(lang, ortho, 'toIpa')
    expect(preview).toHaveLength(3)
    expect(preview.every((row) => !row.enabled)).toBe(true)
    expect(JSON.stringify(lang)).toBe(before)
    expect(transcribe(lang, ortho, 'tha')).toBe('za')
    lang.phonemes[1].graphemes[ortho.id] = 'e'
    syncPhonemeRules(lang, ortho, { initialize: true, activatePhonemeId: 'ph-1' })
    expect(ortho.rulesToIpa).toBe('th > z')
    expect(transcribe(lang, ortho, 'the')).toBe('za')
    expect(
      phonemeRules(ortho, 'toIpa')
        .filter((row) => row.phonemeId === 'ph-0')
        .every((row) => !row.enabled)
    ).toBe(true)
  })
  it('runs advanced adjustments once after base conversion and preserves word-edge behavior', () => {
    const { lang, ortho } = fixture([
      ['k', 'c'],
      ['a', 'a']
    ])
    generate(lang, ortho)
    ortho.rulesToIpa = 'k > x / _#'
    expect(runOrthographyOnText(lang, ortho, 'toIpa', 'cac,\n cac')).toBe('kax,\n kax')
    expect(ortho.rulesToIpa).toBe('k > x / _#')
    const word = createLexeme(lang.id, 'cac')
    expect(derivePronunciations(lang, word)).toBe(true)
    expect(word.pronunciations[ortho.id].ipa).toBe('kax')
    word.pronunciations[ortho.id] = { ipa: 'manual', irregular: true }
    derivePronunciations(lang, word)
    expect(word.pronunciations[ortho.id].ipa).toBe('manual')
  })
  it('treats characters as literal mappings rather than rule syntax or replacement commands', () => {
    const { lang, ortho } = fixture([
      ['$&', '?'],
      ['[x]', '.']
    ])
    generate(lang, ortho)
    expect(transcribe(lang, ortho, '?.')).toBe('$&[x]')
    const row = phonemeRules(ortho, 'toIpa')[0]
    editPhonemeRule(lang, ortho, 'toIpa', row.id, { from: 'a/b', to: '#;[]' })
    expect(runOrthography(lang, ortho, 'toIpa', 'a/b').output).toBe('#;[]')
  })
  it('keeps orthographies independent and persists edited mappings in the unchanged project format', () => {
    const { lang, ortho } = fixture()
    generate(lang, ortho)
    const before = JSON.stringify(ortho),
      second = createOrthography('Second')
    lang.orthographies.push(second)
    lang.phonemes[0].graphemes[second.id] = 'dh'
    syncPhonemeRules(lang, second, { initialize: true, activatePhonemeId: 'ph-0' })
    expect(JSON.stringify(ortho)).toBe(before)
    expect(transcribe(lang, second, 'dh')).toBe('θ')
    const row = phonemeRules(second, 'toIpa')[0]
    editPhonemeRule(lang, second, 'toIpa', row.id, { to: 'ð' })
    const p = createProject({
      name: 'Mapping QA',
      template: 'blank',
      appVersion: '1.0.1',
      uiLocale: 'zh'
    })
    p.languages = [lang]
    const parsed = parseProject(serializeProject(p))
    expect(parsed.schemaVersion).toBe(p.schemaVersion)
    expect(transcribe(parsed.languages[0], parsed.languages[0].orthographies[1], 'dh')).toBe('ð')
    expect(parsed.languages[0].orthographies[1].phonemeRules!.toIpa[0].edited).toBe(true)
  })
  it('uses edited spelling units and invalidates an existing morphological spoken cache', () => {
    const p = createProject({
        name: 'Morph QA',
        template: 'blank',
        appVersion: '1',
        uiLocale: 'zh'
      }),
      lang = p.languages[0],
      ortho = lang.orthographies[0]
    lang.phonemes = [
      {
        id: 'k',
        symbol: 'k',
        features: inferFeatures('k'),
        graphemes: { [ortho.id]: 'c' },
        notes: ''
      },
      {
        id: 'a',
        symbol: 'a',
        features: inferFeatures('a'),
        graphemes: { [ortho.id]: 'ae' },
        notes: ''
      }
    ]
    lang.classes = [{ id: 'C', name: 'C', members: ['k', 'l'], featureQuery: null }]
    generate(lang, ortho)
    const ctx = makeContext(p, lang),
      m = createMorpheme(lang.id, 'prefix')
    m.form = 'e'
    m.allomorphs = [{ id: 'allo', form: 'ex', environment: '_CC' }]
    expect(selectAllomorph(ctx, m, 'clam', 'prefix').form).toBe('ex')
    const row = phonemeRules(ortho, 'toIpa')[0]
    editPhonemeRule(lang, ortho, 'toIpa', row.id, { to: 'a' })
    expect(selectAllomorph(ctx, m, 'clam', 'prefix').form).toBe('e')
    const vowel = phonemeRules(ortho, 'toIpa')[1]
    editPhonemeRule(lang, ortho, 'toIpa', vowel.id, { from: 'ee' })
    expect(spellingUnits(lang).units).toContain('ee')
    expect(spellingUnits(lang).units).not.toContain('ae')
    expect(spellingUnits(lang).isVowel('ee')).toBe(true)
  })
  it('keeps old multi-letter spelling units when an unrelated phoneme first creates a table', () => {
    const p = createProject({
        name: 'Legacy morphology QA',
        template: 'blank',
        appVersion: '1',
        uiLocale: 'zh'
      }),
      lang = p.languages[0],
      ortho = lang.orthographies[0]
    lang.phonemes = [
      {
        id: 'ts',
        symbol: 't͡s',
        features: inferFeatures('t͡s'),
        graphemes: { [ortho.id]: 'ts' },
        notes: ''
      },
      {
        id: 'a',
        symbol: 'a',
        features: inferFeatures('a'),
        graphemes: { [ortho.id]: 'a' },
        notes: ''
      }
    ]
    ortho.rulesToIpa = 'ts > t͡s'
    p.categories = [
      {
        id: 'number',
        name: { en: 'Number' },
        values: [{ id: 'form', name: { en: 'Form' }, abbr: 'F' }]
      }
    ]
    const paradigm: Paradigm = {
      id: 'redup',
      name: { en: 'Reduplication' },
      dimensionIds: ['number'],
      disabledSlots: [],
      generators: { form: { kind: 'reduplication', stem: '', scope: 'initial', length: 1 } },
      inheritsFrom: null
    }
    p.paradigms.push(paradigm)
    const slot = paradigmSlots(paradigm, p.categories, ['en'])[0],
      word = createLexeme(lang.id, 'tsa')
    const surface = (): string | undefined =>
      generateForm(makeContext(p, lang), word, paradigm, slot)?.surface
    expect(surface()).toBe('tstsa')
    lang.phonemes[1].graphemes[ortho.id] = 'a e'
    syncPhonemeRules(lang, ortho, { initialize: true, activatePhonemeId: 'a' })
    expect(phonemeRules(ortho, 'toIpa').find((row) => row.phonemeId === 'ts')).toMatchObject({
      enabled: false,
      edited: false
    })
    expect(spellingUnits(lang).units).toContain('ts')
    expect(surface()).toBe('tstsa')
    const ts = phonemeRules(ortho, 'toIpa').find((row) => row.phonemeId === 'ts')!
    editPhonemeRule(lang, ortho, 'toIpa', ts.id, { enabled: false })
    expect(spellingUnits(lang).units).not.toContain('ts')
    expect(surface()).toBe('ttsa')
  })
})
