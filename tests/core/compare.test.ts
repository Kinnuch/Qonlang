/**
 * 关系图的对比：同一个词根来源的几组词、从词根到词的路径与构成、按规则集重推的音变、语音对应。
 * 例词随手编的，不对应任何真实语言。
 */
import { describe, expect, it } from 'vitest'
import {
  createLanguage,
  createLexeme,
  createMorpheme,
  createProject,
  createRuleSet
} from '$lib/core/factory'
import type { Lexeme, Project } from '$lib/core/model'
import {
  ancestorsOf,
  alignForms,
  compareContext,
  compareGroups,
  correspondences,
  meaningPieces,
  soundPathOfWord,
  wordPath,
  type ProgramCache
} from '$lib/core/compare'

function word(p: Project, languageId: string, lemma: string, zh: string): Lexeme {
  const l = createLexeme(languageId, lemma)
  l.senses[0].definition = { zh }
  p.lexemes.push(l)
  return l
}

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  p.settings.glossLanguages = ['zh']
  const P = createLanguage({ name: 'Proto', abbr: 'P' })
  const A = p.languages[0]
  A.name = 'Alpha'
  const B = createLanguage({ name: 'Beta', abbr: 'B' })
  p.languages.push(P, B)
  const root = createMorpheme(P.id, 'root')
  root.form = 'kasu'
  root.gloss = 'house'
  const lu = createMorpheme(A.id, 'suffix')
  lu.form = '-lu'
  lu.gloss = 'having'
  p.morphemes.push(root, lu)
  const kaso = word(p, A.id, 'kaso', '房子')
  kaso.etymology.type = 'inherited'
  kaso.etymology.sources = [{ kind: 'morpheme', id: root.id }]
  const hasu = word(p, B.id, 'hasu', '帐篷')
  hasu.etymology.type = 'inherited'
  hasu.etymology.sources = [{ kind: 'morpheme', id: root.id }]
  const kasolu = word(p, A.id, 'kasolu', '有房子的')
  kasolu.etymology.type = 'derivation'
  kasolu.etymology.sources = [
    { kind: 'lexeme', id: kaso.id },
    { kind: 'morpheme', id: lu.id }
  ]
  const teli = word(p, A.id, 'teli', '水')
  const telikaso = word(p, A.id, 'telikaso', '水房子，澡堂')
  telikaso.etymology.type = 'compound'
  telikaso.etymology.sources = [
    { kind: 'lexeme', id: teli.id },
    { kind: 'lexeme', id: kaso.id }
  ]
  const toA = createRuleSet('P → A', '-* 祖语\nu > o / _#\n-* 现代')
  toA.stageLanguages = { 祖语: P.id, 现代: A.id }
  const toB = createRuleSet('P → B', '-* 祖语\nk > h / #_\n-* 现代')
  toB.stageLanguages = { 祖语: P.id, 现代: B.id }
  p.ruleSets.push(toA, toB)
  return { p, P, A, B, root, lu, kaso, hasu, kasolu, teli, telikaso }
}

describe('compareGroups', () => {
  it('跨语言的同源词排第一组，中心词在最前，别的语言的词随后', () => {
    const { p, root, kaso, hasu, kasolu, telikaso } = setup()
    const ctx = compareContext(p, ['zh'])
    const groups = compareGroups(ctx, kaso)
    expect(groups[0].root.key).toBe(`m:${root.id}`)
    expect(groups[0].languageCount).toBe(2)
    expect(groups[0].lexemes.map((l) => l.lemma)).toEqual([
      kaso.lemma,
      hasu.lemma,
      kasolu.lemma,
      telikaso.lemma
    ])
  })
  it('中心词自己也是词根：由它派生的两个词成一组（同一语言）', () => {
    const { p, kaso } = setup()
    const groups = compareGroups(compareContext(p, ['zh']), kaso)
    const self = groups.find((g) => g.root.key === `l:${kaso.id}`)
    expect(self?.lexemes.map((l) => l.lemma)).toEqual(['kasolu', 'telikaso'])
    expect(self?.languageCount).toBe(1)
  })
  it('只有自己一个的词没有对比', () => {
    const { p, teli } = setup()
    const groups = compareGroups(compareContext(p, ['zh']), teli)
    // teli 只派生了 telikaso 一个词
    expect(groups).toEqual([])
  })
  it('词缀不算词根', () => {
    const { p, kasolu, lu } = setup()
    const anc = ancestorsOf(compareContext(p, ['zh']), `l:${kasolu.id}`)
    expect(anc.has(`m:${lu.id}`)).toBe(false)
    expect(anc.size).toBe(2) // kaso 与 kasu
  })
  it('词源成环也能算完', () => {
    const { p, A } = setup()
    const x = word(p, A.id, 'x', 'x')
    const y = word(p, A.id, 'y', 'y')
    x.etymology.sources = [{ kind: 'lexeme', id: y.id }]
    y.etymology.sources = [{ kind: 'lexeme', id: x.id }]
    const anc = ancestorsOf(compareContext(p, ['zh']), `l:${x.id}`)
    expect([...anc.keys()]).toEqual([`l:${y.id}`])
  })
})

describe('wordPath', () => {
  it('路径与一路加进来的成分：派生加了后缀，复合加了另一个词', () => {
    const { p, kaso, kasolu, telikaso } = setup()
    const ctx = compareContext(p, ['zh'])
    const a = wordPath(ctx, kasolu, `l:${kaso.id}`)
    expect(a.steps.map((s) => [s.from.ref.label, s.to.label, s.type])).toEqual([
      ['kaso', 'kasolu', 'derivation']
    ])
    expect(a.components.map((c) => [c.ref.label, c.ref.morphemeType])).toEqual([['-lu', 'suffix']])
    const b = wordPath(ctx, telikaso, `l:${kaso.id}`)
    expect(b.components.map((c) => c.ref.label)).toEqual(['teli'])
  })
  it('自定义来源按边界拆开：同一个成分算同一个词根，后缀与单个字母不算', () => {
    const { p } = setup()
    const T = createLanguage({ name: 'Old', abbr: 'O' })
    const M = createLanguage({ name: 'Modern', abbr: 'M' })
    p.languages.push(T, M)
    const ren = createMorpheme(T.id, 'suffix')
    ren.form = '-ren'
    ren.gloss = 'NMLZ'
    p.morphemes.push(ren)
    const one = word(p, M.id, 'nerrin', '人偶')
    one.etymology.sources = [{ kind: 'external', language: 'Old', form: 'nder-ren', meaning: '' }]
    const two = word(p, M.id, 'anerrin', '逆流的人偶')
    two.etymology.sources = [
      { kind: 'external', language: 'Old', form: 'a-nder-ren-eh', meaning: '' }
    ]
    const ctx = compareContext(p, ['zh'])
    const groups = compareGroups(ctx, two)
    expect(groups.map((g) => g.root.label)).toEqual(['nder'])
    expect(groups[0].lexemes.map((l) => l.lemma)).toEqual(['anerrin', 'nerrin'])
    const path = wordPath(ctx, two, groups[0].root.key)
    expect(path.components.map((c) => c.ref.label)).toEqual(['a', '-ren', 'eh'])
  })
})

describe('soundPathOfWord', () => {
  it('按规则集里阶段绑定的语言从词根推到每个词，列出用上的规则', () => {
    const { p, root, kaso, hasu, kasolu } = setup()
    const ctx = compareContext(p, ['zh'])
    const cache: ProgramCache = new Map()
    const rk = `m:${root.id}`
    const a = soundPathOfWord(ctx, cache, kaso, wordPath(ctx, kaso, rk))
    expect(a?.path.output).toBe('kaso')
    expect(a?.path.matches).toBe(true)
    expect(a?.path.rules.map((r) => r.rule)).toEqual(['u > o / _#'])
    const b = soundPathOfWord(ctx, cache, hasu, wordPath(ctx, hasu, rk))
    expect(b?.path.ruleSetName).toBe('P → B')
    expect(b?.path.rules.map((r) => [r.before, r.after])).toEqual([['kasu', 'hasu']])
    // 派生词没有自己的音变：给的是它的上一代（kaso）的继承
    const c = soundPathOfWord(ctx, cache, kasolu, wordPath(ctx, kasolu, rk))
    expect(c?.via).toBe('kaso')
  })
  it('推出来跟词库对不上时标出来', () => {
    const { p, root, hasu } = setup()
    hasu.lemma = 'hazu'
    const ctx = compareContext(p, ['zh'])
    const r = soundPathOfWord(ctx, new Map(), hasu, wordPath(ctx, hasu, `m:${root.id}`))
    expect(r?.path.output).toBe('hasu')
    expect(r?.path.matches).toBe(false)
  })
})

describe('意思与语音对应', () => {
  it('释义按标点拆块', () => {
    expect(meaningPieces('水房子，澡堂；洗澡的地方')).toEqual(['水房子', '澡堂', '洗澡的地方'])
  })
  it('逐音对齐：替换、脱落、增音', () => {
    expect(alignForms('kasu', 'hasu')).toEqual([
      ['k', 'h'],
      ['a', 'a'],
      ['s', 's'],
      ['u', 'u']
    ])
    expect(alignForms('teli', 'tel').filter(([a, b]) => a !== b)).toEqual([['i', '']])
  })
  it('只留下有变化或各词不一样的位置', () => {
    const rows = correspondences('kasu', [
      { id: 'a', form: 'kaso' },
      { id: 'b', form: 'hasu' }
    ])
    expect(rows).toEqual([
      { source: 'k', reflex: { a: 'k', b: 'h' } },
      { source: 'u', reflex: { a: 'o', b: 'u' } }
    ])
  })
})
