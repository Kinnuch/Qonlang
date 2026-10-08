import type { GrammaticalCategory, Id } from '$lib/core/model'
import type { SlotDef } from '$lib/engine/morph'

/**
 * 构形页槽位表头的漏斗：按启用 / 停用、按维度的取值筛槽位（只影响显示，不进项目）。
 * 同一个维度里点了几个取值，满足其一即可；不同维度之间要同时满足；一个维度一个都没点就不按它筛。
 */
export interface SlotFilter {
  state: 'all' | 'on' | 'off'
  /** 维度 id → 点了的取值 id */
  values: Record<Id, Id[]>
}

export const NO_SLOT_FILTER: SlotFilter = { state: 'all', values: {} }

export function slotFilterActive(f: SlotFilter): boolean {
  return f.state !== 'all' || Object.values(f.values).some((v) => v.length > 0)
}

/** 这一格过不过筛（disabled 是停用的槽位键） */
export function slotPasses(s: SlotDef, f: SlotFilter, disabled: ReadonlySet<string>): boolean {
  if (f.state === 'on' && disabled.has(s.key)) return false
  if (f.state === 'off' && !disabled.has(s.key)) return false
  for (const [catId, vals] of Object.entries(f.values)) {
    if (!vals.length) continue
    // 少了这个维度的格（加维度之前留下来的）不算满足
    if (!s.values.some((v) => v.categoryId === catId && vals.includes(v.valueId))) return false
  }
  return true
}

/** 点一个取值：点上或去掉 */
export function toggleSlotFilterValue(f: SlotFilter, catId: Id, valueId: Id): SlotFilter {
  const cur = f.values[catId] ?? []
  const next = cur.includes(valueId) ? cur.filter((v) => v !== valueId) : [...cur, valueId]
  const values = { ...f.values }
  if (next.length) values[catId] = next
  else delete values[catId]
  return { ...f, values }
}

/** 漏斗里列哪些维度、哪些取值 */
export interface SlotFilterDim {
  id: Id
  category: GrammaticalCategory
  /** 至少有一格用到的取值，按维度表里的先后 */
  valueIds: Id[]
}

/**
 * 槽位里用到的维度：先按构形里维度的先后，再是只有个别格带着的（锁定前留下来的那些）；
 * 取值只列至少有一格用到的
 */
export function slotFilterDims(
  slots: SlotDef[],
  dimensionIds: Id[],
  categories: GrammaticalCategory[]
): SlotFilterDim[] {
  const used = new Map<Id, Set<Id>>()
  for (const s of slots)
    for (const v of s.values) {
      let set = used.get(v.categoryId)
      if (!set) used.set(v.categoryId, (set = new Set()))
      set.add(v.valueId)
    }
  const order = [
    ...dimensionIds,
    ...categories.map((c) => c.id).filter((id) => !dimensionIds.includes(id))
  ]
  const out: SlotFilterDim[] = []
  for (const id of order) {
    const set = used.get(id)
    const category = categories.find((c) => c.id === id)
    if (!set || !category) continue
    const valueIds = category.values.filter((v) => set.has(v.id)).map((v) => v.id)
    if (valueIds.length) out.push({ id, category, valueIds })
  }
  return out
}

/**
 * 维度、取值删了之后，筛选里留着的旧 id 去掉（不然筛出来一个都没有，又看不出是在按什么筛）；
 * 没变就原样返回
 */
export function pruneSlotFilter(f: SlotFilter, dims: SlotFilterDim[]): SlotFilter {
  let changed = false
  const values: Record<Id, Id[]> = {}
  for (const [catId, vals] of Object.entries(f.values)) {
    const dim = dims.find((d) => d.id === catId)
    const kept = dim ? vals.filter((v) => dim.valueIds.includes(v)) : []
    if (kept.length !== vals.length) changed = true
    if (kept.length) values[catId] = kept
  }
  return changed ? { ...f, values } : f
}
