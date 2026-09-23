/**
 * 译文工作台的附着台：认出词类，把能跟这个词搭的东西分门别类找出来，再按挑好的拼出这个词。
 * 用两个示例工程（Aelith 黏着语、Tsahun 孤立语）和一个现搭的「动词头」小项目。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import { createLanguage, createLexeme, createProject, newId } from '$lib/core/factory'
import type { GrammaticalCategory, Paradigm, PartOfSpeech, Project } from '$lib/core/model'
import { makeContext } from '$lib/engine/morph'
import { pinChoices } from '$lib/engine/compose'
import {
  buildWord,
  companionPiece,
  companionsFor,
  deckModel,
  glossParts,
  hostInfo,
  markerCatalog,
  markersFor,
  morphsOf,
  pieceFor,
  recognize,
  type DeckEnv,
  type WordSpec
} from '$lib/engine/attach'

const load = (name: string): Project =>
  parseProject(readFileSync(join(__dirname, '..', '..', 'examples', name), 'utf8'))

function envOf(p: Project, languageName: string): DeckEnv {
  const L = p.languages.find((l) => l.name === languageName)!
  const glossLangs = ['zh', 'en']
  return {
    project: p,
    ctx: makeContext(p, L),
    glossLangs,
    languageId: L.id,
    catalog: markerCatalog(p, L.id, glossLangs)
  }
}
const word = (p: Project, lemma: string): WordSpec => {
  const l = p.lexemes.find((x) => x.lemma === lemma)!
  return { lexemeId: l.id, base: l.lemma, own: null, pieces: [] }
}

describe('gloss 拆段', () => {
  it('按点号、连字符拆，1SG 这种再拆成人称与数', () => {
    expect(glossParts('2SG.POSS')).toEqual(['2SG.POSS', '2SG', '2', 'SG', 'POSS'])
    expect(glossParts('完成体')).toEqual(['完成体'])
  })
})

describe('Tsahun（孤立语）：小品词单独成词，放哪边看语料', () => {
  const p = load('Tsahun.laim.json')
  const env = envOf(p, 'Tsahun')
  const kwe = p.lexemes.find((x) => x.lemma === 'kwe51')!
  const nok = p.lexemes.find((x) => x.lemma === 'nok21')!

  it('动词：完成体 ta33 放在后面、否定 mo35 放在前面，按通用范畴分组', () => {
    const { groups } = markersFor(p, env.catalog, hostInfo(p, kwe))
    const all = groups.flatMap((g) =>
      g.items.map((x) => ({ g: g.group.id, form: x.marker.form, mode: x.mode }))
    )
    expect(all).toContainEqual({ g: 'u:aspect', form: 'ta33', mode: 'after' })
    expect(all).toContainEqual({ g: 'u:polarity', form: 'mo35', mode: 'before' })
  })
  it('名词：ta33 只挨着后面的名词出现过（它其实跟着前面的动词），不算名词的', () => {
    const { groups, others } = markersFor(p, env.catalog, hostInfo(p, nok))
    expect(groups.flatMap((g) => g.items).some((x) => x.marker.form === 'ta33')).toBe(false)
    expect(others.some((x) => x.marker.form === 'ta33')).toBe(true)
  })
  it('名词自己的构形（重叠复数）挑复数就是重叠形', () => {
    const d = deckModel(env, word(p, 'nok21'), new Set())
    const num = d.own[0].dims[0]
    expect(num.values.map((v) => v.form)).toEqual(['nok21', 'nok21nok21'])
  })
})

describe('Aelith（黏着语）：屈折形、词缀按异体形环境、连读浊化', () => {
  const p = load('Aelith.laim.json')
  const env = envOf(p, 'Aelith')

  it('名词的构形：每个格挑了是什么形式；复数位格', () => {
    const d = deckModel(env, word(p, 'kaso'), new Set())
    const dims = Object.fromEntries(d.own[0].dims.map((x) => [x.name, x.values.map((v) => v.form)]))
    expect(dims['格']).toEqual(['kaso', 'kasom', 'kasoda', 'kasoka'])
    const lp = d.own[0].key
    const num = p.categories.find((c) => c.name.zh === '数')!
    const kase = p.categories.find((c) => c.name.zh === '格')!
    const pl = num.values.find((v) => v.abbr === 'PL')!.id
    const loc = kase.values.find((v) => v.abbr === 'LOC')!.id
    const b = buildWord(env, {
      ...word(p, 'kaso'),
      own: { lpKey: lp, picks: { [num.id]: pl, [kase.id]: loc } }
    })
    expect(b.form).toBe('kasolarda')
    expect(b.slotAbbr).toBe('PL.LOC')
    expect(b.parts[0].gloss).toBe('房子.PL.LOC')
  })
  it('后缀按词干挑异体形（辅音后的后元音词用 -un），拼好的各段记进分析', () => {
    const tovar = word(p, 'tovar')
    const marker = env.catalog.markers.find((m) => m.gloss === '2SG.POSS')!
    const b = buildWord(env, { ...tovar, pieces: [pieceFor(env, marker, 'suffix', 0)] })
    expect(b.form).toBe('tovarun')
    expect(b.parts.map((x) => [x.form, x.gloss])).toEqual([
      ['tovar', '朋友'],
      ['un', '2SG.POSS']
    ])
    // 自动分析里没有这种切法时，按拼好的各段补一个分析并确认
    const tokens = [{ surface: 'tovarun', analyses: [], chosen: 0, confirmed: false }]
    pinChoices(
      tokens,
      [{ lexemeId: tovar.lexemeId, form: b.form, slotKey: null, morphs: morphsOf(b) }],
      () => ''
    )
    expect(tokens[0].confirmed).toBe(true)
    expect(tokens[0].analyses[0]).toMatchObject({
      lexemeId: tovar.lexemeId,
      morphs: [
        { form: 'tovar', gloss: '朋友' },
        { form: 'un', gloss: '2SG.POSS', morphemeId: marker.morphemeId }
      ]
    })
  })
  it('作用于所有词的连读浊化：整个词最后过一遍，gloss 接上缩写', () => {
    const sandhi = p.paradigms.find((x) => x.appliesToAll)!
    const d = deckModel(env, word(p, 'tovar'), new Set())
    expect(d.mutations[0].slots[0].form).toBe('dovar')
    const b = buildWord(env, {
      ...word(p, 'tovar'),
      mutation: { paradigmId: sandhi.id, slotKey: d.mutations[0].slots[0].key }
    })
    expect(b.form).toBe('dovar')
    expect(b.parts[0].gloss).toBe('朋友.VOI')
  })
  it('名词自己的构形管着数与格：数、格的后缀不再单列', () => {
    const d = deckModel(env, word(p, 'kaso'), new Set())
    const listed = [...d.groups, ...d.others].flatMap((g) => g.markers.map((m) => m.gloss))
    expect(listed).not.toContain('LOC')
    expect(listed).not.toContain('PL')
  })
  it('手打的词：词头、存下来的屈折形都认得出来，连挑的那一格', () => {
    const L = env.languageId
    expect(recognize(p, L, 'kaso', ['zh'])?.own).toBeNull()
    const hit = recognize(p, L, 'kasoda', ['zh'])!
    expect(p.lexemes.find((x) => x.id === hit.lexemeId)?.lemma).toBe('kaso')
    expect(Object.keys(hit.own!.picks)).toHaveLength(2)
    expect(recognize(p, L, 'zzz', ['zh'])).toBeNull()
  })
})

describe('搭伴的构形：式、体、时不在动词自己的构形里，而在「动词头」上', () => {
  // 现搭一个：「时」写明给动词和动词头用；动词头的构形只有「时」这一维，推出来的形式带中点、贴在动词前面
  const p = createProject({ name: 't', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const L = p.languages[0]
  const tense: GrammaticalCategory = {
    id: newId(),
    name: { zh: '时' },
    values: [
      { id: newId(), name: { zh: '现在时' }, abbr: 'PRS' },
      { id: newId(), name: { zh: '过去时' }, abbr: 'PST' }
    ]
  }
  const head: Paradigm = {
    id: newId(),
    name: { zh: '动词头' },
    variants: [],
    dimensionIds: [tense.id],
    disabledSlots: [],
    generators: {},
    inheritsFrom: null
  }
  const V: PartOfSpeech = { id: newId(), name: { zh: '动词' }, abbr: 'V', paradigmId: null }
  const VH: PartOfSpeech = { id: newId(), name: { zh: '动词头' }, abbr: 'VH', paradigmId: head.id }
  tense.posIds = [V.id, VH.id]
  p.categories.push(tense)
  p.paradigms.push(head)
  p.posList.push(V, VH)
  const dot = createLexeme(L.id, '·')
  dot.posId = VH.id
  dot.forms = {
    现在时: { surface: 'sa·', derived: true, override: false, trace: [] },
    过去时: { surface: 'n·', derived: true, override: false, trace: [] }
  }
  const fly = createLexeme(L.id, 'lhes')
  fly.posId = V.id
  fly.senses[0].definition = { zh: '飞' }
  p.lexemes.push(dot, fly)
  const L2 = createLanguage({ name: 'other' })
  p.languages.push(L2)

  it('找得到动词头，贴在前面；挑过去时拼成 n·lhes', () => {
    const env: DeckEnv = {
      project: p,
      ctx: makeContext(p, L),
      glossLangs: ['zh'],
      languageId: L.id,
      catalog: markerCatalog(p, L.id, ['zh'])
    }
    const cs = companionsFor(p, L.id, env.catalog, hostInfo(p, fly))
    expect(cs).toHaveLength(1)
    expect(cs[0].mode).toBe('prefix')
    const pst = tense.values[1].id
    const b = buildWord(env, {
      lexemeId: fly.id,
      base: 'lhes',
      own: null,
      pieces: [companionPiece(cs[0], dot.id, { [tense.id]: pst }, 0)]
    })
    expect(b.form).toBe('n·lhes')
    expect(b.parts.map((x) => x.gloss)).toEqual(['PST', '飞'])
    // 附着台里这一套列出来，每个取值挑了是什么
    const d = deckModel(env, { lexemeId: fly.id, base: 'lhes', own: null, pieces: [] }, new Set())
    expect(d.companions[0].dims[0].values.map((v) => v.form)).toEqual(['sa·', 'n·'])
  })
  it('动词头自己（那个「·」）不是动词，不给它请动词头', () => {
    const catalog = markerCatalog(p, L.id, ['zh'])
    expect(companionsFor(p, L.id, catalog, hostInfo(p, dot))).toEqual([])
  })
})
