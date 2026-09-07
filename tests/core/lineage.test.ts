import { describe, it, expect } from 'vitest'
import { createLanguage, languageChildren, languageLineage, wouldCreateCycle } from '$lib/core/factory'

const a = createLanguage({ name: 'A' })
const b = createLanguage({ name: 'B', parentId: a.id })
const c = createLanguage({ name: 'C', parentId: b.id })
const orphan = createLanguage({ name: 'O', parentId: 'missing' })
const langs = [a, b, c, orphan]

describe('language tree', () => {
  it('groups children by parent and treats dangling parents as roots', () => {
    const m = languageChildren(langs)
    expect(m.get(null)?.map((l) => l.name)).toEqual(['A', 'O'])
    expect(m.get(a.id)?.map((l) => l.name)).toEqual(['B'])
  })

  it('computes lineage root-first', () => {
    expect(languageLineage(langs, c.id).map((l) => l.name)).toEqual(['A', 'B', 'C'])
  })

  it('detects cycles', () => {
    expect(wouldCreateCycle(langs, a.id, c.id)).toBe(true)
    expect(wouldCreateCycle(langs, a.id, a.id)).toBe(true)
    expect(wouldCreateCycle(langs, c.id, a.id)).toBe(false)
    expect(wouldCreateCycle(langs, c.id, null)).toBe(false)
  })
})
