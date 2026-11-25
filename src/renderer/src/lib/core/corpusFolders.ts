/** 语料文件夹只管理归属与顺序，不复制或删除例句正文。 */
import type { CorpusFolder, Id, Project, Sentence } from './model'
import {
  folderParents,
  folderPath,
  createFolderIndex,
  folderDescendants,
  canMoveFolder,
  moveFolder,
  removeFolderPreservingChildren
} from './folderTree'

export const DEFAULT_CORPUS_FOLDER = ''
export interface CorpusFolderItem extends CorpusFolder {
  count: number
  subtreeCount: number
  default: boolean
  path: string
}

export const corpusFolderTree = (project: Project, languageId: Id): CorpusFolder[] =>
  (project.corpusFolders ?? []).filter((folder) => folder.languageId === languageId)
export const corpusFolderPath = (project: Project, languageId: Id, id: Id): CorpusFolder[] =>
  folderPath(corpusFolderTree(project, languageId), id)

export function corpusFolderOf(project: Project, sentence: Sentence): Id {
  return (project.corpusFolders ?? []).some(
    (folder) => folder.id === sentence.folderId && folder.languageId === sentence.languageId
  )
    ? sentence.folderId!
    : DEFAULT_CORPUS_FOLDER
}

export function corpusFoldersFor(project: Project, languageId: Id): CorpusFolderItem[] {
  const tree = corpusFolderTree(project, languageId),
    parents = folderParents(tree)
  const folders: CorpusFolderItem[] = [
    {
      id: DEFAULT_CORPUS_FOLDER,
      languageId,
      name: 'Default',
      count: 0,
      subtreeCount: 0,
      default: true,
      path: 'Default'
    }
  ]
  const ids = new Set([DEFAULT_CORPUS_FOLDER])
  for (const folder of project.corpusFolders ?? [])
    if (
      folder.languageId === languageId &&
      typeof folder.id === 'string' &&
      folder.id &&
      typeof folder.name === 'string' &&
      !ids.has(folder.id)
    ) {
      ids.add(folder.id)
      folders.push({
        ...folder,
        parentId: parents.get(folder.id) ?? '',
        count: 0,
        subtreeCount: 0,
        default: false,
        path: folder.name
      })
    }
  const counts = new Map(folders.map((folder) => [folder.id, folder]))
  for (const sentence of project.sentences)
    if (sentence.languageId === languageId)
      counts.get(ids.has(sentence.folderId ?? '') ? (sentence.folderId ?? '') : '')!.count++
  const children = new Map<string, number>(),
    childItems = new Map<string, CorpusFolderItem[]>(),
    queue: CorpusFolderItem[] = []
  for (const folder of folders) {
    folder.subtreeCount = folder.count
    if (!folder.default) {
      const parent = parents.get(folder.id) ?? ''
      children.set(parent, (children.get(parent) ?? 0) + 1)
      if (!childItems.has(parent)) childItems.set(parent, [])
      childItems.get(parent)!.push(folder)
    }
  }
  for (const folder of folders) if (!children.get(folder.id)) queue.push(folder)
  for (let i = 0; i < queue.length; i++) {
    const folder = queue[i]
    if (folder.default) continue
    const parent = counts.get(parents.get(folder.id) ?? '')!
    parent.subtreeCount += folder.subtreeCount
    const remaining = (children.get(parent.id) ?? 1) - 1
    children.set(parent.id, remaining)
    if (!remaining) queue.push(parent)
  }
  const paths = [...(childItems.get('') ?? [])]
  for (let i = 0; i < paths.length; i++)
    for (const child of childItems.get(paths[i].id) ?? []) {
      child.path = paths[i].path + ' / ' + child.name
      paths.push(child)
    }
  return folders
}

/** 目的地一次性按原始子树排除；无效父链不能作为移动目标。 */
export function corpusFolderMoveTargets(project: Project, languageId: Id, id: Id): Set<Id> {
  const tree = corpusFolderTree(project, languageId),
    parents = folderParents(tree),
    blocked = folderDescendants(tree, id)
  if (!tree.some((folder) => folder.id === id)) return new Set()
  return new Set([
    '',
    ...tree
      .filter(
        (folder) =>
          !blocked.has(folder.id) && (parents.get(folder.id) ?? '') === (folder.parentId ?? '')
      )
      .map((folder) => folder.id)
  ])
}

export function validCorpusFolder(project: Project, languageId: Id, folderId: Id): boolean {
  return (
    !folderId ||
    (project.corpusFolders ?? []).some(
      (folder) => folder.id === folderId && folder.languageId === languageId
    )
  )
}

export function createCorpusFolder(
  project: Project,
  languageId: Id,
  name: string,
  id: Id,
  parentId: Id = ''
): CorpusFolder | null {
  const clean = name.trim(),
    parents = folderParents(corpusFolderTree(project, languageId))
  if (
    !clean ||
    clean.toLowerCase() === 'default' ||
    !id ||
    !project.languages.some((language) => language.id === languageId) ||
    !validCorpusFolder(project, languageId, parentId) ||
    (project.corpusFolders ?? []).some(
      (folder) =>
        folder.id === id ||
        (folder.languageId === languageId &&
          (parents.get(folder.id) ?? '') === parentId &&
          folder.name.trim() === clean)
    )
  )
    return null
  const folder: CorpusFolder = { id, languageId, name: clean, ...(parentId ? { parentId } : {}) }
  // 第一次赋给 Svelte 深层状态后再推原数组会绕开代理，整段赋值使首个文件夹也能可靠保存。
  project.corpusFolders = [...(project.corpusFolders ?? []), folder]
  return folder
}

export function renameCorpusFolder(project: Project, folderId: Id, name: string): boolean {
  const folder = project.corpusFolders?.find((folder) => folder.id === folderId),
    clean = name.trim(),
    parents = folderParents(folder ? corpusFolderTree(project, folder.languageId) : [])
  if (
    !folder ||
    !clean ||
    clean.toLowerCase() === 'default' ||
    (project.corpusFolders ?? []).some(
      (other) =>
        other.id !== folderId &&
        other.languageId === folder.languageId &&
        (parents.get(other.id) ?? '') === (parents.get(folder.id) ?? '') &&
        other.name.trim() === clean
    )
  )
    return false
  folder.name = clean
  return true
}

/** 删除文件夹将直接子层与其中例句提升到父层，子树、正文和分析均保留。 */
export function removeCorpusFolder(project: Project, folderId: Id): boolean {
  const at = project.corpusFolders?.findIndex((folder) => folder.id === folderId) ?? -1
  if (at < 0) return false
  const folder = project.corpusFolders![at]
  const tree = corpusFolderTree(project, folder.languageId),
    removed = removeFolderPreservingChildren(tree, folderId)
  if (!removed) return false
  project.corpusFolders = project.corpusFolders!.filter((item) => item.id !== folderId)
  for (const sentence of project.sentences)
    if (sentence.languageId === folder.languageId && sentence.folderId === folderId)
      if (removed.parentId) sentence.folderId = removed.parentId
      else delete sentence.folderId
  return true
}

/** 网格拖动交换有序槽位，其他语言的文件夹保持原位。 */
export function reorderCorpusFolder(
  project: Project,
  languageId: Id,
  fromId: Id,
  toId: Id
): boolean {
  if (!fromId || !toId || fromId === toId) return false
  const folders = project.corpusFolders ?? [],
    parents = folderParents(corpusFolderTree(project, languageId)),
    parent = parents.get(fromId) ?? '',
    scoped = folders.filter(
      (folder) => folder.languageId === languageId && (parents.get(folder.id) ?? '') === parent
    ),
    from = scoped.findIndex((folder) => folder.id === fromId),
    to = scoped.findIndex((folder) => folder.id === toId)
  if (from < 0 || to < 0) return false
  const [folder] = scoped.splice(from, 1)
  scoped.splice(to, 0, folder)
  let n = 0
  for (let i = 0; i < folders.length; i++)
    if (folders[i].languageId === languageId && (parents.get(folders[i].id) ?? '') === parent)
      folders[i] = scoped[n++]
  return true
}

export function moveCorpusSentences(
  project: Project,
  ids: readonly Id[],
  languageId: Id,
  folderId: Id
): number {
  if (!validCorpusFolder(project, languageId, folderId)) return 0
  const wanted = new Set(ids),
    validIds = new Set(corpusFolderTree(project, languageId).map((folder) => folder.id))
  let count = 0
  for (const sentence of project.sentences)
    if (
      wanted.has(sentence.id) &&
      sentence.languageId === languageId &&
      (sentence.folderId && validIds.has(sentence.folderId) ? sentence.folderId : '') !== folderId
    ) {
      if (folderId) sentence.folderId = folderId
      else delete sentence.folderId
      count++
    }
  return count
}

export function corpusFolderSentences(
  project: Project,
  languageId: Id,
  folderId: Id,
  recursive = false
): Sentence[] {
  if (!validCorpusFolder(project, languageId, folderId)) return []
  const tree = corpusFolderTree(project, languageId),
    validIds = new Set(tree.map((folder) => folder.id)),
    descendants = recursive
      ? createFolderIndex(tree).normalizedDescendants(folderId)
      : new Set([folderId])
  return project.sentences.filter(
    (sentence) =>
      sentence.languageId === languageId &&
      descendants.has(sentence.folderId && validIds.has(sentence.folderId) ? sentence.folderId : '')
  )
}

export function moveCorpusFolder(project: Project, languageId: Id, id: Id, parentId: Id): boolean {
  const tree = corpusFolderTree(project, languageId),
    source = tree.find((folder) => folder.id === id),
    parents = folderParents(tree)
  if (
    !source ||
    !validCorpusFolder(project, languageId, parentId) ||
    !canMoveFolder(tree, id, parentId)
  )
    return false
  if (
    tree.some(
      (other) =>
        other.id !== id &&
        (parents.get(other.id) ?? '') === parentId &&
        other.name.trim() === source.name.trim()
    )
  )
    return false
  const old = new Set(tree.map((folder) => folder.id))
  if (!moveFolder(tree, id, parentId)) return false
  let index = 0
  project.corpusFolders = project.corpusFolders!.map((folder) =>
    old.has(folder.id) ? tree[index++] : folder
  )
  return true
}
