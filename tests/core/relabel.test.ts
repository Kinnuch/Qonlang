/**
 * 维度取值改名、构形换维度顺序、词干槽改名之后，词条里按旧名存的屈折形、词干跟着挪到新名下。
 */
import { describe, it, expect } from 'vitest'
import { createLexeme, createProject, createScript, newId } from '$lib/core/factory'
import type { GrammaticalCategory, Paradigm, PartOfSpeech, SlotGenerator } from '$lib/core/model'
import {
  followSlotLabels,
  followStemRename,
  renameKeys,
  setDimensionOrder,
  slotLabels
} from '$lib/core/relabel'

const form = (surface: string) => ({ surface, derived: false, override: true, trace: [] })

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const L = p.languages[0]
  const num: GrammaticalCategory = {
    id: 'num',
    name: { zh: '数' },
    values: [
      { id: 'sg', name: { zh: '单' }, abbr: 'SG' },
      { id: 'pl', name: { zh: '复' }, abbr: 'PL' }
    ]
  }
  const kase: GrammaticalCategory = {
    id: 'case',
    name: { zh: '格' },
    values: [
      { id: 'nom', name: { zh: '主' }, abbr: 'NOM' },
      { id: 'acc', name: { zh: '宾' }, abbr: 'ACC' }
    ]
  }
  p.categories.push(num, kase)
  const pipe = (stem: string): SlotGenerator => ({ kind: 'pipeline', stem, steps: [] })
  const decl: Paradigm = {
    id: newId(),
    name: { zh: '名词' },
    variants: [],
    dimensionIds: ['num', 'case'],
    disabledSlots: [],
    generators: { 'sg|nom': pipe('词干'), 'pl|acc': pipe('') },
    inheritsFrom: null
  }
  p.paradigms.push(decl)
  const N: PartOfSpeech = {
    id: newId(),
    name: { zh: '名词' },
    abbr: 'n.',
    paradigmId: decl.id,
    stemSlots: [{ name: '词干', notes: '' }]
  }
  const V: PartOfSpeech = {
    id: newId(),
    name: { zh: '动词' },
    abbr: 'v.',
    paradigmId: null,
    stemSlots: [{ name: '词干', notes: '' }]
  }
  p.posList.push(N, V)
  const noun = createLexeme(L.id, 'kasa')
  noun.posId = N.id
  noun.stems = { 词干: 'kas' }
  noun.forms = { '单.主': form('kasa'), '复.宾': form('kasam'), 注: form('kasa!') }
  const verb = createLexeme(L.id, 'tur')
  verb.posId = V.id
  verb.stems = { 词干: 'tu' }
  verb.forms = { '单.主': form('tur') }
  p.lexemes.push(noun, verb)
  const sc = createScript('S')
  sc.from = 'form:单.主'
  L.scripts.push(sc)
  p.settings.lexiconColumns = ['pos', 'form:单.主', 'stem:词干']
  return { p, decl, N, V, noun, verb, sc, kase }
}

describe('renameKeys', () => {
  it('keeps order, swaps cleanly and refuses clashes', () => {
    expect(Object.keys(renameKeys({ a: 1, b: 2, c: 3 }, new Map([['b', 'x']]))!)).toEqual([
      'a',
      'x',
      'c'
    ])
    expect(
      renameKeys(
        { 'x.y': 1, 'y.x': 2 },
        new Map([
          ['x.y', 'y.x'],
          ['y.x', 'x.y']
        ])
      )
    ).toEqual({
      'y.x': 1,
      'x.y': 2
    })
    expect(renameKeys({ a: 1, b: 2 }, new Map([['a', 'b']]))).toBeNull()
    expect(renameKeys({ a: 1 }, new Map())).toBeNull()
  })
})

describe('followSlotLabels', () => {
  it('moves forms when a dimension value is renamed', () => {
    const { p, noun, verb, sc, kase } = setup()
    const before = slotLabels(p)
    kase.values[0].name.zh = '主格'
    expect(followSlotLabels(p, before)).toBe(1)
    expect(Object.keys(noun.forms)).toEqual(['单.主格', '复.宾', '注'])
    expect(noun.forms['单.主格'].surface).toBe('kasa')
    // 动词没有用这个构形，它的形式不动
    expect(Object.keys(verb.forms)).toEqual(['单.主'])
    expect(p.settings.lexiconColumns).toEqual(['pos', 'form:单.主格', 'stem:词干'])
    expect(sc.from).toBe('form:单.主格')
  })

  it('re-keys generators and disabled slots and moves forms when the dimension order changes', () => {
    const { p, decl, noun } = setup()
    noun.forms['宾.复'] = form('hand-written')
    decl.generators['sg|acc#v1'] = { kind: 'table' }
    decl.disabledSlots = ['pl|nom']
    expect(setDimensionOrder(p, decl, ['case', 'num'])).toBe(1)
    expect(decl.dimensionIds).toEqual(['case', 'num'])
    expect(Object.keys(decl.generators)).toEqual(['nom|sg', 'acc|pl', 'acc|sg#v1'])
    expect(decl.disabledSlots).toEqual(['nom|pl'])
    expect(noun.forms['主.单'].surface).toBe('kasa')
    // 新名下已经有手填的：旧名那条留着，不盖掉
    expect(noun.forms['宾.复'].surface).toBe('hand-written')
    expect(noun.forms['复.宾'].surface).toBe('kasam')
  })

  it('does nothing when labels did not change', () => {
    const { p, noun } = setup()
    const before = slotLabels(p)
    expect(followSlotLabels(p, before)).toBe(0)
    expect(Object.keys(noun.forms)).toEqual(['单.主', '复.宾', '注'])
  })
})

describe('followStemRename', () => {
  it('moves stems of words using that part of speech and updates references', () => {
    const { p, decl, N, noun, verb } = setup()
    N.stemSlots![0].name = '根'
    // 动词还有叫「词干」的词干槽：列里的 stem:词干 仍有人用，不改
    expect(followStemRename(p, N.id, '词干', '根')).toBe(1)
    expect(noun.stems).toEqual({ 根: 'kas' })
    expect(verb.stems).toEqual({ 词干: 'tu' })
    expect((decl.generators['sg|nom'] as { stem: string }).stem).toBe('根')
    expect(p.settings.lexiconColumns).toContain('stem:词干')
  })

  it('renames column and script references once nobody uses the old name', () => {
    const { p, N, V, verb, sc } = setup()
    p.lexemes = p.lexemes.filter((l) => l !== verb)
    p.posList = p.posList.filter((x) => x !== V)
    sc.from = 'stem:词干'
    N.stemSlots![0].name = '根'
    followStemRename(p, N.id, '词干', '根')
    expect(p.settings.lexiconColumns).toEqual(['pos', 'form:单.主', 'stem:根'])
    expect(sc.from).toBe('stem:根')
  })

  it('ignores empty or unchanged names', () => {
    const { p, N, noun } = setup()
    expect(followStemRename(p, N.id, '', '根')).toBe(0)
    expect(followStemRename(p, N.id, '词干', '词干')).toBe(0)
    expect(noun.stems).toEqual({ 词干: 'kas' })
  })
})
