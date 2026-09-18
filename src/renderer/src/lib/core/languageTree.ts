/**
 * 语言页的树：语系 / 语族 / 语支节点和语言摆在一起。
 * 语言挂在哪：写了所属节点、而父语言不在同一个节点里时挂在节点下；否则跟着父语言；都没有就在最外层。
 * 没写所属节点的语言跟着父语言算进它的节点（统计、对比时用）。
 */
import type { Id, Language, LanguageGroup, LanguageStage, Project } from './model'

export type TreeItem =
  | { kind: 'group'; group: LanguageGroup; children: TreeItem[] }
  | { kind: 'language'; language: Language; children: TreeItem[] }

export function languageTree(project: Project): TreeItem[] {
  const groups = project.languageGroups ?? []
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const langById = new Map(project.languages.map((l) => [l.id, l]))
  const groupItems = new Map<Id, TreeItem>(
    groups.map((g) => [g.id, { kind: 'group', group: g, children: [] }])
  )
  const langItems = new Map<Id, TreeItem>(
    project.languages.map((l) => [l.id, { kind: 'language', language: l, children: [] }])
  )
  const roots: TreeItem[] = []
  for (const g of groups) {
    const item = groupItems.get(g.id)!
    const parent = g.parentId && g.parentId !== g.id ? groupItems.get(g.parentId) : undefined
    if (parent && !groupAncestors(groups, g.parentId!).has(g.id)) parent.children.push(item)
    else roots.push(item)
  }
  for (const l of project.languages) {
    const item = langItems.get(l.id)!
    const parent = l.parentId ? langById.get(l.parentId) : undefined
    const ownGroup = l.groupId && groupById.has(l.groupId) ? l.groupId : null
    if (ownGroup && (!parent || effectiveGroupId(project, parent.id) !== ownGroup))
      groupItems.get(ownGroup)!.children.push(item)
    else if (parent) langItems.get(parent.id)!.children.push(item)
    else roots.push(item)
  }
  // 一个分类节点下面：代表原始语排最前（语系与下一级语支之间），再是下一级节点，最后是别的语言
  for (const g of groups) {
    const item = groupItems.get(g.id)
    if (!item) continue
    const rank = (x: TreeItem): number =>
      x.kind === 'language' && x.language.id === g.protoLanguageId ? 0 : x.kind === 'group' ? 1 : 2
    item.children = item.children
      .map((x, i) => ({ x, i }))
      .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
      .map((e) => e.x)
  }
  return roots
}

/** 一个节点往上的全部节点 id（含自己） */
export function groupAncestors(groups: LanguageGroup[], id: Id): Set<Id> {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const out = new Set<Id>()
  let cur = byId.get(id)
  while (cur && !out.has(cur.id)) {
    out.add(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return out
}

/** 把 id 挂到 parentId 下会不会绕成圈 */
export function wouldCreateGroupCycle(
  groups: LanguageGroup[],
  id: Id,
  parentId: Id | null
): boolean {
  return !!parentId && groupAncestors(groups, parentId).has(id)
}

/** 语言实际算在哪个节点：自己写了就是自己的，没写就沿父语言往上找 */
export function effectiveGroupId(project: Project, languageId: Id): Id | null {
  const groups = new Set((project.languageGroups ?? []).map((g) => g.id))
  const byId = new Map(project.languages.map((l) => [l.id, l]))
  const seen = new Set<Id>()
  let cur = byId.get(languageId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.groupId && groups.has(cur.groupId)) return cur.groupId
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return null
}

/** 节点下面（含各级子节点）的全部语言，按项目里的顺序 */
export function groupLanguages(project: Project, groupId: Id): Language[] {
  const groups = project.languageGroups ?? []
  return project.languages.filter((l) => {
    const g = effectiveGroupId(project, l.id)
    return !!g && groupAncestors(groups, g).has(groupId)
  })
}

/** 节点的直接子节点 */
export function childGroups(project: Project, groupId: Id | null): LanguageGroup[] {
  return (project.languageGroups ?? []).filter((g) => g.parentId === groupId)
}

/** 树里的一个节点：一门语言或者一个分类节点 */
export interface TreeRef {
  kind: 'group' | 'language'
  id: Id
}

const sameRef = (a: TreeRef, b: TreeRef): boolean => a.kind === b.kind && a.id === b.id

/** id 是语言还是分类节点；都不是返回 null */
export function refOf(project: Project, id: Id): TreeRef | null {
  if (project.languages.some((l) => l.id === id)) return { kind: 'language', id }
  if ((project.languageGroups ?? []).some((g) => g.id === id)) return { kind: 'group', id }
  return null
}

/** 树里这个节点挂在谁下面：跟 languageTree 摆放的规则一致（最外层返回 null） */
export function treeParent(project: Project, ref: TreeRef): TreeRef | null {
  const groups = project.languageGroups ?? []
  const groupById = new Map(groups.map((g) => [g.id, g]))
  if (ref.kind === 'group') {
    const g = groupById.get(ref.id)
    if (!g?.parentId || g.parentId === g.id || !groupById.has(g.parentId)) return null
    // 绕成圈的挂法在树里当最外层看
    if (groupAncestors(groups, g.parentId).has(g.id)) return null
    return { kind: 'group', id: g.parentId }
  }
  const l = project.languages.find((x) => x.id === ref.id)
  if (!l) return null
  const parent = l.parentId ? project.languages.find((x) => x.id === l.parentId) : undefined
  const ownGroup = l.groupId && groupById.has(l.groupId) ? l.groupId : null
  if (ownGroup && (!parent || effectiveGroupId(project, parent.id) !== ownGroup))
    return { kind: 'group', id: ownGroup }
  if (parent) return { kind: 'language', id: parent.id }
  return null
}

/** 从这个节点一路往上，含自己，最外层在最后 */
export function treePath(project: Project, ref: TreeRef): TreeRef[] {
  const out: TreeRef[] = []
  const seen = new Set<string>()
  let cur: TreeRef | null = ref
  while (cur && !seen.has(cur.kind + cur.id)) {
    seen.add(cur.kind + cur.id)
    out.push(cur)
    cur = treeParent(project, cur)
  }
  return out
}

export interface CommonNode {
  /** 最近的公共节点：共同的祖先语言，或者只在分类节点上碰头时的那个节点 */
  node: TreeRef
  /** a 到公共节点的一串（含两头） */
  pathA: TreeRef[]
  /** b 到公共节点的一串（含两头） */
  pathB: TreeRef[]
}

/**
 * 两个节点在树里的最近公共节点，以及各自到它的那一串。
 * 一个是另一个的祖先时，公共节点就是那个祖先；两边碰不上返回 null。
 */
export function nearestCommonNode(project: Project, aId: Id, bId: Id): CommonNode | null {
  const a = refOf(project, aId)
  const b = refOf(project, bId)
  if (!a || !b) return null
  const pathA = treePath(project, a)
  const pathB = treePath(project, b)
  for (let i = 0; i < pathA.length; i++) {
    const j = pathB.findIndex((x) => sameRef(x, pathA[i]))
    if (j >= 0)
      return { node: pathA[i], pathA: pathA.slice(0, i + 1), pathB: pathB.slice(0, j + 1) }
  }
  return null
}

/** 按名字或缩写找语言的某个阶段（词源里写的来源语言可能是阶段名，比如合并之前的「上古某某语」） */
export function findStageByName(
  project: Project,
  name: string
): { language: Language; stage: LanguageStage } | null {
  const q = name.trim().toLowerCase()
  if (!q) return null
  for (const key of ['name', 'abbr'] as const)
    for (const language of project.languages)
      for (const stage of language.stages ?? [])
        if (stage[key].trim().toLowerCase() === q) return { language, stage }
  return null
}

/** 阶段显示用的短名：缩写优先 */
export function stageShort(stage: LanguageStage): string {
  return stage.abbr.trim() || stage.name.trim()
}
