import { describe, it, expect } from 'vitest'
import {
  folderParent,
  folderAncestors,
  folderPath,
  folderDescendants,
  canMoveFolder,
  moveFolder,
  removeFolderPreservingChildren,
  type FolderNode
} from '$lib/core/folderTree'
const tree = (): FolderNode[] => [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B', parentId: 'a' },
  { id: 'c', name: 'C', parentId: 'b' },
  { id: 'd', name: 'D', parentId: 'a' },
  { id: 'e', name: 'E' }
]
describe('通用多级文件夹', () => {
  it('旧单层与多层路径按根至自身排列', () => {
    const folders = tree()
    expect(folderParent(folders, 'a')).toBe('')
    expect(folderAncestors(folders, 'c').map((f) => f.id)).toEqual(['a', 'b'])
    expect(folderPath(folders, 'c').map((f) => f.id)).toEqual(['a', 'b', 'c'])
    expect(folderPath(folders, 'missing')).toEqual([])
  })
  it('坏引用和循环不死循环，路径只保留自身', () => {
    const folders = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'bad', name: 'Bad', parentId: 'missing' }
    ]
    for (const folder of folders) {
      expect(folderParent(folders, folder.id)).toBe('')
      expect(folderPath(folders, folder.id).map((f) => f.id)).toEqual([folder.id])
    }
    expect(folderDescendants(folders, 'a')).toEqual(new Set(['a', 'b']))
    expect(canMoveFolder(folders, 'bad', 'a')).toBe(false)
    expect(moveFolder(folders, 'a', '')).toBe(true)
    expect(folderPath(folders, 'b').map((f) => f.id)).toEqual(['a', 'b'])
  })
  it('拒绝移动至自身、子树或不存在目标，错误时不改数据', () => {
    const folders = tree(),
      before = JSON.stringify(folders)
    for (const parent of ['a', 'b', 'c', 'missing'])
      expect(moveFolder(folders, 'a', parent)).toBe(false)
    expect(moveFolder(folders, '', 'a')).toBe(false)
    expect(JSON.stringify(folders)).toBe(before)
  })
  it('移动子树只改父链，保留后代并可同层插入排序', () => {
    const folders = tree()
    expect(moveFolder(folders, 'b', 'e')).toBe(true)
    expect(folderPath(folders, 'c').map((f) => f.id)).toEqual(['e', 'b', 'c'])
    expect(moveFolder(folders, 'e', '', 'a')).toBe(true)
    expect(folders.filter((f) => !folderParent(folders, f.id)).map((f) => f.id)).toEqual(['e', 'a'])
  })
  it('删除目录仅提升直接子层，后代ID和内容保留', () => {
    const folders = tree()
    expect(removeFolderPreservingChildren(folders, 'b')).toEqual({
      parentId: 'a',
      childIds: ['c'],
      renamed: []
    })
    expect(folderPath(folders, 'c').map((f) => f.id)).toEqual(['a', 'c'])
    expect(removeFolderPreservingChildren(folders, '')).toBeNull()
  })
  it('提升重名目录只编号显示名，根层保留Default，ID不合并', () => {
    const folders: FolderNode[] = [
      { id: 'p', name: 'P' },
      { id: 'same', name: 'Same' },
      { id: 'child', name: 'Same', parentId: 'p' },
      { id: 'reserved', name: 'Default', parentId: 'p' }
    ]
    expect(removeFolderPreservingChildren(folders, 'p')?.renamed).toEqual([
      { id: 'child', from: 'Same', to: 'Same (2)' },
      { id: 'reserved', from: 'Default', to: 'Default (2)' }
    ])
    expect(folders.map((folder) => folder.id)).toEqual(['same', 'child', 'reserved'])
  })
  it('深树遍历不递归溢出', () => {
    const folders = Array.from({ length: 3000 }, (_, i) => ({
      id: '' + i,
      name: '' + i,
      ...(i ? { parentId: '' + (i - 1) } : {})
    }))
    expect(folderPath(folders, '2999')).toHaveLength(3000)
    expect(folderDescendants(folders, '0').size).toBe(3000)
    expect(canMoveFolder(folders, '0', '2999')).toBe(false)
  })
})
