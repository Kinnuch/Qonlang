/**
 * 通用切分：几个词干连写再接词缀、单字母语素确认过才可信、学来的整块、按译文挑、异体形环境、
 * 构形现推的形式、长释义截短、索引缓存。
 */
import { describe, it, expect } from 'vitest'
import {
  createLexeme,
  createMorpheme,
  createProject,
  createSentence,
  newId
} from '$lib/core/factory'
import type { Analysis, MorphemeType, Paradigm, Project } from '$lib/core/model'
import { analyzeToken, buildIndex, glossIndexFor, shortGloss } from '$lib/engine/gloss'
import { piecesOf } from '$lib/engine/gloss/candidates'

function setup(): { p: Project; lid: string } {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  p.settings.glossLanguages = ['zh']
  return { p, lid: p.languages[0].id }
}
function lex(p: Project, lid: string, lemma: string, def: string): string {
  const l = createLexeme(lid, lemma)
  l.senses[0].definition = { zh: def }
  p.lexemes.push(l)
  return l.id
}
function morph(
  p: Project,
  lid: string,
  type: MorphemeType,
  form: string,
  gloss: string,
  allomorphs: { form: string; environment: string }[] = []
): string {
  const m = createMorpheme(lid, type)
  m.form = form
  m.gloss = gloss
  m.allomorphs = allomorphs
  p.morphemes.push(m)
  return m.id
}
const forms = (a: Analysis | undefined): string[] => a?.morphs.map((m) => m.form) ?? []
const glosses = (a: Analysis | undefined): string[] => a?.morphs.map((m) => m.gloss) ?? []

describe('通用切分', () => {
  it('一处写了几个异写（斜线、逗号分开）：哪个写法都认得出', () => {
    const { p, lid } = setup()
    lex(p, lid, 'fóros/fauros', '门')
    const idx = buildIndex(p, lid)
    const b = p.settings.morphemeBoundaries
    expect(glosses(analyzeToken(idx, 'fauros', b)[0])).toEqual(['门'])
    expect(glosses(analyzeToken(idx, 'fóros', b)[0])).toEqual(['门'])
    // 语料里也写成两个异写：整串认不出时逐个异写去认
    expect(glosses(analyzeToken(idx, 'fóros/fauros', b)[0])).toEqual(['门'])
  })

  it('一个词条几个义项：每个义项各给一条候选', () => {
    const { p, lid } = setup()
    const l = createLexeme(lid, 'nae')
    l.senses[0].definition = { zh: '种子，希望' }
    l.senses.push({ ...l.senses[0], id: newId(), definition: { zh: '生成物' } })
    l.senses.push({ ...l.senses[0], id: newId(), definition: { zh: '人民' } })
    p.lexemes.push(l)
    lex(p, lid, 'nae', '本')
    const idx = buildIndex(p, lid)
    const list = analyzeToken(idx, 'nae', p.settings.morphemeBoundaries)
    // 义项紧挨着它自己那个词条排（排在最后的话，切分候选一多就会被条数上限挤掉）
    expect(list.map((a) => a.morphs[0].gloss)).toEqual(['种子', '生成物', '人民', '本'])
  })

  it('切分候选很多时，义项也不会被挤掉', () => {
    const { p, lid } = setup()
    // 整词一条，外加一堆能拼出这个词的语素组合
    const l = createLexeme(lid, 'leka')
    l.senses[0].definition = { zh: '垂竖' }
    l.senses.push({ ...l.senses[0], id: newId(), definition: { zh: '地下' } })
    l.senses.push({ ...l.senses[0], id: newId(), definition: { zh: '坏了的钟楼表' } })
    p.lexemes.push(l)
    for (const g of ['光', '枝条']) lex(p, lid, 'le', g)
    for (const g of ['三', '十', '舞蹈', '三星', '站立']) lex(p, lid, 'ka', g)
    const idx = buildIndex(p, lid)
    const list = analyzeToken(idx, 'leka', p.settings.morphemeBoundaries)
    const whole = list.filter((a) => a.morphs.length === 1).map((a) => a.morphs[0].gloss)
    expect(whole).toContain('坏了的钟楼表')
  })

  it('附着词单独成词也给 gloss（悬浮认得出，下拉里也得有）', () => {
    const { p, lid } = setup()
    const of = morph(p, lid, 'clitic', 'jehr', '属于')
    lex(p, lid, 'aila', '转折')
    const idx = buildIndex(p, lid)
    const a = analyzeToken(idx, 'jehr', p.settings.morphemeBoundaries)[0]
    expect(forms(a)).toEqual(['jehr'])
    expect(glosses(a)).toEqual(['属于'])
    expect(a.morphs[0].morphemeId).toBe(of)
  })
  it('两个词连写再接两个后缀也认得出，拼了两个词干的标成猜测', () => {
    const { p, lid } = setup()
    const tall = lex(p, lid, 'yvpli', '高大')
    lex(p, lid, 'hemelia', '神')
    morph(p, lid, 'suffix', 'xete', '仿佛')
    morph(p, lid, 'suffix', 'ses', 'V')
    const idx = buildIndex(p, lid)
    const b = p.settings.morphemeBoundaries
    const a = analyzeToken(idx, 'yvplihemeliaxeteses', b)[0]
    expect(forms(a)).toEqual(['yvpli', 'hemelia', 'xete', 'ses'])
    expect(glosses(a)).toEqual(['高大', '神', '仿佛', 'V'])
    expect(a.guess).toBe('split')
    // 一个词干加词缀：正常结果，不算猜测
    const one = analyzeToken(idx, 'hemeliaxeteses', b)[0]
    expect(forms(one)).toEqual(['hemelia', 'xete', 'ses'])
    expect(one.guess).toBeUndefined()
    // 整词对应的词条取最长的词干
    expect(a.lexemeId).not.toBe(tall)
  })

  it('两个词各自确认过不够：这两个词连着确认过，复合词才不算猜测', () => {
    const { p, lid } = setup()
    const lake = lex(p, lid, 'gol', '湖')
    const house = lex(p, lid, 'kaso', '房子')
    const b = p.settings.morphemeBoundaries
    const confirm = (surface: string, morphs: Analysis['morphs'], lexemeId: string): void => {
      const sen = createSentence(lid)
      sen.tokens = [
        { surface, chosen: 0, confirmed: true, analyses: [{ lexemeId, slot: null, morphs }] }
      ]
      p.sentences.push(sen)
    }
    confirm('gol', [{ form: 'gol', gloss: '湖', morphemeId: null }], lake)
    confirm('kaso', [{ form: 'kaso', gloss: '房子', morphemeId: null }], house)
    expect(analyzeToken(buildIndex(p, lid), 'golkaso', b)[0].guess).toBe('split')
    confirm(
      'golkasoya',
      [
        { form: 'gol', gloss: '湖', morphemeId: null, lexemeId: lake },
        { form: 'kaso', gloss: '房子', morphemeId: null, lexemeId: house }
      ],
      house
    )
    const a = analyzeToken(buildIndex(p, lid), 'golkaso', b)[0]
    expect(forms(a)).toEqual(['gol', 'kaso'])
    expect(a.guess).toBeUndefined()
  })

  it('整词在词典里时不去乱切', () => {
    const { p, lid } = setup()
    lex(p, lid, 'kasoda', '厨房')
    lex(p, lid, 'kaso', '房子')
    morph(p, lid, 'suffix', 'da', 'LOC')
    const a = analyzeToken(buildIndex(p, lid), 'kasoda', p.settings.morphemeBoundaries)
    expect(forms(a[0])).toEqual(['kasoda'])
    expect(a.some((x) => forms(x).join('|') === 'kaso|da')).toBe(true)
  })

  it('单字母语素没确认过是猜测，语料里确认过一次就可信', () => {
    const { p, lid } = setup()
    lex(p, lid, 'kat', '猫')
    const s = morph(p, lid, 'suffix', 's', 'PL')
    const b = p.settings.morphemeBoundaries
    expect(analyzeToken(buildIndex(p, lid), 'kats', b)[0].guess).toBe('split')
    const sen = createSentence(lid)
    sen.text = 'kats'
    sen.tokens = [
      {
        surface: 'kats',
        chosen: 0,
        confirmed: true,
        analyses: [
          {
            lexemeId: null,
            slot: null,
            morphs: [
              { form: 'kat', gloss: '猫', morphemeId: null },
              { form: 's', gloss: 'PL', morphemeId: s }
            ]
          }
        ]
      }
    ]
    p.sentences.push(sen)
    // 别的词里的同一个 -s 也跟着可信
    lex(p, lid, 'dog', '狗')
    const a = analyzeToken(buildIndex(p, lid), 'dogs', b)[0]
    expect(forms(a)).toEqual(['dog', 's'])
    expect(a.guess).toBeUndefined()
  })

  it('一段文字在别处确认成了几段，再遇到时照那样切', () => {
    const { p, lid } = setup()
    lex(p, lid, 'don', '虚像')
    const pfv = morph(p, lid, 'prefix', 'do', '完成体')
    const pst = morph(p, lid, 'prefix', 'n', '过去')
    const kaso = lex(p, lid, 'kaso', '房子')
    const b = p.settings.morphemeBoundaries
    // 没学过：don 当词条
    expect(forms(analyzeToken(buildIndex(p, lid), 'don-kaso', b)[0])).toEqual(['don', 'kaso'])
    const sen = createSentence(lid)
    sen.tokens = [
      {
        surface: 'donkaso',
        chosen: 0,
        confirmed: true,
        analyses: [
          {
            lexemeId: kaso,
            slot: null,
            morphs: [
              { form: 'do', gloss: '完成体', morphemeId: pfv },
              { form: 'n', gloss: '过去', morphemeId: pst },
              { form: 'kaso', gloss: '房子', morphemeId: null }
            ]
          }
        ]
      }
    ]
    p.sentences.push(sen)
    const a = analyzeToken(buildIndex(p, lid), 'don-kaso', b)[0]
    expect(forms(a)).toEqual(['do', 'n', 'kaso'])
    expect(glosses(a)).toEqual(['完成体', '过去', '房子'])
  })

  it('同形的词按本句译文挑', () => {
    const { p, lid } = setup()
    const lake = lex(p, lid, 'lin', '湖')
    const line = lex(p, lid, 'lin', '线')
    morph(p, lid, 'suffix', 'da', 'LOC')
    const idx = buildIndex(p, lid)
    const b = p.settings.morphemeBoundaries
    expect(analyzeToken(idx, 'linda', b, piecesOf('他站在线上'))[0].lexemeId).toBe(line)
    expect(analyzeToken(idx, 'linda', b, piecesOf('鱼在湖里'))[0].lexemeId).toBe(lake)
  })

  it('异体形按出现环境判断', () => {
    const { p, lid } = setup()
    lex(p, lid, 'ile', '孩子')
    morph(p, lid, 'suffix', 'lar', 'PL', [{ form: 'ler', environment: 'e_' }])
    const idx = buildIndex(p, lid)
    const [ler] = idx.source.pieces('ler', false).filter((x) => x.role === 'suf')
    const [lar] = idx.source.pieces('lar', false).filter((x) => x.role === 'suf')
    expect(idx.source.envFit(ler, 'ile', '')).toBe(1)
    expect(idx.source.envFit(lar, 'ile', '')).toBe(-1)
    expect(idx.source.envFit(lar, 'kas', '')).toBe(1)
  })

  it('构形里只加词缀的槽位：没点过推导的词也认得出屈折形', () => {
    const { p, lid } = setup()
    p.categories.push({
      id: 'case',
      name: { zh: '格' },
      values: [
        { id: 'nom', name: { zh: '主格' }, abbr: 'NOM' },
        { id: 'loc', name: { zh: '位格' }, abbr: 'LOC' }
      ]
    })
    const noun: Paradigm = {
      id: newId(),
      name: { zh: '名词' },
      variants: [],
      dimensionIds: ['case'],
      disabledSlots: [],
      generators: {
        nom: { kind: 'pipeline', stem: '', steps: [] },
        loc: { kind: 'pipeline', stem: '', steps: [{ id: newId(), kind: 'suffix', text: '-dá' }] }
      },
      inheritsFrom: null
    }
    p.paradigms.push(noun)
    const kaso = lex(p, lid, 'kaso', '房子')
    p.lexemes.find((l) => l.id === kaso)!.paradigmId = noun.id
    const a = analyzeToken(buildIndex(p, lid), 'kasodá', p.settings.morphemeBoundaries)[0]
    expect(forms(a)).toEqual(['kasodá'])
    expect(glosses(a)).toEqual(['房子.LOC'])
    expect(a.lexemeId).toBe(kaso)
  })

  it('长释义截成简短 gloss', () => {
    expect(shortGloss('动词头：式 × 体 × 时三个插槽的组合（感音、否定）')).toBe('动词头')
    expect(shortGloss('（植物）生长')).toBe('生长')
    expect(shortGloss('在...上（不接触）')).toBe('在...上')
    expect(shortGloss('house (building); home')).toBe('house')
  })

  it('分词索引按项目缓存，项目一改就重建', () => {
    const { p, lid } = setup()
    const a = glossIndexFor(p, lid)
    expect(glossIndexFor(p, lid)).toBe(a)
    p.meta.updatedAt = '2099-01-01T00:00:00.000Z'
    expect(glossIndexFor(p, lid)).not.toBe(a)
  })
})
