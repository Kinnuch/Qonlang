/** 项目共享目录与剪贴板事务。只处理数据，不访问系统剪贴板、磁盘或界面。 */
import type { DocPage, Id, Phrase, Project, ProjectFolder, Sentence } from './model'
export type { ProjectFolder } from './model'
import { newId } from './factory'
import {
  canMoveFolder,
  createFolderIndex,
  folderDescendants,
  folderParents,
  folderPath,
  moveFolder,
  removeFolderPreservingChildren
} from './folderTree'

export type ProjectRecordKind = 'sentence' | 'phrase' | 'doc'
export interface ProjectRecordRef {
  kind: ProjectRecordKind
  id: Id
}
export type ProjectClipboardRef = ProjectRecordRef | { kind: 'folder'; id: Id }
export type ProjectRecord = Sentence | Phrase | DocPage
export type ProjectRecordSnapshot =
  | { kind: 'sentence'; record: Sentence }
  | { kind: 'phrase'; record: Phrase }
  | { kind: 'doc'; record: DocPage }

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const snapshotKey = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  )
const kinds: ProjectRecordKind[] = ['sentence', 'phrase', 'doc']
const collection = (project: Project, kind: ProjectRecordKind): ProjectRecord[] =>
  kind === 'sentence' ? project.sentences : kind === 'phrase' ? project.phrasebook : project.docs
const recordKey = (ref: ProjectRecordRef): string => `${ref.kind}\0${ref.id}`
const writable = (project: Project): boolean => project.meta.readOnly !== true

/** 同层名冲突只改显示名，不合并目录或记录。 */
function uniqueName(name: string, names: ReadonlySet<string>, parentId: Id): string {
  const base = name.trim() || 'Folder'
  let candidate = base,
    n = 2
  while (names.has(candidate) || (!parentId && candidate.toLowerCase() === 'default'))
    candidate = `${base} (${n++})`
  return candidate
}

export function normalizeProjectFolders(value: unknown): ProjectFolder[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>(),
    rows: ProjectFolder[] = []
  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof raw.id !== 'string' ||
      !raw.id ||
      seen.has(raw.id) ||
      typeof raw.name !== 'string' ||
      !raw.name.trim()
    )
      continue
    seen.add(raw.id)
    rows.push({
      id: raw.id,
      name: raw.name.trim(),
      ...(typeof raw.parentId === 'string' && raw.parentId ? { parentId: raw.parentId } : {}),
      ...(Array.isArray(raw.tags)
        ? { tags: raw.tags.filter((tag: unknown): tag is string => typeof tag === 'string') }
        : {}),
      ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {})
    })
  }
  const parents = folderParents(rows),
    names = new Map<Id, Set<string>>()
  return rows.map((row) => {
    const parentId = parents.get(row.id) ?? ''
    let used = names.get(parentId)
    if (!used) names.set(parentId, (used = new Set()))
    const name = uniqueName(row.name, used, parentId)
    used.add(name)
    const normalized = { ...row, name }
    if (parentId) normalized.parentId = parentId
    else delete normalized.parentId
    return normalized
  })
}

interface LegacyProjection {
  folders: ProjectFolder[]
  corpus: Map<string, Id>
  docs: Map<Id, Id>
}
const legacyCorpusKey = (languageId: Id, id: Id): string => `${languageId}\0${id}`

/** 按旧集合和语料语言分别记映射，避免旧ID碰撞时把记录误挂到另一棵树。 */
function legacyProjection(project: Project): LegacyProjection {
  const folders: ProjectFolder[] = [],
    corpus = new Map<string, Id>(),
    docs = new Map<Id, Id>(),
    used = new Set<Id>(),
    reserved = new Set(
      [
        ...(Array.isArray(project.corpusFolders) ? project.corpusFolders : []),
        ...(Array.isArray(project.docFolders) ? project.docFolders : [])
      ]
        .filter((folder) => !!folder && typeof folder.id === 'string')
        .map((folder) => folder.id)
    ),
    pending: { node: ProjectFolder; source: 'corpus' | 'doc'; language: Id; parent: Id }[] = []
  const append = (raw: unknown, source: 'corpus' | 'doc'): void => {
    if (!raw || typeof raw !== 'object') return
    const row = raw as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name.trim())
      return
    const language = source === 'corpus' && typeof row.languageId === 'string' ? row.languageId : ''
    if (source === 'corpus' && !language) return
    const key = legacyCorpusKey(language, row.id)
    // 同一旧集合中的重复ID保留首项；不同语言／集合的碰撞分别保留。
    if (source === 'corpus' ? corpus.has(key) : docs.has(row.id)) return
    let id = row.id,
      n = 2
    if (used.has(id)) {
      do {
        id = `${row.id}:legacy-${source}-${n++}`
      } while (used.has(id) || reserved.has(id))
    }
    used.add(id)
    const node: ProjectFolder = { id, name: row.name.trim() }
    if (source === 'corpus' && !corpus.has(key)) corpus.set(key, id)
    if (source === 'doc' && !docs.has(row.id)) docs.set(row.id, id)
    folders.push(node)
    pending.push({
      node,
      source,
      language,
      parent: typeof row.parentId === 'string' ? row.parentId : ''
    })
  }
  for (const row of Array.isArray(project.corpusFolders) ? project.corpusFolders : [])
    append(row, 'corpus')
  for (const row of Array.isArray(project.docFolders) ? project.docFolders : []) append(row, 'doc')
  for (const row of pending) {
    const parent =
      row.source === 'corpus'
        ? corpus.get(legacyCorpusKey(row.language, row.parent))
        : docs.get(row.parent)
    if (parent) row.node.parentId = parent
  }
  return { folders: normalizeProjectFolders(folders), corpus, docs }
}

/** 只读投影：即使直接传旧测试对象也可读取；不会给项目增加字段。 */
export function projectFolders(project: Project): ProjectFolder[] {
  return project.folders !== undefined
    ? normalizeProjectFolders(project.folders)
    : legacyProjection(project).folders
}

/** 明确迁移时写入共享图。旧数组只留作格式兼容，不再参与共享模式的读取。 */
export function ensureProjectFolders(project: Project): ProjectFolder[] {
  if (project.folders !== undefined) {
    const normalized = normalizeProjectFolders(project.folders)
    if (JSON.stringify(normalized) !== JSON.stringify(project.folders)) project.folders = normalized
    return project.folders
  }
  const projected = legacyProjection(project)
  for (const sentence of project.sentences)
    if (sentence.folderId) {
      const id = projected.corpus.get(legacyCorpusKey(sentence.languageId, sentence.folderId))
      if (id) sentence.folderId = id
      else delete sentence.folderId
    }
  for (const doc of project.docs)
    if (doc.folderId) {
      const id = projected.docs.get(doc.folderId)
      if (id) doc.folderId = id
      else delete doc.folderId
    }
  project.folders = projected.folders
  return project.folders
}

export const validProjectFolder = (project: Project, id: Id): boolean =>
  !id ||
  (project.folders !== undefined
    ? Array.isArray(project.folders) &&
      project.folders.some(
        (folder) =>
          !!folder && folder.id === id && typeof folder.name === 'string' && !!folder.name.trim()
      )
    : projectFolders(project).some((folder) => folder.id === id))
export function projectFolderOf(project: Project, record: { folderId?: Id }): Id {
  if (project.folders === undefined && record.folderId) {
    const legacy = legacyProjection(project),
      value = record as { folderId: Id; languageId?: Id | null; title?: string }
    if ('title' in value) return legacy.docs.get(value.folderId) ?? ''
    if (typeof value.languageId === 'string')
      return legacy.corpus.get(legacyCorpusKey(value.languageId, value.folderId)) ?? ''
  }
  return record.folderId && validProjectFolder(project, record.folderId) ? record.folderId : ''
}
export const projectFolderPath = (project: Project, id: Id): ProjectFolder[] =>
  folderPath(projectFolders(project), id)

const siblingNames = (folders: readonly ProjectFolder[], parentId: Id, except = ''): Set<string> =>
  new Set(
    folders
      .filter((folder) => folder.id !== except && (folder.parentId ?? '') === parentId)
      .map((folder) => folder.name.trim())
  )

export function createProjectFolder(
  project: Project,
  name: string,
  id: Id,
  parentId: Id = ''
): ProjectFolder | null {
  if (!writable(project) || !name.trim() || !id || !validProjectFolder(project, parentId))
    return null
  const folders = projectFolders(project),
    clean = name.trim()
  if (
    folders.some((folder) => folder.id === id) ||
    siblingNames(folders, parentId).has(clean) ||
    (!parentId && clean.toLowerCase() === 'default')
  )
    return null
  ensureProjectFolders(project)
  const folder: ProjectFolder = {
    id,
    name: clean,
    ...(parentId ? { parentId } : {}),
    createdAt: new Date().toISOString()
  }
  project.folders = [...project.folders!, folder]
  return folder
}
export function renameProjectFolder(project: Project, id: Id, name: string): boolean {
  const clean = name.trim(),
    rows = projectFolders(project),
    row = rows.find((folder) => folder.id === id)
  if (
    !writable(project) ||
    !row ||
    !clean ||
    siblingNames(rows, row.parentId ?? '', id).has(clean) ||
    (!row.parentId && clean.toLowerCase() === 'default')
  )
    return false
  ensureProjectFolders(project).find((folder) => folder.id === id)!.name = clean
  return true
}
export function projectFolderMoveTargets(project: Project, id: Id): Set<Id> {
  const rows = projectFolders(project),
    source = rows.find((folder) => folder.id === id)
  if (!source) return new Set()
  return new Set(
    ['', ...rows.map((folder) => folder.id)].filter(
      (target) =>
        canMoveFolder(rows, id, target) &&
        !siblingNames(rows, target, id).has(source.name) &&
        (target || source.name.toLowerCase() !== 'default')
    )
  )
}
export function moveProjectFolder(project: Project, id: Id, parentId: Id): boolean {
  if (!writable(project) || !projectFolderMoveTargets(project, id).has(parentId)) return false
  const rows = ensureProjectFolders(project)
  if (!moveFolder(rows, id, parentId)) return false
  project.folders = [...rows]
  return true
}
export function removeProjectFolder(project: Project, id: Id): boolean {
  if (!writable(project) || !id || !validProjectFolder(project, id)) return false
  const rows = ensureProjectFolders(project),
    removed = removeFolderPreservingChildren(rows, id)
  if (!removed) return false
  for (const kind of kinds)
    for (const record of collection(project, kind))
      if (record.folderId === id) {
        if (removed.parentId) record.folderId = removed.parentId
        else delete record.folderId
      }
  project.folders = [...rows]
  return true
}
export function reorderProjectFolder(project: Project, fromId: Id, toId: Id): boolean {
  const rows = projectFolders(project),
    from = rows.find((folder) => folder.id === fromId),
    to = rows.find((folder) => folder.id === toId)
  if (
    !writable(project) ||
    !from ||
    !to ||
    fromId === toId ||
    (from.parentId ?? '') !== (to.parentId ?? '')
  )
    return false
  const stored = ensureProjectFolders(project),
    at = stored.findIndex((folder) => folder.id === fromId),
    target = stored.findIndex((folder) => folder.id === toId)
  const [moved] = stored.splice(at, 1)
  stored.splice(target, 0, moved)
  project.folders = [...stored]
  return true
}
export function projectRecord(project: Project, ref: ProjectRecordRef): ProjectRecord | undefined {
  return kinds.includes(ref.kind)
    ? collection(project, ref.kind).find((record) => record.id === ref.id)
    : undefined
}

type ProjectRecordIndex = Map<ProjectRecordKind, Map<Id, ProjectRecord>>
/** 仅本次批量操作使用；保留旧find的首ID优先，不跨类型猜测同名ID。 */
function indexProjectRecords(project: Project): ProjectRecordIndex {
  const index: ProjectRecordIndex = new Map()
  for (const kind of kinds) {
    const records = new Map<Id, ProjectRecord>()
    for (const record of collection(project, kind))
      if (!records.has(record.id)) records.set(record.id, record)
    index.set(kind, records)
  }
  return index
}
const indexedRecord = (
  index: ProjectRecordIndex,
  ref: ProjectRecordRef
): ProjectRecord | undefined => index.get(ref.kind)?.get(ref.id)
export function moveProjectRecords(
  project: Project,
  refs: readonly ProjectRecordRef[],
  targetFolder: Id
): number {
  if (!writable(project) || !validProjectFolder(project, targetFolder)) return 0
  const index = indexProjectRecords(project)
  const records = [
    ...new Map(refs.map((ref) => [recordKey(ref), indexedRecord(index, ref)])).values()
  ].filter((record): record is ProjectRecord => !!record)
  const valid = new Set(projectFolders(project).map((folder) => folder.id))
  const moving = records.filter(
    (record) =>
      (record.folderId && valid.has(record.folderId) ? record.folderId : '') !== targetFolder
  )
  if (!moving.length) return 0
  ensureProjectFolders(project)
  for (const record of moving) {
    if (targetFolder) record.folderId = targetFolder
    else delete record.folderId
  }
  return moving.length
}
export function projectFolderRecords(
  project: Project,
  id: Id,
  recursive = false
): ProjectRecordRef[] {
  const folders = projectFolders(project),
    index = createFolderIndex(folders)
  if (!index.has(id)) return []
  const allowed = recursive ? index.normalizedDescendants(id) : new Set([id]),
    out: ProjectRecordRef[] = []
  const valid = new Set(folders.map((folder) => folder.id))
  const legacy = project.folders === undefined ? legacyProjection(project) : null
  for (const kind of kinds)
    for (const record of collection(project, kind))
      if (allowed.has(effectiveRecordFolder(record, kind, valid, legacy)))
        out.push({ kind, id: record.id })
  return out
}

function effectiveRecordFolder(
  record: ProjectRecord,
  kind: ProjectRecordKind,
  valid: ReadonlySet<Id>,
  legacy: LegacyProjection | null
): Id {
  if (!record.folderId) return ''
  if (legacy)
    return (
      (kind === 'doc'
        ? legacy.docs.get(record.folderId)
        : legacy.corpus.get(legacyCorpusKey(record.languageId ?? '', record.folderId))) ?? ''
    )
  return valid.has(record.folderId) ? record.folderId : ''
}

/** 大小只是当前记录JSON的UTF-8估算，不是导出文件或磁盘占用。 */
export function projectRecordSize(project: Project, ref: ProjectRecordRef): number {
  const record = projectRecord(project, ref)
  return record ? new TextEncoder().encode(JSON.stringify(record)).byteLength : 0
}

export interface ProjectClipboard {
  version: 1
  id: Id
  mode: 'copy' | 'cut'
  projectId: Id
  sessionId: Id
  createdAt: number
  expiresAt: number
  folderIds: Id[]
  refs: ProjectRecordRef[]
  folders: ProjectFolder[]
  records: ProjectRecordSnapshot[]
}
export type ProjectPasteResult =
  | { ok: true; mode: 'copy' | 'cut'; folderIds: Id[]; refs: ProjectRecordRef[]; count: number }
  | {
      ok: false
      reason:
        | 'readonly'
        | 'invalid-target'
        | 'cross-project'
        | 'expired'
        | 'stale'
        | 'invalid-source'
        | 'cycle'
        | 'invalid-id'
    }

// 复制与剪切都只接受当前项目实例签发的完整载荷；外部文本不能靠改ID冒充来源。
const sessions = new WeakMap<Project, Id>()
const consumedCuts = new Map<Id, number>()
const issuedClipboards = new WeakMap<Project, { payload: ProjectClipboard; snapshot: string }>()
const sessionOf = (project: Project): Id => {
  let id = sessions.get(project)
  if (!id) {
    id = newId()
    sessions.set(project, id)
  }
  return id
}
function snapshotSelection(
  project: Project,
  selected: readonly ProjectClipboardRef[],
  recordsByKind?: ProjectRecordIndex
): Pick<ProjectClipboard, 'folderIds' | 'refs' | 'folders' | 'records'> | null {
  const folders = projectFolders(project),
    index = createFolderIndex(folders),
    wanted = new Set(selected.filter((ref) => ref.kind === 'folder').map((ref) => ref.id))
  if ([...wanted].some((id) => !id || !index.nodes.has(id))) return null
  const records = recordsByKind ?? indexProjectRecords(project)
  const folderIds = [...wanted].filter(
      (id) => !index.ancestors(id).some((ancestor) => wanted.has(ancestor.id))
    ),
    included = new Set(folderIds.flatMap((id) => [...index.normalizedDescendants(id)])),
    refs = new Map<string, ProjectRecordRef>()
  const valid = new Set(folders.map((folder) => folder.id)),
    legacy = project.folders === undefined ? legacyProjection(project) : null
  for (const ref of selected)
    if (ref.kind !== 'folder') {
      if (!indexedRecord(records, ref)) return null
      refs.set(recordKey(ref), ref)
    }
  for (const kind of kinds)
    for (const record of collection(project, kind))
      if (included.has(effectiveRecordFolder(record, kind, valid, legacy))) {
        const ref = { kind, id: record.id }
        refs.set(recordKey(ref), ref)
      }
  const list = [...refs.values()]
  if (!folderIds.length && !list.length) return null
  return {
    folderIds,
    refs: clone(list),
    folders: clone(folders.filter((folder) => included.has(folder.id))),
    records: list.map((ref) => {
      const record = clone(indexedRecord(records, ref)!),
        folderId = effectiveRecordFolder(record, ref.kind, valid, legacy)
      if (folderId) record.folderId = folderId
      else delete record.folderId
      return { kind: ref.kind, record } as ProjectRecordSnapshot
    })
  }
}
export function createProjectClipboard(
  project: Project,
  refs: readonly ProjectClipboardRef[],
  mode: 'copy' | 'cut',
  options: { now?: number; ttlMs?: number } = {}
): ProjectClipboard | null {
  if ((mode !== 'copy' && mode !== 'cut') || (mode === 'cut' && !writable(project))) return null
  const data = snapshotSelection(project, refs),
    now = options.now ?? Date.now()
  if (
    !data ||
    !Number.isFinite(now) ||
    (options.ttlMs !== undefined && !Number.isFinite(options.ttlMs))
  )
    return null
  const clipboard: ProjectClipboard = {
    version: 1,
    id: newId(),
    mode,
    projectId: project.meta.id,
    sessionId: sessionOf(project),
    createdAt: now,
    expiresAt:
      mode === 'cut' ? now + Math.max(0, options.ttlMs ?? 30 * 60 * 1000) : Number.MAX_SAFE_INTEGER,
    ...data
  }
  // 只保留本项目当前一次签发；重复粘贴同一copy仍可用，不累计保留大子树快照。
  issuedClipboards.set(project, { payload: clone(clipboard), snapshot: snapshotKey(clipboard) })
  return clipboard
}
function validClipboard(value: ProjectClipboard): boolean {
  return (
    !!value &&
    value.version === 1 &&
    typeof value.id === 'string' &&
    !!value.id &&
    (value.mode === 'copy' || value.mode === 'cut') &&
    Number.isFinite(value.expiresAt) &&
    Array.isArray(value.folderIds) &&
    Array.isArray(value.refs) &&
    Array.isArray(value.folders) &&
    Array.isArray(value.records) &&
    value.folders.every(
      (folder) =>
        !!folder &&
        typeof folder.id === 'string' &&
        !!folder.id &&
        typeof folder.name === 'string' &&
        !!folder.name.trim() &&
        (folder.parentId === undefined || typeof folder.parentId === 'string')
    ) &&
    value.folderIds.every((id) => typeof id === 'string' && !!id) &&
    value.refs.every((ref) => !!ref && kinds.includes(ref.kind) && typeof ref.id === 'string') &&
    value.records.every(
      (row) =>
        !!row &&
        kinds.includes(row.kind) &&
        !!row.record &&
        typeof row.record.id === 'string' &&
        (row.kind === 'doc'
          ? typeof row.record.title === 'string' &&
            typeof row.record.markdown === 'string' &&
            (row.record.languageId === null || typeof row.record.languageId === 'string')
          : typeof row.record.text === 'string' &&
            typeof row.record.languageId === 'string' &&
            (row.kind !== 'sentence' || Array.isArray(row.record.tokens)))
    )
  )
}

export function pasteProjectClipboard(
  project: Project,
  clipboard: ProjectClipboard,
  targetFolderId: Id,
  options: { newId?: () => Id; now?: number; allowFolders?: boolean } = {}
): ProjectPasteResult {
  const fail = (
    reason: Extract<ProjectPasteResult, { ok: false }>['reason']
  ): ProjectPasteResult => ({ ok: false, reason })
  if (!writable(project)) return fail('readonly')
  if (!validClipboard(clipboard)) return fail('invalid-source')
  if (clipboard.projectId !== project.meta.id || sessions.get(project) !== clipboard.sessionId)
    return fail('cross-project')
  const issued = issuedClipboards.get(project)
  if (!issued || issued.payload.id !== clipboard.id || issued.snapshot !== snapshotKey(clipboard))
    return fail('stale')
  // 后续计划只读内部已签发快照，不按系统文本提供的来源ID重新猜记录。
  clipboard = issued.payload
  // Default和视图根共用空ID，但Default仅容纳记录；由入口明确禁止目录粘贴。
  if (options.allowFolders === false && clipboard.folders.length > 0) return fail('invalid-target')
  const now = options.now ?? Date.now()
  for (const [id, expires] of consumedCuts) if (expires <= now) consumedCuts.delete(id)
  if (
    !Number.isFinite(now) ||
    now < clipboard.createdAt ||
    now >= clipboard.expiresAt ||
    consumedCuts.has(clipboard.id)
  )
    return fail('expired')
  if (!validProjectFolder(project, targetFolderId)) return fail('invalid-target')
  const source = [
    ...clipboard.folderIds.map((id) => ({ kind: 'folder' as const, id })),
    ...clipboard.refs
  ]
  const sourceRecords = clipboard.mode === 'cut' ? indexProjectRecords(project) : null
  if (clipboard.mode === 'cut') {
    const current = snapshotSelection(project, source, sourceRecords!)
    const previous = {
      folderIds: clipboard.folderIds,
      refs: clipboard.refs,
      folders: clipboard.folders,
      records: clipboard.records
    }
    if (!current || snapshotKey(current) !== snapshotKey(previous)) return fail('stale')
  }
  const rows = projectFolders(project)
  if (clipboard.folderIds.some((id) => folderDescendants(rows, id).has(targetFolderId)))
    return fail('cycle')
  const folderIds = new Set(clipboard.folders.map((folder) => folder.id)),
    roots = new Set(clipboard.folderIds)
  if (
    folderIds.size !== clipboard.folders.length ||
    [...roots].some((id) => !folderIds.has(id)) ||
    clipboard.refs.length !== clipboard.records.length ||
    new Set(clipboard.refs.map(recordKey)).size !== clipboard.refs.length ||
    clipboard.records.some(
      (row, i) => row.kind !== clipboard.refs[i].kind || row.record.id !== clipboard.refs[i].id
    )
  )
    return fail('invalid-source')
  const plannedFolders = clone(clipboard.folders),
    plannedRecords = clone(clipboard.records),
    idMap = new Map<Id, Id>(),
    used = new Set<Id>()
  for (const values of Object.values(project))
    if (Array.isArray(values))
      for (const value of values)
        if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string')
          used.add(value.id)
  const allocate = (): Id | null => {
    for (let n = 0; n < 64; n++) {
      const id = (options.newId ?? newId)()
      if (typeof id === 'string' && id && !used.has(id)) {
        used.add(id)
        return id
      }
    }
    return null
  }
  if (clipboard.mode === 'copy') {
    for (const folder of plannedFolders) {
      const id = allocate()
      if (!id) return fail('invalid-id')
      idMap.set(folder.id, id)
    }
    for (const row of plannedRecords) {
      const id = allocate()
      if (!id) return fail('invalid-id')
      row.record.id = id
      row.record.createdAt = new Date(now).toISOString()
    }
  }
  // 选中根原本可位于其他目录，外部父不在载荷里；只校验其内部子树，最终父层随后设为目标。
  const graph = createFolderIndex(
    plannedFolders.map((folder) =>
      roots.has(folder.id) ? { ...folder, parentId: undefined } : folder
    )
  )
  if (
    plannedFolders.some(
      (folder) => !roots.has(folder.id) && graph.parent(folder.id) !== (folder.parentId ?? '')
    ) ||
    roots.size !== clipboard.folderIds.length
  )
    return fail('invalid-source')
  const names = new Set(
    rows
      .filter(
        (folder) =>
          (folder.parentId ?? '') === targetFolderId &&
          !(clipboard.mode === 'cut' && roots.has(folder.id))
      )
      .map((folder) => folder.name.trim())
  )
  for (const folder of plannedFolders) {
    const root = roots.has(folder.id),
      parent = root ? targetFolderId : (idMap.get(folder.parentId ?? '') ?? folder.parentId ?? '')
    if (!root && !folderIds.has(folder.parentId ?? '')) return fail('invalid-source')
    if (root) {
      folder.name = uniqueName(folder.name, names, targetFolderId)
      names.add(folder.name)
    }
    if (clipboard.mode === 'copy') {
      folder.id = idMap.get(folder.id)!
      folder.createdAt = new Date(now).toISOString()
    }
    if (parent) folder.parentId = parent
    else delete folder.parentId
  }
  for (const row of plannedRecords) {
    const parent =
      row.record.folderId && folderIds.has(row.record.folderId)
        ? (idMap.get(row.record.folderId) ?? row.record.folderId)
        : targetFolderId
    if (parent) row.record.folderId = parent
    else delete row.record.folderId
  }
  // 所有校验、命名及ID分配完成后才提交；失败粘贴从不删除或部分移动原记录。
  ensureProjectFolders(project)
  if (clipboard.mode === 'copy') {
    project.folders = [...project.folders!, ...plannedFolders]
    project.sentences = [
      ...project.sentences,
      ...plannedRecords.filter((row) => row.kind === 'sentence').map((row) => row.record)
    ]
    project.phrasebook = [
      ...project.phrasebook,
      ...plannedRecords.filter((row) => row.kind === 'phrase').map((row) => row.record)
    ]
    project.docs = [
      ...project.docs,
      ...plannedRecords.filter((row) => row.kind === 'doc').map((row) => row.record)
    ]
  } else {
    const changes = new Map(plannedFolders.map((folder) => [folder.id, folder]))
    project.folders = project.folders!.map((folder) => changes.get(folder.id) ?? folder)
    for (const row of plannedRecords) {
      const record = indexedRecord(sourceRecords!, { kind: row.kind, id: row.record.id })!
      if (row.record.folderId) record.folderId = row.record.folderId
      else delete record.folderId
    }
    consumedCuts.set(clipboard.id, clipboard.expiresAt)
  }
  const resultFolders = clipboard.folderIds.map((id) => idMap.get(id) ?? id),
    resultRefs = plannedRecords.map((row) => ({ kind: row.kind, id: row.record.id }))
  return {
    ok: true,
    mode: clipboard.mode,
    folderIds: resultFolders,
    refs: resultRefs,
    count: plannedFolders.length + plannedRecords.length
  }
}
