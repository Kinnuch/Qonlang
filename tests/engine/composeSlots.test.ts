import { describe, expect, it } from 'vitest'
import { createLexeme, createMorpheme, createProject, createSentence } from '$lib/core/factory'
import type { Project } from '$lib/core/model'
import {
  composeCandidates,
  composeGaps,
  composeSuggestions,
  composeSuggestionsFrom,
  prepareComposeIndex,
  findIn
} from '$lib/engine/compose'

function fixture(): Project {
  return createProject({ name: 'Slot QA', template: 'blank', appVersion: '1.0.4', uiLocale: 'zh' })
}

function word(
  p: Project,
  surface: string,
  meaning: string,
  languageId = p.languages[0].id
): string {
  const l = createLexeme(languageId, surface)
  l.senses[0].definition = { zh: meaning, en: meaning }
  p.lexemes.push(l)
  return l.id
}

const candidates = (p: Project, text: string) =>
  composeCandidates(p, p.languages[0].id, text, ['zh', 'en'])
const gaps = (p: Project, text: string) => composeGaps(p, p.languages[0].id, text, ['zh', 'en'])

describe('工作台带槽释义', () => {
  it.each(['在...中', '在…中', '在……中'])('%s 匹配框架，槽内词仍是独立候选', (meaning) => {
    const p = fixture()
    word(p, 'frame', meaning)
    word(p, 'light', '光')
    word(p, 'at', '在')
    word(p, 'middle', '中')
    expect(candidates(p, '在光中').map((c) => c.surface)).toEqual(['frame', 'light'])
    expect(candidates(p, '在光中')[0].matched).toBe(meaning)
    expect(gaps(p, '在光中')).toEqual([])
  })

  it('框架只覆盖固定锚点，不吞掉槽内的缺词', () => {
    const p = fixture()
    word(p, 'frame', '在…中')
    expect(gaps(p, '在微光中')).toEqual([{ text: '微光', at: 1 }])
  })

  it('在句中另一处独立出现的短词仍保留，按独立出现的位置排', () => {
    const p = fixture()
    word(p, 'frame', '在…中')
    word(p, 'light', '光')
    word(p, 'at', '在')
    word(p, 'middle', '中')
    expect(candidates(p, '在光中，在岸边，中间').map((c) => [c.surface, c.at])).toEqual([
      ['frame', 0],
      ['light', 1],
      ['at', 4],
      ['middle', 8]
    ])
  })

  it('保留精准短语与横跨槽的有效歧义，精准完整短语优先', () => {
    const p = fixture()
    word(p, 'frame', '在……中')
    word(p, 'exact', '在光中')
    word(p, 'partial', '在光')
    word(p, 'light', '光')
    expect(candidates(p, '在光中').map((c) => c.surface)).toEqual([
      'exact',
      'frame',
      'partial',
      'light'
    ])
  })

  it('多处出现时都覆盖固定锚点，槽内已知词和缺词分别保留', () => {
    const p = fixture()
    word(p, 'frame', '在…中')
    word(p, 'light', '光')
    expect(candidates(p, '在光中，在影中').map((c) => c.surface)).toEqual(['frame', 'light'])
    expect(gaps(p, '在光中，在影中')).toEqual([{ text: '影', at: 5 }])
  })

  it('多槽按序匹配，同类自由文本不限于汉字', () => {
    const p = fixture()
    word(p, 'route', '从…到…之间')
    word(p, 'put-away', 'put ... away')
    word(p, 'box', 'box')
    expect(candidates(p, '从山到海之间').map((c) => c.surface)).toEqual(['route'])
    expect(gaps(p, '从山到海之间').map((c) => c.text)).toEqual(['山', '海'])
    expect(candidates(p, 'She puts the box away').map((c) => c.surface)).toEqual([
      'put-away',
      'box'
    ])
    expect(gaps(p, 'She puts the box away').map((c) => c.text)).toEqual(['She', 'the'])
  })

  it('槽必须非空、不跨句界，不从拉丁词中间匹配', () => {
    for (const text of [
      '在中',
      '在。光中',
      '在光\n中',
      '在光，中间',
      '中光在',
      '在岸边：中午',
      '在岸边（中午）',
      '在岸边(中午)'
    ])
      expect(findIn(text, '在…中')).toBe(-1)
    expect(findIn('input boxes away', 'put ... away')).toBe(-1)
    expect(findIn('put away', 'put ... away')).toBe(-1)
    expect(findIn('put a box away', 'put ... away')).toBe(0)
    expect(findIn('注：（在光中）', '在…中')).toBe(3)
  })

  it('词根与自由文本 gloss 都可作为来源，其他语言及空写法不会混入', () => {
    const p = fixture()
    const m = createMorpheme(p.languages[0].id)
    m.form = 'root'
    m.meaning = { zh: '在…中' }
    p.morphemes.push(m)
    const g = createMorpheme(p.languages[0].id, 'suffix')
    g.form = '-x'
    g.gloss = 'put ... away'
    p.morphemes.push(g)
    word(p, 'foreign', '在…中', 'other-language')
    word(p, ' ', '在…中')
    expect(candidates(p, '在光中').map((c) => c.surface)).toEqual(['root'])
    expect(candidates(p, 'put a box away').map((c) => c.surface)).toEqual(['-x'])
  })

  it('省略号样式不影响分数，排序稳定且不改写词条', () => {
    const p = fixture()
    for (const [i, meaning] of ['在...中', '在…中', '在……中'].entries()) {
      word(p, 'frame-' + i, meaning)
      p.lexemes[i].id = 'frame-' + i
    }
    const before = JSON.stringify(p)
    const a = candidates(p, '在光中')
    expect(new Set(a.map((c) => c.score)).size).toBe(1)
    expect(candidates(p, '在光中')).toEqual(a)
    expect(JSON.stringify(p)).toBe(before)
  })

  it('语料经验仍为实际匹配的带槽说法加分，不把分数写回或逐次累加', () => {
    const p = fixture()
    const id = word(p, 'frame', '在…中')
    const base = candidates(p, '在光中')[0].score
    const s = createSentence(p.languages[0].id)
    s.translation = { zh: '在影中' }
    s.tokens = [
      { surface: 'frame', chosen: 0, analyses: [{ lexemeId: id, slot: null, morphs: [] }] }
    ]
    p.sentences.push(s)
    expect(candidates(p, '在光中')[0].score).toBe(base + 2)
    expect(candidates(p, '在光中')[0].score).toBe(base + 2)
    s.translation.zh = '在岸边，中间'
    expect(candidates(p, '在光中')[0].score).toBe(base)
  })

  it('聚合查询与原API一致，limit不吞掉缺词，位置保留原译文空白', () => {
    const p = fixture()
    word(p, 'frame', '在…中')
    word(p, 'light', '光')
    const text = '  在光中，在影中'
    const all = composeSuggestions(p, p.languages[0].id, text, ['zh', 'en'])
    expect(all).toEqual({ candidates: candidates(p, text), gaps: gaps(p, text) })
    expect(all.candidates[0]).toMatchObject({ at: 2, end: 5 })
    expect(composeSuggestions(p, p.languages[0].id, text, ['zh', 'en'], 1)).toEqual({
      candidates: all.candidates.slice(0, 1),
      gaps: [{ text: '影', at: 7 }]
    })
  })

  it('修改义项后立即重查，不依赖project updatedAt；同一字形的不同词条顺序稳定', () => {
    const p = fixture()
    word(p, 'frame', '在…中')
    p.lexemes[0].id = 'z'
    word(p, 'frame', '在…中')
    p.lexemes[1].id = 'a'
    expect(candidates(p, '在光中').map((c) => c.key)).toEqual(['l:a', 'l:z'])
    p.lexemes.reverse()
    expect(candidates(p, '在光中').map((c) => c.key)).toEqual(['l:a', 'l:z'])
    p.lexemes[0].senses[0].definition = { zh: '从…来' }
    expect(candidates(p, '在光中').map((c) => c.key)).toEqual(['l:z'])
  })

  it('匹配失效时不隐藏独立锚点，槽内出现的相同短词也不隐藏', () => {
    const p = fixture()
    word(p, 'frame', '在…中')
    word(p, 'at', '在')
    word(p, 'middle', '中')
    expect(candidates(p, '在，中').map((c) => c.surface)).toEqual(['at', 'middle'])
    expect(candidates(p, '在在中').map((c) => c.surface)).toEqual(['frame', 'at'])
  })

  it('模板只认识省略号，其他符号按原字面匹配，不使用正则通配', () => {
    expect(findIn('在.光中', '在.…中')).toBe(0)
    expect(findIn('在光中', '在.…中')).toBe(-1)
    expect(findIn('在x光中', '在.*…中')).toBe(-1)
    expect(findIn('在光中', '在..中')).toBe(-1)
  })

  it('大词库末尾的框架仍可命中，多次模板不会让槽内文字消失', () => {
    const p = fixture()
    for (let i = 0; i < 10000; i++) word(p, 'word-' + i, '测试义项' + i)
    word(p, 'frame', '在…中')
    word(p, 'light', '光')
    expect(candidates(p, '在光中').map((c) => c.surface)).toEqual(['frame', 'light'])
    expect(gaps(p, '在光中，'.repeat(1000) + '在影中')).toEqual([{ text: '影', at: 4001 }])
  })

  it('准备索引与纯API结果一致；重建时读入真实字段修改，不读updatedAt猜缓存', () => {
    const p = fixture()
    word(p, 'frame', '在…中')
    let index = prepareComposeIndex(p, p.languages[0].id, ['zh', 'en'])
    expect(composeSuggestionsFrom(index, '在光中')).toEqual(
      composeSuggestions(p, p.languages[0].id, '在光中', ['zh', 'en'])
    )
    expect(composeSuggestionsFrom(index, '在光中').gaps).toEqual([{ text: '光', at: 1 }])
    p.lexemes[0].senses[0].definition = { zh: '从…来' }
    index = prepareComposeIndex(p, p.languages[0].id, ['zh', 'en'])
    expect(composeSuggestionsFrom(index, '在光中').candidates).toEqual([])
    expect(composeSuggestionsFrom(index, '从山来').candidates.map((c) => c.surface)).toEqual([
      'frame'
    ])
  })
})
