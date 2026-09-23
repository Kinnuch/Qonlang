/**
 * 槽位排成表格 / 树：行列怎么摆、第三个维度起每种取值一张表、树按维度分叉。
 */
import { describe, it, expect } from 'vitest'
import { createProject } from '$lib/core/factory'
import type { GrammaticalCategory } from '$lib/core/model'
import { paradigmDims, paradigmSlots, slotKey } from '$lib/engine/morph'
import { cellKey, slotTables, slotTree, type LayoutDim } from '$lib/engine/morph/layout'

const cat = (id: string, name: string, vals: [string, string, string][]): GrammaticalCategory => ({
  id,
  name: { zh: name },
  values: vals.map(([vid, vname, abbr]) => ({ id: vid, name: { zh: vname }, abbr }))
})

const kase = cat('case', '格', [
  ['nom', '主格', 'NOM'],
  ['gen', '属格', 'GEN']
])
const num = cat('num', '数', [
  ['sg', '单数', 'SG'],
  ['pl', '复数', 'PL']
])
const def = cat('def', '有定性', [
  ['ind', '无定', 'INDF'],
  ['dfn', '定', 'DEF']
])

const dims = (...cs: GrammaticalCategory[]): LayoutDim[] =>
  cs.map((c) => ({
    id: c.id,
    name: c.name.zh,
    values: c.values.map((v) => ({ id: v.id, name: v.name.zh, abbr: v.abbr }))
  }))

describe('slot layout', () => {
  it('lays two dimensions out as one table', () => {
    const d = dims(kase, num)
    const tables = slotTables(d)
    expect(tables).toHaveLength(1)
    expect(tables[0].caption).toBe('')
    // 行是第一个维度、列是第二个：属格 × 复数
    expect(cellKey(d, d[0].values[1], d[1].values[1], tables[0].fixed)).toBe(
      slotKey([
        { categoryId: 'case', valueId: 'gen' },
        { categoryId: 'num', valueId: 'pl' }
      ])
    )
  })

  it('gives the third dimension onwards a table each', () => {
    const d = dims(kase, num, def)
    const tables = slotTables(d)
    // 取值有 gloss 缩写就写缩写（维度名照写全名）
    expect(tables.map((x) => x.caption)).toEqual(['有定性 INDF', '有定性 DEF'])
    expect(cellKey(d, d[0].values[0], d[1].values[0], tables[1].fixed)).toBe(
      slotKey([
        { categoryId: 'case', valueId: 'nom' },
        { categoryId: 'num', valueId: 'sg' },
        { categoryId: 'def', valueId: 'dfn' }
      ])
    )
  })

  it('makes a single column when there is only one dimension', () => {
    const d = dims(kase)
    const tables = slotTables(d)
    expect(tables).toHaveLength(1)
    expect(cellKey(d, d[0].values[0], null, tables[0].fixed)).toBe(
      slotKey([{ categoryId: 'case', valueId: 'nom' }])
    )
  })

  it('branches the tree by dimension and ends on slot keys', () => {
    const tree = slotTree(dims(kase, num))
    expect(tree.map((n) => n.label)).toEqual(['主格', '属格'])
    expect(tree[0].leaf).toBe(false)
    const leaves = tree.flatMap((n) => n.children)
    expect(leaves.every((n) => n.leaf)).toBe(true)
    expect(leaves.map((n) => n.key)).toEqual(['nom|sg', 'nom|pl', 'gen|sg', 'gen|pl'])
  })

  it('每一格都对得上构形算出来的槽位', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
    p.categories.push(kase, num, def)
    p.paradigms.push({
      id: 'pd',
      name: { zh: '名词' },
      dimensionIds: ['case', 'num', 'def'],
      generators: {},
      disabledSlots: [],
      variants: []
    })
    const pd = p.paradigms[0]
    const d = paradigmDims(pd, p.categories, ['zh'])
    expect(d.map((x) => x.name)).toEqual(['格', '数', '有定性'])
    const keys = new Set(paradigmSlots(pd, p.categories, ['zh']).map((s) => s.key))
    const cells = slotTables(d).flatMap((tb) =>
      d[0].values.flatMap((r) => d[1].values.map((c) => cellKey(d, r, c, tb.fixed)))
    )
    expect(cells).toHaveLength(keys.size)
    for (const k of cells) expect(keys.has(k)).toBe(true)
    // 树的叶子也是同一批槽位
    const leaves: string[] = []
    const walk = (ns: ReturnType<typeof slotTree>): void => {
      for (const n of ns)
        if (n.leaf) leaves.push(n.key)
        else walk(n.children)
    }
    walk(slotTree(d))
    expect(new Set(leaves)).toEqual(keys)
  })
})
