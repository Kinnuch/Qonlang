import type { Id, LocalizedText, Project, TabGroupSet } from './model'
import { ownParadigmIds } from './pos'

/** 分组的颜色（界面按主题调深浅） */
export const TAB_GROUP_COLORS = [
  'blue',
  'green',
  'purple',
  'orange',
  'red',
  'teal',
  'pink',
  'yellow',
  'grey'
] as const

export type TabGroupKind = 'ruleSets' | 'paradigms'

/**
 * 音变默认两组：历时（阶段绑到两门以上语言，祖语 → 子语）和共时（阶段都在同一门语言里，
 * 比如元音和谐、书面语 → 口语；或者构形流水线里跑的规则集）。
 * 都对不上的不分组；两组的 id 固定，名字按当时的界面语言写。
 */
export function defaultRuleSetGroups(
  project: Project,
  names: { synchronic: string; diachronic: string }
): TabGroupSet {
  const used = new Set<Id>()
  for (const p of project.paradigms)
    for (const g of Object.values(p.generators))
      if (g.kind === 'pipeline')
        for (const st of g.steps) if (st.kind === 'sca' && st.ruleSetId) used.add(st.ruleSetId)
  const members: Record<Id, Id> = {}
  for (const rs of project.ruleSets) {
    const langs = new Set(Object.values(rs.stageLanguages ?? {}).filter(Boolean))
    if (langs.size >= 2) members[rs.id] = 'diachronic'
    else if (langs.size === 1 || used.has(rs.id)) members[rs.id] = 'synchronic'
  }
  return {
    groups: [
      { id: 'synchronic', name: names.synchronic, color: 'teal' },
      { id: 'diachronic', name: names.diachronic, color: 'purple' }
    ],
    members
  }
}

/** 构形默认按词类分组：绑在哪个词类上就进哪组（绑了几个的进第一个），一组都没进的词类不建组 */
export function defaultParadigmGroups(
  project: Project,
  posName: (name: LocalizedText, abbr: string) => string
): TabGroupSet {
  const members: Record<Id, Id> = {}
  const groups: TabGroupSet['groups'] = []
  const exists = new Set(project.paradigms.map((p) => p.id))
  for (const pos of project.posList) {
    const ids = ownParadigmIds(pos).filter((id) => exists.has(id) && !members[id])
    if (!ids.length) continue
    const gid = `pos:${pos.id}`
    groups.push({
      id: gid,
      name: posName(pos.name, pos.abbr),
      color: TAB_GROUP_COLORS[groups.length % TAB_GROUP_COLORS.length]
    })
    for (const id of ids) members[id] = gid
  }
  return { groups, members }
}

/** 页签排成几段：每个分组一段（按分组顺序，组里按原顺序），没分组的放最后 */
export function groupTabs<T extends { id: Id }>(
  items: T[],
  set: TabGroupSet
): { group: TabGroupSet['groups'][number] | null; items: { item: T; index: number }[] }[] {
  const known = new Set(set.groups.map((g) => g.id))
  const out = set.groups.map((group) => ({ group, items: [] as { item: T; index: number }[] }))
  const loose: { item: T; index: number }[] = []
  items.forEach((item, index) => {
    const gid = set.members[item.id]
    if (gid && known.has(gid)) out.find((x) => x.group.id === gid)!.items.push({ item, index })
    else loose.push({ item, index })
  })
  return [...out, { group: null, items: loose }]
}
