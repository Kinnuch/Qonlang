import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import { createSentence } from '$lib/core/factory'
import { tokenize, buildIndex, analyzeToken, analyzeSentence, interlinear, toLeipzig, toLatex, toHtml, toMarkdown, renderTemplate, coverage, corpusStats } from '$lib/engine/gloss'

const p = parseProject(readFileSync(join(__dirname, '..', '..', 'examples', 'Aelith.laim.json'), 'utf8'))
const L = p.languages[0]

describe('tokenize', () => {
  it('splits on whitespace and strips punctuation', () => {
    expect(tokenize('ilenler kasoda jatdu. “sen nölüm” sördün mü?')).toEqual(['ilenler', 'kasoda', 'jatdu', 'sen', 'nölüm', 'sördün', 'mü'])
  })
})

describe('analysis', () => {
  const idx = buildIndex(p, L.id)
  const b = p.settings.morphemeBoundaries
  it('finds lemmas, stems and morphemes', () => {
    expect(analyzeToken(idx, 'kaso', b)[0]).toMatchObject({ slot: null, morphs: [{ form: 'kaso', gloss: '房子' }] })
    expect(analyzeToken(idx, 've', b)[0].morphs[0].gloss).toBe('and')
  })
  it('strips suffix allomorphs, several layers deep', () => {
    const a = analyzeToken(idx, 'ilenler', b)[0]
    expect(a.morphs.map((m) => [m.form, m.gloss])).toEqual([
      ['ilen', '孩子'],
      ['ler', 'PL']
    ])
    const two = analyzeToken(idx, 'kasolarda', b)[0]
    expect(two.morphs.map((m) => m.gloss)).toEqual(['房子', 'PL', 'LOC'])
    expect(analyzeToken(idx, 'sördün', b)[0].morphs.map((m) => m.gloss)).toEqual(['看见', 'PST', '2SG.POSS'])
  })
  it('respects explicit boundaries written in the token', () => {
    const a = analyzeToken(idx, 'kaso-lar', b)[0]
    expect(a.morphs.map((m) => m.form)).toEqual(['kaso', 'lar'])
  })
  it('returns an empty list for unknown words', () => {
    expect(analyzeToken(idx, 'zzz', b)).toEqual([])
  })
})

describe('sentence analysis and rendering', () => {
  it('analyzes, keeps confirmed tokens and renders all formats', () => {
    const s = createSentence(L.id)
    s.text = 'ilenler kasoda jatdu.'
    s.translation = { zh: '孩子们在房子里睡了。', en: 'The children slept in the house.' }
    analyzeSentence(p, s)
    expect(s.tokens).toHaveLength(3)
    const il = interlinear(p, s, 'en')
    expect(il.words.map((w) => w.morphs)).toEqual(['ilen-ler', 'kaso-da', 'jat-du'])
    expect(il.words.map((w) => w.gloss)).toEqual(['孩子-PL', '房子-LOC', '睡-PST'])
    expect(il.translation).toBe('The children slept in the house.')
    expect(coverage(s)).toEqual({ total: 3, resolved: 3, confirmed: 0 })

    // 用户改成自定义分析并确认；重分析后保留
    s.tokens[0].analyses.unshift({ lexemeId: null, slot: null, morphs: [{ form: 'ilenler', gloss: 'kids', morphemeId: null }] })
    s.tokens[0].chosen = 0
    s.tokens[0].confirmed = true
    analyzeSentence(p, s)
    expect(interlinear(p, s).words[0].gloss).toBe('kids')
    // 已确认的分析成为其他句子的首选
    p.sentences.push(s)
    const s2 = createSentence(L.id)
    s2.text = 'ilenler'
    analyzeSentence(p, s2)
    expect(s2.tokens[0].analyses[0].morphs[0].gloss).toBe('kids')
    p.sentences.pop()

    const leipzig = toLeipzig(il)
    expect(leipzig.split('\n')[0]).toMatch(/^ilen-ler\s+kaso-da\s+jat-du$/)
    expect(toLatex(il)).toContain('\\gll ilen-ler kaso-da jat-du \\\\')
    expect(toHtml(il)).toContain('gl__g">孩子-PL<')
    expect(toMarkdown(il)).toContain('| ilen-ler | kaso-da | jat-du |')
    expect(renderTemplate('{{#tokens}}{{sep}}{{morphs}}/{{gloss}}{{/tokens}} = {{translation}}', il, s)).toBe('ilen-ler/孩子-PL kaso-da/房子-LOC jat-du/睡-PST = The children slept in the house.')
  })
  it('corpus statistics', () => {
    const s = createSentence(L.id)
    s.text = 'kaso kaso zzz'
    analyzeSentence(p, s)
    p.sentences.push(s)
    const st = corpusStats(p, L.id)
    expect(st.frequency[0]).toEqual({ surface: 'kaso', n: 2 })
    expect(st.unresolved).toEqual(['zzz'])
    expect(st.lexemeCoverage).toBeGreaterThan(0)
    p.sentences.pop()
  })
})
