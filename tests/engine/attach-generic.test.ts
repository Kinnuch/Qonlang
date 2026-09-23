/**
 * 附着台对「任何一门语言」都得有用：不认识哪门语言，只看项目自己的数据。
 * 这里全用现搭的小项目，各缺一样东西：没有语料、词类名认不出来、什么线索都没有、语料很足、
 * 虚词放在词库里……看附着台还能不能把东西分门别类摆对。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import {
  createLexeme,
  createMorpheme,
  createProject,
  createSentence,
  newId
} from '$lib/core/factory'
import type {
  GrammaticalCategory,
  Id,
  Language,
  Lexeme,
  Morpheme,
  MorphemeType,
  Paradigm,
  PartOfSpeech,
  Project
} from '$lib/core/model'
import { makeContext } from '$lib/engine/morph'
import { composeGaps } from '$lib/engine/compose'
import {
  buildWord,
  deckModel,
  defaultPicks,
  markerCatalog,
  modeOf,
  particleWords,
  type DeckEnv,
  type DeckModel,
  type WordSpec
} from '$lib/engine/attach'

function blank(): { p: Project; L: Language } {
  const p = createProject({ name: 't', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  return { p, L: p.languages[0] }
}
function pos(p: Project, name: string, abbr = '', paradigmId: Id | null = null): PartOfSpeech {
  const x: PartOfSpeech = { id: newId(), name: { en: name }, abbr, paradigmId }
  p.posList.push(x)
  return x
}
function morph(
  p: Project,
  L: Language,
  type: MorphemeType,
  form: string,
  gloss: string,
  more: Partial<Morpheme> = {}
): Morpheme {
  const m = { ...createMorpheme(L.id, type), form, gloss, ...more }
  p.morphemes.push(m)
  return m
}
function lex(p: Project, L: Language, lemma: string, posId: Id | null, def: string): Lexeme {
  const l = createLexeme(L.id, lemma)
  l.posId = posId
  l.senses[0].definition = { en: def }
  p.lexemes.push(l)
  return l
}
function envOf(p: Project, L: Language): DeckEnv {
  const glossLangs = ['en', 'zh']
  return {
    project: p,
    ctx: makeContext(p, L),
    glossLangs,
    languageId: L.id,
    catalog: markerCatalog(p, L.id, glossLangs)
  }
}
const spec = (l: Lexeme): WordSpec => ({ lexemeId: l.id, base: l.lemma, own: null, pieces: [] })
const shown = (d: DeckModel): string[] => d.groups.flatMap((g) => g.markers.map((m) => m.form))
const folded = (d: DeckModel): string[] => d.others.flatMap((g) => g.markers.map((m) => m.form))

/** 一门常见的黏着语的语素，gloss 用莱比锡缩写；没有维度、构形、语料 */
function agglutinative(nounName: string, verbName: string, nounAbbr = '', verbAbbr = '') {
  const { p, L } = blank()
  const N = pos(p, nounName, nounAbbr)
  const V = pos(p, verbName, verbAbbr)
  morph(p, L, 'suffix', '-lar', 'PL')
  morph(p, L, 'suffix', '-da', 'LOC')
  morph(p, L, 'suffix', '-di', 'PST')
  morph(p, L, 'prefix', 'ma-', 'NEG')
  morph(p, L, 'clitic', '=mi', 'Q')
  morph(p, L, 'suffix', '-ci', 'AGT')
  const house = lex(p, L, 'ev', N.id, 'house')
  const come = lex(p, L, 'gel', V.id, 'come')
  return { p, L, N, V, house, come }
}

describe('语料里还没分析过语素：按结构猜，给体词的配体词、给谓词的配谓词', () => {
  const { p, L, house, come } = agglutinative('Noun', 'Verb', 'n.', 'v.')
  const env = envOf(p, L)
  it('名词：数、格摆出来（算猜的），时、否定、疑问收进「其余」', () => {
    const d = deckModel(env, spec(house), new Set())
    expect(d.domain).toBe('nominal')
    expect(shown(d)).toEqual(expect.arrayContaining(['-lar', '-da', '-ci']))
    expect(folded(d)).toEqual(expect.arrayContaining(['-di', 'ma-', '=mi']))
    expect(d.groups.every((g) => g.markers.every((m) => m.weak))).toBe(true)
  })
  it('动词：时、否定、疑问摆出来，数、格收进「其余」；派生两边都有', () => {
    const d = deckModel(env, spec(come), new Set())
    expect(d.domain).toBe('verbal')
    expect(shown(d)).toEqual(expect.arrayContaining(['-di', 'ma-', '=mi', '-ci']))
    expect(folded(d)).toEqual(expect.arrayContaining(['-lar', '-da']))
  })
  it('词类名换成别的界面语言、带汉字的缩写也认得出（情况动词 v况.）', () => {
    const zh = agglutinative('名词', '情况动词', 'n.', 'v况.')
    const e = envOf(zh.p, zh.L)
    expect(deckModel(e, spec(zh.house), new Set()).domain).toBe('nominal')
    expect(deckModel(e, spec(zh.come), new Set()).domain).toBe('verbal')
  })
})

describe('词类名认不出来：看它的构形用到哪些维度', () => {
  const { p, L } = blank()
  const cse: GrammaticalCategory = {
    id: newId(),
    name: { en: 'Ruk' },
    values: [
      { id: newId(), name: { en: 'rukna' }, abbr: 'NOM' },
      { id: newId(), name: { en: 'rukta' }, abbr: 'ACC' },
      { id: newId(), name: { en: 'ruksa' }, abbr: 'GEN' }
    ]
  }
  const par: Paradigm = {
    id: newId(),
    name: { en: 'P1' },
    variants: [],
    dimensionIds: [cse.id],
    disabledSlots: [],
    generators: {},
    inheritsFrom: null
  }
  p.categories.push(cse)
  p.paradigms.push(par)
  const kelo = pos(p, 'kelo', '', par.id)
  const sabra = pos(p, 'sabra')
  morph(p, L, 'suffix', '-s', 'PL')
  morph(p, L, 'suffix', '-t', 'PST')
  morph(p, L, 'suffix', '-n', 'ACC')
  const a = lex(p, L, 'tomo', kelo.id, 'stone')
  const b = lex(p, L, 'rina', sabra.id, 'run')
  const env = envOf(p, L)
  it('构形里有「格」（取值是 NOM、ACC……）的算体词：数摆出来、时收起来，格的后缀归构形管、不单列', () => {
    const d = deckModel(env, spec(a), new Set())
    expect(d.domain).toBe('nominal')
    expect(shown(d)).toContain('-s')
    expect(folded(d)).toContain('-t')
    expect([...shown(d), ...folded(d)]).not.toContain('-n')
  })
  it('什么线索都没有的词类：全都先摆出来（都算猜的），不藏', () => {
    const d = deckModel(env, spec(b), new Set())
    expect(d.domain).toBeNull()
    expect(shown(d)).toEqual(expect.arrayContaining(['-s', '-t', '-n']))
    expect(folded(d)).toEqual([])
  })
})

describe('语料分析得足：缺证据就是真没见过，不猜', () => {
  const { p, L, N, V, house, come } = agglutinative('Noun', 'Verb')
  const past = p.morphemes.find((m) => m.gloss === 'PST')!
  for (let i = 0; i < 32; i++) {
    const s = createSentence(L.id)
    s.text = 'ev geldi'
    s.tokens = [
      {
        surface: 'ev',
        analyses: [
          {
            lexemeId: house.id,
            slot: null,
            morphs: [{ form: 'ev', gloss: 'house', morphemeId: null }]
          }
        ],
        chosen: 0,
        confirmed: true
      },
      {
        surface: 'geldi',
        analyses: [
          {
            lexemeId: come.id,
            slot: null,
            morphs: [
              { form: 'gel', gloss: 'come', morphemeId: null, lexemeId: come.id },
              { form: 'di', gloss: 'PST', morphemeId: past.id }
            ]
          }
        ],
        chosen: 0,
        confirmed: true
      }
    ]
    p.sentences.push(s)
  }
  const env = envOf(p, L)
  it('动词：语料里用过的过去时有根据（不是猜的），没用过的否定收进「其余」', () => {
    expect(env.catalog.uses).toBeGreaterThanOrEqual(30)
    expect(env.catalog.posTokens.get(V.id)).toBeGreaterThan(0)
    const d = deckModel(env, spec(come), new Set())
    const g = d.groups.find((x) => x.markers.some((m) => m.form === '-di'))!
    expect(g.markers.find((m) => m.form === '-di')!.weak).toBe(false)
    expect(folded(d)).toContain('ma-')
  })
  it('名词：语料里见过这类词，却从没跟数、格一起出现：收起来', () => {
    expect(env.catalog.posTokens.get(N.id)).toBeGreaterThan(0)
    const d = deckModel(env, spec(house), new Set())
    expect(shown(d)).not.toContain('-lar')
    expect(folded(d)).toEqual(expect.arrayContaining(['-lar', '-da']))
  })
})

describe('词库里的虚词：词类是虚词一类的全算，内容词只算说得出范畴的', () => {
  const { p, L } = blank()
  const PART = pos(p, 'Particle', 'part.')
  const N = pos(p, 'Noun', 'n.')
  const PRON = pos(p, 'Pronoun', 'pron.')
  const X = pos(p, 'Xq')
  lex(p, L, 'ka', PART.id, 'and')
  lex(p, L, 'ne…pas', PART.id, 'negation')
  lex(p, L, 'emo', N.id, 'emoticon marker')
  lex(p, L, 'pasado', N.id, 'the past; past times')
  lex(p, L, 'plu', N.id, 'plural marker')
  lex(p, L, 'mi', PRON.id, 'first person (I)')
  lex(p, L, 'ta', X.id, 'PST marker')
  lex(p, L, 'ki', X.id, 'question particle')
  lex(p, L, 'ya', X.id, 'also')
  const env = envOf(p, L)
  const forms = env.catalog.markers.map((m) => m.form)
  it('叫 Particle 的词类的词都算；名词里只有「plural marker」算；代词、常用词不算', () => {
    expect(forms).toEqual(expect.arrayContaining(['ka', 'ne…pas', 'plu']))
    expect(forms).not.toContain('emo')
    expect(forms).not.toContain('pasado')
    expect(forms).not.toContain('mi')
  })
  it('名字认不出来、但三成以上的词释义是语法标记的词类，也算虚词一类（连 also 一起）', () => {
    expect(forms).toEqual(expect.arrayContaining(['ta', 'ki', 'ya']))
  })
  it('说得出范畴的归到那个范畴，说不出的归到它的词类', () => {
    const g = (f: string): string => env.catalog.markers.find((m) => m.form === f)!.group.id
    expect(g('ne…pas')).toBe('u:polarity')
    expect(g('plu')).toBe('u:number')
    expect(g('ka')).toBe('pos:' + PART.id)
  })
})

describe('单独成词的虚词放进句子里写成什么', () => {
  it('隔开写的包在词的两边；只写一半的放一边；可省的、几种写法的取最简的第一种', () => {
    expect(particleWords('ne…pas', 'around')).toEqual(['ne', 'pas'])
    expect(particleWords('ma...gò', 'around')).toEqual(['ma', 'gò'])
    expect(particleWords('bo…', 'before')).toEqual(['bo'])
    expect(particleWords('(le)kùti', 'after')).toEqual(['kùti'])
    expect(particleWords('moh / goh', 'after')).toEqual(['moh'])
  })
  it('隔开写的两段各是一个词：各自写成自己那一段，gloss 一样', () => {
    const { p, L } = blank()
    const P = pos(p, 'Particle')
    const neg = lex(p, L, 'ne…pas', P.id, 'negation')
    const env = envOf(p, L)
    const [a, b] = particleWords(neg.lemma, 'around')
    const one = buildWord(env, { lexemeId: neg.id, base: a, surface: a, pieces: [] })
    const two = buildWord(env, { lexemeId: neg.id, base: b, surface: b, pieces: [] })
    expect([one.form, two.form]).toEqual(['ne', 'pas'])
    expect(one.parts[0].gloss).toBe(two.parts[0].gloss)
    expect(one.parts[0].lexemeId).toBe(neg.id)
  })
  it('怎么接：看省略号在哪边', () => {
    const { p, L } = blank()
    const P = pos(p, 'Particle')
    lex(p, L, 'ne…pas', P.id, 'negation')
    lex(p, L, 'bo…', P.id, 'passive')
    lex(p, L, '…le', P.id, 'plural marker')
    const env = envOf(p, L)
    const mode = (f: string): string =>
      modeOf(
        env.catalog,
        env.catalog.markers.find((m) => m.form === f)!,
        []
      )
    expect(mode('ne…pas')).toBe('around')
    expect(mode('bo…')).toBe('before')
    expect(mode('…le')).toBe('after')
  })
})

describe('标签、释义里写着的词类', () => {
  const { p, L } = blank()
  const V = pos(p, '动词', 'v.')
  const ADV = pos(p, '副词', 'adv.')
  const N = pos(p, '名词', 'n.')
  morph(p, L, 'suffix', '-ly', 'ADV', { tags: ['adv.'] })
  morph(p, L, 'suffix', '-pl', 'PL', { meaning: { zh: '名词复数' } })
  morph(p, L, 'suffix', '-mente', 'X', { meaning: { zh: '形容词副词化' } })
  const env = envOf(p, L)
  const m = (f: string) => env.catalog.markers.find((x) => x.form === f)!
  it('标签「adv.」是副词，不是缩写叫「v.」的动词', () => {
    expect(m('-ly').tagPos).toEqual([ADV.id])
    expect(m('-ly').tagPos).not.toContain(V.id)
  })
  it('释义「名词复数」提到名词；「副词化」说的是变成什么，不算提到副词', () => {
    expect(m('-pl').textPos).toEqual([N.id])
    expect(m('-mente').textPos).not.toContain(ADV.id)
  })
})

describe('gloss 与维度取值：拼音文字要整词对上', () => {
  it('gloss「in」不会因为取值叫「inanimate」就归到有生性那一维', () => {
    const { p, L } = blank()
    p.categories.push({
      id: newId(),
      name: { en: 'Animacy' },
      values: [
        { id: newId(), name: { en: 'animate' }, abbr: 'AN' },
        { id: newId(), name: { en: 'inanimate' }, abbr: 'INAN' }
      ]
    })
    morph(p, L, 'prefix', 'na-', 'in')
    const env = envOf(p, L)
    expect(env.catalog.markers[0].group.kind).not.toBe('dim')
  })
})

describe('手打的词挑了词类：按那个词类的构形推', () => {
  it('Aelith：词库里没有的 pelo 算作名词，挑位格就按名词的构形加上格尾', () => {
    const p = parseProject(
      readFileSync(join(__dirname, '..', '..', 'examples', 'Aelith.laim.json'), 'utf8')
    )
    const L = p.languages.find((l) => l.name === 'Aelith')!
    const env: DeckEnv = { ...envOf(p, L), glossLangs: ['zh', 'en'] }
    const noun = p.lexemes.find((x) => x.lemma === 'kaso')!.posId!
    const free: WordSpec = { base: 'pelo', posId: noun, own: null, pieces: [] }
    const d = deckModel(env, free, new Set())
    expect(d.own.length).toBeGreaterThan(0)
    const own = d.own[0]
    const caseDim = own.dims.find((x) => x.values.some((v) => v.abbr === 'LOC'))!
    const loc = caseDim.values.find((v) => v.abbr === 'LOC')!
    const par = p.paradigms.find((x) => own.key.startsWith(x.id))!
    const picks = { ...defaultPicks(p, par), [caseDim.id]: loc.id }
    const w = buildWord(env, { ...free, own: { lpKey: own.key, picks } })
    expect(w.form.startsWith('pelo')).toBe(true)
    expect(w.form).not.toBe('pelo')
    expect(w.parts[0].lexemeId ?? null).toBeNull()
  })
  it('Aelith：「和」既是词条又是小品词语素，附着台上只出一个', () => {
    const p = parseProject(
      readFileSync(join(__dirname, '..', '..', 'examples', 'Aelith.laim.json'), 'utf8')
    )
    const L = p.languages.find((l) => l.name === 'Aelith')!
    const c = envOf(p, L).catalog
    expect(c.markers.filter((m) => m.form === 've').length).toBe(1)
  })
})

describe('译文里没找到对应词的部分', () => {
  const { p, L } = blank()
  lex(p, L, 'efalt', null, '云鸟')
  lex(p, L, 'lhes', null, '飞')
  lex(p, L, 'theur', null, '森林')
  lex(p, L, 'ilen', null, 'child')
  lex(p, L, 'sepe', null, 'see')
  lex(p, L, 'fenu', null, 'bird')
  it('汉字按连着没对上的一段算，标点不算', () => {
    expect(composeGaps(p, L.id, '云鸟飞往森林。', ['en', 'zh'])).toEqual([{ text: '往', at: 3 }])
    expect(composeGaps(p, L.id, '云鸟飞往大森林里', ['en', 'zh']).map((g) => g.text)).toEqual([
      '往大',
      '里'
    ])
  })
  it('拼音文字按词算（词尾多几个字母的照样对得上），重复的只列一次', () => {
    expect(composeGaps(p, L.id, 'The child sees the bird.', ['en']).map((g) => g.text)).toEqual([
      'The'
    ])
  })
  it('空的译文没有', () => {
    expect(composeGaps(p, L.id, '  ', ['en'])).toEqual([])
  })
})
