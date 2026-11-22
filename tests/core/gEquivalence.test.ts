import { describe, expect, it } from 'vitest'
import {
  canonicalG,
  gEquivalent,
  gLiteralPattern,
  gMemberIndex,
  gSearchRegex
} from '$lib/ipa/equivalence'
import { inferFeatures } from '$lib/ipa/features'
import { matchText, parseQuery } from '$lib/core/query'
import {
  prepareLiteralMapping,
  syncPhonemeRules,
  duplicatePhonemeRules
} from '$lib/core/phonemeSpelling'
import { spellToIpa, transcribe } from '$lib/core/pronounce'
import {
  createLanguage,
  createLexeme,
  createMorpheme,
  createProject,
  createRuleSet,
  createScript
} from '$lib/core/factory'
import { planEvolution } from '$lib/engine/evolve'
import { parseRuleText } from '$lib/engine/sca'
import { analyzeWord, checkWord, generateWords, segment, tokenizeWord } from '$lib/engine/phon'
import { generateNaturalWords } from '$lib/engine/phon/wordgen'
import { analyzeToken, buildIndex } from '$lib/engine/gloss'
import { WordResolver } from '$lib/engine/gloss/resolve'
import { surfaceKey } from '$lib/engine/gloss/candidates'
import { autoMappingLines, packText, renderScript } from '$lib/script/render'
import { looseKey, resolveFormInLanguage } from '$lib/core/etymology'
import { sentenceSimilarity } from '$lib/core/sentenceDedup'
import { applyCsvImport, defaultMapping, guessMapping } from '$lib/importers/csvImport'
import { serializeProject } from '$lib/core/serialize'

function fixture() {
  const project = createProject({
    name: 'g QA',
    template: 'blank',
    appVersion: '1',
    uiLocale: 'en'
  })
  const lang = project.languages[0],
    ortho = lang.orthographies[0]
  lang.phonemes = ['ɡ', 'a'].map((symbol, i) => ({
    id: `glyph-${i}`,
    symbol,
    graphemes: { [ortho.id]: symbol },
    features: inferFeatures(symbol),
    notes: ''
  }))
  return { project, lang, ortho }
}

describe('g / ɡ share comparison keys without changing source text', () => {
  it('recognises an existing target headword during whole-lexicon evolution', () => {
    const { project, lang } = fixture()
    const target = createLanguage({ name: 'Target' })
    const source = createLexeme(lang.id, 'ga'),
      stored = createLexeme(target.id, 'ɡa')
    project.languages.push(target)
    project.lexemes = [source, stored]
    const opts = {
      sourceLanguageId: lang.id,
      targetLanguageId: target.id,
      ruleSet: createRuleSet('Test'),
      program: parseRuleText('')
    }
    expect(planEvolution(project, opts)[0]).toMatchObject({
      action: 'skip',
      collision: { id: stored.id }
    })
    stored.etymology.sources = [{ kind: 'lexeme', id: source.id }]
    expect(planEvolution(project, opts)[0]).toMatchObject({
      action: 'same',
      existing: { lemma: 'ɡa' }
    })
  })
  it('folds only the two lowercase glyphs and takes the first equivalent member', () => {
    expect(canonicalG('Gɢɡgáá')).toBe('Gɢggáá')
    expect(gEquivalent('nɡʷ', 'ngʷ')).toBe(true)
    expect(gEquivalent('G', 'ɡ')).toBe(false)
    expect(gMemberIndex(['ɡ', 'g'], 'g')).toBe(0)
    expect(new RegExp(`^${gLiteralPattern('g.[ɡ]')}$`, 'u').test('ɡ.[g]')).toBe(true)
  })

  it('maps longest literal sources once and uses the first equivalent row, preserving outputs', () => {
    const rows = [
      { from: 'ɡg', to: 'G' },
      { from: 'ɡ', to: 'ɡ' },
      { from: 'g', to: 'x' }
    ]
    const before = JSON.stringify(rows),
      run = prepareLiteralMapping(rows)
    expect(run('gg ɡg gɡ ɡɡ g ɡ G')).toBe('G G G G ɡ ɡ G')
    expect(JSON.stringify(rows)).toBe(before)
    expect(prepareLiteralMapping([{ from: 'nɡ', to: 'ɡ' }], true)('NG Nɡ')).toBe('ɡ ɡ')
  })

  it('applies spelling rows and legacy fallback equally while preserving the inventory and project', () => {
    const { project, lang, ortho } = fixture()
    lang.phonemes[0].graphemes[ortho.id] = 'g'
    const before = serializeProject(project)
    expect(spellToIpa(lang, ortho, 'g ɡ')).toBe('ɡ ɡ')
    expect(serializeProject(project)).toBe(before)
    syncPhonemeRules(lang, ortho, { initialize: true, activateAll: true })
    const saved = serializeProject(project)
    expect(transcribe(lang, ortho, 'g ɡ')).toBe('ɡ ɡ')
    expect(serializeProject(project)).toBe(saved)
    const row = ortho.phonemeRules!.toIpa[0]
    ortho.phonemeRules!.toIpa.push({ ...row, id: 'different-ID', from: 'ɡ', to: 'x' })
    expect(duplicatePhonemeRules(ortho, 'toIpa')).toEqual(new Set(['different-ID']))
    expect(transcribe(lang, ortho, 'gɡ')).toBe('ɡɡ')
  })

  it('segments declared multigraphs with either glyph and keeps actual token characters', () => {
    expect(segment('ɡgagɡ', ['gg', 'a'])).toEqual(['ɡg', 'a', 'gɡ'])
    expect(tokenizeWord('ɡǵa', new Set(['gg', 'a']))).toEqual([
      { text: 'ɡǵ', kind: 'seg' },
      { text: 'a', kind: 'seg' }
    ])
    const { lang } = fixture()
    lang.syllable.enabled = true
    lang.phonotactics.onsets = ['ɡ']
    lang.phonotactics.codas = ['ɡ']
    lang.phonotactics.nuclei = ['a']
    for (const text of ['gag', 'ɡaɡ']) {
      const word = analyzeWord(lang, text)
      expect(word.text).toBe(text)
      expect(checkWord(word.segments, word.syllables, lang.phonotactics)).toEqual([])
    }
    lang.phonotactics.illegal = ['ɡa']
    const word = analyzeWord(lang, 'ga')
    expect(checkWord(word.segments, word.syllables, lang.phonotactics)).toContainEqual({
      kind: 'illegal',
      detail: 'ɡa'
    })
  })

  it('retains feature inference and excludes equivalent generated words', () => {
    expect(inferFeatures('gʷ')).toEqual(inferFeatures('ɡʷ'))
    const { lang } = fixture()
    Object.assign(lang.phonotactics, { onsets: ['ɡ'], nuclei: ['a'], codas: [] })
    const lists = lang.phonotactics
    expect(
      generateWords(lists, {
        count: 1,
        minSyllables: 1,
        maxSyllables: 1,
        onsetProb: 1,
        exclude: new Set(['ga']),
        seed: 7
      })
    ).toEqual([])
    const generated = generateNaturalWords(lang, {
      count: 20,
      minSyllables: 1,
      maxSyllables: 1,
      lexicon: [],
      exclude: new Set(['ga']),
      seed: 7
    })
    expect(generated.some((w) => canonicalG(w.ipa) === 'ga')).toBe(false)
  })

  it.each(['ga', 'ɡa', 'word==ga', 'word==ɡa'])('plain query %s matches both spellings', (q) => {
    const query = parseQuery(q, [{ key: 'word', aliases: [] }])
    expect(matchText(query, ['ga'])).toBe(true)
    expect(matchText(query, ['ɡa'])).toBe(true)
    expect(query.terms[0].raw).toBe(q)
  })

  it.each(['/gɡ/u', '/ɡg/u', '/[ɡ]g/u', '/[g]ɡ/u', '/\\u0261\\x67/u', '/(?<ɡ>g)\\k<ɡ>/u'])(
    'regex %s matches mixed glyphs without changing names',
    (q) => {
      const query = parseQuery(q)
      expect(query.errors).toEqual([])
      for (const value of ['gg', 'gɡ', 'ɡg', 'ɡɡ']) expect(matchText(query, [value])).toBe(true)
      expect(query.terms[0].raw).toBe(q)
    }
  )

  it('preserves regular expression ranges, negation, properties and case flags', () => {
    expect(matchText(parseQuery('/[^ɡ]/u'), ['g'])).toBe(false)
    expect(matchText(parseQuery('/[^g]/u'), ['ɡ'])).toBe(false)
    expect(matchText(parseQuery('/[ɡ-ɣ]/u'), ['ɣ'])).toBe(true)
    expect(matchText(parseQuery('/[ɡ-ɣ]/u'), ['h'])).toBe(false)
    expect(matchText(parseQuery('/G/u'), ['ɡ'])).toBe(false)
    expect(matchText(parseQuery('/G/iu'), ['ɡ'])).toBe(true)
    const re = /(?<ɡ>ɡ)\k<ɡ>\p{Letter}/u
    expect(gSearchRegex(re).source).toContain('(?<ɡ>g)\\k<ɡ>\\p{Letter}')
    expect(re.source).toBe('(?<ɡ>ɡ)\\k<ɡ>\\p{Letter}')
  })

  it('matches Unicode-set string alternatives and retains escaped backslashes and control syntax', () => {
    for (const q of ['/^[\\q{gɡ}]$/v', '/^[\\q{\\u{0261}g}]$/v']) {
      const query = parseQuery(q)
      expect(query.errors).toEqual([])
      for (const text of ['gg', 'gɡ', 'ɡg', 'ɡɡ']) expect(matchText(query, [text])).toBe(true)
    }
    expect(matchText(parseQuery('/\\cɡ/'), ['\\cɡ'])).toBe(true)
    expect(matchText(parseQuery('/\\cG/'), ['\u0007'])).toBe(true)
    expect(matchText(parseQuery('/\\\\ɡ/u'), ['\\g'])).toBe(true)
  })

  it('finds whole and segmented glossary forms while retaining actual surface glyphs', () => {
    const { project, lang } = fixture(),
      lexeme = createLexeme(lang.id, 'ɡa')
    lexeme.senses[0].definition = { en: 'word' }
    const suffix = createMorpheme(lang.id, 'suffix')
    suffix.form = 'ɡ'
    suffix.gloss = 'PL'
    project.lexemes.push(lexeme)
    project.morphemes.push(suffix)
    const before = serializeProject(project),
      idx = buildIndex(project, lang.id)
    const whole = analyzeToken(idx, 'ga', [])
    expect(whole[0]).toMatchObject({ lexemeId: lexeme.id, morphs: [{ form: 'ga' }] })
    const split = analyzeToken(idx, 'gaɡ', []).find((a) => a.morphs.length === 2)!
    expect(split.morphs.map((m) => m.form)).toEqual(['ga', 'ɡ'])
    const token = { surface: 'ga', analyses: [], chosen: 0, confirmed: false }
    expect(new WordResolver(project, lang.id).resolveWord(token)).toEqual({ lexemeId: lexeme.id })
    expect(surfaceKey('ga')).toBe(surfaceKey('ɡa'))
    expect(serializeProject(project)).toBe(before)
  })

  it('uses first glyph reading in both rule and syllable packing script modes', () => {
    const { lang } = fixture(),
      script = createScript('glyph QA')
    script.glyphs = [
      { id: 'ID-ɡ', char: '甲', name: '', value: 'ɡa', category: 'syllable', notes: '' },
      { id: 'ID-g', char: '乙', name: '', value: 'ga', category: 'syllable', notes: '' }
    ]
    const before = JSON.stringify(script)
    expect(autoMappingLines(script, lang)).toEqual(['ɡa > 甲'])
    expect(renderScript(lang, script, 'ga ɡa')).toBe('甲 甲')
    expect(JSON.stringify(script)).toBe(before)
    script.packing = { enabled: true } as NonNullable<typeof script.packing>
    expect(packText(lang, script, 'ga ɡa')).toBe('甲 甲')
  })

  it('compares language forms and sentence duplicates without changing stored IDs or spelling', () => {
    const { project, lang } = fixture(),
      first = createLexeme(lang.id, 'ɡa'),
      second = createLexeme(lang.id, 'ga')
    first.id = 'id-ɡ'
    second.id = 'id-g'
    project.lexemes.push(first, second)
    const before = serializeProject(project)
    expect(resolveFormInLanguage(project, lang.name, 'ga')).toEqual({ kind: 'lexeme', id: 'id-ɡ' })
    expect(looseKey('ɡá')).toBe(looseKey('gá'))
    expect(sentenceSimilarity('ɡa ga', 'ga ɡa')).toBe(1)
    expect(serializeProject(project)).toBe(before)
  })

  it('matches CSV overwrite by glyph equivalence, keeping existing identity and spelling', () => {
    const { project, lang } = fixture(),
      entry = createLexeme(lang.id, 'ɡa')
    entry.id = 'id-ɡ'
    project.lexemes.push(entry)
    const header = ['lemma', 'definition_en'],
      mapping = guessMapping(header, defaultMapping(lang.id, 2))
    mapping.overwriteExisting = true
    const report = applyCsvImport(project, [header, ['ga', 'updated']], mapping)
    expect(report.updated).toBe(1)
    expect(project.lexemes).toHaveLength(1)
    expect(project.lexemes[0]).toMatchObject({ id: 'id-ɡ', lemma: 'ɡa' })
  })
})
