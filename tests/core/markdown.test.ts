/**
 * Markdown 表格：格子里写 \\| 的竖线是内容，不当分隔（规则语法文档里 th|θ 那一行）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { mdToHtml } from '$lib/core/markdown'

describe('markdown tables', () => {
  it('keeps an escaped pipe inside one cell', () => {
    const md = ['| 写法 | 意思 |', '|---|---|', '| `th\\|θ` | 多合字母 |'].join('\n')
    const html = mdToHtml(md)
    expect(html).toContain('<code>th|θ</code>')
    expect((html.match(/<td>/g) ?? []).length).toBe(2)
  })

  it('still splits ordinary cells', () => {
    const html = mdToHtml(['| a | b | c |', '|---|---|---|', '| 1 | 2 | 3 |'].join('\n'))
    expect((html.match(/<th>/g) ?? []).length).toBe(3)
    expect((html.match(/<td>/g) ?? []).length).toBe(3)
  })

  it('renders the rule syntax doc without breaking that row', () => {
    const doc = join(__dirname, '..', '..', 'src/renderer/src/assets/docs/rule-syntax.zh.md')
    expect(mdToHtml(readFileSync(doc, 'utf8'))).toContain('<code>th|θ</code>')
  })
})
