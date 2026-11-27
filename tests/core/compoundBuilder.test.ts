import { describe, expect, it } from 'vitest'
import { createLanguage, createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import {
  createCompoundLexeme,
  findCompoundCombinations,
  compoundSourcesValid,
  prepareCompoundIndex
} from '$lib/core/compoundBuilder'
import {
  parseProject,
  projectFromFolder,
  projectToFolder,
  serializeProject
} from '$lib/core/serialize'
import { createLexemeGraph } from '$lib/core/lexemeGraph'
const fixture = () => {
  const p = createProject({
      name: 'Compound QA',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.2'
    }),
    lang = p.languages[0],
    other = createLanguage({ name: 'Other' })
  p.languages.push(other)
  const add = (id: string, lemma: string, languageId = lang.id) => {
    const w = createLexeme(languageId, lemma)
    w.id = id
    w.senses[0].definition = { en: 'meaning ' + id }
    p.lexemes.push(w)
    return w
  }
  return { p, lang, other, add }
}
const refs = (combination: { parts: { kind: string; id: string }[] }) =>
  combination.parts.map((part) => part.kind + ':' + part.id)

describe('bounded compound source suggestions', () => {
  it('carries live source records for constant-time labels without rebuilding on definition changes', () => {
    const { p, lang, add } = fixture()
    const word = add('source', 'a')
    add('tail', 'b')
    const index = prepareCompoundIndex(p, lang.id),
      source = index.records.get('lexeme:source')!
    expect(source.kind).toBe('lexeme')
    expect(source.record).toBe(word)
    word.senses[0].definition.en = 'edited source definition'
    if (source.kind === 'lexeme')
      expect(source.record.senses[0].definition.en).toBe('edited source definition')
    expect(findCompoundCombinations(index, 'ab').combinations).toHaveLength(1)
  })
  it('lists two-part analyses before three-part analyses and preserves mixed reference identities', () => {
    const { p, lang, add } = fixture()
    add('sun', 'sun')
    add('flower', 'flower')
    add('bird', 'bird')
    add('flowerbird', 'flowerbird')
    const prefix = createMorpheme(lang.id, 'prefix')
    prefix.id = 'sun-prefix'
    prefix.form = 'sun-'
    p.morphemes.push(prefix)
    const result = findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'sunflowerbird')
    expect(result.combinations.map((c) => c.parts.map((part) => part.id))).toContainEqual([
      'sun',
      'flowerbird'
    ])
    expect(result.combinations.map((c) => c.parts.map((part) => part.id))).toContainEqual([
      'sun',
      'flower',
      'bird'
    ])
    expect(result.combinations.map((c) => c.parts.map((part) => part.id))).toContainEqual([
      'sun-prefix',
      'flower',
      'bird'
    ])
    expect(result.combinations.map((c) => c.parts.length)).toEqual([2, 2, 3, 3])
    expect(compoundSourcesValid(p, lang.id, result.combinations[2].parts)).toBe(true)
    expect(compoundSourcesValid(p, lang.id, result.combinations[2].parts, 'flower')).toBe(false)
  })
  it('reserves a visible three-part analysis under large homograph ambiguity without expanding all products', () => {
    const { p, lang, add } = fixture()
    p.lexemes = Array.from({ length: 10000 }, (_, i) => ({
      ...createLexeme(lang.id, 'a'),
      id: 'entry-' + i
    }))
    add('double', 'aa')
    const result = findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'aaa')
    expect(result.combinations).toHaveLength(40)
    expect(result.truncated).toBe(true)
    const counts = result.combinations.map((c) => c.parts.length)
    expect(counts).toContain(2)
    expect(counts).toContain(3)
    expect(counts).toEqual([...counts].sort())
  })
  it('finds all exact homograph identities without choosing one or changing project data', () => {
    const { p, lang, add } = fixture()
    add('sun-star', 'sun')
    add('sun-name', 'sun')
    add('flower', 'flower')
    const before = JSON.stringify(p),
      result = findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'sunflower')
    expect(result.combinations.map(refs)).toEqual([
      ['lexeme:sun-star', 'lexeme:flower'],
      ['lexeme:sun-name', 'lexeme:flower']
    ])
    expect(result.truncated).toBe(false)
    expect(JSON.stringify(p)).toBe(before)
  })
  it('excludes the owner and other languages even when their spelling is identical', () => {
    const { p, lang, other, add } = fixture()
    add('owner', 'sun')
    add('local', 'sun')
    add('foreign', 'sun', other.id)
    add('flower', 'flower')
    const result = findCompoundCombinations(
      prepareCompoundIndex(p, lang.id, { excludeId: 'owner' }),
      'sunflower'
    )
    expect(result.combinations.map(refs)).toEqual([['lexeme:local', 'lexeme:flower']])
  })
  it('offers lexeme/morpheme mixed combinations with conventional affix hyphens removed only for matching', () => {
    const { p, lang, add } = fixture()
    add('sun', 'sun')
    add('flower', 'flower')
    const m = createMorpheme(lang.id, 'prefix')
    m.id = 'prefix'
    m.form = 'sun-'
    p.morphemes.push(m)
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'sunflower').combinations.map(refs)
    ).toContainEqual(['morpheme:prefix', 'lexeme:flower'])
    expect(m.form).toBe('sun-')
  })
  it('does not invent circumfix, empty or unlisted allomorph matches', () => {
    const { p, lang, add } = fixture()
    add('flower', 'flower')
    const m = createMorpheme(lang.id, 'circumfix')
    m.form = 'sun'
    m.form2 = 'x'
    m.allomorphs = [{ form: 'star', environment: '' }]
    p.morphemes.push(m)
    const empty = createMorpheme(lang.id)
    empty.form = '--'
    p.morphemes.push(empty)
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'sunflower').combinations
    ).toEqual([])
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'starflower').combinations
    ).toEqual([])
  })
  it.each(['sun-flower', 'sun·flower', 'sun flower', 'sun + flower', 'sun::flower'])(
    'honors declared boundaries in %s',
    (form) => {
      const { p, lang, add } = fixture()
      p.settings.morphemeBoundaries.push('::')
      add('sun', 'sun')
      add('flower', 'flower')
      expect(
        findCompoundCombinations(prepareCompoundIndex(p, lang.id), form).combinations.map(refs)
      ).toContainEqual(['lexeme:sun', 'lexeme:flower'])
    }
  )
  it('uses NFC, case and keyboard-g/IPA-g equivalence without rewriting original spelling', () => {
    const { p, lang, add } = fixture()
    add('g', 'ɡé')
    add('tail', '鳥')
    const before = JSON.stringify(p)
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'GE\u0301鳥').combinations.map(
        refs
      )
    ).toEqual([['lexeme:g', 'lexeme:tail']])
    expect(JSON.stringify(p)).toBe(before)
  })
  it('checks more than one complete split and keeps ordered repeated references', () => {
    const { p, lang, add } = fixture()
    for (const [id, form] of [
      ['sun', 'sun'],
      ['flowerbird', 'flowerbird'],
      ['sunflower', 'sunflower'],
      ['bird', 'bird']
    ])
      add(id, form)
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'sunflowerbird').combinations.map(
        refs
      )
    ).toEqual([
      ['lexeme:sun', 'lexeme:flowerbird'],
      ['lexeme:sunflower', 'lexeme:bird']
    ])
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'sunsun').combinations.map(refs)
    ).toEqual([['lexeme:sun', 'lexeme:sun']])
  })
  it('does not split a surrogate pair or infer a whole-form record as its own component', () => {
    const { p, lang, add } = fixture()
    add('whole', '𐀀bird')
    add('symbol', '𐀀')
    add('bird', 'bird')
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), '𐀀bird').combinations.map(refs)
    ).toEqual([['lexeme:symbol', 'lexeme:bird']])
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'unmatched').combinations
    ).toEqual([])
  })
  it('bounds 10000 same-form records instead of building their Cartesian product', () => {
    const { p, lang } = fixture()
    p.lexemes = Array.from({ length: 10000 }, (_, i) => ({
      ...createLexeme(lang.id, 'a'),
      id: 'entry-' + i
    }))
    const index = prepareCompoundIndex(p, lang.id),
      result = findCompoundCombinations(index, 'aa', { limit: 30 })
    expect(index.byForm.get('a')).toHaveLength(10000)
    expect(result.combinations).toHaveLength(30)
    expect(result.truncated).toBe(true)
    expect(result.combinations[0].parts[0].id).toBe('entry-0')
    expect(result.combinations[29].parts[1].id).toBe('entry-29')
  })
  it('has bounded output and explicit manual fallback for long forms or too many boundaries', () => {
    const { p, lang, add } = fixture()
    add('a', 'a')
    expect(findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'a'.repeat(513))).toEqual({
      combinations: [],
      truncated: true
    })
    p.settings.morphemeBoundaries = Array.from({ length: 40 }, (_, i) => ':' + i)
    expect(findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'aa').truncated).toBe(true)
    expect(
      findCompoundCombinations(prepareCompoundIndex(p, lang.id), 'aa', { limit: 0 }).combinations
    ).toEqual([])
  })
  it('returns independent candidate references and revalidates deletion, language and owner', () => {
    const { p, lang, other, add } = fixture()
    const a = add('a', 'a')
    add('b', 'b')
    const index = prepareCompoundIndex(p, lang.id),
      pair = findCompoundCombinations(index, 'ab').combinations[0]
    expect(compoundSourcesValid(p, lang.id, pair.parts)).toBe(true)
    expect(compoundSourcesValid(p, lang.id, pair.parts, 'a')).toBe(false)
    pair.parts[0].id = 'changed'
    expect(findCompoundCombinations(index, 'ab').combinations[0].parts[0].id).toBe('a')
    const fresh = findCompoundCombinations(index, 'ab').combinations[0]
    a.languageId = other.id
    expect(compoundSourcesValid(p, lang.id, fresh.parts)).toBe(false)
    a.languageId = lang.id
    p.lexemes.splice(p.lexemes.indexOf(a), 1)
    expect(compoundSourcesValid(p, lang.id, fresh.parts)).toBe(false)
  })
})
describe('explicit compound entry creation', () => {
  it('derives source links from etymology alone and removes old components when sources change', () => {
    const { p, lang, add } = fixture()
    for (const id of ['a', 'b', 'c', 'd']) add(id, id)
    const word = createCompoundLexeme(p, {
      languageId: lang.id,
      firstId: 'a',
      secondId: 'b',
      lemma: 'ab'
    })!
    p.lexemes.push(word)
    expect(word.relations).toEqual([])
    expect(
      createLexemeGraph(p, ['en'])
        .linksOf('l:' + word.id)
        .map((link) => link.node.key)
    ).toEqual(expect.arrayContaining(['l:a', 'l:b']))
    word.etymology.sources = [
      { kind: 'lexeme', id: 'c' },
      { kind: 'lexeme', id: 'd' }
    ]
    const neighbors = createLexemeGraph(p, ['en'])
      .linksOf('l:' + word.id)
      .map((link) => link.node.key)
    expect(neighbors).toEqual(expect.arrayContaining(['l:c', 'l:d']))
    expect(neighbors).not.toContain('l:a')
    expect(neighbors).not.toContain('l:b')
  })
  it('creates real ordered sources for the explicitly chosen homograph, manual form, custom POS and multilingual definitions', () => {
    const { p, lang, add } = fixture()
    add('star', 'sun')
    add('name', 'sun')
    add('flower', 'flower')
    p.posList = [{ id: 'custom', name: { en: 'User category' }, abbr: 'USR', paradigmId: null }]
    const before = JSON.stringify(p),
      word = createCompoundLexeme(p, {
        languageId: lang.id,
        firstId: 'name',
        secondId: 'flower',
        lemma: 'sun·flor',
        posId: 'custom',
        definitions: { en: ' New meaning ', qaa: 'Custom gloss' }
      })!
    expect(JSON.stringify(p)).toBe(before)
    expect(word.lemma).toBe('sun·flor')
    expect(word.posId).toBe('custom')
    expect(word.senses[0].definition).toEqual({ en: 'New meaning', qaa: 'Custom gloss' })
    expect(word.etymology).toEqual({
      type: 'compound',
      sources: [
        { kind: 'lexeme', id: 'name' },
        { kind: 'lexeme', id: 'flower' }
      ],
      stages: [],
      notes: ''
    })
    expect(word.relations).toEqual([])
  })
  it('does not guess POS or definitions and does not mutate until the caller confirms insertion', () => {
    const { p, lang, add } = fixture()
    const left = add('a', 'a')
    left.posId = 'source-pos'
    add('b', 'b')
    const word = createCompoundLexeme(p, {
      languageId: lang.id,
      firstId: 'a',
      secondId: 'b',
      lemma: 'ab'
    })!
    expect(word.posId).toBeNull()
    expect(word.senses[0].definition).toEqual({})
    expect(p.lexemes).toHaveLength(2)
    expect(p.lexemes.some((w) => w.id === word.id)).toBe(false)
  })
  it('permits explicit repetition of one word without redundant manual relations', () => {
    const { p, lang, add } = fixture()
    add('a', 'a')
    const word = createCompoundLexeme(p, {
      languageId: lang.id,
      firstId: 'a',
      secondId: 'a',
      lemma: 'aa'
    })!
    expect(word.etymology.sources).toHaveLength(2)
    expect(word.relations).toEqual([])
  })
  it.each(['missing', 'foreign', 'empty', 'language', 'pos', 'readonly'] as const)(
    'rejects %s without writing a project',
    (kind) => {
      const { p, lang, other, add } = fixture()
      add('a', 'a')
      add('b', 'b')
      const input = {
        languageId: lang.id,
        firstId: 'a',
        secondId: 'b',
        lemma: 'ab',
        posId: null as string | null
      }
      if (kind === 'missing') input.secondId = 'gone'
      if (kind === 'foreign') p.lexemes[1].languageId = other.id
      if (kind === 'empty') input.lemma = ' '
      if (kind === 'language') input.languageId = 'gone'
      if (kind === 'pos') input.posId = 'gone'
      if (kind === 'readonly') p.meta.readOnly = true
      const before = JSON.stringify(p)
      expect(createCompoundLexeme(p, input)).toBeNull()
      expect(JSON.stringify(p)).toBe(before)
    }
  )
  it.each(['json', 'folder'] as const)(
    '%s roundtrip retains real references and graph source edges',
    (format) => {
      const { p, lang, add } = fixture()
      add('a', 'a')
      add('b', 'b')
      const word = createCompoundLexeme(p, {
        languageId: lang.id,
        firstId: 'a',
        secondId: 'b',
        lemma: 'ab'
      })!
      p.lexemes.push(word)
      const back =
        format === 'json'
          ? parseProject(serializeProject(p))
          : projectFromFolder(projectToFolder(p))
      expect(back.lexemes.find((w) => w.id === word.id)!.etymology).toEqual(word.etymology)
      const model = createLexemeGraph(back, ['en'])
      expect(model.linksOf('l:' + word.id).map((link) => link.node.key)).toEqual(
        expect.arrayContaining(['l:a', 'l:b'])
      )
    }
  )
})
