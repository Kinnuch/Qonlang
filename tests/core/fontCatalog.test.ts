import { describe, it, expect } from 'vitest'
import { FONT_CATALOG } from '$lib/skin/presets'

describe('font catalog', () => {
  it('has no duplicate files (the list is keyed by file in the UI)', () => {
    const files = FONT_CATALOG.map((f) => f.file)
    expect(files).toEqual([...new Set(files)])
  })
  it('gives every non-builtin entry a download URL', () => {
    for (const f of FONT_CATALOG) {
      if (f.builtin) expect(f.url).toBe('')
      else expect(f.url).toMatch(/^https:\/\//)
    }
  })
})
