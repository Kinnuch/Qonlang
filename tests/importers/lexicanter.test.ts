import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseLexc, lexicanterToProject, blocksToMarkdown } from '$lib/importers/lexicanter'
import { parseProject, serializeProject } from '$lib/core/serialize'

const file = parseLexc(readFileSync(join(__dirname, '..', 'fixtures', 'lexicanter', 'sample.lexc'), 'utf8'))
const { project: p, report } = lexicanterToProject(file, { definitionLang: 'en', uiLocale: 'zh', appVersion: '0' })

describe('lexicanter import', () => {
  it('creates the main language and relatives', () => {
    expect(report.languages).toEqual(['Sample', 'Proto-Sample'])
    expect(p.languages.map((l) => l.name)).toEqual(['Sample', 'Proto-Sample'])
    expect(p.settings.defaultLanguageId).toBe(p.languages[0].id)
  })
  it('imports words with senses, tags, lects and pronunciations', () => {
    const kama = p.lexemes.find((l) => l.lemma === 'kama')!
    expect(kama.senses.map((s) => s.definition.en)).toEqual(['house', 'home'])
    expect(kama.senses[1].tags).toEqual(['noun', 'figurative'])
    expect(kama.tags).toEqual(['noun', 'figurative'])
    const north = p.languages[0].dialects.find((d) => d.name === 'North')!
    expect(kama.senses[1].dialectIds).toEqual([north.id])
    const ortho = p.languages[0].orthographies[0]
    expect(kama.pronunciations[ortho.id]).toEqual({ ipa: 'kama', irregular: false })
    expect(kama.notes).toContain('kɑma')
    expect(report.lexemes).toBe(4)
  })
  it('links etymologies inside the language and to relatives', () => {
    const kamathal = p.lexemes.find((l) => l.lemma === 'kamathal')!
    const kama = p.lexemes.find((l) => l.lemma === 'kama')!
    const thal = p.lexemes.find((l) => l.lemma === 'thal')!
    const kam = p.lexemes.find((l) => l.lemma === 'kam')!
    expect(kamathal.etymology.sources).toEqual([
      { kind: 'lexeme', id: kama.id },
      { kind: 'lexeme', id: thal.id }
    ])
    expect(kama.etymology.sources).toEqual([{ kind: 'lexeme', id: kam.id }])
    expect(kam.languageId).toBe(p.languages[1].id)
  })
  it('converts pronunciation rules, orthographies, alphabet and phonotactics', () => {
    const lang = p.languages[0]
    expect(lang.orthographies[0].rulesToIpa).toBe('th > θ\nk > k')
    expect(p.ruleSets).toHaveLength(1)
    expect(p.ruleSets[0].text).toBe('th > θ\na > ɑ')
    expect(lang.orthographies[1].name).toBe('Native')
    expect(lang.orthographies[1].rulesFromIpa).toBe('th > þ')
    expect(lang.alphabet).toContain('th')
    expect(lang.phonotactics.onsets).toEqual(['k', 't', 'th', 'm', 'n'])
    expect(lang.phonotactics.illegal).toEqual(['tt'])
  })
  it('imports phrasebook and docs', () => {
    expect(p.phrasebook).toHaveLength(1)
    expect(p.phrasebook[0].variants[0].text).toBe('thal kama!')
    expect(p.docs.map((d) => d.title)).toEqual(['Sample · Lexicanter 文档', '屈折表 · noun'])
    expect(p.docs[0].markdown).toContain('## Grammar')
    expect(p.docs[0].markdown).toContain('**SOV**')
    expect(p.docs[1].markdown).toContain('| nom | - | -i |')
  })
  it('produces a project that survives serialization', () => {
    expect(parseProject(serializeProject(p))).toEqual(p)
  })
  it('blocksToMarkdown keeps unknown blocks as json', () => {
    expect(blocksToMarkdown([{ type: 'weird', data: { a: 1 } }])).toContain('```json')
  })
})
