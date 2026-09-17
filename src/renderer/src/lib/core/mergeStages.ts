/**
 * 「合并为阶段」：一条首尾相连的历时链（上古语 → 中古语 → 现代语，后一门的父语言是前一门）
 * 并成最后那门语言的几个阶段。
 * - 每门被并的语言变成一个阶段（它自己分过阶段就把那几个阶段依次搬过来），最后那门语言自己也补一个阶段；
 * - 被并语言里的词条、语素、例句、短语、文档挪到最后那门语言，词条和语素记上原来是哪个阶段；
 * - 音变里绑到被并语言的阶段标记改绑到「最后那门语言 · 对应阶段」，原来就绑最后那门语言的补上它自己的阶段；
 * - 正字法、文字、方言按名字对上最后那门语言里的，对不上的文字和方言搬过去；对不上的正字法下的发音丢掉（报告里有数）；
 * - 音系（音位、音类、多合字母、音节、韵律）只留最后那门语言的；
 * - 挂在被并语言下面的别的语言改挂到最后那门语言，分类节点的代表原始语也跟着换。
 */
import { newId } from './factory'
import type { Id, Language, LanguageStage, Project } from './model'

export interface MergeReport {
  stages: number
  lexemes: number
  morphemes: number
  sentences: number
  phrases: number
  docs: number
  /** 正字法对不上、丢掉的发音条数 */
  droppedPronunciations: number
}

/** 从 fromId 往下到 toId 的历时链（fromId 必须是 toId 的祖先）；对不上返回 null */
export function stageChain(project: Project, fromId: Id, toId: Id): Language[] | null {
  const byId = new Map(project.languages.map((l) => [l.id, l]))
  const chain: Language[] = []
  const seen = new Set<Id>()
  let cur = byId.get(toId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur)
    if (cur.id === fromId) return chain.length > 1 ? chain : null
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return null
}

export function mergeAsStages(project: Project, chain: Language[]): MergeReport {
  const report: MergeReport = {
    stages: 0,
    lexemes: 0,
    morphemes: 0,
    sentences: 0,
    phrases: 0,
    docs: 0,
    droppedPronunciations: 0
  }
  if (chain.length < 2) return report
  const target = chain[chain.length - 1]
  const older = chain.slice(0, -1)
  const olderIds = new Set(older.map((l) => l.id))

  // 阶段：老的在前，最后那门语言自己的（没分过就补一个）在后
  const stages: LanguageStage[] = []
  const stageOf = new Map<Id, Id>()
  const stageFor = (l: Language): void => {
    if (l.stages?.length) {
      stages.push(...l.stages)
      stageOf.set(l.id, l.stages[l.stages.length - 1].id)
    } else {
      const s: LanguageStage = { id: newId(), name: l.name, abbr: l.abbr, notes: l.notes }
      stages.push(s)
      stageOf.set(l.id, s.id)
    }
  }
  for (const l of older) stageFor(l)
  stageFor(target)
  report.stages = stages.length
  target.stages = stages

  // 正字法、文字、方言：按名字对上
  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
  const orthoMap = new Map<Id, Id | null>()
  const scriptMap = new Map<Id, Id>()
  const dialectMap = new Map<Id, Id>()
  for (const l of older) {
    for (const o of l.orthographies) {
      const hit =
        target.orthographies.find((x) => same(x.name, o.name)) ??
        (o.isPrimary ? target.orthographies.find((x) => x.isPrimary) : undefined)
      orthoMap.set(o.id, hit?.id ?? null)
    }
    for (const sc of l.scripts) {
      const hit = target.scripts.find((x) => same(x.name, sc.name))
      if (hit) scriptMap.set(sc.id, hit.id)
      else target.scripts.push(sc)
    }
    for (const d of l.dialects) {
      const hit = target.dialects.find((x) => same(x.name, d.name))
      if (hit) dialectMap.set(d.id, hit.id)
      else target.dialects.push(d)
    }
  }
  const remapKeys = <T>(
    rec: Record<Id, T>,
    map: Map<Id, Id | null>,
    count = false
  ): Record<Id, T> => {
    const out: Record<Id, T> = {}
    for (const [k, v] of Object.entries(rec)) {
      if (!map.has(k)) out[k] = v
      else {
        const to = map.get(k)
        if (to) out[to] ??= v
        else if (count) report.droppedPronunciations++
      }
    }
    return out
  }

  for (const l of project.lexemes) {
    if (!olderIds.has(l.languageId)) continue
    l.stageId ??= stageOf.get(l.languageId) ?? null
    l.languageId = target.id
    l.pronunciations = remapKeys(l.pronunciations, orthoMap, true)
    l.scriptForms = remapKeys(l.scriptForms ?? {}, scriptMap)
    l.dialectIds = l.dialectIds.map((d) => dialectMap.get(d) ?? d)
    report.lexemes++
  }
  for (const m of project.morphemes) {
    if (!olderIds.has(m.languageId)) continue
    m.stageId ??= stageOf.get(m.languageId) ?? null
    m.languageId = target.id
    report.morphemes++
  }
  for (const s of project.sentences) {
    if (!olderIds.has(s.languageId)) continue
    s.languageId = target.id
    s.orthoTexts = remapKeys(s.orthoTexts ?? {}, orthoMap)
    s.scriptForms = remapKeys(s.scriptForms ?? {}, scriptMap)
    report.sentences++
  }
  for (const p of project.phrasebook) {
    if (!olderIds.has(p.languageId)) continue
    p.languageId = target.id
    p.pronunciations = remapKeys(p.pronunciations, orthoMap, true)
    report.phrases++
  }
  for (const d of project.docs) {
    if (d.languageId && olderIds.has(d.languageId)) {
      d.languageId = target.id
      report.docs++
    }
  }

  // 音变：绑到被并语言的标记改绑阶段；原来就绑最后那门语言的补上它自己的阶段
  for (const rs of project.ruleSets) {
    for (const [m, lid] of Object.entries(rs.stageLanguages)) {
      if (!lid || (!olderIds.has(lid) && lid !== target.id)) continue
      const stageMap = (rs.stageLanguageStages ??= {})
      if (olderIds.has(lid) || !stageMap[m]) stageMap[m] = stageOf.get(lid) ?? null
      rs.stageLanguages[m] = target.id
    }
  }

  // 挂在被并语言下面的语言、分类节点的代表原始语、别处记着的语言
  target.parentId = older[0].parentId && !olderIds.has(older[0].parentId) ? older[0].parentId : null
  target.groupId ??= older.find((l) => l.groupId)?.groupId ?? null
  for (const l of project.languages)
    if (l.parentId && olderIds.has(l.parentId) && l.id !== target.id) l.parentId = target.id
  for (const g of project.languageGroups ?? [])
    if (g.protoLanguageId && olderIds.has(g.protoLanguageId)) g.protoLanguageId = target.id
  for (const p of project.paradigms)
    if (p.appliesToLanguageId && olderIds.has(p.appliesToLanguageId))
      p.appliesToLanguageId = target.id
  for (const f of project.customFields)
    f.languageIds = [...new Set(f.languageIds.map((id) => (olderIds.has(id) ? target.id : id)))]
  if (project.settings.defaultLanguageId && olderIds.has(project.settings.defaultLanguageId))
    project.settings.defaultLanguageId = target.id

  project.languages = project.languages.filter((l) => !olderIds.has(l.id))
  return report
}
