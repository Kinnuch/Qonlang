import { describe, it, expect } from 'vitest'
import { blockSize, sizesFromScales, CARD_BASE_PX } from '$lib/ui/cardBlocks'

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
