import type { Id, MorphStep, Project, SlotGenerator } from './model'

/**
 * 槽位键：取值 id 按维度 id 排好序再拼，跟构形里维度的先后无关——维度换了先后、删了再加回来、
 * 两个维度顺序不同的构形互相继承，同一组取值都是同一个键（显示上的「A.B」「B.A」只是标签）
 */
export function slotKey(values: { categoryId: Id; valueId: Id }[]): string {
  return [...values]
    .sort((a, b) => (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0))
    .map((v) => v.valueId)
    .join('|')
}

/** 旧版按维度先后拼的键（可带 `#变体`）换成 slotKey 的排法；认不出的取值原样不动 */
export function canonicalSlotKey(key: string, catOf: ReadonlyMap<Id, Id>): string {
  const hash = key.indexOf('#')
  const base = hash < 0 ? key : key.slice(0, hash)
  const parts = base.split('|')
  if (parts.some((v) => !catOf.has(v))) return key
  return (
    slotKey(parts.map((valueId) => ({ categoryId: catOf.get(valueId)!, valueId }))) +
    (hash < 0 ? '' : key.slice(hash))
  )
}

/**
 * 整个项目的槽位键都换成 slotKey 的排法（打开项目时跑，已经是新排法的不变）：
 * 各构形的生成器、停用的槽位，流水线里「构形」步骤指的槽位。返回改了几处
 */
export function canonicalizeSlotKeys(project: Project): number {
  const catOf = new Map<Id, Id>()
  for (const c of project.categories) for (const v of c.values) catOf.set(v.id, c.id)
  let n = 0
  const fixSteps = (steps: MorphStep[]): void => {
    for (const st of steps)
      if (st.kind === 'paradigm' && st.slotKey) {
        const k = canonicalSlotKey(st.slotKey, catOf)
        if (k !== st.slotKey) {
          st.slotKey = k
          n++
        }
      }
  }
  for (const p of project.paradigms) {
    const entries = Object.entries(p.generators)
    if (entries.some(([k]) => canonicalSlotKey(k, catOf) !== k)) {
      const next: Record<string, SlotGenerator> = {}
      for (const [k, g] of entries) {
        const c = canonicalSlotKey(k, catOf)
        // 两个旧键撞到一起（不该发生）：先写的留着
        if (!(c in next)) next[c] = g
        if (c !== k) n++
      }
      p.generators = next
    }
    p.disabledSlots = p.disabledSlots.map((k) => {
      const c = canonicalSlotKey(k, catOf)
      if (c !== k) n++
      return c
    })
    for (const g of Object.values(p.generators)) {
      if (g.kind !== 'pipeline') continue
      fixSteps(g.steps)
      if (g.pron) fixSteps(g.pron.steps)
      if (g.base?.slotKey) {
        const k = canonicalSlotKey(g.base.slotKey, catOf)
        if (k !== g.base.slotKey) {
          g.base.slotKey = k
          n++
        }
      }
    }
  }
  return n
}

/** 槽位键里用到了哪几个维度 */
export function slotKeyDims(key: string, catOf: ReadonlyMap<Id, Id>): Id[] {
  return [
    ...new Set(
      key
        .split('#')[0]
        .split('|')
        .map((v) => catOf.get(v))
        .filter((c): c is Id => !!c)
    )
  ]
}

/**
 * 键里去掉几个维度的取值，剩下的拼成一个键（简洁模式里「时-体-人称」往上找「时-体」用的）。
 * keep 里没有的维度都去掉；一个取值都不剩时返回空串
 */
export function slotKeySubset(
  key: string,
  catOf: ReadonlyMap<Id, Id>,
  keep: ReadonlySet<Id>
): string {
  const values = key
    .split('#')[0]
    .split('|')
    .filter((v) => {
      const c = catOf.get(v)
      return !!c && keep.has(c)
    })
  return values
    .sort((a, b) => {
      const ca = catOf.get(a)!
      const cb = catOf.get(b)!
      return ca < cb ? -1 : ca > cb ? 1 : 0
    })
    .join('|')
}
