import { describe, it, expect } from 'vitest'
import { moveById, moveItem } from '$lib/core/move'

describe('moveItem', () => {
  it('puts the dragged item where the target was', () => {
    const a = ['a', 'b', 'c', 'd']
    expect(moveItem(a, 0, 2)).toBe(true)
    expect(a).toEqual(['b', 'c', 'a', 'd'])
    moveItem(a, 3, 0)
    expect(a).toEqual(['d', 'b', 'c', 'a'])
  })

  it('leaves the array alone for a drop on itself or out of range', () => {
    const a = [1, 2, 3]
    expect(moveItem(a, 1, 1)).toBe(false)
    expect(moveItem(a, -1, 0)).toBe(false)
    expect(moveItem(a, 0, 3)).toBe(false)
    expect(a).toEqual([1, 2, 3])
  })

  it('moves by id inside a longer list', () => {
    const a = ['p', 'a', 't', 'i', 'k'].map((id) => ({ id }))
    // 只显示辅音 p t k 时，把 k 拖到 p 上
    expect(moveById(a, 'k', 'p')).toBe(true)
    expect(a.map((x) => x.id).join('')).toBe('kpati')
  })
})
