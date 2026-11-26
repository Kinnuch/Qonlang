import { describe, it, expect } from 'vitest'
import { createProject, createLanguage, createLexeme, createMorpheme } from '$lib/core/factory'
import { createRecordClipboard, pasteRecordClipboard } from '$lib/core/recordClipboard'
function fixture() {
  const p = createProject({
      name: 'clipboard',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.1'
    }),
    a = p.languages[0],
    b = createLanguage({ name: 'target' })
  p.languages.push(b)
  const one = createLexeme(a.id, 'same'),
    two = createLexeme(a.id, 'same')
  one.relations = [{ kind: 'see', lexemeId: two.id }]
  two.etymology.sources = [{ kind: 'lexeme', id: one.id }]
  one.etymology.stages = [{ id: 'old-stage', form: 'earlier', type: '', notes: '' }]
  one.images = [{ id: 'image', caption: 'x', dataUrl: 'data:image/png;base64,AA==' }]
  p.lexemes = [one, two]
  return { p, a, b, one, two }
}
describe('whole lexeme and morpheme clipboard', () => {
  it('rejects unknown, retagged and modified selection payloads without changing the target', () => {
    const { p, a, one } = fixture(),
      clip = createRecordClipboard(p, 'lexeme', [one.id], 'copy')!,
      before = JSON.stringify(p)
    expect(pasteRecordClipboard(p, { ...clip, id: 'not-issued' }, a.id)).toEqual({
      ok: false,
      reason: 'stale'
    })
    expect(
      pasteRecordClipboard(p, { ...clip, records: [{ ...clip.records[0], id: 'other' }] }, a.id)
    ).toEqual({ ok: false, reason: 'stale' })
    expect(
      pasteRecordClipboard(
        p,
        { ...clip, kind: 'morpheme', records: [{ id: one.id, languageId: a.id, form: 'forged' }] },
        a.id
      )
    ).toEqual({ ok: false, reason: 'stale' })
    expect(pasteRecordClipboard(JSON.parse(JSON.stringify(p)), clip, a.id)).toEqual({
      ok: false,
      reason: 'stale'
    })
    expect(JSON.stringify(p)).toBe(before)
  })
  it('copies complete same-form entries with new root and embedded IDs, remapping group links', () => {
    const { p, a, one, two } = fixture(),
      before = JSON.stringify(p.lexemes),
      clip = createRecordClipboard(p, 'lexeme', [one.id, two.id], 'copy')!,
      result = pasteRecordClipboard(p, clip, a.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const copies = p.lexemes.filter((r) => result.ids.includes(r.id))
    expect(copies).toHaveLength(2)
    expect(new Set(p.lexemes.map((r) => r.id)).size).toBe(4)
    expect(copies[0].relations[0].lexemeId).toBe(copies[1].id)
    expect(copies[1].etymology.sources[0]).toEqual({ kind: 'lexeme', id: copies[0].id })
    expect(copies[0].senses[0].id).not.toBe(one.senses[0].id)
    expect(copies[0].images[0].id).not.toBe('image')
    expect(copies[0].etymology.stages[0].id).not.toBe('old-stage')
    expect(JSON.stringify(p.lexemes.slice(0, 2))).toBe(before)
    copies[0].senses[0].definition.en = 'changed'
    expect(one.senses[0].definition.en).not.toBe('changed')
  })
  it('moves simple cut records only after paste and preserves identity/group links', () => {
    const { p, b, one, two } = fixture(),
      clip = createRecordClipboard(p, 'lexeme', [one.id, two.id], 'cut')!
    expect(one.languageId).not.toBe(b.id)
    const r = pasteRecordClipboard(p, JSON.parse(JSON.stringify(clip)), b.id)
    expect(r.ok).toBe(true)
    expect(one.languageId).toBe(b.id)
    expect(two.languageId).toBe(b.id)
    expect(one.relations[0].lexemeId).toBe(two.id)
    expect(p.lexemes).toHaveLength(2)
    expect(pasteRecordClipboard(p, clip, b.id)).toEqual({ ok: false, reason: 'consumed' })
  })
  it('copies plain records to another language while leaving originals in their source language', () => {
    const { p, a, b, one } = fixture(),
      r = pasteRecordClipboard(p, createRecordClipboard(p, 'lexeme', [one.id], 'copy'), b.id)
    expect(r.ok).toBe(true)
    expect(one.languageId).toBe(a.id)
    expect(p.lexemes.at(-1)?.languageId).toBe(b.id)
  })
  it.each([
    'pronunciations',
    'scriptForms',
    'dialectIds',
    'morphemeBindings',
    'forms',
    'stageId'
  ] as const)('atomically rejects unmapped %s without clearing or moving source data', (field) => {
    const { p, b, one, two } = fixture()
    Object.assign(one, {
      [field]:
        field === 'stageId'
          ? 'old-stage'
          : field === 'dialectIds'
            ? ['old-dialect']
            : { old: 'kept' }
    })
    const before = JSON.stringify(p),
      clip = createRecordClipboard(p, 'lexeme', [one.id, two.id], 'cut')
    expect(pasteRecordClipboard(p, clip, b.id)).toEqual({ ok: false, reason: 'invalid-target' })
    expect(JSON.stringify(p)).toBe(before)
  })
  it('rejects stale or cross-project cuts and expired payloads without deleting records', () => {
    const { p, a, one } = fixture(),
      clip = createRecordClipboard(p, 'lexeme', [one.id], 'cut', 1000)!
    one.notes = 'new edit'
    expect(pasteRecordClipboard(p, clip, a.id, undefined, 1001)).toEqual({
      ok: false,
      reason: 'stale'
    })
    const other = createProject({
      name: 'other',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.1'
    })
    expect(pasteRecordClipboard(other, clip, null)).toEqual({ ok: false, reason: 'cross-project' })
    expect(pasteRecordClipboard(p, clip, null, undefined, 31 * 60 * 1000)).toEqual({
      ok: false,
      reason: 'expired'
    })
    expect(p.lexemes).toHaveLength(2)
  })
  it('does not trust cut payloads forged from serialized copy records', () => {
    const { p, a, one } = fixture(),
      clip = createRecordClipboard(p, 'lexeme', [one.id], 'copy')!
    clip.mode = 'cut'
    expect(pasteRecordClipboard(p, clip, a.id)).toEqual({ ok: false, reason: 'stale' })
    expect(p.lexemes).toHaveLength(2)
  })
  it('rejects cuts after reopening the same project as a different object', () => {
    const { p, a, one } = fixture(),
      clip = createRecordClipboard(p, 'lexeme', [one.id], 'cut')!
    expect(pasteRecordClipboard(JSON.parse(JSON.stringify(p)), clip, a.id)).toEqual({
      ok: false,
      reason: 'stale'
    })
  })
  it('preserves complete same-language data and ordinary morpheme allomorphs', () => {
    const { p, a, b } = fixture(),
      m = createMorpheme(a.id, 'circumfix'),
      n = createMorpheme(a.id, 'root')
    m.form = 'na'
    m.form2 = 'ta'
    m.allomorphs = [{ form: 'ni', environment: '_V', values: ['v'], valueMatch: 'any' }]
    m.etymology.sources = [{ kind: 'morpheme', id: n.id }]
    p.morphemes = [m, n]
    const result = pasteRecordClipboard(
      p,
      createRecordClipboard(p, 'morpheme', [m.id, n.id], 'copy'),
      b.id
    )
    expect(result.ok).toBe(true)
    const copied = p.morphemes.slice(2)
    expect(copied[0].form2).toBe('ta')
    expect(copied[0].allomorphs).toEqual(m.allomorphs)
    expect(copied[0].etymology.sources[0]).toEqual({ kind: 'morpheme', id: copied[1].id })
    expect(m.languageId).toBe(a.id)
  })
  it('read-only and missing language/source guards are atomic', () => {
    const { p, a, one } = fixture(),
      clip = createRecordClipboard(p, 'lexeme', [one.id], 'copy')!
    p.meta.readOnly = true
    expect(createRecordClipboard(p, 'lexeme', [one.id], 'cut')).toBeNull()
    expect(pasteRecordClipboard(p, clip, a.id)).toEqual({ ok: false, reason: 'readonly' })
    p.meta.readOnly = false
    expect(pasteRecordClipboard(p, clip, 'missing')).toEqual({
      ok: false,
      reason: 'invalid-target'
    })
    p.lexemes = []
    expect(pasteRecordClipboard(p, clip, a.id).ok).toBe(true)
  })
})
