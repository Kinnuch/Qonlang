import { describe, it, expect } from 'vitest'
import { createLanguage, createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import { resolveFormInLanguage, splitSourceForm } from '$lib/core/etymology'

const project = createProject({ name: 'p', template: 'blank', appVersion: '0', uiLocale: 'zh' })
const proto = createLanguage({ name: 'Proto-X', abbr: 'PX' })
const daughter = createLanguage({ name: 'X', abbr: 'X', parentId: proto.id })
project.languages.push(proto, daughter)
project.settings.morphemeBoundaries = ['-', '=', '·']
const ges = createMorpheme(proto.id, 'root')
ges.form = 'GĒS'
const sal = createLexeme(proto.id, 'sal')
const salX = createLexeme(daughter.id, 'sal')
project.morphemes.push(ges)
project.lexemes.push(sal, salX)

describe('splitSourceForm', () => {
  it('splits on boundaries, plus, spaces; strips parens and stars', () => {
    expect(splitSourceForm(project, 'gēs-sal')).toEqual(['gēs', 'sal'])
    expect(splitSourceForm(project, 'seuk-(é)-rēn')).toEqual(['seuk', 'é', 'rēn'])
    expect(splitSourceForm(project, '*kal + *tar')).toEqual(['kal', 'tar'])
    expect(splitSourceForm(project, 'a·b')).toEqual(['a', 'b'])
    expect(splitSourceForm(project, 'plain')).toEqual(['plain'])
  })
})

describe('resolveFormInLanguage', () => {
  it('finds lexemes and morphemes in the named language, case- and diacritic-insensitively', () => {
    expect(resolveFormInLanguage(project, 'Proto-X', 'gēs')).toEqual({
      kind: 'morpheme',
      id: ges.id
    })
    expect(resolveFormInLanguage(project, 'PX', 'ges')).toEqual({ kind: 'morpheme', id: ges.id })
    expect(resolveFormInLanguage(project, 'Proto-X', 'sal')).toEqual({ kind: 'lexeme', id: sal.id })
    expect(resolveFormInLanguage(project, 'X', 'sal')).toEqual({ kind: 'lexeme', id: salX.id })
    expect(resolveFormInLanguage(project, 'Proto-X', 'nothing')).toBeNull()
  })
  it('searches all languages when no language is named', () => {
    expect(resolveFormInLanguage(project, '', 'sal')?.kind).toBe('lexeme')
  })
})
