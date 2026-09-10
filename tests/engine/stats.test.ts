import { describe, it, expect } from 'vitest'
import {
  createLanguage,
  createLexeme,
  createMorpheme,
  createProject,
  createSentence
} from '$lib/core/factory'
import { corpusStatsFull, lexiconStats, morphemeStats, wordLength } from '$lib/engine/stats'
import { checkConsistency, groupIssues } from '$lib/engine/consistency'

function build() {
  const project = createProject({ name: 'p', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const lang = createLanguage({ name: 'L' })
  lang.alphabet = ['a', 'b', 'ch', 'e', 'k', 'l', 'n', 'o', 's', 'd', 'i', 'r', 'j', 't', 'u']
  project.languages.push(lang)
  const kaso = createLexeme(lang.id, 'kaso')
  kaso.senses[0].definition = { zh: '房子' }
  const ilen = createLexeme(lang.id, 'ilen')
  const dup = createLexeme(lang.id, 'ilen')
  const cha = createLexeme(lang.id, 'chab')
  cha.senses[0].definition = { zh: 'x' }
  cha.tags = ['t']
  project.lexemes.push(kaso, ilen, dup, cha)
  const pl = createMorpheme(lang.id, 'suffix')
  pl.form = '-ler'
  pl.gloss = 'PL'
  const unused = createMorpheme(lang.id, 'root')
  unused.form = 'zzz'
  project.morphemes.push(pl, unused)
  const s = createSentence(lang.id)
  s.text = 'ilen-ler kaso'
  s.source = 'A'
  s.tokens = [
    {
      surface: 'ilen-ler',
      chosen: 0,
      confirmed: true,
      analyses: [
        {
          lexemeId: ilen.id,
          slot: null,
          morphs: [
            { form: 'ilen', gloss: '孩子', morphemeId: null },
            { form: 'ler', gloss: 'PL', morphemeId: pl.id }
          ]
        }
      ]
    },
    {
      surface: 'kaso',
      chosen: 0,
      confirmed: false,
      analyses: [
        { lexemeId: kaso.id, slot: null, morphs: [{ form: 'kaso', gloss: '?', morphemeId: null }] }
      ]
    }
  ]
  project.sentences.push(s)
  return { project, lang, kaso, ilen, pl, unused }
}

describe('wordLength', () => {
  it('counts multigraphs from the alphabet as one letter', () => {
    expect(wordLength('chab', ['ch', 'a', 'b'])).toBe(3)
    expect(wordLength('chab', [])).toBe(4)
  })
})

describe('lexiconStats', () => {
  it('counts fields, buckets and corpus usage', () => {
    const { project, lang } = build()
    const st = lexiconStats(project, lang.id)
    expect(st.total).toBe(4)
    expect(st.withDefinition).toBe(2)
    expect(st.usedInCorpus).toBe(2)
    expect(st.unusedInCorpus).toBe(2)
    expect(st.duplicateLemmas).toBe(1)
    expect(st.byTag).toEqual([{ key: 't', label: 't', n: 1 }])
    expect(st.byInitial.find((b) => b.label === 'ch')?.n).toBe(1)
    expect(st.topUsed[0].n).toBe(1)
  })
})

describe('morphemeStats', () => {
  it('finds used and unused morphemes', () => {
    const { project, lang, unused } = build()
    const st = morphemeStats(project, lang.id)
    expect(st.total).toBe(2)
    expect(st.usedInCorpus).toBe(1)
    expect(st.unused.map((u) => u.id)).toEqual([unused.id])
    expect(st.byType.map((b) => b.key).sort()).toEqual(['root', 'suffix'])
  })
})

describe('corpusStatsFull', () => {
  it('summarises tokens, confirmation and coverage', () => {
    const { project, lang } = build()
    const st = corpusStatsFull(project, lang.id)
    expect(st.sentences).toBe(1)
    expect(st.tokens).toBe(2)
    expect(st.confirmedTokens).toBe(1)
    expect(st.resolvedTokens).toBe(1)
    expect(st.unresolved).toEqual(['kaso'])
    expect(st.lexemeCoverage).toBeCloseTo(0.5)
    expect(st.bySource[0]).toEqual({ key: 'A', label: 'A', n: 1 })
    expect(st.byGloss[0].key).toBe('PL')
  })
})

describe('checkConsistency', () => {
  it('reports missing definitions, duplicates, unresolved tokens and unknown abbreviations', () => {
    const { project, lang, ilen } = build()
    const issues = checkConsistency(project, lang.id)
    const kinds = new Set(issues.map((i) => i.kind))
    expect(kinds.has('lexeme.noDefinition')).toBe(true)
    expect(kinds.has('lexeme.duplicate')).toBe(true)
    expect(kinds.has('sentence.unresolved')).toBe(true)
    expect(kinds.has('abbr.missing')).toBe(true)
    expect(
      issues.find((i) => i.kind === 'lexeme.noDefinition' && i.targetId === ilen.id)
    ).toBeTruthy()
    const groups = groupIssues(issues)
    expect(groups[0].severity).not.toBe('info')
  })
  it('flags broken references', () => {
    const { project, lang, kaso } = build()
    kaso.relations.push({ kind: 'syn', lexemeId: 'nope' })
    kaso.etymology.sources.push({ kind: 'morpheme', id: 'gone' })
    const issues = checkConsistency(project, lang.id)
    expect(issues.some((i) => i.kind === 'lexeme.brokenRelation')).toBe(true)
    expect(issues.some((i) => i.kind === 'lexeme.brokenSource')).toBe(true)
  })
})
