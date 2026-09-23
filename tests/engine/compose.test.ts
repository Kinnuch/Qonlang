/**
 * 译文工作台的候选词：照着译文反查词库（汉字按子串、拉丁字母按词），按在译文里的先后排。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import { composeCandidates, findIn, glossItems, joinForms, pinChoices } from '$lib/engine/compose'

const p = parseProject(
  readFileSync(join(__dirname, '..', '..', 'examples', 'Aelith.laim.json'), 'utf8')
)
const L = p.languages.find((l) => l.name === 'Aelith')!

describe('释义拆成说法', () => {
  it('分号、逗号、斜线分开，括号里的补充不算', () => {
    expect(glossItems('拿；取')).toEqual(['拿', '取'])
    expect(glossItems('他 / 她 / 它')).toEqual(['他', '她', '它'])
    expect(glossItems('磨坊（字面：水屋）')).toEqual(['磨坊'])
    expect(glossItems('mill (lit. water-house)')).toEqual(['mill'])
  })
})

describe('说法在译文里的位置', () => {
  it('汉字按子串找', () => {
    expect(findIn('我知道你来了', '知道')).toBe(1)
    expect(findIn('我知道你来了', '去')).toBe(-1)
  })
  it('拉丁字母按词找，词尾可以多几个字母，不会从词中间对上', () => {
    expect(findIn('I know you came', 'know')).toBe(2)
    expect(findIn('She knows it', 'know')).toBe(4)
    expect(findIn('a snowball', 'now')).toBe(-1)
    expect(findIn('you came to the house', 'the house')).toBe(12)
  })
})

describe('候选词', () => {
  it('中文译文：按在译文里的先后给出词条', () => {
    const c = composeCandidates(p, L.id, '我知道你的朋友在房子里', ['zh', 'en'])
    const lemmas = c.map((x) => x.surface)
    expect(lemmas.slice(0, 3)).toEqual(['men', 'bil-', 'sen'])
    expect(lemmas).toContain('tovar')
    expect(lemmas).toContain('kaso')
    expect(lemmas.indexOf('tovar')).toBeLessThan(lemmas.indexOf('kaso'))
  })
  it('英文译文也行', () => {
    const c = composeCandidates(p, L.id, 'The child sees the bird', ['en', 'zh'])
    expect(c.map((x) => x.surface)).toEqual(expect.arrayContaining(['ilen', 'sepe']))
  })
  it('空译文没有候选；拼原文按分词方式隔开', () => {
    expect(composeCandidates(p, L.id, '  ', ['zh'])).toEqual([])
    expect(joinForms(['men', ' bil ', 'sen'], 'whitespace')).toBe('men bil sen')
    expect(joinForms(['红', '学'], 'character')).toBe('红学')
  })
})

describe('把工作台挑定的词钉到分析上', () => {
  it('分析里有这个词条就选中并确认；没有就补一个分析；自由词不动', () => {
    const tokens = [
      {
        surface: 'men',
        analyses: [{ lexemeId: 'x', slot: null, morphs: [] }],
        chosen: 0,
        confirmed: false
      },
      { surface: 'kaso', analyses: [], chosen: 0, confirmed: false },
      { surface: 'zut', analyses: [], chosen: 0, confirmed: false }
    ]
    const n = pinChoices(
      tokens,
      [
        { lexemeId: 'x', form: 'men', slotKey: null },
        { lexemeId: 'y', form: 'kaso', slotKey: null },
        { form: 'zut', slotKey: null }
      ],
      () => '房子'
    )
    expect(n).toBe(2)
    expect(tokens[0].confirmed).toBe(true)
    expect(tokens[1].analyses[0].lexemeId).toBe('y')
    expect(tokens[1].analyses[0].morphs[0].gloss).toBe('房子')
    expect(tokens[2].confirmed).toBe(false)
  })
})
