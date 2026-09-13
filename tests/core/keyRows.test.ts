import { describe, it, expect } from 'vitest'
import { KeyRows, renameObjectKey } from '$lib/ui/keyRows'

describe('editable name → value rows', () => {
  it('keeps each row’s id and position through renames, whatever the key order', () => {
    const rows = new KeyRows()
    const first = rows.sync('lex1', ['', 'b'])
    expect(first.map((r) => r.key)).toEqual(['', 'b'])
    rows.rename(first[0].id, 'a')
    // 对象里的键顺序变了（代理上常见），行的顺序不跟着变
    const again = rows.sync('lex1', ['b', 'a', 'c'])
    expect(again.map((r) => r.key)).toEqual(['a', 'b', 'c'])
    expect(again[0].id).toBe(first[0].id)
    expect(again[1].id).toBe(first[1].id)
    expect(rows.sync('lex1', ['c', 'a']).map((r) => r.key)).toEqual(['a', 'c'])
    // 换了词条就从头来
    expect(rows.sync('lex2', ['x']).map((r) => r.key)).toEqual(['x'])
  })
  it('renames a key only when the new name is free', () => {
    const o: Record<string, unknown> = { a: 1, b: 2 }
    expect(renameObjectKey(o, 'a', 'c')).toBe(true)
    expect(o).toEqual({ b: 2, c: 1 })
    expect(renameObjectKey(o, 'c', 'b')).toBe(false)
    expect(renameObjectKey(o, 'c', '')).toBe(false)
    expect(renameObjectKey(o, 'c', 'c')).toBe(false)
  })
})
