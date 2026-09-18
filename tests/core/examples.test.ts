import { describe, expect, it } from 'vitest'
import { createLexeme, createPhrase, createProject, createSentence } from '$lib/core/factory'
import { findExamples, lexemeForms, markParts } from '$lib/core/examples'
import type { Analysis, Lexeme, Project, Sentence } from '$lib/core/model'

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

/** 把命中的位置切出原文里的那几段，方便断言 */
const cut = (h: { text: string; spans: { start: number; end: number }[] }): string[] =>
  h.spans.map((sp) => h.text.slice(sp.start, sp.end))

function token(surface: string, a?: Partial<Analysis>): Sentence['tokens'][number] {
  return {
    surface,
    analyses: a ? [{ lexemeId: null, slot: null, morphs: [], ...a }] : [],
    chosen: 0,
    confirmed: false
  }
}

describe('例句里命中的位置', () => {
  it('整词：标出来的就是那个词，两头的标点不算', () => {
    const { p, lang, abos } = setup()
    const s = createSentence(lang)
    s.text = 'nélu abos, ré'
    p.sentences.push(s)
    const [h] = findExamples(p, abos, ['zh'])
    expect(cut(h)).toEqual(['abos'])
    expect(h.spans).toEqual([{ start: 5, end: 9 }])
  })

  it('屈折形：分析里认的是这个词条，写法不一样也标得出来', () => {
    const { p, lang, abos } = setup()
    const s = createSentence(lang)
    s.text = 'thi abosen!'
    s.tokens = [token('thi'), token('abosen', { lexemeId: abos.id })]
    p.sentences.push(s)
    const [h] = findExamples(p, abos, ['zh'])
    expect(cut(h)).toEqual(['abosen'])
  })

  it('一句里出现两次：标两处', () => {
    const { p, lang, abos } = setup()
    const s = createSentence(lang)
    s.text = 'abos ké abos'
    s.tokens = [token('abos', { lexemeId: abos.id }), token('ké'), token('abos')]
    p.sentences.push(s)
    const [h] = findExamples(p, abos, ['zh'])
    expect(h.spans).toEqual([
      { start: 0, end: 4 },
      { start: 8, end: 12 }
    ])
    expect(cut(h)).toEqual(['abos', 'abos'])
  })

  it('连写的复合词：只标属于这个词条的那一段', () => {
    const { p, lang, abos } = setup()
    const nir = createLexeme(lang, 'nir')
    p.lexemes.push(nir)
    const s = createSentence(lang)
    s.text = 'sé wabosnir'
    s.tokens = [
      token('sé'),
      token('wabosnir', {
        morphs: [
          { form: 'wabos', gloss: '', morphemeId: null, lexemeId: abos.id },
          { form: '-nir', gloss: '', morphemeId: null, lexemeId: nir.id }
        ]
      })
    ]
    p.sentences.push(s)
    expect(cut(findExamples(p, abos, ['zh'])[0])).toEqual(['wabos'])
    expect(cut(findExamples(p, nir, ['zh'])[0])).toEqual(['nir'])
  })

  it('短语：正文里的那个词标出来，只在换一种说法里的不瞎标', () => {
    const { p, lang, abos } = setup()
    const ph = createPhrase(lang, '日常')
    ph.text = 'ta abos!'
    const ph2 = createPhrase(lang, '日常')
    ph2.text = 'ta nél'
    ph2.variants = [{ text: 'ta abos', note: '' }] as typeof ph2.variants
    p.phrasebook.push(ph, ph2)
    const hits = findExamples(p, abos, ['zh'])
    expect(hits.map((h) => h.id)).toEqual([ph.id, ph2.id])
    expect(cut(hits[0])).toEqual(['abos'])
    expect(hits[1].spans).toEqual([])
  })

  it('位置定不下来时一处都不标（原文改过、分词结果还是旧的）', () => {
    const { p, lang, abos } = setup()
    const s = createSentence(lang)
    s.text = 'nélu ré'
    s.tokens = [token('abos', { lexemeId: abos.id })]
    p.sentences.push(s)
    const [h] = findExamples(p, abos, ['zh'])
    expect(h.id).toBe(s.id)
    expect(h.spans).toEqual([])
    expect(markParts(h.text, h.spans)).toEqual([{ text: 'nélu ré', mark: false }])
  })

  it('markParts 把原文切成标与不标的几段，拼起来还是原文', () => {
    const parts = markParts('abos ké abos', [
      { start: 8, end: 12 },
      { start: 0, end: 4 }
    ])
    expect(parts).toEqual([
      { text: 'abos', mark: true },
      { text: ' ké ', mark: false },
      { text: 'abos', mark: true }
    ])
    expect(parts.map((x) => x.text).join('')).toBe('abos ké abos')
  })
})
