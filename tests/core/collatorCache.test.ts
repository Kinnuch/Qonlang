/**
 * 排序器缓存后排出来的顺序跟原来一样：没有字母表时同 localeCompare，有字母表时按表。
 */
import { describe, it, expect } from 'vitest'
import { makeCollator } from '$lib/core/collate'

it('treats g glyphs as one sort key without rewriting the original words or alphabet', () => {
  for (const alphabet of [[], ['ɡ', 'g', 'a'], ['ng', 'nɡ', 'a']]) {
    const before = JSON.stringify(alphabet),
      compare = makeCollator(alphabet)
    expect(compare('ga', 'ɡa')).toBe(0)
    expect(compare('nga', 'nɡa')).toBe(0)
    expect(JSON.stringify(alphabet)).toBe(before)
    const words = ['ɡa', 'ga']
    expect(words.toSorted(compare)).toEqual(words)
  }
})

describe('排序器', () => {
  it('没有字母表：跟 localeCompare（先不分大小写和附加符）一样', () => {
    const words = ['Éa', 'ea', 'eb', 'Eb', 'a', 'á', 'b', 'aa', 'Ab']
    const old = (a: string, b: string): number =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b)
    expect([...words].sort(makeCollator([]))).toEqual([...words].sort(old))
  })
  it('有字母表：多字母字素、表外的字排在后面，同一个词比很多次结果一致', () => {
    const cmp = makeCollator(['a', 'th', 't', 'e'])
    const words = ['te', 'the', 'ta', 'tha', 'a', 'ez', 'e']
    const sorted = [...words].sort(cmp)
    expect(sorted).toEqual(['a', 'tha', 'the', 'ta', 'te', 'e', 'ez'])
    expect([...words].reverse().sort(cmp)).toEqual(sorted)
  })
})
