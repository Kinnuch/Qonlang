import { describe, it, expect } from 'vitest'
import { createProject, createLexeme, createMorpheme } from '$lib/core/factory'
import {
  slotUsage,
  detachMorphemeSlot,
  restoreMorphemeSlot,
  boundMorpheme
} from '$lib/core/morphemeSlots'
import type { Paradigm } from '$lib/core/model'
function fixture() {
  const p = createProject({
    name: 'Slot removal',
    template: 'blank',
    uiLocale: 'en',
    appVersion: '1.1.1'
  })
  const l = p.languages[0],
    m = createMorpheme(l.id, 'prefix'),
    w = createLexeme(l.id, 'root')
  m.form = 'pre'
  p.morphemes.push(m)
  p.lexemes.push(w)
  p.morphemeSlots = [
    { id: 'left', name: 'Left', description: '' },
    { id: 'keep', name: 'Other', description: '' }
  ]
  w.morphemeBindings = { left: m.id, keep: m.id }
  const para = {
    id: 'p',
    name: { en: 'Rule' },
    variants: [],
    dimensionIds: [],
    disabledSlots: [],
    generators: {
      empty: {
        kind: 'pipeline',
        stem: '',
        steps: [{ id: 'st', kind: 'prefix', text: 'unrelated', morphemeSlot: 'left' }]
      }
    },
    inheritsFrom: null
  } satisfies Paradigm
  p.paradigms.push(para)
  return { p, w, m, para }
}
describe('remove and restore a project morpheme slot', () => {
  it('replaces the old binding map and restores both slots without modifying its snapshot', () => {
    const { p, w: word, m } = fixture()
    const before = Object.freeze(word.morphemeBindings!)
    const removed = detachMorphemeSlot(p, 'left')!
    expect(Object.keys(word.morphemeBindings!)).toEqual(['keep'])
    expect(before).toEqual({ left: m.id, keep: m.id })
    expect(restoreMorphemeSlot(p, removed)).toBe(true)
    expect(word.morphemeBindings).toEqual(before)
  })
  it('counts dependencies and preserves the words, morphemes and editable steps; undo restores their identities', () => {
    const { p, w, m, para } = fixture()
    expect(slotUsage(p, 'left')).toEqual({ words: 1, steps: 1 })
    const saved = detachMorphemeSlot(p, 'left')!
    expect(w.morphemeBindings).toEqual({ keep: m.id })
    expect(boundMorpheme(p, w, 'left').issue).toBe('slot-missing')
    expect(para.generators.empty.steps[0].morphemeSlot).toBe('left')
    expect(p.morphemes).toContain(m)
    expect(restoreMorphemeSlot(p, saved)).toBe(true)
    expect(boundMorpheme(p, w, 'left').morpheme?.id).toBe(m.id)
    expect(p.morphemeSlots?.map((s) => s.id)).toEqual(['left', 'keep'])
    expect(restoreMorphemeSlot(p, saved)).toBe(false)
  })
  it('does not overwrite a later name, invent absent bindings, or change read-only projects', () => {
    const { p, w } = fixture()
    p.meta.readOnly = true
    expect(detachMorphemeSlot(p, 'left')).toBeNull()
    delete p.meta.readOnly
    const saved = detachMorphemeSlot(p, 'left')!
    p.morphemeSlots!.push({ id: 'new', name: 'Left', description: '' })
    p.morphemes = []
    expect(restoreMorphemeSlot(p, saved)).toBe(true)
    expect(w.morphemeBindings?.left).toBeUndefined()
    expect(p.morphemeSlots!.find((s) => s.id === 'left')?.name).toBe('Left (2)')
  })
})
