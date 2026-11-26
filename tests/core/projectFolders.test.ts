import { describe, expect, it } from 'vitest'
import {
  createDoc,
  createLanguage,
  createPhrase,
  createProject,
  createSentence
} from '$lib/core/factory'
import {
  createProjectClipboard,
  createProjectFolder,
  ensureProjectFolders,
  moveProjectFolder,
  moveProjectRecords,
  pasteProjectClipboard,
  projectFolderMoveTargets,
  projectFolderOf,
  projectFolderPath,
  projectFolderRecords,
  projectFolders,
  projectRecordSize,
  removeProjectFolder,
  renameProjectFolder,
  reorderProjectFolder
} from '$lib/core/projectFolders'
import { corpusFolderOf, corpusFoldersFor } from '$lib/core/corpusFolders'
import { docFolderOf, docFoldersFor } from '$lib/core/docFolders'
import {
  parseProject,
  projectFromFolder,
  projectToFolder,
  serializeProject
} from '$lib/core/serialize'

const fixture = () => {
  const project = createProject({
      name: 'Shared folders QA',
      template: 'blank',
      appVersion: '1.1.1',
      uiLocale: 'en'
    }),
    language = project.languages[0],
    other = createLanguage({ name: 'Other' }),
    sentence = createSentence(language.id),
    phrase = createPhrase(other.id),
    doc = createDoc(null, 'HTML source')
  project.languages.push(other)
  sentence.text = 'source g / ɡ'
  sentence.tokens = [
    {
      surface: 'g',
      chosen: 0,
      confirmed: true,
      analyses: [
        {
          lexemeId: 'keep-lexeme',
          slot: null,
          morphs: [{ form: 'g', gloss: 'KEEP', morphemeId: 'keep-morpheme' }]
        }
      ]
    }
  ]
  phrase.text = 'phrase'
  phrase.variants = [{ text: 'variant', note: 'keep' }]
  doc.format = 'html'
  doc.markdown = '<p>[[sentence:source g / ɡ]]</p>'
  doc.tags = ['tag']
  project.sentences.push(sentence)
  project.phrasebook.push(phrase)
  project.docs.push(doc)
  return { project, language, other, sentence, phrase, doc }
}
const refsOf = (f: ReturnType<typeof fixture>) => [
  { kind: 'sentence' as const, id: f.sentence.id },
  { kind: 'phrase' as const, id: f.phrase.id },
  { kind: 'doc' as const, id: f.doc.id }
]
const ids = (prefix = 'copied') => {
  let n = 0
  return () => `${prefix}-${++n}`
}

describe('project-wide folder graph and compatibility migration', () => {
  it('reads legacy collisions without writing, then migrates each source and language separately', () => {
    const f = fixture(),
      { project, sentence, doc, language, other } = f
    project.corpusFolders = [
      { id: 'same', name: 'Notes', languageId: language.id },
      { id: 'same', name: 'Notes', languageId: other.id },
      { id: 'child', name: 'Child', languageId: language.id, parentId: 'same' }
    ]
    project.docFolders = [
      { id: 'same', name: 'Notes' },
      { id: 'doc-child', name: 'Child', parentId: 'same' }
    ]
    sentence.folderId = 'child'
    doc.folderId = 'doc-child'
    const foreign = createSentence(other.id)
    foreign.folderId = 'same'
    project.sentences.push(foreign)
    delete sentence.createdAt
    delete doc.createdAt
    const before = serializeProject(project),
      view = projectFolders(project)
    expect(view).toHaveLength(5)
    expect(new Set(view.map((row) => row.id)).size).toBe(5)
    expect(serializeProject(project)).toBe(before)
    expect(
      projectFolderPath(project, projectFolderOf(project, doc)).map((row) => row.name)
    ).toEqual(['Notes (3)', 'Child'])
    ensureProjectFolders(project)
    expect(projectFolderPath(project, sentence.folderId!).map((row) => row.name)).toEqual([
      'Notes',
      'Child'
    ])
    expect(projectFolderPath(project, foreign.folderId!).map((row) => row.name)).toEqual([
      'Notes (2)'
    ])
    expect(projectFolderPath(project, doc.folderId!).map((row) => row.name)).toEqual([
      'Notes (3)',
      'Child'
    ])
    expect(sentence.id).toBe(f.sentence.id)
    expect(doc.markdown).toBe('<p>[[sentence:source g / ɡ]]</p>')
    expect(sentence.createdAt).toBeUndefined()
    expect(doc.createdAt).toBeUndefined()
    const once = serializeProject(project)
    ensureProjectFolders(project)
    expect(serializeProject(project)).toBe(once)
  })

  it('does not infer cross-language bad legacy parents or keep orphan assignments', () => {
    const { project, language, other, sentence, doc } = fixture()
    project.corpusFolders = [
      { id: 'a', name: 'A', languageId: language.id, parentId: 'b' },
      { id: 'b', name: 'B', languageId: other.id }
    ]
    project.docFolders = [
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' }
    ]
    sentence.folderId = 'b'
    doc.folderId = 'missing'
    ensureProjectFolders(project)
    expect(project.folders!.every((folder) => !folder.parentId)).toBe(true)
    expect(sentence.folderId).toBeUndefined()
    expect(doc.folderId).toBeUndefined()
  })

  it('does not allocate a collision ID that steals another original legacy folder ID', () => {
    const { project, language } = fixture()
    project.corpusFolders = [{ id: 'clash', name: 'Corpus', languageId: language.id }]
    project.docFolders = [
      { id: 'clash', name: 'Docs' },
      { id: 'clash:legacy-doc-2', name: 'Original ID' }
    ]
    ensureProjectFolders(project)
    expect(project.folders!.find((folder) => folder.name === 'Original ID')!.id).toBe(
      'clash:legacy-doc-2'
    )
    expect(project.folders!.find((folder) => folder.name === 'Docs')!.id).toBe('clash:legacy-doc-3')
  })

  it('uses one tree for every record kind while preserving language and content', () => {
    const f = fixture(),
      { project, sentence, phrase, doc, language, other } = f
    createProjectFolder(project, 'Shared', 'shared')
    const before = refsOf(f).map((ref) => {
      const record = ref.kind === 'sentence' ? sentence : ref.kind === 'phrase' ? phrase : doc
      return { ...record }
    })
    expect(moveProjectRecords(project, refsOf(f), 'shared')).toBe(3)
    expect(projectFolderRecords(project, 'shared')).toEqual(refsOf(f))
    expect([sentence.languageId, phrase.languageId, doc.languageId]).toEqual([
      language.id,
      other.id,
      null
    ])
    expect([sentence, phrase, doc].map((record) => ({ ...record, folderId: undefined }))).toEqual(
      before.map((record) => ({ ...record, folderId: undefined }))
    )
    expect(corpusFolderOf(project, sentence)).toBe('shared')
    expect(docFolderOf(project, doc)).toBe('shared')
    expect(corpusFoldersFor(project, language.id).some((row) => row.id === 'shared')).toBe(true)
    expect(docFoldersFor(project, other.id).some((row) => row.id === 'shared')).toBe(true)
  })

  it('validates sibling names, moves and reorder without allowing cycles or moving Default', () => {
    const { project } = fixture()
    expect(createProjectFolder(project, 'Default', 'bad')).toBeNull()
    createProjectFolder(project, 'A', 'a')
    createProjectFolder(project, 'B', 'b')
    createProjectFolder(project, 'Child', 'child', 'a')
    expect(createProjectFolder(project, 'Child', 'dup', 'a')).toBeNull()
    expect(createProjectFolder(project, 'Child', 'other-child', 'b')).not.toBeNull()
    expect(projectFolderMoveTargets(project, 'a').has('child')).toBe(false)
    expect(moveProjectFolder(project, 'a', 'child')).toBe(false)
    expect(moveProjectFolder(project, '', 'a')).toBe(false)
    expect(renameProjectFolder(project, 'a', 'Default')).toBe(false)
    expect(reorderProjectFolder(project, 'b', 'a')).toBe(true)
    expect(
      projectFolders(project)
        .slice(0, 2)
        .map((row) => row.id)
    ).toEqual(['b', 'a'])
  })

  it('removes only the directory and promotes all three record types and direct children', () => {
    const f = fixture(),
      { project, sentence, phrase, doc } = f
    createProjectFolder(project, 'A', 'a')
    createProjectFolder(project, 'Child', 'root-child')
    createProjectFolder(project, 'Child', 'child', 'a')
    createProjectFolder(project, 'Grandchild', 'grand', 'child')
    moveProjectRecords(project, refsOf(f), 'a')
    const idsBefore = [sentence.id, phrase.id, doc.id]
    expect(removeProjectFolder(project, 'a')).toBe(true)
    expect([sentence.folderId, phrase.folderId, doc.folderId]).toEqual([
      undefined,
      undefined,
      undefined
    ])
    expect([sentence.id, phrase.id, doc.id]).toEqual(idsBefore)
    expect(project.folders!.find((folder) => folder.id === 'child')).toMatchObject({
      name: 'Child (2)'
    })
    expect(projectFolderPath(project, 'grand').map((row) => row.name)).toEqual([
      'Child (2)',
      'Grandchild'
    ])
    expect(removeProjectFolder(project, '')).toBe(false)
    // 旧兼容数组不能把已删除的新目录复活。
    project.corpusFolders = [{ id: 'a', name: 'A', languageId: sentence.languageId }]
    expect(projectFolders(project).some((folder) => folder.id === 'a')).toBe(false)
  })

  it('round-trips shared IDs, metadata and all record assignments through JSON and folder formats', () => {
    const f = fixture(),
      { project } = f
    createProjectFolder(project, 'A', 'a')
    createProjectFolder(project, 'B', 'b', 'a')
    project.folders![0].tags = ['folder tag']
    moveProjectRecords(project, refsOf(f), 'b')
    project.settings.folderView = 'details'
    project.settings.folderMetadata = ['tags', 'createdAt', 'size', 'type']
    const folderFiles = projectToFolder(project)
    expect(JSON.parse(folderFiles['project.json']).folders).toEqual(project.folders)
    expect(JSON.parse(folderFiles['docs.json'])[0].folderId).toBe('b')
    for (const loaded of [
      parseProject(serializeProject(project)),
      projectFromFolder(folderFiles)
    ]) {
      expect(loaded.folders).toEqual(project.folders)
      expect(loaded.sentences).toEqual(project.sentences)
      expect(loaded.phrasebook).toEqual(project.phrasebook)
      expect(loaded.docs).toEqual(project.docs)
      expect(loaded.settings.folderMetadata).toEqual(project.settings.folderMetadata)
    }
  })

  it('does not fabricate dates for legacy records and estimates serialized UTF-8 size', () => {
    const { project, sentence, phrase, doc } = fixture()
    delete sentence.createdAt
    delete phrase.createdAt
    delete doc.createdAt
    const loaded = parseProject(serializeProject(project))
    expect([
      loaded.sentences[0].createdAt,
      loaded.phrasebook[0].createdAt,
      loaded.docs[0].createdAt
    ]).toEqual([undefined, undefined, undefined])
    expect(projectRecordSize(project, { kind: 'doc', id: doc.id })).toBe(
      new TextEncoder().encode(JSON.stringify(doc)).length
    )
  })
})

describe('atomic folder and record clipboard operations', () => {
  it('copies a whole subtree, three record kinds and links with fresh IDs and unique names', () => {
    const f = fixture(),
      { project, sentence, phrase, doc } = f
    createProjectFolder(project, 'A', 'a')
    createProjectFolder(project, 'B', 'b', 'a')
    moveProjectRecords(project, refsOf(f), 'b')
    const original = serializeProject(project)
    const clipboard = createProjectClipboard(
      project,
      [{ kind: 'folder', id: 'a' }, { kind: 'folder', id: 'b' }, ...refsOf(f)],
      'copy',
      { now: 1000 }
    )!
    expect(clipboard.folderIds).toEqual(['a'])
    expect(clipboard.records).toHaveLength(3)
    expect(serializeProject(project)).toBe(original)
    const result = pasteProjectClipboard(project, clipboard, '', { newId: ids(), now: 2000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.count).toBe(5)
    expect(projectFolderPath(project, 'copied-2').map((row) => row.name)).toEqual(['A (2)', 'B'])
    expect(project.sentences[1].tokens).toEqual(sentence.tokens)
    expect(project.sentences[1].tokens).not.toBe(sentence.tokens)
    expect(project.phrasebook[1].variants).toEqual(phrase.variants)
    expect(project.docs[1].markdown).toBe(doc.markdown)
    expect(project.docs[1].folderId).toBe('copied-2')
    expect(project.docs[1].id).not.toBe(doc.id)
    expect(project.docs[1].createdAt).toBe(new Date(2000).toISOString())
    project.sentences[1].tokens[0].surface = 'changed copy'
    expect(sentence.tokens[0].surface).toBe('g')
  })

  it('copies each standalone record and supports repeated same-project paste after JSON transport', () => {
    const f = fixture(),
      { project } = f
    createProjectFolder(project, 'Target', 'target')
    const clipboard = JSON.parse(
      JSON.stringify(createProjectClipboard(project, refsOf(f), 'copy', { now: 1 }))
    )
    expect(
      pasteProjectClipboard(project, clipboard, 'target', { newId: ids('first'), now: 99999999 }).ok
    ).toBe(true)
    expect(
      pasteProjectClipboard(project, clipboard, 'target', { newId: ids('second'), now: 99999999 })
        .ok
    ).toBe(true)
    expect(project.sentences).toHaveLength(3)
    expect(project.docs).toHaveLength(3)
  })

  it('copies the issued snapshot after source records are edited or deleted', () => {
    const f = fixture(),
      { project, sentence, doc } = f,
      originalText = sentence.text,
      originalDoc = doc.markdown,
      clipboard = createProjectClipboard(project, refsOf(f), 'copy', { now: 1 })!
    sentence.text = 'edited after copying'
    doc.markdown = 'edited document'
    project.phrasebook = []
    const result = pasteProjectClipboard(project, clipboard, '', { now: 2, newId: ids() })
    expect(result.ok).toBe(true)
    expect(project.sentences.at(-1)!.text).toBe(originalText)
    expect(project.docs.at(-1)!.markdown).toBe(originalDoc)
    expect(project.phrasebook).toHaveLength(1)
    expect(project.phrasebook[0].text).toBe('phrase')
    expect(sentence.text).toBe('edited after copying')
    expect(doc.markdown).toBe('edited document')
  })

  it('retains only the current issued operation and permits repeated paste of that copy', () => {
    const f = fixture(),
      { project } = f,
      previous = createProjectClipboard(project, refsOf(f), 'copy', { now: 1 })!,
      current = createProjectClipboard(project, refsOf(f), 'copy', { now: 2 })!
    expect(pasteProjectClipboard(project, previous, '', { now: 3 })).toEqual({
      ok: false,
      reason: 'stale'
    })
    expect(pasteProjectClipboard(project, current, '', { now: 3, newId: ids('first') }).ok).toBe(
      true
    )
    expect(pasteProjectClipboard(project, current, '', { now: 4, newId: ids('second') }).ok).toBe(
      true
    )
  })

  it.each(['copy', 'cut'] as const)('rejects %s before its registered creation time', (mode) => {
    const f = fixture(),
      clipboard = createProjectClipboard(f.project, refsOf(f), mode, { now: 100000 })!,
      before = serializeProject(f.project)
    expect(pasteProjectClipboard(f.project, clipboard, '', { now: -1 })).toEqual({
      ok: false,
      reason: 'expired'
    })
    expect(serializeProject(f.project)).toBe(before)
  })

  it('rejects a transported copy in a reopened instance of the same project ID', () => {
    const f = fixture(),
      clipboard = createProjectClipboard(f.project, refsOf(f), 'copy', { now: 1 })!,
      reopened = parseProject(serializeProject(f.project)),
      before = serializeProject(reopened)
    expect(
      pasteProjectClipboard(reopened, JSON.parse(JSON.stringify(clipboard)), '', { now: 2 })
    ).toEqual({ ok: false, reason: 'cross-project' })
    expect(serializeProject(reopened)).toBe(before)
  })

  it('rejects foreign copies even if their project, session and operation IDs are forged', () => {
    const source = fixture(),
      target = fixture(),
      foreign = createProjectClipboard(source.project, refsOf(source), 'copy', { now: 1 })!,
      local = createProjectClipboard(target.project, refsOf(target), 'copy', { now: 1 })!,
      forged = JSON.parse(JSON.stringify(foreign)),
      before = serializeProject(target.project)
    forged.projectId = target.project.meta.id
    expect(pasteProjectClipboard(target.project, forged, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'cross-project'
    })
    forged.sessionId = local.sessionId
    forged.id = local.id
    expect(pasteProjectClipboard(target.project, forged, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'stale'
    })
    expect(serializeProject(target.project)).toBe(before)
  })

  it.each(['mode', 'createdAt', 'expiresAt', 'refs', 'records', 'folders'] as const)(
    'rejects tampering with issued copy %s without modifying the project',
    (field) => {
      const f = fixture(),
        clipboard = createProjectClipboard(f.project, refsOf(f), 'copy', { now: 1000 })!,
        forged = JSON.parse(JSON.stringify(clipboard)),
        before = serializeProject(f.project)
      if (field === 'mode') forged.mode = 'cut'
      if (field === 'createdAt') forged.createdAt = 0
      if (field === 'expiresAt') forged.expiresAt = 99999999
      if (field === 'refs') forged.refs[0].id = 'other-record'
      if (field === 'records') forged.records[0].record.text = 'external payload'
      if (field === 'folders') {
        forged.folders = [{ id: 'external', name: 'External' }]
        forged.folderIds = ['external']
      }
      expect(pasteProjectClipboard(f.project, forged, '', { now: 2000 })).toEqual({
        ok: false,
        reason: 'stale'
      })
      expect(serializeProject(f.project)).toBe(before)
    }
  )

  it('keeps a cut source intact until successful paste and consumes a successful cut once', () => {
    const f = fixture(),
      { project } = f
    createProjectFolder(project, 'Source', 'source')
    createProjectFolder(project, 'Target', 'target')
    moveProjectRecords(project, refsOf(f), 'source')
    const before = serializeProject(project),
      clipboard = createProjectClipboard(project, [{ kind: 'folder', id: 'source' }], 'cut', {
        now: 1000
      })!
    expect(serializeProject(project)).toBe(before)
    expect(pasteProjectClipboard(project, clipboard, 'missing', { now: 2000 })).toEqual({
      ok: false,
      reason: 'invalid-target'
    })
    expect(serializeProject(project)).toBe(before)
    const result = pasteProjectClipboard(project, clipboard, 'target', { now: 2000 })
    expect(result.ok).toBe(true)
    expect(projectFolderPath(project, 'source').map((row) => row.id)).toEqual(['target', 'source'])
    expect(project.sentences).toHaveLength(1)
    expect(pasteProjectClipboard(project, clipboard, '', { now: 2001 })).toEqual({
      ok: false,
      reason: 'expired'
    })
  })

  it.each(['copy', 'cut'] as const)(
    'rejects cross-project %s without touching either project',
    (mode) => {
      const f = fixture(),
        other = fixture(),
        clipboard = createProjectClipboard(f.project, refsOf(f), mode, { now: 1 })!
      const source = serializeProject(f.project),
        target = serializeProject(other.project)
      expect(pasteProjectClipboard(other.project, clipboard, '', { now: 2 })).toEqual({
        ok: false,
        reason: 'cross-project'
      })
      expect(serializeProject(f.project)).toBe(source)
      expect(serializeProject(other.project)).toBe(target)
    }
  )

  it('rejects expired, stale and re-opened-session cuts without deleting source objects', () => {
    const f = fixture(),
      { project, sentence } = f
    const expired = createProjectClipboard(project, refsOf(f), 'cut', { now: 1, ttlMs: 1 })!
    expect(pasteProjectClipboard(project, expired, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'expired'
    })
    const stale = createProjectClipboard(project, refsOf(f), 'cut', { now: 1 })!
    sentence.text = 'edited after cutting'
    expect(pasteProjectClipboard(project, stale, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'stale'
    })
    const fresh = createProjectClipboard(project, refsOf(f), 'cut', { now: 1 })!
    const reopened = parseProject(serializeProject(project))
    expect(pasteProjectClipboard(reopened, fresh, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'cross-project'
    })
    expect(sentence.text).toBe('edited after cutting')
    expect(project.sentences).toHaveLength(1)
  })

  it('detects newly added subtree contents and rejects self/descendant paste for either operation', () => {
    const f = fixture(),
      { project } = f
    createProjectFolder(project, 'A', 'a')
    createProjectFolder(project, 'Child', 'child', 'a')
    for (const mode of ['copy', 'cut'] as const) {
      const clipboard = createProjectClipboard(project, [{ kind: 'folder', id: 'a' }], mode, {
        now: 1
      })!
      expect(pasteProjectClipboard(project, clipboard, 'child', { now: 2 })).toEqual({
        ok: false,
        reason: 'cycle'
      })
    }
    const clipboard = createProjectClipboard(project, [{ kind: 'folder', id: 'a' }], 'cut', {
      now: 1
    })!
    const added = createDoc(null, 'added')
    added.folderId = 'child'
    project.docs.push(added)
    expect(pasteProjectClipboard(project, clipboard, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'stale'
    })
  })

  it('renames a cut root on collision instead of merging records into the existing directory', () => {
    const f = fixture(),
      { project } = f
    createProjectFolder(project, 'Parent', 'parent')
    createProjectFolder(project, 'A', 'a')
    createProjectFolder(project, 'A', 'existing', 'parent')
    const clipboard = createProjectClipboard(project, [{ kind: 'folder', id: 'a' }], 'cut', {
      now: 1
    })!
    expect(pasteProjectClipboard(project, clipboard, 'parent', { now: 2 }).ok).toBe(true)
    expect(project.folders!.find((folder) => folder.id === 'a')).toMatchObject({
      name: 'A (2)',
      parentId: 'parent'
    })
    expect(project.folders!.some((folder) => folder.id === 'existing')).toBe(true)
  })

  it('allocates all copy IDs before committing and leaves the project unchanged on failure', () => {
    const f = fixture(),
      clipboard = createProjectClipboard(f.project, refsOf(f), 'copy', { now: 1 })!,
      before = serializeProject(f.project)
    expect(
      pasteProjectClipboard(f.project, clipboard, '', { now: 2, newId: () => f.sentence.id })
    ).toEqual({ ok: false, reason: 'invalid-id' })
    expect(serializeProject(f.project)).toBe(before)
    expect(f.project.folders).toBeUndefined()
  })

  it('enforces read-only mutation guards while allowing copying without changing the source', () => {
    const f = fixture(),
      { project } = f
    const clipboard = createProjectClipboard(project, refsOf(f), 'copy', { now: 1 })!
    project.meta.readOnly = true
    const before = serializeProject(project)
    expect(createProjectFolder(project, 'A', 'a')).toBeNull()
    expect(moveProjectRecords(project, refsOf(f), '')).toBe(0)
    expect(createProjectClipboard(project, refsOf(f), 'cut')).toBeNull()
    expect(createProjectClipboard(project, refsOf(f), 'copy')).not.toBeNull()
    expect(pasteProjectClipboard(project, clipboard, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'readonly'
    })
    expect(serializeProject(project)).toBe(before)
  })

  it('copies legacy colliding directories using their effective shared IDs, not raw legacy IDs', () => {
    const f = fixture(),
      { project, sentence, doc } = f
    project.corpusFolders = [{ id: 'same', name: 'Corpus', languageId: sentence.languageId }]
    project.docFolders = [{ id: 'same', name: 'Docs' }]
    sentence.folderId = 'same'
    doc.folderId = 'same'
    const docFolder = projectFolderOf(project, doc)
    expect(docFolder).not.toBe('same')
    const clipboard = createProjectClipboard(project, [{ kind: 'folder', id: docFolder }], 'copy', {
      now: 1
    })!
    expect(clipboard.records.map((row) => row.kind)).toEqual(['doc'])
    expect(pasteProjectClipboard(project, clipboard, '', { now: 2, newId: ids() }).ok).toBe(true)
    expect(project.docs[1].folderId).toBe('copied-1')
    expect(project.sentences).toHaveLength(1)
  })

  it('rejects forged cuts and malformed clipboard graphs without partial writes', () => {
    const f = fixture(),
      { project } = f
    const copy = createProjectClipboard(project, refsOf(f), 'copy', { now: 1 })!
    const before = serializeProject(project)
    copy.mode = 'cut'
    expect(pasteProjectClipboard(project, copy, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'stale'
    })
    const malformed = createProjectClipboard(project, refsOf(f), 'copy', { now: 1 })!
    malformed.folders = [null as never]
    expect(pasteProjectClipboard(project, malformed, '', { now: 2 })).toEqual({
      ok: false,
      reason: 'invalid-source'
    })
    expect(serializeProject(project)).toBe(before)
  })

  it('accepts transported cuts with reordered object keys, but not changed selected content', () => {
    const f = fixture(),
      { project } = f
    createProjectFolder(project, 'Target', 'target')
    const clipboard = createProjectClipboard(project, refsOf(f), 'cut', { now: 1 })!
    const encoded = JSON.stringify(clipboard, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .reverse()
              .map((key) => [key, value[key]])
          )
        : value
    )
    expect(pasteProjectClipboard(project, JSON.parse(encoded), 'target', { now: 2 }).ok).toBe(true)
  })

  it('legacy source-only document folders do not receive invented creation times', () => {
    const { project } = fixture(),
      files = projectToFolder(project)
    delete files['docs.json']
    const restored = projectFromFolder(files)
    expect(restored.docs[0].createdAt).toBeUndefined()
  })

  it('keeps the first duplicate ID within a kind and treats IDs in other kinds separately', () => {
    const f = fixture(),
      { project, sentence, phrase, doc } = f
    sentence.id = phrase.id = doc.id = 'same-id'
    sentence.text = 'first sentence'
    const duplicate = { ...sentence, text: 'second sentence' }
    project.sentences.push(duplicate)
    createProjectFolder(project, 'Target', 'target')
    const refs = refsOf(f),
      copy = createProjectClipboard(project, refs, 'copy', { now: 1 })!
    expect(copy.records.map((row) => row.kind)).toEqual(['sentence', 'phrase', 'doc'])
    expect(copy.records[0].record).toMatchObject({ text: 'first sentence' })
    const cut = createProjectClipboard(project, refs, 'cut', { now: 2 })!
    expect(pasteProjectClipboard(project, cut, 'target', { now: 3 }).ok).toBe(true)
    expect(sentence.folderId).toBe('target')
    expect(phrase.folderId).toBe('target')
    expect(doc.folderId).toBe('target')
    expect(duplicate.folderId).toBeUndefined()
    expect(duplicate.text).toBe('second sentence')
  })

  it('builds a fresh cut-paste index for current objects rather than retaining a previous operation cache', () => {
    const f = fixture(),
      { project, sentence } = f
    createProjectFolder(project, 'Target', 'target')
    const cut = createProjectClipboard(project, refsOf(f), 'cut', { now: 1 })!
    project.sentences = JSON.parse(JSON.stringify(project.sentences))
    expect(pasteProjectClipboard(project, cut, 'target', { now: 2 }).ok).toBe(true)
    expect(project.sentences[0].folderId).toBe('target')
    expect(sentence.folderId).toBeUndefined()
  })

  it('cuts a large reversed selection without changing record order, content or identity', () => {
    const { project, language } = fixture()
    project.sentences = Array.from({ length: 2000 }, (_, i) => ({
      ...createSentence(language.id),
      id: `bulk-${i}`,
      text: `entry ${i}`
    }))
    createProjectFolder(project, 'Target', 'target')
    const refs = project.sentences
        .map((record) => ({ kind: 'sentence' as const, id: record.id }))
        .reverse(),
      before = project.sentences.map((record) => [record.id, record.text, record.languageId]),
      cut = createProjectClipboard(project, refs, 'cut', { now: 1 })!
    const result = pasteProjectClipboard(project, cut, 'target', { now: 2 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.refs).toEqual(refs)
    expect(project.sentences.map((record) => [record.id, record.text, record.languageId])).toEqual(
      before
    )
    expect(project.sentences.every((record) => record.folderId === 'target')).toBe(true)
  })
})
