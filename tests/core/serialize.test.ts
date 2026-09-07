import { describe, it, expect } from 'vitest'
import { createProject, createLanguage, createLexeme } from '$lib/core/factory'
import { parseProject, serializeProject, projectToFolder, projectFromFolder, ProjectParseError } from '$lib/core/serialize'
import { SCHEMA_VERSION } from '$lib/core/model'

function sample() {
  const p = createProject({ name: '测试', template: 'family', appVersion: '0.0.0', uiLocale: 'zh', familyNames: { proto: 'Proto', daughters: ['A', 'B'] } })
  p.lexemes.push(createLexeme(p.languages[1].id, 'kama'))
  return p
}

describe('serialize', () => {
  it('roundtrips through JSON', () => {
    const p = sample()
    const back = parseProject(serializeProject(p))
    expect(back).toEqual(p)
  })

  it('rejects non-JSON and non-project files', () => {
    expect(() => parseProject('nope')).toThrow(ProjectParseError)
    expect(() => parseProject('{"foo":1}')).toThrow(ProjectParseError)
    expect(() => parseProject(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, meta: {} }))).toThrowError(/更新版本/)
  })

  it('fills in missing collections on old/partial files', () => {
    const p = parseProject(JSON.stringify({ schemaVersion: 1, meta: { name: 'x' } }))
    expect(p.languages).toEqual([])
    expect(p.lexemes).toEqual([])
    expect(p.settings.morphemeBoundaries).toEqual(['-', '='])
    expect(p.meta.name).toBe('x')
  })

  it('keeps unknown fields for forward compatibility', () => {
    const p = sample() as unknown as Record<string, unknown>
    p.futureField = { a: 1 }
    const back = parseProject(serializeProject(p as never)) as unknown as Record<string, unknown>
    expect(back.futureField).toEqual({ a: 1 })
  })

  it('folder export roundtrips', () => {
    const p = sample()
    p.soundChanges.push({ id: 'r1', text: 'a > e / _i', note: 'umlaut', enabled: true, group: 'Stage 1', fromLanguageId: null, toLanguageId: null, order: 0 })
    p.soundChanges.push({ id: 'r2', text: 'k > c', note: '', enabled: false, group: 'Stage 1', fromLanguageId: null, toLanguageId: null, order: 1 })
    const files = projectToFolder(p)
    expect(files['rules.txt']).toBe('-* Stage 1\na > e / _i  ; umlaut\n; k > c\n')
    const back = projectFromFolder(files)
    expect({ ...back, docs: p.docs }).toEqual(p)
  })
})

describe('factory', () => {
  it('blank template creates one language named after the project', () => {
    const p = createProject({ name: 'Foo', template: 'blank', appVersion: '1', uiLocale: 'en' })
    expect(p.languages).toHaveLength(1)
    expect(p.languages[0].name).toBe('Foo')
    expect(p.settings.defaultLanguageId).toBe(p.languages[0].id)
    expect(p.settings.glossLanguages).toEqual(['en', 'zh'])
  })

  it('family template links daughters to proto and skips blank names', () => {
    const p = createProject({ name: 'F', template: 'family', appVersion: '1', uiLocale: 'zh', familyNames: { proto: 'P', daughters: ['A', '', 'B'] } })
    expect(p.languages.map((l) => l.name)).toEqual(['P', 'A', 'B'])
    expect(p.languages[1].parentId).toBe(p.languages[0].id)
  })

  it('createLanguage always has one primary orthography', () => {
    const l = createLanguage({ name: 'X' })
    expect(l.orthographies.filter((o) => o.isPrimary)).toHaveLength(1)
  })
})
