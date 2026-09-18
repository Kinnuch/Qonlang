/** 隔开写的词（`ma…gò`）：一句里按顺序找出各段，每段都挂上同一个词条 */
import { describe, it, expect } from 'vitest'
import { createLexeme, createProject, createSentence } from '$lib/core/factory'
import { analyzeSentence } from '$lib/engine/gloss'
import { splitParts } from '$lib/engine/gloss/discontinuous'

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  p.settings.glossLanguages = ['zh']
  const lid = p.languages[0].id
  const lex = (lemma: string, def: string) => {
    const l = createLexeme(lid, lemma)
    l.senses[0].definition = { zh: def }
    p.lexemes.push(l)
    return l
  }
  return { p, lid, lex }
}

describe('隔开写的词', () => {
  it('词头按 … 拆段，不足两段的不算', () => {
    expect(splitParts('ma…gò')).toEqual(['ma', 'gò'])
    expect(splitParts('nja...hi...kja')).toEqual(['nja', 'hi', 'kja'])
    expect(splitParts('hi…')).toEqual([])
    expect(splitParts('kaso')).toEqual([])
  })

  it('语料里隔着几个词也认得出，每一段都是那个词条', () => {
    const { p, lid, lex } = setup()
    const neg = lex('ma…gò', '否定（对于句子）')
    lex('nae', '种子')
    lex('fede', '看清')
    const s = createSentence(lid)
    s.text = 'nae ma fede tozu gò nae'
    p.sentences.push(s)
    analyzeSentence(p, s, { force: true })
    const rows = s.tokens.map((t) => [t.surface, t.analyses[t.chosen]?.morphs[0]?.gloss ?? ''])
    expect(rows).toEqual([
      ['nae', '种子'],
      ['ma', '否定'],
      ['fede', '看清'],
      ['tozu', ''],
      ['gò', '否定'],
      ['nae', '种子']
    ])
    const parts = s.tokens
      .map((t) => t.analyses[t.chosen]?.part)
      .filter(Boolean)
      .map((x) => `${x!.i}/${x!.n}`)
    expect(parts).toEqual(['0/2', '1/2'])
    expect(s.tokens[1].analyses[0].lexemeId).toBe(neg.id)
  })

  it('只有前一段、没有后一段时不挂上', () => {
    const { p, lid, lex } = setup()
    lex('ma…gò', '否定（对于句子）')
    const s = createSentence(lid)
    s.text = 'ma nae'
    p.sentences.push(s)
    analyzeSentence(p, s, { force: true })
    expect(s.tokens[0].analyses[0]?.part).toBeUndefined()
  })
})
