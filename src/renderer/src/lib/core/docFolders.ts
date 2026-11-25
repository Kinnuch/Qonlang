/** 文档目录独立于所属语言；旧文档无归属时落在隐式Default，任何移动都不改正文。 */
import type { DocFolder, DocPage, Id, Project } from './model'
import {
  folderParent,
  folderParents,
  folderDescendants,
  folderPath,
  moveFolder,
  removeFolderPreservingChildren
} from './folderTree'

export interface DocFolderItem extends DocFolder {
  parentId: Id
  count: number
  default: boolean
  ancestors: Id[]
  children: boolean
  path: string
}
export function normalizeDocFolders(value: unknown): DocFolder[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>(),
    out: DocFolder[] = []
  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof raw.id !== 'string' ||
      !raw.id ||
      ids.has(raw.id) ||
      typeof raw.name !== 'string' ||
      !raw.name.trim()
    )
      continue
    ids.add(raw.id)
    out.push({
      ...raw,
      name: raw.name.trim(),
      ...(typeof raw.parentId === 'string' && raw.parentId
        ? { parentId: raw.parentId }
        : { parentId: undefined })
    })
  }
  const parents = folderParents(out)
  return out.map((folder) => ({ ...folder, parentId: parents.get(folder.id) || undefined }))
}
export function validDocFolder(project: Project, id: Id): boolean {
  return !id || (project.docFolders ?? []).some((folder) => folder.id === id)
}
export function docFolderOf(project: Project, doc: Pick<DocPage, 'folderId'>): Id {
  return doc.folderId && validDocFolder(project, doc.folderId) ? doc.folderId : ''
}
export function docFolderPath(project: Project, id: Id): string {
  return (
    folderPath(project.docFolders ?? [], id)
      .map((folder) => folder.name)
      .join(' / ') || 'Default'
  )
}
export function docFoldersFor(project: Project, languageId: Id | null = null): DocFolderItem[] {
  const byId = new Map<string, DocFolder>()
  for (const folder of project.docFolders ?? [])
    if (folder.id && !byId.has(folder.id)) byId.set(folder.id, folder)
  const list = [...byId.values()],
    parents = folderParents(list),
    counts = new Map<string, number>()
  for (const doc of project.docs)
    if (!languageId || !doc.languageId || doc.languageId === languageId) {
      const id = doc.folderId && byId.has(doc.folderId) ? doc.folderId : ''
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  const rows: DocFolderItem[] = [
    {
      id: '',
      name: 'Default',
      parentId: '',
      count: counts.get('') ?? 0,
      default: true,
      ancestors: [],
      children: false,
      path: 'Default'
    }
  ]
  // 按树的前序排列，数组保存的同级顺序不变；显式栈避免多级目录的递归溢出。
  const byParent = new Map<string, DocFolder[]>()
  for (const folder of list) {
    const parent = parents.get(folder.id) ?? ''
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent)!.push(folder)
  }
  const pending = [...(byParent.get('') ?? [])]
      .reverse()
      .map((folder) => ({ folder, ancestors: [] as string[], path: folder.name })),
    seen = new Set<string>()
  while (pending.length) {
    const { folder, ancestors, path } = pending.pop()!
    if (seen.has(folder.id)) continue
    seen.add(folder.id)
    rows.push({
      ...folder,
      parentId: parents.get(folder.id) ?? '',
      count: counts.get(folder.id) ?? 0,
      default: false,
      ancestors,
      children: !!byParent.get(folder.id)?.length,
      path
    })
    for (const child of [...(byParent.get(folder.id) ?? [])].reverse())
      pending.push({
        folder: child,
        ancestors: [...ancestors, folder.id],
        path: path + ' / ' + child.name
      })
  }
  return rows
}
const sameName = (project: Project, name: string, parent: Id, except = ''): boolean => {
  const parents = folderParents(project.docFolders ?? [])
  return (project.docFolders ?? []).some(
    (folder) =>
      folder.id !== except &&
      (parents.get(folder.id) ?? '') === parent &&
      folder.name.trim() === name
  )
}
export function createDocFolder(
  project: Project,
  name: string,
  id: Id,
  parentId: Id = ''
): DocFolder | null {
  const clean = name.trim()
  if (
    !clean ||
    !id ||
    !validDocFolder(project, parentId) ||
    validDocFolder(project, id) ||
    (!parentId && clean.toLowerCase() === 'default') ||
    sameName(project, clean, parentId)
  )
    return null
  const folder: DocFolder = { id, name: clean, ...(parentId ? { parentId } : {}) }
  project.docFolders = [...(project.docFolders ?? []), folder]
  return folder
}
export function renameDocFolder(project: Project, id: Id, name: string): boolean {
  const folder = project.docFolders?.find((folder) => folder.id === id),
    clean = name.trim(),
    parent = folderParent(project.docFolders ?? [], id)
  if (
    !folder ||
    !clean ||
    (!parent && clean.toLowerCase() === 'default') ||
    sameName(project, clean, parent, id)
  )
    return false
  folder.name = clean
  return true
}
export function canMoveDocFolder(project: Project, id: Id, parentId: Id): boolean {
  return docFolderMoveTargets(project, id).has(parentId)
}
/** 批量目标只建一次有效父索引；防移入子树仍按原始关系判断。 */
export function docFolderMoveTargets(project: Project, id: Id): Set<Id> {
  const folders = project.docFolders ?? [],
    source = folders.find((folder) => folder.id === id),
    targets = new Set<Id>()
  if (!source || !id) return targets
  const parents = folderParents(folders),
    blocked = folderDescendants(folders, id),
    duplicates = new Set<string>(),
    name = source.name.trim()
  for (const folder of folders)
    if (folder.id !== id && folder.name.trim() === name)
      duplicates.add(parents.get(folder.id) ?? '')
  if (name.toLowerCase() !== 'default' && !duplicates.has('')) targets.add('')
  for (const folder of folders)
    if (
      !blocked.has(folder.id) &&
      (folder.parentId ?? '') === (parents.get(folder.id) ?? '') &&
      !duplicates.has(folder.id)
    )
      targets.add(folder.id)
  return targets
}
export function moveDocFolder(project: Project, id: Id, parentId: Id): boolean {
  return (
    canMoveDocFolder(project, id, parentId) && moveFolder(project.docFolders ?? [], id, parentId)
  )
}
export function removeDocFolder(project: Project, id: Id): boolean {
  const removed = removeFolderPreservingChildren(project.docFolders ?? [], id)
  if (!removed) return false
  for (const doc of project.docs)
    if (doc.folderId === id) {
      if (removed.parentId) doc.folderId = removed.parentId
      else delete doc.folderId
    }
  return true
}
export function moveDocs(project: Project, ids: readonly Id[], folderId: Id): number {
  if (!validDocFolder(project, folderId)) return 0
  const wanted = new Set(ids)
  let count = 0
  for (const doc of project.docs)
    if (wanted.has(doc.id) && docFolderOf(project, doc) !== folderId) {
      if (folderId) doc.folderId = folderId
      else delete doc.folderId
      count++
    }
  return count
}
