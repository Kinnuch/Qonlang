/** 文件夹的纯层级算法，语料与文档共用；空 ID 表示不可删除的 Default 根目录。 */
export interface FolderNode {
  id: string
  name: string
  parentId?: string | null
}

function indexOf<T extends FolderNode>(folders: readonly T[]): Map<string, T> {
  const index = new Map<string, T>()
  for (const folder of folders) if (folder.id && !index.has(folder.id)) index.set(folder.id, folder)
  return index
}

/** 返回有效的原始祖先链（近→远）；坏引用或循环整条视为无效。 */
function chain<T extends FolderNode>(index: ReadonlyMap<string, T>, id: string): T[] | null {
  const out: T[] = [],
    seen = new Set([id])
  let parent = index.get(id)?.parentId ?? ''
  while (parent) {
    if (seen.has(parent)) return null
    seen.add(parent)
    const folder = index.get(parent)
    if (!folder) return null
    out.push(folder)
    parent = folder.parentId ?? ''
  }
  return out
}

/** 一次规范化所有父关系，不写回文件；整条坏链归根，迭代处理深树与环。 */
export function folderParents<T extends FolderNode>(folders: readonly T[]): Map<string, string> {
  const index = indexOf(folders),
    valid = new Map<string, boolean>(),
    parents = new Map<string, string>()
  for (const id of index.keys()) {
    if (valid.has(id)) continue
    const path: string[] = [],
      seen = new Set<string>()
    let key = id,
      okay = true
    while (key) {
      if (valid.has(key)) {
        okay = valid.get(key)!
        break
      }
      if (seen.has(key) || !index.has(key)) {
        okay = false
        break
      }
      seen.add(key)
      path.push(key)
      key = index.get(key)!.parentId ?? ''
    }
    for (const item of path) {
      valid.set(item, okay)
      parents.set(item, okay ? (index.get(item)!.parentId ?? '') : '')
    }
  }
  return parents
}

export interface FolderTreeIndex<T extends FolderNode> {
  nodes: ReadonlyMap<string, T>
  parents: ReadonlyMap<string, string>
  children: ReadonlyMap<string, readonly T[]>
  has: (id: string) => boolean
  parent: (id: string) => string
  ancestors: (id: string) => T[]
  path: (id: string) => T[]
  normalizedDescendants: (id: string) => Set<string>
  depth: (id: string) => number
}

/** 一次操作内复用的有效父层快照；不长期缓存可变工程。 */
export function createFolderIndex<T extends FolderNode>(folders: readonly T[]): FolderTreeIndex<T> {
  const nodes = indexOf(folders),
    parents = folderParents(folders),
    children = new Map<string, T[]>(),
    depths = new Map<string, number>()
  for (const folder of nodes.values()) {
    const parent = parents.get(folder.id) ?? ''
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(folder)
  }
  const queue = (children.get('') ?? []).map((folder) => folder.id)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    depths.set(id, (depths.get(parents.get(id) ?? '') ?? 0) + 1)
    for (const child of children.get(id) ?? []) queue.push(child.id)
  }
  const ancestors = (id: string): T[] => {
    const result: T[] = []
    let parent = parents.get(id) ?? ''
    while (parent) {
      const folder = nodes.get(parent)!
      result.push(folder)
      parent = parents.get(parent) ?? ''
    }
    return result.reverse()
  }
  return {
    nodes,
    parents,
    children,
    has: (id) => !id || nodes.has(id),
    parent: (id) => parents.get(id) ?? '',
    ancestors,
    path: (id) => (nodes.has(id) ? [...ancestors(id), nodes.get(id)!] : []),
    depth: (id) => depths.get(id) ?? 0,
    normalizedDescendants: (id) => {
      const seen = new Set([id]),
        queue = [id]
      for (let i = 0; i < queue.length; i++)
        for (const child of children.get(queue[i]) ?? [])
          if (!seen.has(child.id)) {
            seen.add(child.id)
            queue.push(child.id)
          }
      return seen
    }
  }
}

export function folderParent<T extends FolderNode>(folders: readonly T[], id: string): string {
  const index = indexOf(folders),
    parents = chain(index, id)
  return parents?.[0]?.id ?? ''
}

export function folderAncestors<T extends FolderNode>(folders: readonly T[], id: string): T[] {
  return (chain(indexOf(folders), id) ?? []).reverse()
}

export function folderPath<T extends FolderNode>(folders: readonly T[], id: string): T[] {
  const index = indexOf(folders),
    folder = index.get(id)
  return folder ? [...(chain(index, id) ?? []).reverse(), folder] : []
}

/** 按原始子关系遍历并防环；即使旧数据坏了，移动时也不能移进原有子树。 */
export function folderDescendants<T extends FolderNode>(
  folders: readonly T[],
  id: string
): Set<string> {
  const children = new Map<string, string[]>()
  for (const folder of folders) {
    const parent = folder.parentId ?? ''
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(folder.id)
  }
  const found = new Set<string>(),
    queue = [id]
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]
    if (found.has(key)) continue
    found.add(key)
    for (const child of children.get(key) ?? []) if (!found.has(child)) queue.push(child)
  }
  return found
}

export function canMoveFolder<T extends FolderNode>(
  folders: readonly T[],
  id: string,
  parentId: string
): boolean {
  const index = indexOf(folders),
    source = index.get(id)
  if (!source || !id || id === parentId) return false
  if (!parentId) return true
  return (
    index.has(parentId) &&
    chain(index, parentId) !== null &&
    !folderDescendants(folders, id).has(parentId)
  )
}

/** 更改父层并插到同层 beforeId 前；不提供 beforeId 时置于该层末尾。 */
export function moveFolder<T extends FolderNode>(
  folders: T[],
  id: string,
  parentId: string,
  beforeId?: string
): boolean {
  if (!canMoveFolder(folders, id, parentId)) return false
  const at = folders.findIndex((folder) => folder.id === id),
    folder = folders[at],
    parents = folderParents(folders)
  if (beforeId === id) return false
  if (
    beforeId &&
    !folders.some((item) => item.id === beforeId && (parents.get(item.id) ?? '') === parentId)
  )
    return false
  const remaining = folders.filter((_, index) => index !== at)
  let target = beforeId ? remaining.findIndex((item) => item.id === beforeId) : -1
  if (target < 0) {
    for (let i = 0; i < remaining.length; i++)
      if ((parents.get(remaining[i].id) ?? '') === parentId) target = i + 1
    if (target < 0) target = remaining.length
  }
  if ((folder.parentId ?? '') === parentId && at === target) return false
  folders.splice(at, 1)
  if (parentId) folder.parentId = parentId
  else delete folder.parentId
  folders.splice(target, 0, folder)
  return true
}

/** 仅删指定目录，直接子目录提升一层；文档/例句归属由调用方改到返回的父目录。 */
export function removeFolderPreservingChildren<T extends FolderNode>(
  folders: T[],
  id: string
): {
  parentId: string
  childIds: string[]
  renamed: { id: string; from: string; to: string }[]
} | null {
  const at = folders.findIndex((folder) => folder.id === id)
  if (!id || at < 0) return null
  const parents = folderParents(folders),
    parentId = parents.get(id) ?? '',
    childIds: string[] = [],
    renamed: { id: string; from: string; to: string }[] = [],
    names = new Set(
      folders
        .filter(
          (folder) =>
            folder.id !== id &&
            folder.parentId !== id &&
            (parents.get(folder.id) ?? '') === parentId
        )
        .map((folder) => folder.name.trim())
    )
  for (const folder of folders)
    if (folder.parentId === id) {
      const from = folder.name,
        base = folder.name.trim()
      let to = from,
        n = 2
      while (names.has(to.trim()) || (!parentId && to.trim().toLowerCase() === 'default'))
        to = `${base} (${n++})`
      names.add(to.trim())
      if (to !== from) {
        folder.name = to
        renamed.push({ id: folder.id, from, to })
      }
      if (parentId) folder.parentId = parentId
      else delete folder.parentId
      childIds.push(folder.id)
    }
  folders.splice(at, 1)
  return { parentId, childIds, renamed }
}
