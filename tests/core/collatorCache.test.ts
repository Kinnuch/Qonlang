/**
 * 排序器缓存后排出来的顺序跟原来一样：没有字母表时同 localeCompare，有字母表时按表。
 */
import { describe, it, expect } from 'vitest'
import { makeCollator } from '$lib/core/collate'

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
