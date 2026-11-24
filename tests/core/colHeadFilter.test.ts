import { describe, expect, it } from 'vitest'
import { pickFilterOption } from '$lib/ui/colHeadFilter'
describe('column filter selection', () => {
  it('does not treat a removed letter as a checked current letter', () => {
    expect(pickFilterOption(['a', 'b'], new Set(['old']), 'a', true)).toEqual(new Set(['a']))
    expect(pickFilterOption(['a', 'b'], new Set(['old']), 'b', false)).toEqual(new Set())
  })
  it('keeps the existing null-for-all convention for ordinary column filters', () => {
    expect(pickFilterOption(['a', 'b'], null, 'a', false)).toEqual(new Set(['b']))
    expect(pickFilterOption(['a', 'b'], new Set(['b']), 'a', true)).toBeNull()
    expect(pickFilterOption(['a', 'b'], undefined, 'a', true)).toBeNull()
  })
  it('ignores a queued event for an option that has disappeared and preserves the caller set', () => {
    const selected = new Set(['a', 'old'])
    expect(pickFilterOption(['a', 'b'], selected, 'old', true)).toEqual(new Set(['a']))
    expect(selected).toEqual(new Set(['a', 'old']))
  })
})
