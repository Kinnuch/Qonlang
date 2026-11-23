import { describe, it, expect } from 'vitest'
import {
  blockSize,
  sizesFromScales,
  CARD_BASE_PX,
  CARD_SCALABLE,
  cardBlocks,
  cardHiddenBlocks,
  cardBlockVisible,
  setCardBlockVisible
} from '$lib/ui/cardBlocks'

describe('entry card block sizes', () => {
  it('falls back to the default size', () => {
    expect(blockSize({}, 'senses')).toBe(CARD_BASE_PX)
    expect(blockSize({ senses: 99 }, 'senses')).toBe(CARD_BASE_PX)
    expect(blockSize({ senses: 18 }, 'senses')).toBe(18)
  })
  it('turns the old multipliers (whole card × block) into pixel sizes', () => {
    expect(sizesFromScales(1, {})).toEqual({})
    expect(sizesFromScales(1, { senses: 1.4 })).toEqual({ senses: 21 })
    const all = sizesFromScales(1.2, { header: 1.5 })
    expect(all.header).toBe(27)
    expect(all.senses).toBe(18)
    expect(Object.keys(all)).toHaveLength(10)
    expect(sizesFromScales('x', null)).toEqual({})
  })
})

describe('entry card block visibility', () => {
  it('keeps all ten existing blocks visible for old preferences and invalid input', () => {
    expect(CARD_SCALABLE).toHaveLength(10)
    for (const value of [undefined, null, {}, false, 'header', [false, 'unknown']]) {
      expect(cardHiddenBlocks(value)).toEqual([])
      expect(CARD_SCALABLE.every((key) => cardBlockVisible(value, key))).toBe(true)
    }
  })
  it('normalizes hidden keys and preserves the old history switch', () => {
    expect(cardHiddenBlocks(['tags', 'tags', 'unknown', 'header'])).toEqual(['header', 'tags'])
    expect(cardHiddenBlocks(undefined, false)).toEqual(['history'])
    expect(cardBlockVisible([], 'history', false)).toBe(false)
    expect(cardBlockVisible(['tags'], 'header', false)).toBe(true)
  })
  it('hides and restores every block independently without changing order or size', () => {
    const order = ['notes', 'senses'],
      sizes = { header: 23, notes: 18 }
    let hidden: string[] = []
    for (const key of CARD_SCALABLE) hidden = setCardBlockVisible(hidden, key, false)
    expect(hidden).toEqual([...CARD_SCALABLE])
    for (const key of CARD_SCALABLE) {
      const restored = setCardBlockVisible(hidden, key, true)
      expect(cardBlockVisible(restored, key)).toBe(true)
      expect(restored).toHaveLength(9)
      expect(cardBlocks(order).slice(0, 2)).toEqual(order)
      expect(blockSize(sizes, 'header')).toBe(23)
      expect(blockSize(sizes, 'notes')).toBe(18)
    }
  })
  it('does not mutate the stored hidden list and ignores unknown controls', () => {
    const stored = ['tags']
    expect(setCardBlockVisible(stored, 'header', false)).toEqual(['header', 'tags'])
    expect(setCardBlockVisible(stored, 'future-block', false)).toEqual(['tags'])
    expect(stored).toEqual(['tags'])
  })
})
