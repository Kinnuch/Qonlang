import { describe, it, expect } from 'vitest'
import { createLanguage, createProject, createSentence } from '$lib/core/factory'
import {
  parseProject,
  serializeProject,
  projectToFolder,
  projectFromFolder
} from '$lib/core/serialize'
import {
  createCorpusFolder,
  moveCorpusFolder,
  removeCorpusFolder,
  moveCorpusSentences,
  corpusFolderSentences,
  corpusFoldersFor,
  corpusFolderPath
} from '$lib/core/corpusFolders'
const fixture = () => {
  const p = createProject({
      name: 'Nested corpus',
      template: 'blank',
      appVersion: '1.1.0',
      uiLocale: 'zh'
    }),
    l = p.languages[0]
  createCorpusFolder(p, l.id, 'A', 'a')
  createCorpusFolder(p, l.id, 'B', 'b', 'a')
  createCorpusFolder(p, l.id, 'C', 'c', 'b')
  for (const [id, folderId] of [
    ['default', ''],
    ['in-a', 'a'],
    ['in-b', 'b'],
    ['in-c', 'c']
  ]) {
    const s = createSentence(l.id)
    s.id = id
    s.text = id
    if (folderId) s.folderId = folderId
    p.sentences.push(s)
  }
  return { p, l }
}
describe('语料多级文件夹', () => {
  it('名称只在同一父层要求唯一，移动拒绝自己与子树', () => {
    const { p, l } = fixture()
    expect(createCorpusFolder(p, l.id, 'B', 'other-b')).not.toBeNull()
    expect(createCorpusFolder(p, l.id, 'B', 'dup-b', 'a')).toBeNull()
    expect(moveCorpusFolder(p, l.id, 'a', 'c')).toBe(false)
    expect(moveCorpusFolder(p, l.id, 'b', 'b')).toBe(false)
    expect(moveCorpusFolder(p, l.id, 'b', '')).toBe(false)
    expect(corpusFolderPath(p, l.id, 'c').map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })
  it('本层与子树范围明确，计数与递归选择使用相同有效父图', () => {
    const { p, l } = fixture()
    expect(corpusFolderSentences(p, l.id, 'a').map((s) => s.id)).toEqual(['in-a'])
    expect(corpusFolderSentences(p, l.id, 'a', true).map((s) => s.id)).toEqual([
      'in-a',
      'in-b',
      'in-c'
    ])
    expect(corpusFoldersFor(p, l.id).map((f) => [f.id, f.count, f.subtreeCount])).toEqual([
      ['', 1, 4],
      ['a', 1, 3],
      ['b', 1, 2],
      ['c', 1, 1]
    ])
  })
  it('孤儿、循环与跨语言坏父都归有效根，递归Default不会漏句', () => {
    const { p, l } = fixture(),
      other = createLanguage({ name: 'Other' })
    p.languages.push(other)
    p.corpusFolders![0].parentId = 'missing'
    p.corpusFolders![1].parentId = 'c'
    p.corpusFolders!.push({ id: 'foreign', languageId: other.id, name: 'Foreign' })
    p.corpusFolders![2].parentId = 'foreign'
    expect(corpusFoldersFor(p, l.id).find((f) => f.id === '')?.subtreeCount).toBe(4)
    expect(corpusFolderSentences(p, l.id, '', true).map((s) => s.id)).toEqual([
      'default',
      'in-a',
      'in-b',
      'in-c'
    ])
  })
  it('删除提升直接子目录与本层例句，子树中内容不丢失；重名只改显示名', () => {
    const { p, l } = fixture()
    createCorpusFolder(p, l.id, 'C', 'root-c', 'a')
    const ids = p.sentences.map((s) => s.id)
    expect(removeCorpusFolder(p, 'b')).toBe(true)
    expect(p.corpusFolders?.find((f) => f.id === 'c')).toMatchObject({
      parentId: 'a',
      name: 'C (2)'
    })
    expect(p.sentences.find((s) => s.id === 'in-b')?.folderId).toBe('a')
    expect(p.sentences.find((s) => s.id === 'in-c')?.folderId).toBe('c')
    expect(p.sentences.map((s) => s.id)).toEqual(ids)
  })
  it('跨层移动整个子树保留全部句子与父子ID，JSON和目录格式可重开', () => {
    const { p, l } = fixture()
    createCorpusFolder(p, l.id, 'Target', 'target')
    expect(moveCorpusFolder(p, l.id, 'a', 'target')).toBe(true)
    expect(corpusFolderPath(p, l.id, 'c').map((f) => f.id)).toEqual(['target', 'a', 'b', 'c'])
    for (const saved of [
      parseProject(serializeProject(p)),
      projectFromFolder(projectToFolder(p))
    ]) {
      expect(saved.corpusFolders).toEqual(p.corpusFolders)
      expect(saved.sentences.map((s) => [s.id, s.folderId])).toEqual(
        p.sentences.map((s) => [s.id, s.folderId])
      )
    }
  })
  it('批量移动例句不改变其语言、正文、分析与顺序', () => {
    const { p, l } = fixture(),
      before = p.sentences.map((s) => [s.id, s.text, s.tokens])
    expect(moveCorpusSentences(p, ['default', 'in-a'], l.id, 'c')).toBe(2)
    expect(p.sentences.map((s) => [s.id, s.text, s.tokens])).toEqual(before)
  })
})
