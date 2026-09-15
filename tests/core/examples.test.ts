import { describe, expect, it } from 'vitest'
import { createLexeme, createProject, createSentence } from '$lib/core/factory'
import { findExamples, lexemeForms } from '$lib/core/examples'
import type { Lexeme, Project } from '$lib/core/model'

function setup(): { p: Project; lang: string; abos: Lexeme } {
  const p = createProject({ name: 't', template: 'blank', appVersion: '', uiLocale: 'zh' })
  const lang = p.languages[0].id
  const abos = createLexeme(lang, 'abos')
  abos.stems = { 词干元音: 'a' }
  abos.forms = {
    弱失焦: { surface: 'a.abs', derived: true, override: false, trace: [] },
    动名词: { surface: 'wabos, wabus', derived: false, override: true, trace: [] }
  }
  p.lexemes.push(abos)
  return { p, lang, abos }
}

describe('词条的例句', () => {
  it('词干不拿来整词匹配，一格里写的几个形式拆开认', () => {
    const { abos } = setup()
    const forms = lexemeForms(abos)
    expect(forms.has('a')).toBe(false)
    expect(forms.has('abos')).toBe(true)
    expect(forms.has('wabus')).toBe(true)
  })

  it('只有单独一个 a 的句子、文档行不算这个词的例句', () => {
    const { p, lang, abos } = setup()
    const s1 = createSentence(lang)
    s1.text = 'sé falth a nól'
    const s2 = createSentence(lang)
    s2.text = 'wabus iélan'
    p.sentences.push(s1, s2)
    p.docs.push({
      id: 'd1',
      title: '元音',
      languageId: lang,
      markdown: '| a | e | i | o | u |',
      createdAt: '',
      updatedAt: ''
    } as Project['docs'][number])
    const hits = findExamples(p, abos, ['zh'])
    expect(hits.map((h) => h.id)).toEqual([s2.id])
  })

  it('黏着的词头（带连字符）不按词头匹配，确认成别的词条的同形词也不算', () => {
    const { p, lang } = setup()
    const al = createLexeme(lang, 'al-')
    p.lexemes.push(al)
    const other = createLexeme(lang, 'kel')
    p.lexemes.push(other)
    const s = createSentence(lang)
    s.text = 'al kel'
    s.tokens = [
      { surface: 'al', analyses: [], chosen: 0, confirmed: false },
      {
        surface: 'kel',
        analyses: [{ lexemeId: other.id, slot: null, morphs: [] }],
        chosen: 0,
        confirmed: true
      }
    ] as typeof s.tokens
    p.sentences.push(s)
    expect(findExamples(p, al, ['zh'])).toEqual([])
    const kel2 = createLexeme(lang, 'kel')
    p.lexemes.push(kel2)
    expect(findExamples(p, kel2, ['zh'])).toEqual([])
    expect(findExamples(p, other, ['zh']).map((h) => h.id)).toEqual([s.id])
  })
})
