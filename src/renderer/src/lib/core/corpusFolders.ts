/** 语料文件夹只管理归属与顺序，不复制或删除例句正文。 */
import type { CorpusFolder, Id, Project, Sentence } from './model'

export const DEFAULT_CORPUS_FOLDER = ''
export interface CorpusFolderItem extends CorpusFolder {
  count: number
  default: boolean
}

export function corpusFolderOf(project: Project, sentence: Sentence): Id {
  return (project.corpusFolders ?? []).some(
    (folder) => folder.id === sentence.folderId && folder.languageId === sentence.languageId
  )
    ? sentence.folderId!
    : DEFAULT_CORPUS_FOLDER
}

export function corpusFoldersFor(project: Project, languageId: Id): CorpusFolderItem[] {
  const folders: CorpusFolderItem[] = [
    { id: DEFAULT_CORPUS_FOLDER, languageId, name: 'Default', count: 0, default: true }
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
      folders.push({ ...folder, count: 0, default: false })
    }
  const counts = new Map(folders.map((folder) => [folder.id, folder]))
  for (const sentence of project.sentences)
    if (sentence.languageId === languageId)
      counts.get(ids.has(sentence.folderId ?? '') ? (sentence.folderId ?? '') : '')!.count++
  return folders
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
  id: Id
): CorpusFolder | null {
  const clean = name.trim()
  if (
    !clean ||
    clean.toLowerCase() === 'default' ||
    !id ||
    !project.languages.some((language) => language.id === languageId) ||
    (project.corpusFolders ?? []).some(
      (folder) =>
        folder.id === id || (folder.languageId === languageId && folder.name.trim() === clean)
    )
  )
    return null
  const folder = { id, languageId, name: clean }
  // 第一次赋给 Svelte 深层状态后再推原数组会绕开代理，整段赋值使首个文件夹也能可靠保存。
  project.corpusFolders = [...(project.corpusFolders ?? []), folder]
  return folder
}

export function renameCorpusFolder(project: Project, folderId: Id, name: string): boolean {
  const folder = project.corpusFolders?.find((folder) => folder.id === folderId),
    clean = name.trim()
  if (
    !folder ||
    !clean ||
    clean.toLowerCase() === 'default' ||
    (project.corpusFolders ?? []).some(
      (other) =>
        other.id !== folderId &&
        other.languageId === folder.languageId &&
        other.name.trim() === clean
    )
  )
    return false
  folder.name = clean
  return true
}

/** 删除文件夹把例句移回 Default，例句 ID、分析与正文保留。 */
export function removeCorpusFolder(project: Project, folderId: Id): boolean {
  const at = project.corpusFolders?.findIndex((folder) => folder.id === folderId) ?? -1
  if (at < 0) return false
  const folder = project.corpusFolders![at]
  project.corpusFolders!.splice(at, 1)
  for (const sentence of project.sentences)
    if (sentence.languageId === folder.languageId && sentence.folderId === folderId)
      delete sentence.folderId
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
    scoped = folders.filter((folder) => folder.languageId === languageId),
    from = scoped.findIndex((folder) => folder.id === fromId),
    to = scoped.findIndex((folder) => folder.id === toId)
  if (from < 0 || to < 0) return false
  const [folder] = scoped.splice(from, 1)
  scoped.splice(to, 0, folder)
  let n = 0
  for (let i = 0; i < folders.length; i++)
    if (folders[i].languageId === languageId) folders[i] = scoped[n++]
  return true
}

export function moveCorpusSentences(
  project: Project,
  ids: readonly Id[],
  languageId: Id,
  folderId: Id
): number {
  if (!validCorpusFolder(project, languageId, folderId)) return 0
  const wanted = new Set(ids)
  let count = 0
  for (const sentence of project.sentences)
    if (
      wanted.has(sentence.id) &&
      sentence.languageId === languageId &&
      corpusFolderOf(project, sentence) !== folderId
    ) {
      if (folderId) sentence.folderId = folderId
      else delete sentence.folderId
      count++
    }
  return count
}

export function corpusFolderSentences(project: Project, languageId: Id, folderId: Id): Sentence[] {
  if (!validCorpusFolder(project, languageId, folderId)) return []
  return project.sentences.filter(
    (sentence) =>
      sentence.languageId === languageId && corpusFolderOf(project, sentence) === folderId
  )
}
