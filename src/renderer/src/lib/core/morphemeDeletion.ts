import type { Id, Morpheme, Project } from './model'

export interface RemovedMorpheme {
  index: number
  morpheme: Morpheme
}

/** 单条与批量删除共用；保留引用的 id 和生成器原文，与旧单条删除一致。 */
export function removeMorphemes(project: Project, ids: ReadonlySet<Id>): RemovedMorpheme[] {
  const removed: RemovedMorpheme[] = []
  project.morphemes = project.morphemes.filter((morpheme, index) => {
    if (!ids.has(morpheme.id)) return true
    removed.push({ index, morpheme })
    return false
  })
  return removed
}

/** 只放回这次删掉且尚未恢复的语素，保留随后新增的其他项目。 */
export function restoreMorphemes(project: Project, removed: readonly RemovedMorpheme[]): Id[] {
  const present = new Set(project.morphemes.map((morpheme) => morpheme.id))
  const restored: Id[] = []
  for (const { index, morpheme } of removed) {
    if (present.has(morpheme.id)) continue
    project.morphemes.splice(Math.min(index, project.morphemes.length), 0, morpheme)
    present.add(morpheme.id)
    restored.push(morpheme.id)
  }
  return restored
}
