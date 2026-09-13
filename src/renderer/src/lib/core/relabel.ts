/**
 * 按名字存的数据跟着改名走。词条的屈折形按槽位名（取值名用 . 连接）存、词干按词干槽名存，
 * 词库的列（`form:` / `stem:`）、文字的「转写来源」写的也是名字——
 * 维度取值改了名、构形换了维度顺序、词干槽改了名之后，把旧名下的内容挪到新名下。
 * 新名下已经有内容的、分不清该挪到哪儿的，都原样不动。
 */
import type { Id, Lexeme, Paradigm, Project } from './model'
import { paradigmFor, paradigmSlots } from '$lib/engine/morph'
import { findPos, isCompoundPos, posParadigmIds, posParts } from './pos'

/** 每个构形：取值组合（与维度先后无关）→ 槽位名 */
export type SlotLabels = Map<Id, Map<string, string>>

/** 一个槽位用到的取值，排好序拼起来：维度换了先后也还是同一个 */
const comboOf = (values: { valueId: Id }[]): string =>
  values
    .map((v) => v.valueId)
    .sort()
    .join('|')

export function slotLabels(project: Project): SlotLabels {
  const out: SlotLabels = new Map()
  for (const p of project.paradigms)
    out.set(
      p.id,
      new Map(
        paradigmSlots(p, project.categories, project.settings.glossLanguages, true).map((s) => [
          comboOf(s.values),
          s.label
        ])
      )
    )
  return out
}

/**
 * 构形换维度先后。槽位 key 是按维度先后拼的取值 id，所以生成器（含变体的 `key#变体`）和停用的槽位
 * 要按新顺序重拼 key，不然整张构形的写法都对不上；词条里按槽位名存的屈折形也跟着挪。返回挪了屈折形的词条数。
 */
export function setDimensionOrder(project: Project, para: Paradigm, order: Id[]): number {
  const old = [...para.dimensionIds]
  if (old.length !== order.length || old.every((id, i) => id === order[i])) return 0
  const before = slotLabels(project)
  const catOf = new Map<Id, Id>()
  for (const c of project.categories) for (const v of c.values) catOf.set(v.id, c.id)
  const rekey = (key: string): string => {
    const hash = key.indexOf('#')
    const base = hash < 0 ? key : key.slice(0, hash)
    const parts = base.split('|')
    if (parts.length !== old.length) return key
    const byCat = new Map<Id, string>()
    for (const v of parts) {
      const c = catOf.get(v)
      if (!c) return key
      byCat.set(c, v)
    }
    if (order.some((d) => !byCat.has(d))) return key
    return order.map((d) => byCat.get(d)!).join('|') + (hash < 0 ? '' : key.slice(hash))
  }
  para.generators =
    renameKeys(para.generators, new Map(Object.keys(para.generators).map((k) => [k, rekey(k)]))) ??
    para.generators
  para.disabledSlots = para.disabledSlots.map(rekey)
  para.dimensionIds = [...order]
  return followSlotLabels(project, before)
}

/**
 * 按 map 给对象的键改名，顺序不变。两个键会撞到同一个名字时，撞上的那几个都不改；
 * 没有任何键改名时返回 null。
 */
export function renameKeys<T>(
  obj: Record<string, T>,
  map: ReadonlyMap<string, string>
): Record<string, T> | null {
  const keys = Object.keys(obj)
  const target = new Map(keys.map((k) => [k, map.get(k) ?? k]))
  for (;;) {
    const byName = new Map<string, string[]>()
    for (const k of keys) {
      const n = target.get(k)!
      byName.set(n, [...(byName.get(n) ?? []), k])
    }
    const clash = [...byName.values()]
      .filter((ks) => ks.length > 1)
      .flat()
      .filter((k) => target.get(k) !== k)
    if (!clash.length) break
    for (const k of clash) target.set(k, k)
  }
  if (keys.every((k) => target.get(k) === k)) return null
  const out: Record<string, T> = {}
  for (const k of keys) out[target.get(k)!] = obj[k]
  return out
}

/** 同一个旧名对到不同新名时记成 null（分不清） */
function addRename(m: Map<string, string | null>, from: string, to: string): void {
  if (!m.has(from)) m.set(from, to)
  else if (m.get(from) !== to) m.set(from, null)
}

const definite = (m: Map<string, string | null>): Map<string, string> =>
  new Map([...m].filter((e): e is [string, string] => e[1] !== null))

/** 词库列与各套文字的转写来源里 `前缀旧名` 换成 `前缀新名` */
function renameReferences(
  project: Project,
  prefix: string,
  map: ReadonlyMap<string, string>
): void {
  if (!map.size) return
  const cols = project.settings.lexiconColumns
  if (cols.some((c) => c.startsWith(prefix) && map.has(c.slice(prefix.length)))) {
    const next: string[] = []
    for (const c of cols) {
      const to = c.startsWith(prefix) ? map.get(c.slice(prefix.length)) : undefined
      const key = to !== undefined ? prefix + to : c
      if (!next.includes(key)) next.push(key)
    }
    project.settings.lexiconColumns = next
  }
  for (const lang of project.languages)
    for (const sc of lang.scripts) {
      const from = (sc.from ?? '').trim()
      if (!from.startsWith(prefix)) continue
      const to = map.get(from.slice(prefix.length))
      if (to !== undefined) sc.from = prefix + to
    }
}

/** 这个词条的屈折形可能按哪几个构形的槽位名存：指名的、词类默认的、词类另外绑的 */
function paradigmsOf(project: Project, l: Lexeme): Id[] {
  const ids = new Set<Id>()
  const p = paradigmFor(project, l)
  if (p) ids.add(p.id)
  for (const id of posParadigmIds(project, l.posId)) ids.add(id)
  return [...ids]
}

/**
 * 槽位名变了之后调用（before 是改之前的 slotLabels）：用着这些构形的词条里，旧槽位名下的屈折形挪到新名下，
 * 词库列与文字的转写来源一起改。返回改动了的词条数。
 */
export function followSlotLabels(project: Project, before: SlotLabels): number {
  const after = slotLabels(project)
  const perParadigm = new Map<Id, Map<string, string>>()
  const global = new Map<string, string | null>()
  for (const [pid, old] of before) {
    const now = after.get(pid)
    if (!now) continue
    const m = new Map<string, string>()
    for (const [key, label] of old) {
      const next = now.get(key)
      if (next === undefined || next === label || !label || !next) continue
      m.set(label, next)
      addRename(global, label, next)
    }
    if (m.size) perParadigm.set(pid, m)
  }
  if (!perParadigm.size) return 0
  let changed = 0
  for (const l of project.lexemes) {
    if (!Object.keys(l.forms).length) continue
    const m = new Map<string, string | null>()
    for (const pid of paradigmsOf(project, l))
      for (const [from, to] of perParadigm.get(pid) ?? []) addRename(m, from, to)
    const next = m.size ? renameKeys(l.forms, definite(m)) : null
    if (!next) continue
    l.forms = next
    changed++
  }
  renameReferences(project, 'form:', definite(global))
  return changed
}

/** 词条的词干槽是不是就是这个词类的（词类自己，或者没设词干槽、由它组成的复合词类） */
function usesStemSlotsOf(project: Project, posId: Id | null | undefined, ownerId: Id): boolean {
  const own = findPos(project, posId)
  if (!own) return false
  if (own.id === ownerId) return true
  return (
    isCompoundPos(own) &&
    !own.stemSlots?.length &&
    posParts(project, own.id).some((c) => c.id === ownerId)
  )
}

/**
 * 词干槽改名（ownerPosId 这个词类的，oldName → newName）：用这个词类词干槽的词条里旧名下的词干挪到新名下；
 * 这些词条用的构形里「词干」写的旧名改成新名（别的词类也有同名词干槽、又绑了这个构形时不改）；
 * 没人再用旧名时，词库列与文字的转写来源一起改。返回改动了的词条数。
 */
export function followStemRename(
  project: Project,
  ownerPosId: Id,
  oldName: string,
  newName: string
): number {
  const from = oldName.trim()
  const to = newName.trim()
  if (!from || !to || from === to) return 0
  let changed = 0
  const paradigmIds = new Set<Id>()
  for (const l of project.lexemes) {
    if (!usesStemSlotsOf(project, l.posId, ownerPosId)) continue
    for (const id of paradigmsOf(project, l)) paradigmIds.add(id)
    const next = from in l.stems ? renameKeys(l.stems, new Map([[from, to]])) : null
    if (!next) continue
    l.stems = next
    changed++
  }
  const users = project.posList.filter((p) => usesStemSlotsOf(project, p.id, ownerPosId))
  for (const p of users) for (const id of posParadigmIds(project, p.id)) paradigmIds.add(id)
  // 别的词类（不用这个词类的词干槽）还有叫旧名的词干槽、又绑了这个构形：那个构形里的旧名还有人用
  const stillNamed = (para: Paradigm): boolean =>
    project.posList.some(
      (p) =>
        !users.includes(p) &&
        posParadigmIds(project, p.id).includes(para.id) &&
        (p.stemSlots ?? []).some((s) => s.name.trim() === from)
    )
  for (const para of project.paradigms) {
    if (!paradigmIds.has(para.id) || stillNamed(para)) continue
    for (const g of Object.values(para.generators))
      if ('stem' in g && g.stem.trim() === from) g.stem = to
  }
  const oldStillUsed =
    project.posList.some((p) => (p.stemSlots ?? []).some((s) => s.name.trim() === from)) ||
    project.lexemes.some((l) => from in l.stems)
  if (!oldStillUsed) renameReferences(project, 'stem:', new Map([[from, to]]))
  return changed
}
