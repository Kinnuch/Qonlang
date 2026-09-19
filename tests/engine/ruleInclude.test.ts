/**
 * 音变引用另一套音变的一段：`-@ 规则集名 : 起始阶段 .. 终止阶段`。
 * 共用的那一段只写一遍，源头改了引用它的这边跟着变。
 */
import { describe, it, expect } from 'vitest'
import { parseRuleText, runRules } from '$lib/engine/sca'

/** 「共用」这套：a > b（PSkr 段）、b > c（中古段） */
const SHARED = ['-* PSkr', 'a > b / _', '-* 中古', 'b > c / _', '-* 现代', 'c > d / _'].join('\n')

const resolve = (name: string): { text: string } | null =>
  name === '共用' ? { text: SHARED } : null

describe('音变里引用另一套音变的一段', () => {
  it('整套引用：跑完被引用的全部规则', () => {
    const p = parseRuleText('-@ 共用\nd > e / _', { resolveInclude: resolve })
    expect(p.diagnostics).toEqual([])
    expect(runRules(p, 'a').output).toBe('e')
  })

  it('指定起止阶段：只跑那一段', () => {
    const p = parseRuleText('-@ 共用 : PSkr .. 中古', { resolveInclude: resolve })
    expect(p.diagnostics).toEqual([])
    expect(runRules(p, 'a').output).toBe('b')
  })

  it('引用来的阶段在这边也算数（快照与阶段名都有）', () => {
    const p = parseRuleText('-@ 共用 : PSkr .. 现代\n-* 自己的', {
      resolveInclude: resolve
    })
    expect(p.markers).toEqual(['PSkr', '中古', '现代', '自己的'])
    const r = runRules(p, 'a')
    expect(r.stages.map((s) => `${s.name}:${s.form}`)).toEqual([
      'PSkr:a',
      '中古:b',
      '现代:c',
      '自己的:c'
    ])
  })

  it('引用段里的规则也进轨迹，标着来自哪一套', () => {
    const p = parseRuleText('-@ 共用 : PSkr .. 中古', { resolveInclude: resolve })
    const r = runRules(p, 'a', { trace: true })
    expect(r.trace.length).toBe(1)
    expect(r.trace[0].ref).toBe('共用')
    expect(r.trace[0].target).toBe('a')
  })

  it('源头改了，引用它的这边跟着变', () => {
    const changed = (name: string): { text: string } | null =>
      name === '共用' ? { text: '-* PSkr\na > z / _\n-* 中古' } : null
    const p = parseRuleText('-@ 共用 : PSkr .. 中古', { resolveInclude: changed })
    expect(runRules(p, 'a').output).toBe('z')
  })

  it('引用的那套有自己的音类：按它自己的算', () => {
    const other = (name: string): { text: string } | null =>
      name === '别套' ? { text: 'V=ao\n-* 起\nV > i / _\n-* 止' } : null
    // 这边的 V 只有 e，引用段里的 V 仍然是 a o
    const p = parseRuleText('V=e\n-@ 别套 : 起 .. 止\nV > u / _', { resolveInclude: other })
    expect(runRules(p, 'kao').output).toBe('kii')
    expect(runRules(p, 'ke').output).toBe('ku')
  })

  it('写错了会报错：找不到那套、没有那个阶段、转圈引用', () => {
    const miss = parseRuleText('-@ 没有这套', { resolveInclude: resolve })
    expect(miss.diagnostics[0].message).toContain('找不到')
    const badStage = parseRuleText('-@ 共用 : 没这个阶段', { resolveInclude: resolve })
    expect(badStage.diagnostics[0].message).toContain('阶段')
    const loop = (name: string): { text: string } | null =>
      name === '甲' ? { text: '-@ 乙' } : name === '乙' ? { text: '-@ 甲' } : null
    const cyc = parseRuleText('-@ 甲', { resolveInclude: loop })
    expect(JSON.stringify(cyc.diagnostics)).toContain('转着圈')
  })
})
