import { describe, it, expect } from 'vitest'
import { createLanguage, createProject, createSentence } from '$lib/core/factory'
import {
  parseProject,
  projectFromFolder,
  projectToFolder,
  serializeProject
} from '$lib/core/serialize'
import {
  corpusFolderOf,
  corpusFoldersFor,
  corpusFolderSentences,
  createCorpusFolder,
  renameCorpusFolder,
  removeCorpusFolder,
  reorderCorpusFolder,
  moveCorpusSentences,
  validCorpusFolder
} from '$lib/core/corpusFolders'
import {
  importSentenceRecords,
  importSentencesJson,
  sentencesToJson,
  sentencesToRows
} from '$lib/importers/corpusIO'
const fixture = () => {
  const p = createProject({
      name: 'Corpus folders QA',
      template: 'blank',
      appVersion: '1.1.0',
      uiLocale: 'zh'
    }),
    l = p.languages[0],
    other = createLanguage({ name: 'Other' })
  p.languages.push(other)
  for (const text of ['pa ma', 'ta ka']) {
    const s = createSentence(l.id)
    s.text = text
    p.sentences.push(s)
  }
  const foreign = createSentence(other.id)
  foreign.text = 'other'
  p.sentences.push(foreign)
  return { p, l, other }
}
describe('语料单层文件夹', () => {
  it('旧例句只读显示在Default，不增加数据字段', () => {
    const { p, l } = fixture(),
      before = JSON.stringify(p)
    expect(corpusFoldersFor(p, l.id)).toMatchObject([
      { id: '', name: 'Default', count: 2, default: true }
    ])
    expect(corpusFolderSentences(p, l.id, '')).toHaveLength(2)
    expect(JSON.stringify(p)).toBe(before)
  })
  it('创建与重命名验证非空、不重复和保留名，语言之间独立', () => {
    const { p, l, other } = fixture()
    expect(createCorpusFolder(p, l.id, '  Lessons  ', 'one')?.name).toBe('Lessons')
    expect(createCorpusFolder(p, l.id, 'Lessons', 'two')).toBeNull()
    expect(createCorpusFolder(p, l.id, 'Default', 'd')).toBeNull()
    expect(createCorpusFolder(p, l.id, ' ', 'b')).toBeNull()
    expect(createCorpusFolder(p, other.id, 'Lessons', 'other')).not.toBeNull()
    expect(renameCorpusFolder(p, 'one', ' New ')).toBe(true)
    expect(renameCorpusFolder(p, 'one', 'Default')).toBe(false)
    expect(validCorpusFolder(p, other.id, 'one')).toBe(false)
  })
  it('移动只改变同语言目标例句归属，ID正文分析均保留', () => {
    const { p, l, other } = fixture()
    createCorpusFolder(p, l.id, 'Lessons', 'one')
    const s = p.sentences[0],
      snapshot = structuredClone(s)
    expect(moveCorpusSentences(p, [s.id, p.sentences[2].id], l.id, 'one')).toBe(1)
    expect({ ...s, folderId: undefined }).toEqual({ ...snapshot, folderId: undefined })
    expect(corpusFolderOf(p, p.sentences[2])).toBe('')
    expect(moveCorpusSentences(p, [s.id], other.id, 'one')).toBe(0)
    expect(corpusFoldersFor(p, l.id).map((x) => x.count)).toEqual([1, 1])
    expect(moveCorpusSentences(p, [s.id], l.id, '')).toBe(1)
    expect(s.folderId).toBeUndefined()
  })
  it('无效及跨语言旧引用回Default，而非丢掉例句', () => {
    const { p, l, other } = fixture()
    createCorpusFolder(p, other.id, 'Foreign', 'foreign')
    p.sentences[0].folderId = 'foreign'
    p.sentences[1].folderId = 'missing'
    expect(corpusFolderSentences(p, l.id, '')).toHaveLength(2)
    expect(corpusFolderSentences(p, l.id, 'missing')).toEqual([])
  })
  it('网格排序仅调整本语言有序位置，不能拖Default或跨语言项', () => {
    const { p, l, other } = fixture()
    createCorpusFolder(p, l.id, 'A', 'a')
    createCorpusFolder(p, other.id, 'Other', 'other')
    createCorpusFolder(p, l.id, 'B', 'b')
    createCorpusFolder(p, l.id, 'C', 'c')
    expect(reorderCorpusFolder(p, l.id, 'c', 'a')).toBe(true)
    expect(p.corpusFolders?.map((x) => x.id)).toEqual(['c', 'other', 'a', 'b'])
    expect(reorderCorpusFolder(p, l.id, '', 'b')).toBe(false)
    expect(reorderCorpusFolder(p, l.id, 'a', 'other')).toBe(false)
  })
  it('删除文件夹移回Default，不删除任何例句', () => {
    const { p, l } = fixture()
    createCorpusFolder(p, l.id, 'A', 'a')
    moveCorpusSentences(p, [p.sentences[0].id], l.id, 'a')
    const before = p.sentences.map((s) => s.id)
    expect(removeCorpusFolder(p, 'a')).toBe(true)
    expect(p.sentences.map((s) => s.id)).toEqual(before)
    expect(corpusFolderOf(p, p.sentences[0])).toBe('')
    expect(removeCorpusFolder(p, '')).toBe(false)
  })
  it('JSON与多文件工程保留文件夹顺序、归属及显示空格选项', () => {
    const { p, l } = fixture()
    createCorpusFolder(p, l.id, 'Notes', 'notes')
    moveCorpusSentences(p, [p.sentences[0].id], l.id, 'notes')
    p.settings.scriptShowSpaces = false
    for (const copy of [parseProject(serializeProject(p)), projectFromFolder(projectToFolder(p))]) {
      expect(copy.corpusFolders).toEqual(p.corpusFolders)
      expect(copy.sentences[0].folderId).toBe('notes')
      expect(copy.settings.scriptShowSpaces).toBe(false)
    }
  })
  it('导出上下文可复用原格式，导入新例句按明确目标落入文件夹', () => {
    const { p, l } = fixture()
    createCorpusFolder(p, l.id, 'Imported', 'imports')
    const rows = importSentenceRecords(p, l.id, [{ text: 'new sentence', 'tr:zh': '新例句' }])
    expect(moveCorpusSentences(p, rows.ids, l.id, 'imports')).toBe(1)
    const list = corpusFolderSentences(p, l.id, 'imports')
    expect(sentencesToRows(p, list, ['zh'])[1][0]).toBe('new sentence')
    const target = fixture(),
      result = importSentencesJson(target.p, target.l.id, sentencesToJson(list))!
    createCorpusFolder(target.p, target.l.id, 'Here', 'here')
    moveCorpusSentences(target.p, result.ids, target.l.id, 'here')
    expect(corpusFolderSentences(target.p, target.l.id, 'here')[0].translation.zh).toBe('新例句')
  })
  it('导入的错误元数据不导致崩溃，重复id只保留第一项', () => {
    const { p, l } = fixture(),
      raw = {
        ...p,
        corpusFolders: [
          null,
          { id: 'a', name: 'A', languageId: l.id },
          { id: 'a', name: 'Dup', languageId: l.id },
          { id: 'bad' }
        ]
      }
    const restored = parseProject(JSON.stringify(raw))
    expect(restored.corpusFolders).toEqual([{ id: 'a', name: 'A', languageId: l.id }])
    expect(corpusFoldersFor(restored, l.id)).toHaveLength(2)
  })
})
