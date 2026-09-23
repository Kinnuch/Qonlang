/**
 * 槽位排成表格或树的排布（纯函数，不碰界面）：构形页与词库的屈折形都用这一套。
 * 传进来的维度已经取好名字（`name` / `values[].name`），这里只管怎么摆。
 */
import type { Id } from '$lib/core/model'
import { slotKey } from './index'

export interface LayoutValue {
  id: Id
  name: string
  abbr: string
}

export interface LayoutDim {
  id: Id
  name: string
  values: LayoutValue[]
}

/** 第三个维度起每种取值组合各一张表；只有一两个维度时就一张（caption 是空的） */
export interface SlotTable {
  key: string
  /** 这张表固定下来的取值，如「数 复数 · 有定性 定」 */
  caption: string
  fixed: { categoryId: Id; valueId: Id }[]
}

export function slotTables(dims: LayoutDim[]): SlotTable[] {
  if (!dims.length) return []
  let combos: { categoryId: Id; valueId: Id; label: string }[][] = [[]]
  for (const d of dims.slice(2))
    combos = combos.flatMap((c) =>
      d.values.map((v) => [
        ...c,
        // 有 gloss 缩写就写缩写（维度名照写全名，一眼看得出是哪一维）
        { categoryId: d.id, valueId: v.id, label: `${d.name} ${v.abbr || v.name}` }
      ])
    )
  return combos.map((fixed) => ({
    key: fixed.map((e) => e.valueId).join('|') || '-',
    caption: fixed.map((e) => e.label).join(' · '),
    fixed: fixed.map((e) => ({ categoryId: e.categoryId, valueId: e.valueId }))
  }))
}

/** 表格里一格对应哪个槽位键：行是第一个维度，列是第二个维度（只有一个维度时只有一列） */
export function cellKey(
  dims: LayoutDim[],
  row: LayoutValue,
  col: LayoutValue | null,
  fixed: { categoryId: Id; valueId: Id }[]
): string {
  const values = [{ categoryId: dims[0].id, valueId: row.id }]
  if (col && dims[1]) values.push({ categoryId: dims[1].id, valueId: col.id })
  return slotKey([...values, ...fixed])
}

export interface SlotTreeNode {
  /** 走到这里的取值拼成的键；叶子上就是槽位键 */
  key: string
  label: string
  abbr: string
  children: SlotTreeNode[]
  leaf: boolean
}

/** 树形图：第一个维度的取值分叉，往下每个维度再分，叶子是槽位 */
export function slotTree(dims: LayoutDim[]): SlotTreeNode[] {
  if (!dims.length) return []
  const build = (depth: number, prefix: { categoryId: Id; valueId: Id }[]): SlotTreeNode[] =>
    dims[depth].values.map((v) => {
      const values = [...prefix, { categoryId: dims[depth].id, valueId: v.id }]
      const leaf = depth === dims.length - 1
      return {
        key: slotKey(values),
        label: v.name,
        abbr: v.abbr,
        children: leaf ? [] : build(depth + 1, values),
        leaf
      }
    })
  return build(0, [])
}
