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
