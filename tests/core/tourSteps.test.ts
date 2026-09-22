/**
 * 图文引导的步骤表：选择器要稳（别挨着会变的文字与位置下标）、要跳的模块与子页要写对。
 * 界面上真有没有这个元素只能在软件里点，这里卡住的是能静态查出来的那些错。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { TOUR_STEPS } from '$lib/core/tourSteps'

/** 导航上的模块（ui.svelte.ts 里的 SECTIONS；那个文件用了 runes，测试里不能 import） */
const SECTIONS = [
  'languages',
  'phonology',
  'script',
  'soundChanges',
  'morphemes',
  'lexicon',
  'paradigms',
  'corpus',
  'phrasebook',
  'docs',
  'skin',
  'settings'
]

const root = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const steps = Object.entries(TOUR_STEPS)

describe('tour steps', () => {
  it('has a usable selector on every step', () => {
    const bad: string[] = []
    for (const [section, list] of steps)
      list.forEach((s, i) => {
        if (!s.selector.trim()) bad.push(`${section}.${i} 空选择器`)
        // :nth-child / :nth-of-type 这类按位置数的：加一个按钮就指错了
        if (/:nth-|:first-child|:last-child/.test(s.selector)) bad.push(`${section}.${i} 按位置数`)
      })
    expect(bad).toEqual([])
  })

  it('only jumps to real sections', () => {
    const bad: string[] = []
    for (const [section, list] of steps)
      list.forEach((s, i) => {
        if (s.go && !SECTIONS.includes(s.go)) bad.push(`${section}.${i} → ${s.go}`)
        // 要切子页就得先说清楚是哪个模块的子页
        if (s.view && !s.go) bad.push(`${section}.${i} 有 view 没有 go`)
      })
    expect(bad).toEqual([])
  })

  it('每个模块讲够几步（少于 4 步多半是漏讲了）', () => {
    expect(steps.filter(([, list]) => list.length < 4).map(([s]) => s)).toEqual([])
  })

  // data-tour 是界面上专门给引导留的记号：写错一个字母就白等一轮再居中显示
  it('finds every data-tour anchor in the source', () => {
    const src = walk(join(root)).join('\n')
    const missing: string[] = []
    for (const [section, list] of steps)
      list.forEach((s, i) => {
        const m = /^\[data-tour="([^"]+)"\]$/.exec(s.selector)
        if (m && !src.includes(`data-tour="${m[1]}"`) && !src.includes(`tour="${m[1]}"`))
          missing.push(`${section}.${i} → ${m[1]}`)
      })
    expect(missing).toEqual([])
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.svelte$/.test(name)) out.push(readFileSync(p, 'utf8'))
  }
  return out
}
