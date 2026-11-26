import { describe, it, expect } from 'vitest'
import { createPhrase, createProject, createLanguage } from '$lib/core/factory'
import { phrasebookView } from '$lib/core/phrasebookView'
function fixture() {
  const p = createProject({
      name: 'phrase scope',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.1'
    }),
    a = p.languages[0],
    b = createLanguage({ name: 'Other' })
  p.languages.push(b)
  p.folders = [
    { id: 'practice', name: 'Practice' },
    { id: 'excerpts', name: 'Excerpts', parentId: 'practice' }
  ]
  const add = (id: string, language: string, folder: string, category: string, text: string) => {
    const phrase = createPhrase(language, category)
    phrase.id = id
    phrase.text = text
    phrase.translation = { en: 'Translation ' + id }
    if (folder) phrase.folderId = folder
    p.phrasebook.push(phrase)
    return phrase
  }
  add('default', a.id, '', 'Common', 'default alpha')
  add('excerpt', a.id, 'excerpts', 'Common', 'excerpt beta')
  add('other', b.id, 'excerpts', 'Other', 'foreign beta')
  add('orphan', a.id, 'missing', 'Other', 'legacy orphan')
  return { p, a, b }
}
function view(
  f: ReturnType<typeof fixture>,
  folderId: string,
  overrides: Partial<Parameters<typeof phrasebookView>[1]> = {}
) {
  const valid = new Set(f.p.folders?.map((folder) => folder.id))
  return phrasebookView(f.p.phrasebook, {
    languageId: f.a.id,
    folderId,
    root: false,
    query: '',
    category: '',
    folderOf: (phrase) => (phrase.folderId && valid.has(phrase.folderId) ? phrase.folderId : ''),
    ...overrides
  })
}
describe('phrasebook directory and category view', () => {
  it('Default shows old unassigned and invalid-folder phrases but never descendants or another language', () => {
    const f = fixture(),
      result = view(f, '')
    expect(result.list.map((p) => p.id)).toEqual(['default', 'orphan'])
    expect(result.categories).toEqual([
      { name: 'Common', count: 1 },
      { name: 'Other', count: 1 }
    ])
    expect(result.matching).toHaveLength(2)
  })
  it('an empty parent folder stays empty even when its child has a phrase', () => {
    const f = fixture(),
      result = view(f, 'practice')
    expect(result.list).toEqual([])
    expect(result.categories).toEqual([])
    expect(result.matching).toHaveLength(0)
  })
  it('Excerpts counts only its current-language phrase and scopes same-name categories to that layer', () => {
    const f = fixture(),
      result = view(f, 'excerpts')
    expect(result.list.map((p) => p.id)).toEqual(['excerpt'])
    expect(result.categories).toEqual([{ name: 'Common', count: 1 }])
    expect(view(f, 'excerpts', { languageId: f.b.id }).categories).toEqual([
      { name: 'Other', count: 1 }
    ])
  })
  it('Root aggregates the active language, while category filtering retains the same scoped counts', () => {
    const f = fixture(),
      result = view(f, '', { root: true, category: 'Common' })
    expect(result.matching.map((p) => p.id)).toEqual(['default', 'excerpt', 'orphan'])
    expect(result.categories).toEqual([
      { name: 'Common', count: 2 },
      { name: 'Other', count: 1 }
    ])
    expect(result.list.map((p) => p.id)).toEqual(['default', 'excerpt'])
  })
  it('search affects both counts and accessible phrases and never leaks another directory', () => {
    const f = fixture()
    expect(view(f, '', { query: 'beta' }).list).toEqual([])
    const root = view(f, '', { root: true, query: 'beta' })
    expect(root.list.map((p) => p.id)).toEqual(['excerpt'])
    expect(root.categories).toEqual([{ name: 'Common', count: 1 }])
  })
  it('advanced translation/category/tag/variant/IPA searches keep their existing field semantics', () => {
    const f = fixture(),
      phrase = f.p.phrasebook[1]
    phrase.variants = [{ text: 'variant gamma', note: '' }]
    phrase.tags = ['rare']
    phrase.pronunciations = { o: { ipa: 'beːta', irregular: true } }
    for (const query of [
      'tr=="Translation excerpt"',
      'category==Common',
      'tag==rare',
      'text="variant gamma"',
      'ipa=be'
    ])
      expect(view(f, 'excerpts', { query }).list.map((p) => p.id)).toEqual(['excerpt'])
  })
  it('does not mutate any source phrase while changing scope or filters', () => {
    const f = fixture(),
      before = JSON.stringify(f.p)
    view(f, 'practice')
    view(f, '', { root: true, query: 'category=Common', category: 'Common' })
    expect(JSON.stringify(f.p)).toBe(before)
  })
})
