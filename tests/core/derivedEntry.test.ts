import { describe, expect, it } from 'vitest'
import { createLexeme } from '$lib/core/factory'
import { createDerivedLexeme } from '$lib/core/derivedEntry'
import { lexemeHasDefinition } from '$lib/core/lexiconIssues'

describe('构形推出来的形式生成词条', () => {
  it('词源是派生、来源和关系都挂原来的词条，备注写构形与槽位', () => {
    const base = createLexeme('L', 'kant-')
    const l = createDerivedLexeme({
      languageId: 'L',
      lemma: ' kantando ',
      base,
      paradigmName: '动词',
      slotLabel: '动名词',
      definitions: { zh: '唱歌（这件事）', en: '' },
      tags: ['构形', '构形', ' ']
    })
    expect(l.lemma).toBe('kantando')
    expect(l.etymology).toMatchObject({
      type: 'derivation',
      sources: [{ kind: 'lexeme', id: base.id }],
      notes: '动词 · 动名词'
    })
    expect(l.relations).toEqual([{ kind: 'derivation', lexemeId: base.id }])
    expect(l.senses[0].definition).toEqual({ zh: '唱歌（这件事）' })
    expect(l.tags).toEqual(['构形'])
  })

  it('只生成形式、词源和关系：没有义项，词库会提醒缺释义；自由输入的没有来源词条', () => {
    const l = createDerivedLexeme({
      languageId: 'L',
      lemma: 'mirando',
      base: null,
      paradigmName: '动词',
      slotLabel: '动名词'
    })
    expect(l.senses).toEqual([])
    expect(lexemeHasDefinition(l)).toBe(false)
    expect(l.etymology.sources).toEqual([])
    expect(l.relations).toEqual([])
  })
})
