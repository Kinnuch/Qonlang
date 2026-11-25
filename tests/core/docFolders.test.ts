import { describe, expect, it } from 'vitest'
import { createDoc, createLanguage, createProject } from '$lib/core/factory'
import {
  createDocFolder,
  docFolderOf,
  docFolderPath,
  docFoldersFor,
  moveDocFolder,
  moveDocs,
  removeDocFolder,
  renameDocFolder,
  normalizeDocFolders,
  canMoveDocFolder,
  docFolderMoveTargets
} from '$lib/core/docFolders'
import {
  parseProject,
  serializeProject,
  serializeForDisk,
  readProjectText,
  projectFromFolder,
  projectToFolder
} from '$lib/core/serialize'

function fixture() {
  const project = createProject({
      name: 'Document folders QA',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.0'
    }),
    language = project.languages[0],
    other = createLanguage({ name: 'Other' })
  project.languages.push(other)
  const old = createDoc(language.id, 'Legacy'),
    shared = createDoc(null, 'Shared'),
    foreign = createDoc(other.id, 'Foreign')
  old.markdown = '# Preserve me\n\n[[doc:Shared]]'
  shared.format = 'html'
  shared.markdown = '<p>Shared &amp; safe.</p>'
  foreign.markdown = 'Other source'
  project.docs.push(old, shared, foreign)
  return { project, language, other, old, shared, foreign }
}
describe('document folders and legacy contents', () => {
  it('old and orphan documents stay in Default without changing original records', () => {
    const { project, language, old } = fixture()
    old.folderId = 'missing'
    const before = JSON.stringify(project.docs)
    expect(docFolderOf(project, old)).toBe('')
    expect(docFoldersFor(project, language.id)[0]).toMatchObject({
      id: '',
      name: 'Default',
      count: 2,
      default: true
    })
    expect(JSON.stringify(project.docs)).toBe(before)
  })
  it('builds a nested tree and paths, with stable document IDs and language filtering', () => {
    const { project, language, other, old, shared, foreign } = fixture()
    createDocFolder(project, 'Grammar', 'a')
    createDocFolder(project, 'Verbs', 'b', 'a')
    createDocFolder(project, 'History', 'c', 'b')
    moveDocs(project, [old.id, shared.id, foreign.id], 'c')
    expect(docFolderPath(project, 'c')).toBe('Grammar / Verbs / History')
    const row = docFoldersFor(project, language.id).find((folder) => folder.id === 'c')!
    expect(row.ancestors).toEqual(['a', 'b'])
    expect(row.count).toBe(2)
    expect(docFoldersFor(project, other.id).find((folder) => folder.id === 'c')?.count).toBe(2)
    expect(docFoldersFor(project, null).find((folder) => folder.id === 'c')?.count).toBe(3)
  })
  it('uses sibling-name uniqueness, allowing the same name in another parent', () => {
    const { project } = fixture()
    expect(createDocFolder(project, 'Default', 'default')).toBeNull()
    createDocFolder(project, 'A', 'a')
    createDocFolder(project, 'B', 'b')
    expect(createDocFolder(project, 'Child', 'c', 'a')).not.toBeNull()
    expect(createDocFolder(project, 'Child', 'duplicate', 'a')).toBeNull()
    expect(createDocFolder(project, 'Child', 'd', 'b')).not.toBeNull()
    expect(renameDocFolder(project, 'd', 'Renamed')).toBe(true)
    expect(renameDocFolder(project, 'a', 'Default')).toBe(false)
  })
  it('moves a folder as a subtree without changing document belonging or body', () => {
    const { project, old } = fixture()
    createDocFolder(project, 'A', 'a')
    createDocFolder(project, 'B', 'b')
    createDocFolder(project, 'Child', 'c', 'a')
    moveDocs(project, [old.id], 'c')
    const before = JSON.stringify(project.docs)
    expect(moveDocFolder(project, 'a', 'b')).toBe(true)
    expect(docFolderPath(project, 'c')).toBe('B / A / Child')
    expect(JSON.stringify(project.docs)).toBe(before)
  })
  it('rejects self, descendant, nonexistent and duplicate-name move destinations', () => {
    const { project } = fixture()
    createDocFolder(project, 'A', 'a')
    createDocFolder(project, 'B', 'b', 'a')
    createDocFolder(project, 'C', 'c', 'b')
    expect(canMoveDocFolder(project, 'a', 'a')).toBe(false)
    expect(moveDocFolder(project, 'a', 'c')).toBe(false)
    expect(moveDocFolder(project, 'a', 'missing')).toBe(false)
    createDocFolder(project, 'B', 'other')
    expect(moveDocFolder(project, 'b', '')).toBe(false)
  })
  it('batch destination selection excludes descendant, malformed chain and sibling-name conflicts', () => {
    const { project } = fixture()
    project.docFolders = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' },
      { id: 'same', name: 'B' },
      { id: 'e', name: 'E' },
      { id: 'bad', name: 'Bad', parentId: 'missing' }
    ]
    expect([...docFolderMoveTargets(project, 'b')].sort()).toEqual(['a', 'e', 'same'])
  })
  it('batch paths handle deep trees and malformed parents without recursive traversal or dropped folders', () => {
    const { project } = fixture()
    project.docFolders = Array.from({ length: 3000 }, (_, i) => ({
      id: '' + i,
      name: 'N' + i,
      ...(i ? { parentId: '' + (i - 1) } : {})
    }))
    const rows = docFoldersFor(project)
    expect(rows).toHaveLength(3001)
    expect(rows.at(-1)!.ancestors).toHaveLength(2999)
    expect(rows.at(-1)!.path.endsWith('N2998 / N2999')).toBe(true)
    project.docFolders[0].parentId = 'missing'
    const broken = docFoldersFor(project)
    expect(broken).toHaveLength(3001)
    expect(broken.every((row) => !row.ancestors.length)).toBe(true)
  })
  it('deletion promotion disambiguates sibling names without merging folder IDs or document bodies', () => {
    const { project, old } = fixture()
    project.docFolders = [
      { id: 'p', name: 'Parent' },
      { id: 'd', name: 'Delete', parentId: 'p' },
      { id: 'x', name: 'Same', parentId: 'p' },
      { id: 'y', name: 'Same', parentId: 'd' }
    ]
    old.folderId = 'y'
    expect(removeDocFolder(project, 'd')).toBe(true)
    expect(project.docFolders.find((folder) => folder.id === 'x')!.name).toBe('Same')
    expect(project.docFolders.find((folder) => folder.id === 'y')!).toMatchObject({
      name: 'Same (2)',
      parentId: 'p'
    })
    expect(old.folderId).toBe('y')
    expect(old.markdown).toContain('Preserve me')
  })
  it('deleting only a folder promotes its immediate children and pages, retaining all source data', () => {
    const { project, old, shared } = fixture()
    createDocFolder(project, 'A', 'a')
    createDocFolder(project, 'B', 'b', 'a')
    createDocFolder(project, 'C', 'c', 'b')
    moveDocs(project, [old.id], 'b')
    moveDocs(project, [shared.id], 'c')
    const ids = project.docs.map((doc) => doc.id),
      bodies = project.docs.map((doc) => [doc.markdown, doc.format, doc.languageId])
    expect(removeDocFolder(project, 'b')).toBe(true)
    expect(project.docFolders!.map((folder) => folder.id)).toEqual(['a', 'c'])
    expect(docFolderOf(project, old)).toBe('a')
    expect(docFolderOf(project, shared)).toBe('c')
    expect(docFolderPath(project, 'c')).toBe('A / C')
    expect(project.docs.map((doc) => doc.id)).toEqual(ids)
    expect(project.docs.map((doc) => [doc.markdown, doc.format, doc.languageId])).toEqual(bodies)
    expect(removeDocFolder(project, 'a')).toBe(true)
    expect(docFolderOf(project, old)).toBe('')
    expect(docFolderPath(project, 'c')).toBe('C')
    expect(removeDocFolder(project, '')).toBe(false)
  })
  it('document moves validate targets and do not touch language, title, text, format or ID', () => {
    const { project, old } = fixture(),
      before = { ...old }
    createDocFolder(project, 'A', 'a')
    expect(moveDocs(project, [old.id], 'a')).toBe(1)
    expect(moveDocs(project, [old.id], 'a')).toBe(0)
    expect(moveDocs(project, [old.id], 'missing')).toBe(0)
    expect({ ...old, folderId: undefined }).toEqual({ ...before, folderId: undefined })
    expect(moveDocs(project, [old.id], '')).toBe(1)
    expect(old.folderId).toBeUndefined()
  })
  it('normalizes malformed nodes, orphans and cycles without losing document bodies', () => {
    const nodes = normalizeDocFolders([
      null,
      { id: 'a', name: ' A ', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'missing' },
      { id: 'a', name: 'Duplicate' },
      { id: '', name: 'Empty' },
      { id: 'blank', name: ' ' }
    ])
    expect(nodes).toHaveLength(3)
    expect(nodes.every((folder) => !folder.parentId)).toBe(true)
    const { project } = fixture(),
      raw = JSON.parse(serializeProject(project))
    raw.docFolders = nodes
    expect(parseProject(JSON.stringify(raw)).docs.map((doc) => doc.markdown)).toEqual(
      project.docs.map((doc) => doc.markdown)
    )
  })
  it('project JSON and folder-format maps preserve nested folders, IDs, HTML and language metadata', () => {
    const { project, old, shared } = fixture()
    createDocFolder(project, 'A', 'a')
    createDocFolder(project, 'B', 'b', 'a')
    moveDocs(project, [old.id, shared.id], 'b')
    const folders = projectToFolder(project)
    expect(JSON.parse(folders['project.json']).docFolders).toEqual(project.docFolders)
    expect(
      JSON.parse(folders['docs.json']).find((doc: { id: string }) => doc.id === old.id).folderId
    ).toBe('b')
    for (const loaded of [parseProject(serializeProject(project)), projectFromFolder(folders)]) {
      expect(loaded.docFolders).toEqual(project.docFolders)
      expect(loaded.docs).toEqual(project.docs)
      expect(docFolderPath(loaded, 'b')).toBe('A / B')
    }
  })
  it('legacy folders with docs files but no metadata still recover to Default', () => {
    const { project } = fixture(),
      files = projectToFolder(project)
    delete files['docs.json']
    const restored = projectFromFolder(files)
    expect(restored.docs).toHaveLength(project.docs.length)
    expect(
      restored.docs.every((doc) => doc.languageId === null && docFolderOf(restored, doc) === '')
    ).toBe(true)
    expect(restored.docs.map((doc) => doc.markdown).sort()).toEqual(
      project.docs.map((doc) => doc.markdown).sort()
    )
  })
  it('the shared desktop/web save pipeline preserves folders in plain and sealed projects', async () => {
    const { project, old } = fixture()
    createDocFolder(project, 'A', 'a')
    createDocFolder(project, 'B', 'b', 'a')
    moveDocs(project, [old.id], 'b')
    for (const readOnly of [false, true]) {
      project.meta.readOnly = readOnly
      const disk = await serializeForDisk(project),
        loaded = parseProject(await readProjectText(disk))
      expect(loaded.docFolders).toEqual(project.docFolders)
      expect(loaded.docs).toEqual(project.docs)
      expect(docFolderPath(loaded, 'b')).toBe('A / B')
    }
  })
})
