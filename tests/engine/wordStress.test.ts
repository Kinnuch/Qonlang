import { describe, it, expect } from 'vitest'
import {
  createLexeme,
  createMorpheme,
  createProject,
  createRuleSet,
  newId
} from '$lib/core/factory'
import { inferFeatures } from '$lib/ipa/features'
import type { Paradigm, PartOfSpeech } from '$lib/core/model'
import {
  formatStressText,
  parseRuleText,
  parseStressText,
  runRules,
  type WordStress
} from '$lib/engine/sca'
import { lexemeStress, morphemeStress, stressForWord } from '$lib/core/stressInfo'
import { derivePronunciations } from '$lib/core/pronounce'
import { planEvolution } from '$lib/engine/evolve'
import { generateForm, makeContext, paradigmSlots } from '$lib/engine/morph'

const V = 'V=aeiou\nC=ptkbdgmnlrsh'
const run = (rules: string, word: string, info?: WordStress): string =>
  runRules(parseRuleText(`${V}\n${rules}`), word, { word: info }).output

describe('重音规则接收词条的词类与特殊重音', () => {
  it('写法：@、<词类>、0 拆开再拼回去不变', () => {
    const text = '@ , <动词|形容词> (2+) -1 , <!名词> 0 , 1 | · -1'
    const d = parseStressText(text)
    expect(d.errors).toEqual([])
    expect(d.special).toBe(true)
    expect(d.clauses.map((c) => [c.pos, c.position])).toEqual([
      ['动词|形容词', '-1'],
      ['!名词', '0'],
      ['', '1']
    ])
    expect(d.split).toBe('·')
    expect(formatStressText(d)).toBe(text)
  })
  it('<词类> 只对传了这个词类的词生效', () => {
    const rules = 'ˈ = <动词> -1 , 1'
    expect(run(rules, 'katana')).toBe('ˈkatana')
    expect(run(rules, 'katana', { pos: ['动词', 'v.'] })).toBe('kataˈna')
    expect(run(rules, 'katana', { pos: ['名词'] })).toBe('ˈkatana')
    expect(run('ˈ = <!名词> -1 , 1', 'katana', { pos: ['动词'] })).toBe('kataˈna')
    expect(run('ˈ = <V.> -1 , 1', 'katana', { pos: ['v.'] })).toBe('kataˈna')
  })
  it('0 是不重读', () => {
    expect(run('ˈ = <小品词> 0 , 1', 'kana', { pos: ['小品词'] })).toBe('kana')
    expect(run('ˈ = <小品词> 0 , 1', 'kana')).toBe('ˈkana')
  })
  it('写了 @ 时整个词按特殊重音；没写 @ 的规则不理它', () => {
    expect(run('ˈ = @ , 1', 'katana', { stress: -1 })).toBe('kataˈna')
    expect(run('ˈ = @ , 1', 'katana', { stress: 2 })).toBe('kaˈtana')
    expect(run('ˈ = @ , 1', 'katana', { stress: 0 })).toBe('katana')
    expect(run('ˈ = @ , 1', 'katana', { stress: 9 })).toBe('kataˈna')
    expect(run('ˈ = @ , 1', 'katana')).toBe('ˈkatana')
    expect(run('ˈ = 1', 'katana', { stress: -1 })).toBe('ˈkatana')
    // 复合词：特殊重音数整个词的音节，其余段不另标
    expect(run('ˈ = @ , 1 | · -1', 'kata·na', { stress: 2 })).toBe('kaˈta·na')
    // 次重音规则不管特殊重音
    expect(run('ˈ = @ , 1\nˌ = @ , -1', 'katana', { stress: 2 })).toBe('kaˈtaˌna')
  })
  it('特殊重音决定了后面的音变', () => {
    const rules = 'ˈ = @ , 1\na > o / ˈ(C)_'
    expect(run(rules, 'kata', { stress: -1 })).toBe('kaˈto')
    expect(run(rules, 'kata')).toBe('ˈkota')
  })
})

function project() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const L = p.languages[0]
  L.phonemes = 'k t n l r s m a e i o u'
    .split(' ')
    .map((s) => ({ id: newId(), symbol: s, features: inferFeatures(s), graphemes: {}, notes: '' }))
  L.classes = [
    { id: newId(), name: 'V', members: 'a e i o u'.split(' '), featureQuery: null },
    { id: newId(), name: 'C', members: 'k t n l r s m'.split(' '), featureQuery: null }
  ]
  const verb: PartOfSpeech = {
    id: newId(),
    name: { zh: '动词', en: 'verb' },
    abbr: 'v.',
    paradigmId: null,
    stemSlots: []
  }
  const noun: PartOfSpeech = {
    id: newId(),
    name: { zh: '名词', en: 'noun' },
    abbr: 'n.',
    paradigmId: null,
    stemSlots: []
  }
  p.posList.push(verb, noun)
  return { p, L, verb, noun }
}

describe('词库、语素的「对重音影响」', () => {
  it('没勾不传；勾了按两个小勾传词类、特殊重音', () => {
    const { p, L, verb } = project()
    const l = createLexeme(L.id, 'katana')
    l.posId = verb.id
    expect(lexemeStress(p, l)).toBeUndefined()
    l.stress = { affects: true, passPos: true, passSpecial: false, special: -1 }
    expect(lexemeStress(p, l)).toEqual({ pos: ['动词', 'verb', 'v.', 'v'] })
    l.stress = { affects: true, passPos: false, passSpecial: true, special: -1 }
    expect(lexemeStress(p, l)).toEqual({ stress: -1 })
    l.stress = { affects: false, passPos: true, passSpecial: true, special: -1 }
    expect(lexemeStress(p, l)).toBeUndefined()
  })
  it('语素传类型和「算作」的词类', () => {
    const { p, L, noun } = project()
    const m = createMorpheme(L.id, 'suffix')
    m.form = '-na'
    m.stress = { affects: true, passPos: true, passSpecial: true, special: 1, posId: noun.id }
    expect(morphemeStress(p, m)).toEqual({
      pos: ['suffix', '后缀', 'suffix', '名词', 'noun', 'n.', 'n'],
      stress: 1
    })
    p.morphemes.push(m)
    expect(stressForWord(p, L.id, 'na')?.stress).toBe(1)
    // 算作复合词类：组成它的词类也算，<名词> 对得上
    const { p: q, L: M, verb: v2, noun: n2 } = project()
    const both: PartOfSpeech = {
      id: newId(),
      name: { zh: '名词/动词' },
      abbr: 'n./v.',
      paradigmId: null,
      stemSlots: [],
      components: [n2.id, v2.id]
    }
    q.posList.push(both)
    const m2 = createMorpheme(M.id, 'suffix')
    m2.stress = { affects: true, passPos: true, passSpecial: false, special: 1, posId: both.id }
    expect(morphemeStress(q, m2)?.pos).toEqual(
      expect.arrayContaining(['名词/动词', '名词', 'noun', '动词', 'verb'])
    )
  })
  it('测试台敲的词按词头（去掉连字符）找词条', () => {
    const { p, L } = project()
    const l = createLexeme(L.id, 'kata-')
    l.stress = { affects: true, passPos: false, passSpecial: true, special: -1 }
    p.lexemes.push(l)
    expect(stressForWord(p, L.id, 'kata')).toEqual({ stress: -1 })
    expect(stressForWord(p, L.id, 'kato')).toBeUndefined()
  })
  it('自动标音：正字法里的重音规则用到词条的特殊重音', () => {
    const { p, L } = project()
    L.orthographies[0].rulesToIpa = 'ˈ = @ , 1'
    const l = createLexeme(L.id, 'katana')
    l.stress = { affects: true, passPos: false, passSpecial: true, special: -2 }
    derivePronunciations(L, l, p)
    expect(l.pronunciations[L.orthographies[0].id].ipa).toBe('kaˈtana')
  })
  it('整库演化把词条的特殊重音交给重音规则', () => {
    const { p, L } = project()
    const rs = createRuleSet('x', `${V}\nˈ = @ , 1\na > o / ˈ(C)_`)
    p.ruleSets.push(rs)
    const a = createLexeme(L.id, 'kata')
    a.stress = { affects: true, passPos: false, passSpecial: true, special: -1 }
    const b = createLexeme(L.id, 'sata')
    p.lexemes.push(a, b)
    const rows = planEvolution(p, {
      ruleSet: rs,
      program: parseRuleText(rs.text),
      sourceLanguageId: L.id,
      targetLanguageId: L.id
    })
    expect(rows.map((r) => r.output)).toEqual(['kato', 'sota'])
  })
  it('构形里加词缀时特殊重音跟着挪，重读的词缀改到词缀上', () => {
    const { p, L } = project()
    p.categories.push({
      id: 'num',
      name: { zh: '数' },
      values: [
        { id: 'pl', name: { zh: '复数' }, abbr: 'PL' },
        { id: 'du', name: { zh: '双数' }, abbr: 'DU' }
      ]
    })
    const rs = createRuleSet('x', `${V}\nˈ = @ , 1\na > o / ˈ(C)_`)
    p.ruleSets.push(rs)
    const pl = createMorpheme(L.id, 'suffix')
    pl.form = '-lar'
    pl.gloss = 'PL'
    const du = createMorpheme(L.id, 'suffix')
    du.form = '-na'
    du.gloss = 'DU'
    du.stress = { affects: true, passPos: false, passSpecial: true, special: 1 }
    p.morphemes.push(pl, du)
    const sca = { id: newId(), kind: 'sca' as const, ruleSetId: rs.id, fromStage: '', toStage: '' }
    const para: Paradigm = {
      id: 'x',
      name: {},
      dimensionIds: ['num'],
      disabledSlots: [],
      generators: {
        pl: {
          kind: 'pipeline',
          stem: '',
          steps: [{ id: newId(), kind: 'suffix', text: '@PL' }, sca]
        },
        du: {
          kind: 'pipeline',
          stem: '',
          steps: [{ id: newId(), kind: 'suffix', text: '@DU' }, sca]
        }
      },
      inheritsFrom: null
    }
    p.paradigms.push(para)
    const ctx = makeContext(p, L)
    const slots = paradigmSlots(para, p.categories, ['zh'])
    const w = createLexeme(L.id, 'kata')
    w.stress = { affects: true, passPos: false, passSpecial: true, special: -1 }
    // kata 重音在 ta：加了 -lar 还在 ta 上
    expect(generateForm(ctx, w, para, slots[0])?.surface).toBe('katolar')
    // -na 自己重读：改到 na 上
    expect(generateForm(ctx, w, para, slots[1])?.surface).toBe('katano')
  })
})
