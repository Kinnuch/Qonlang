/**
 * 构形页槽位表头的漏斗：按启用 / 停用、按维度的取值筛槽位。
 * 同一维度里点的几个取值满足其一即可，不同维度要同时满足；维度、取值删了之后旧的筛选不算数。
 */
import { describe, it, expect } from 'vitest'
import type { GrammaticalCategory, Paradigm } from '$lib/core/model'
import { paradigmSlots, slotKey } from '$lib/engine/morph'
import {
  NO_SLOT_FILTER,
  pruneSlotFilter,
  slotFilterActive,
  slotFilterDims,
  slotPasses,
  toggleSlotFilterValue,
  type SlotFilter
} from '$lib/ui/slotFilter'

const cat = (id: string, vals: string[]): GrammaticalCategory => ({
  id,
  name: { en: id },
  values: vals.map((v) => ({ id: v, name: { en: v }, abbr: v.toUpperCase() }))
})
const person = cat('person', ['p1', 'p2', 'p3'])
const num = cat('num', ['sg', 'du', 'pl'])
const tense = cat('tense', ['past', 'fut'])
const cats = [person, num, tense]
const para = (dims: string[], extra: Partial<Paradigm> = {}): Paradigm => ({
  id: 'v',
  name: { en: 'verb' },
  variants: [],
  dimensionIds: dims,
  disabledSlots: [],
  generators: {},
  inheritsFrom: null,
  ...extra
})
const slots = paradigmSlots(para(['person', 'num']), cats, ['en'], true)
const key = (...vals: [string, string][]): string =>
  slotKey(vals.map(([categoryId, valueId]) => ({ categoryId, valueId })))
const labels = (f: SlotFilter, disabled: string[] = []): string[] =>
  slots.filter((s) => slotPasses(s, f, new Set(disabled))).map((s) => s.label)

describe('槽位漏斗', () => {
  it('不筛时全部都在', () => {
    expect(slotFilterActive(NO_SLOT_FILTER)).toBe(false)
    expect(labels(NO_SLOT_FILTER)).toHaveLength(9)
  })

  it('同一维度里点几个取值是「或」，不同维度之间是「且」', () => {
    let f = toggleSlotFilterValue(NO_SLOT_FILTER, 'num', 'pl')
    expect(slotFilterActive(f)).toBe(true)
    expect(labels(f)).toEqual(['p1.pl', 'p2.pl', 'p3.pl'])
    f = toggleSlotFilterValue(f, 'num', 'du')
    expect(labels(f)).toEqual(['p1.du', 'p1.pl', 'p2.du', 'p2.pl', 'p3.du', 'p3.pl'])
    f = toggleSlotFilterValue(f, 'person', 'p3')
    expect(labels(f)).toEqual(['p3.du', 'p3.pl'])
  })

  it('再点一次就去掉；一个维度一个都不剩就不按它筛', () => {
    let f = toggleSlotFilterValue(NO_SLOT_FILTER, 'num', 'pl')
    f = toggleSlotFilterValue(f, 'num', 'pl')
    expect(f.values).toEqual({})
    expect(slotFilterActive(f)).toBe(false)
  })

  it('只看启用的、只看停用的', () => {
    const off = [key(['person', 'p1'], ['num', 'sg']), key(['person', 'p2'], ['num', 'sg'])]
    expect(labels({ state: 'off', values: {} }, off)).toEqual(['p1.sg', 'p2.sg'])
    expect(labels({ state: 'on', values: {} }, off)).toHaveLength(7)
    // 跟取值一起用
    expect(labels({ state: 'on', values: { num: ['sg'] } }, off)).toEqual(['p3.sg'])
  })

  it('少了某个维度的格（加维度之前留下的），按那个维度筛时不算满足', () => {
    const p = para(['person', 'num'], {
      generators: { [key(['person', 'p1'])]: { kind: 'table', forms: {} } as never }
    })
    const all = paradigmSlots(p, cats, ['en'], true)
    const old = all.find((s) => s.key === key(['person', 'p1']))!
    expect(old).toBeTruthy()
    expect(slotPasses(old, { state: 'all', values: { num: ['sg'] } }, new Set())).toBe(false)
    expect(slotPasses(old, { state: 'all', values: { person: ['p1'] } }, new Set())).toBe(true)
  })

  it('漏斗里列构形的维度，取值只列用得上的', () => {
    const dims = slotFilterDims(slots, ['person', 'num'], cats)
    expect(dims.map((d) => d.id)).toEqual(['person', 'num'])
    expect(dims[1].valueIds).toEqual(['sg', 'du', 'pl'])
    // 换了先后就按构形里的先后
    expect(slotFilterDims(slots, ['num', 'person'], cats).map((d) => d.id)).toEqual([
      'num',
      'person'
    ])
  })

  it('维度去掉、取值删了之后，筛选里的旧条件不算数', () => {
    const f: SlotFilter = { state: 'on', values: { num: ['pl', 'gone'], tense: ['past'] } }
    const dims = slotFilterDims(slots, ['person', 'num'], cats)
    const pruned = pruneSlotFilter(f, dims)
    expect(pruned).toEqual({ state: 'on', values: { num: ['pl'] } })
    // 没变就原样返回（页面上不会因此重算）
    expect(pruneSlotFilter(pruned, dims)).toBe(pruned)
  })
})
