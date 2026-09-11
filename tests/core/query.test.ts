import { describe, it, expect } from 'vitest'
import { matchQuery, matchText, parseQuery } from '$lib/core/query'
import { SEARCH_FIELDS } from '$lib/core/searchFields'

const rec: Record<string, string[]> = {
  word: ['kâm', 'kam-lar'],
  gloss: ['看', 'PL'],
  tag: ['古语']
}
const values = (field: string | null): string[] =>
  field ? (rec[field] ?? []) : [...rec.word, ...rec.gloss]
const q = (s: string): ReturnType<typeof parseQuery> => parseQuery(s, SEARCH_FIELDS.lexicon)

describe('顶栏高级搜索', () => {
  it('普通文字：忽略大小写，没写附加符时也忽略附加符', () => {
    expect(matchQuery(q('KAM'), values)).toBe(true)
    expect(matchQuery(q('kâm'), values)).toBe(true)
    expect(matchQuery(q('kîm'), values)).toBe(false)
  })

  it('字段=内容只在该字段里找，别名也认', () => {
    expect(matchQuery(q('gloss=pl'), values)).toBe(true)
    expect(matchQuery(q('word=pl'), values)).toBe(false)
    expect(matchQuery(q('释义=看'), values)).toBe(true)
    expect(matchQuery(q('标签=古'), values)).toBe(true)
  })

  it('字段==内容要整个相等；多个条件都要满足', () => {
    expect(matchQuery(q('word==kam'), values)).toBe(true)
    expect(matchQuery(q('word==ka'), values)).toBe(false)
    expect(matchQuery(q('word=kam gloss=看'), values)).toBe(true)
    expect(matchQuery(q('word=kam gloss=听'), values)).toBe(false)
  })

  it('正则：/…/ 与 字段=/…/，写了标志按标志来', () => {
    expect(matchQuery(q('/^k.m$/'), values)).toBe(true)
    expect(matchQuery(q('word=/-lar$/'), values)).toBe(true)
    expect(matchQuery(q('gloss=/^pl$/'), values)).toBe(true)
    expect(matchQuery(q('gloss=/^pl$/u'), values)).toBe(false)
    // g 标志不会让第二次 test 失手
    const g = q('/a/g')
    expect(matchQuery(g, values)).toBe(true)
    expect(matchQuery(g, values)).toBe(true)
  })

  it('写错的正则退回按文字找并记下来', () => {
    const r = q('/(ab/')
    expect(r.errors).toEqual(['/(ab/'])
    expect(matchText(r, ['x(aby'])).toBe(true)
  })

  it('引号里可以有空格；不认识的字段按普通文字；只写了字段名先不过滤', () => {
    expect(matchText(parseQuery('"a b"'), ['xa by'])).toBe(true)
    expect(matchText(parseQuery('"a b"'), ['ab'])).toBe(false)
    expect(matchText(q('kaso=da'), ['kaso=da'])).toBe(true)
    expect(q('gloss=').terms).toHaveLength(0)
    const quoted = parseQuery('tr="你 好"', SEARCH_FIELDS.corpus)
    expect(quoted.terms.map((x) => x.field)).toEqual(['tr'])
    expect(matchQuery(quoted, (f) => (f === 'tr' ? ['说你 好吗'] : []))).toBe(true)
  })
})
