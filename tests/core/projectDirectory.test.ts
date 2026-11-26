import { describe, expect, it, vi } from 'vitest'
import {
  createDoc,
  createLanguage,
  createPhrase,
  createProject,
  createSentence
} from '$lib/core/factory'
import { createProjectDirectoryProjection } from '$lib/core/projectDirectory'

function fixture() {
  const project = createProject({
      name: 'Directory projection QA',
      template: 'blank',
      appVersion: '1.1.1',
      uiLocale: 'en'
    }),
    language = project.languages[0],
    other = createLanguage({ name: 'Other language' })
  project.languages.push(other)
  project.folders = [
    { id: 'a2', name: 'A2', parentId: 'a' },
    { id: 'b', name: 'B' },
    { id: 'a', name: 'A', tags: ['folder tag'], createdAt: '2026-01-02T03:04:05.000Z' },
    { id: 'a1', name: 'A1', parentId: 'a' },
    { id: 'leaf', name: 'Leaf', parentId: 'a1' }
  ]
  const sA = createSentence(language.id),
    sA2 = createSentence(other.id),
    sDefault = createSentence(language.id),
    pLeaf = createPhrase(other.id),
    pDefault = createPhrase(language.id),
    dA1 = createDoc(null, 'Shared document'),
    dB = createDoc(other.id, 'Foreign document'),
    dDefault = createDoc(null, 'Unknown folder')
  sA.folderId = 'a'
  sA.text = '光ɡ🙂'
  sA2.folderId = 'a2'
  sA2.text = 'other language'
  sDefault.folderId = 'missing-sentence'
  pLeaf.folderId = 'leaf'
  pLeaf.text = 'leaf phrase'
  dA1.folderId = 'a1'
  dA1.markdown = '<p>𐀀 &amp; 中</p>'
  dA1.format = 'html'
  dB.folderId = 'b'
  dDefault.folderId = 'missing-doc'
  project.sentences = [sA, sA2, sDefault]
  project.phrasebook = [pLeaf, pDefault]
  project.docs = [dA1, dB, dDefault]
  return { project, language, other, sA, sA2, sDefault, pLeaf, pDefault, dA1, dB, dDefault }
}

describe('shared project directory projection', () => {
  it('uses stable pre-order and counts direct plus descendant records of every kind and language', () => {
    const { project } = fixture(),
      before = JSON.stringify(project),
      result = createProjectDirectoryProjection(project)
    expect(result.rows.map((row) => row.id)).toEqual(['', 'b', 'a', 'a2', 'a1', 'leaf'])
    expect(
      result.rows.map((row) => [row.id, row.depth, row.directCount, row.count, row.children])
    ).toEqual([
      ['', 0, 3, 3, false],
      ['b', 0, 1, 1, false],
      ['a', 0, 1, 4, true],
      ['a2', 1, 1, 1, false],
      ['a1', 1, 1, 2, true],
      ['leaf', 2, 1, 1, false]
    ])
    expect(result.rootCount).toBe(8)
    expect(result.rootBytes).toBe(0)
    expect(result.rows.every((row) => row.bytes === 0)).toBe(true)
    expect(result.byId.get('leaf')!.path).toBe('A / A1 / Leaf')
    expect(result.byId.get('leaf')!.ancestors).toEqual(['a', 'a1'])
    expect(result.byId.get('')).toBe(result.rows[0])
    expect(JSON.stringify(project)).toBe(before)
  })

  it('keeps Default as an exact unassigned container rather than the tree root', () => {
    const { project } = fixture(),
      result = createProjectDirectoryProjection(project),
      row = result.byId.get('')!
    expect(row).toMatchObject({
      name: 'Default',
      parentId: '',
      default: true,
      children: false,
      count: 3,
      directCount: 3,
      path: 'Default',
      ancestors: []
    })
    const treeRoots = result.rows.filter((folder) => !folder.default && !folder.parentId)
    expect(treeRoots.map((folder) => folder.id)).toEqual(['b', 'a'])
    expect(row.count + treeRoots.reduce((count, folder) => count + folder.count, 0)).toBe(
      result.rootCount
    )
    expect([...result.byId.keys()].sort()).toEqual(['', 'a', 'a1', 'a2', 'b', 'leaf'])
  })

  it('estimates UTF-8 record sizes once and accumulates subtree bytes without counting folders', () => {
    const f = fixture(),
      result = createProjectDirectoryProjection(f.project, { sizes: true }),
      bytes = (record: unknown) => new TextEncoder().encode(JSON.stringify(record)).byteLength,
      aBytes = [f.sA, f.sA2, f.pLeaf, f.dA1].reduce((total, record) => total + bytes(record), 0),
      defaultBytes = [f.sDefault, f.pDefault, f.dDefault].reduce(
        (total, record) => total + bytes(record),
        0
      )
    expect(result.byId.get('a')!.bytes).toBe(aBytes)
    expect(result.byId.get('a1')!.bytes).toBe(bytes(f.dA1) + bytes(f.pLeaf))
    expect(result.byId.get('')!.bytes).toBe(defaultBytes)
    expect(result.rootBytes).toBe(aBytes + defaultBytes + bytes(f.dB))
    expect(result.rootCount).toBe(8)
  })

  it.each([false, true])('does not serialize records when sizes are off (legacy=%s)', (legacy) => {
    const { project, sA } = fixture(),
      serialize = vi.fn(() => {
        throw new Error('Must not serialize')
      })
    if (legacy) delete project.folders
    Object.assign(sA, { toJSON: serialize })
    const result = createProjectDirectoryProjection(project)
    expect(result.rootCount).toBe(8)
    expect(serialize).not.toHaveBeenCalled()
  })

  it('serializes each record only once when sizes are requested', () => {
    const { project, sA } = fixture(),
      serialize = vi.fn(() => ({ id: sA.id, text: '光' }))
    Object.assign(sA, { toJSON: serialize })
    createProjectDirectoryProjection(project, { sizes: true })
    expect(serialize).toHaveBeenCalledTimes(1)
  })

  it('normalizes orphan and cyclic parents to roots and counts invalid record references in Default', () => {
    const { project, sA, sA2, sDefault, pLeaf, pDefault, dA1, dB, dDefault } = fixture()
    project.folders = [
      { id: 'orphan', name: 'Orphan', parentId: 'missing' },
      { id: 'descendant', name: 'Descendant', parentId: 'orphan' },
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' },
      { id: 'blank', name: ' ' }
    ]
    sA.folderId = 'orphan'
    sA2.folderId = 'descendant'
    sDefault.folderId = 'x'
    pLeaf.folderId = 'y'
    pDefault.folderId = 'blank'
    dA1.folderId = 'missing'
    dB.folderId = ''
    dDefault.folderId = 'missing-doc'
    const before = JSON.stringify(project),
      result = createProjectDirectoryProjection(project)
    expect(result.rows.slice(1).every((row) => row.parentId === '' && row.depth === 0)).toBe(true)
    expect(result.byId.get('')!.count).toBe(4)
    expect(result.byId.get('orphan')!.count).toBe(1)
    expect(result.rootCount).toBe(8)
    expect(JSON.stringify(project)).toBe(before)
  })

  it('projects legacy cross-source and cross-language ID collisions once without mutating records', () => {
    const { project, language, other, sA, sA2, sDefault, pLeaf, pDefault, dA1, dB, dDefault } =
      fixture()
    delete project.folders
    project.corpusFolders = [
      { id: 'same', name: 'Notes', languageId: language.id },
      { id: 'same', name: 'Notes', languageId: other.id }
    ]
    project.docFolders = [
      { id: 'same', name: 'Notes' },
      { id: 'doc-child', name: 'Child', parentId: 'same' }
    ]
    sA.folderId = sA2.folderId = 'same'
    sDefault.folderId = 'missing'
    delete pLeaf.folderId
    delete pDefault.folderId
    dA1.folderId = 'doc-child'
    dB.folderId = 'same'
    dDefault.folderId = 'missing'
    const before = JSON.stringify(project),
      result = createProjectDirectoryProjection(project)
    expect(result.rows.map((row) => [row.name, row.directCount, row.count])).toEqual([
      ['Default', 4, 4],
      ['Notes', 1, 1],
      ['Notes (2)', 1, 1],
      ['Notes (3)', 1, 2],
      ['Child', 1, 1]
    ])
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(5)
    expect(result.rows.at(-1)!.path).toBe('Notes (3) / Child')
    expect(result.rootCount).toBe(8)
    expect(project.folders).toBeUndefined()
    expect(sA.folderId).toBe('same')
    expect(dB.folderId).toBe('same')
    expect(JSON.stringify(project)).toBe(before)
  })

  it('preserves metadata without inventing historical dates and isolates its graph snapshot', () => {
    const { project } = fixture(),
      result = createProjectDirectoryProjection(project),
      row = result.byId.get('a')!
    expect(row.tags).toEqual(['folder tag'])
    expect(row.createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(result.byId.get('b')!.createdAt).toBeUndefined()
    row.tags!.push('view only')
    project.folders!.find((folder) => folder.id === 'a')!.name = 'Changed'
    expect(result.byId.get('leaf')!.path).toBe('A / A1 / Leaf')
    expect(project.folders!.find((folder) => folder.id === 'a')!.tags).toEqual(['folder tag'])
    expect(createProjectDirectoryProjection(project).byId.get('leaf')!.path).toBe(
      'Changed / A1 / Leaf'
    )
  })

  it('handles deep trees and many records without recursion or eagerly expanding every path', () => {
    const { project, language } = fixture(),
      count = 3000
    project.folders = Array.from({ length: count }, (_, i) => ({
      id: `f${i}`,
      name: `F${i}`,
      ...(i ? { parentId: `f${i - 1}` } : {})
    }))
    project.sentences = Array.from({ length: 10000 }, (_, i) => ({
      ...createSentence(language.id),
      id: `s${i}`,
      folderId: 'f2999'
    }))
    project.phrasebook = []
    project.docs = []
    const result = createProjectDirectoryProjection(project)
    expect(result.rows).toHaveLength(3001)
    expect(result.rootCount).toBe(10000)
    expect(result.byId.get('')!.count).toBe(0)
    expect(result.byId.get('f0')!.count).toBe(10000)
    expect(result.byId.get('f2999')).toMatchObject({
      count: 10000,
      directCount: 10000,
      depth: 2999,
      children: false,
      bytes: 0
    })
    expect(result.byId.get('f2999')!.ancestors).toHaveLength(2999)
    expect(result.byId.get('f2999')!.path.endsWith('F2998 / F2999')).toBe(true)
  })

  it('counts all stored record rows, even when malformed old records repeat an ID', () => {
    const { project, sA } = fixture()
    project.sentences.push({ ...sA })
    expect(createProjectDirectoryProjection(project).rootCount).toBe(9)
    expect(createProjectDirectoryProjection(project).byId.get('a')!.count).toBe(5)
  })

  it('projects an empty legacy project without adding a directory field', () => {
    const project = createProject({
        name: 'Empty',
        template: 'blank',
        appVersion: '1.1.1',
        uiLocale: 'en'
      }),
      before = JSON.stringify(project),
      result = createProjectDirectoryProjection(project)
    expect(result.rows).toHaveLength(1)
    expect(result.rootCount).toBe(0)
    expect(result.rootBytes).toBe(0)
    expect(result.rows[0]).toMatchObject({
      default: true,
      count: 0,
      directCount: 0,
      children: false
    })
    expect(JSON.stringify(project)).toBe(before)
  })
})
