/** 目录视图的只读投影；不把整个项目的视图根混进文件夹ID。 */
import type { Id, Project, ProjectFolder } from './model'
import { ensureProjectFolders, projectFolders } from './projectFolders'

export interface ProjectDirectoryFolder extends ProjectFolder {
  parentId: Id
  default: boolean
  depth: number
  readonly path: string
  readonly ancestors: Id[]
  children: boolean
  /** 本目录及全部后代的三类记录数；Default只统计自身。 */
  count: number
  directCount: number
  /** 记录JSON的UTF-8估算，不包含目录自身，不是磁盘占用。 */
  bytes: number
}

export interface ProjectDirectoryProjection {
  rows: ProjectDirectoryFolder[]
  byId: Map<Id, ProjectDirectoryFolder>
  rootCount: number
  rootBytes: number
}

/**
 * 目录和记录各扫描一次，子树数值按逆前序累计；路径与祖先数组只在读取该行时生成。
 * sizes关闭时不序列化任何记录。旧目录只在浅副本上迁移，原项目及嵌套内容保持原样。
 */
export function createProjectDirectoryProjection(
  project: Project,
  { sizes = false }: { sizes?: boolean } = {}
): ProjectDirectoryProjection {
  let source = project,
    folders: ProjectFolder[]
  if (project.folders === undefined) {
    source = {
      ...project,
      sentences: project.sentences.map((record) => ({ ...record })),
      phrasebook: project.phrasebook.map((record) => ({ ...record })),
      docs: project.docs.map((record) => ({ ...record }))
    }
    folders = ensureProjectFolders(source)
  } else folders = projectFolders(project)

  const defaultFolder: ProjectDirectoryFolder = {
    id: '',
    name: 'Default',
    parentId: '',
    default: true,
    depth: 0,
    path: 'Default',
    ancestors: [],
    children: false,
    count: 0,
    directCount: 0,
    bytes: 0
  }
  const byId = new Map<Id, ProjectDirectoryFolder>([['', defaultFolder]]),
    byParent = new Map<Id, ProjectDirectoryFolder[]>(),
    names = new Map(folders.map((folder) => [folder.id, folder.name])),
    parents = new Map(folders.map((folder) => [folder.id, folder.parentId ?? '']))
  const ancestorsOf = (id: Id): Id[] => {
    const out: Id[] = []
    let parent = parents.get(id) ?? ''
    while (parent) {
      out.push(parent)
      parent = parents.get(parent) ?? ''
    }
    return out.reverse()
  }
  // folders已经是一次规范化后的有效图；不要再为每行重建祖先索引。
  for (const folder of folders) {
    const id = folder.id,
      row: ProjectDirectoryFolder = {
        ...folder,
        parentId: folder.parentId ?? '',
        default: false,
        depth: 0,
        get path() {
          return [...ancestorsOf(id), id].map((key) => names.get(key)!).join(' / ')
        },
        get ancestors() {
          return ancestorsOf(id)
        },
        children: false,
        count: 0,
        directCount: 0,
        bytes: 0
      }
    byId.set(row.id, row)
    if (!byParent.has(row.parentId)) byParent.set(row.parentId, [])
    byParent.get(row.parentId)!.push(row)
  }
  const rows = [defaultFolder],
    pending = [...(byParent.get('') ?? [])].reverse()
  while (pending.length) {
    const row = pending.pop()!,
      parent = row.parentId ? byId.get(row.parentId)! : null,
      children = byParent.get(row.id) ?? []
    row.depth = parent ? parent.depth + 1 : 0
    row.children = children.length > 0
    rows.push(row)
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i])
  }

  const encoder = sizes ? new TextEncoder() : null
  let rootCount = 0,
    rootBytes = 0
  for (const list of [source.sentences, source.phrasebook, source.docs])
    for (const record of list) {
      const row = byId.get(record.folderId ?? '') ?? defaultFolder,
        bytes = encoder ? encoder.encode(JSON.stringify(record)).byteLength : 0
      row.directCount++
      row.count++
      row.bytes += bytes
      rootCount++
      rootBytes += bytes
    }
  for (let i = rows.length - 1; i > 0; i--) {
    const row = rows[i]
    if (!row.parentId) continue
    const parent = byId.get(row.parentId)!
    parent.count += row.count
    parent.bytes += row.bytes
  }
  return { rows, byId, rootCount, rootBytes }
}
