import { describe, it, expect } from 'vitest'
import {
  allTextEntries,
  flattenDict,
  groupsOf,
  paramsMatch,
  paramsOf
} from '../../src/renderer/src/lib/i18n/keys'
import zh from '../../src/renderer/src/lib/i18n/zh'

describe('界面翻译：可翻译条目', () => {
  it('嵌套对象与数组都拍平成点号路径', () => {
    const flat = flattenDict({ a: '一', b: { c: '二', d: ['三', '四'] } })
    expect(flat).toEqual({ a: '一', 'b.c': '二', 'b.d.0': '三', 'b.d.1': '四' })
  })

  it('拍平的条数跟 zh.ts 里的文案一样多，键都能找回去', () => {
    const entries = allTextEntries()
    expect(entries.length).toBeGreaterThan(2000)
    const flat = flattenDict(zh)
    for (const e of entries) expect(flat[e.key]).toBe(e.source)
  })

  it('按第一段归类，导航那一类在里面', () => {
    const groups = groupsOf(allTextEntries())
    expect(groups.some((g) => g.group === 'nav')).toBe(true)
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(allTextEntries().length)
  })

  it('占位符：认得出来，译文少一个就算不对', () => {
    expect(paramsOf('导入了 {n} 条，跳过 {skipped} 条')).toEqual(['{n}', '{skipped}'])
    expect(paramsMatch('已删除 {n} 条', 'Deleted {n}')).toBe(true)
    expect(paramsMatch('已删除 {n} 条', 'Deleted')).toBe(false)
    // 还没译的不算错
    expect(paramsMatch('已删除 {n} 条', '')).toBe(true)
  })
})
