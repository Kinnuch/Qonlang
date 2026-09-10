import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { mdToHtml } from '$lib/core/markdown'
import { parseProject } from '$lib/core/serialize'
import { createLanguage, createLexeme, createRuleSet } from '$lib/core/factory'
import { parseRuleText } from '$lib/engine/sca'
import { planEvolution, applyEvolution } from '$lib/engine/evolve'
import {
  dictionaryHtml,
  dictionaryMarkdown,
  renderEntries,
  collectEntries
} from '$lib/export/dictionary'
import type { Project } from '$lib/core/model'

describe('markdown', () => {
  it('renders headings, lists, tables, code and wiki links', () => {
    const html = mdToHtml(
      '# T\n\n- a\n- **b**\n\n| x | y |\n| --- | --- |\n| 1 | `2` |\n\n```\ncode <x>\n```\n\n> q\n\n[[kaso]] [[zzz|Z]] [site](https://a.b)',
      { resolve: (n) => (n === 'kaso' ? 'id1' : null) }
    )
    expect(html).toContain('<h2>T</h2>')
    expect(html).toContain('<ul><li>a</li><li><strong>b</strong></li></ul>')
    expect(html).toContain(
      '<table><thead><tr><th>x</th><th>y</th></tr></thead><tbody><tr><td>1</td><td><code>2</code></td></tr></tbody></table>'
    )
    expect(html).toContain('<pre><code>code &lt;x&gt;</code></pre>')
    expect(html).toContain('<blockquote><p>q</p></blockquote>')
    expect(html).toContain('data-lexeme="id1"')
    expect(html).toContain('<span class="wl missing">Z</span>')
    expect(html).toContain('href="https://a.b"')
  })
})

describe('evolution', () => {
  function setup() {
    const proto = createLanguage({ name: 'Proto' })
    const daughter = createLanguage({ name: 'Daughter', parentId: proto.id })
    const rs = createRuleSet('P > D', '-* P\np > f\n-* D')
    rs.stageLanguages = { P: proto.id, D: daughter.id }
    const project = parseProject(
      JSON.stringify({
        schemaVersion: 1,
        meta: { name: 'x' },
        languages: [proto, daughter],
        ruleSets: [rs]
      })
    ) as Project
    const a = createLexeme(proto.id, 'pata')
    a.senses[0].definition = { en: 'foot' }
    const b = createLexeme(proto.id, 'kama')
    project.lexemes.push(a, b)
    const program = parseRuleText(rs.text)
    return { project, proto, daughter, rs, program, a }
  }
  it('plans, creates with etymology, then updates instead of duplicating', () => {
    const { project, proto, daughter, rs, program, a } = setup()
    const o = { ruleSet: rs, program, sourceLanguageId: proto.id, targetLanguageId: daughter.id }
    const rows = planEvolution(project, o)
    expect(rows.map((r) => [r.input, r.output, r.action])).toEqual([
      ['pata', 'fata', 'create'],
      ['kama', 'kama', 'create']
    ])
    const r1 = applyEvolution(project, rows, o, {
      copySenses: true,
      updateExisting: true,
      createOnCollision: false
    })
    expect(r1).toEqual({ created: 2, updated: 0, skipped: 0 })
    const d = project.lexemes.find((l) => l.languageId === daughter.id && l.lemma === 'fata')!
    expect(d.etymology.type).toBe('inherited')
    expect(d.etymology.sources).toEqual([{ kind: 'lexeme', id: a.id }])
    expect(d.senses[0].definition.en).toBe('foot')
    // 改规则后再演化：已派生的词更新词头而不是重复建
    const program2 = parseRuleText('-* P\np > h\n-* D')
    const rows2 = planEvolution(project, { ...o, program: program2 })
    expect(rows2.map((r) => r.action)).toEqual(['update', 'same'])
    const r2 = applyEvolution(
      project,
      rows2,
      { ...o, program: program2 },
      { copySenses: true, updateExisting: true, createOnCollision: false }
    )
    expect(r2.updated).toBe(1)
    expect(d.lemma).toBe('hata')
    expect(project.lexemes.filter((l) => l.languageId === daughter.id)).toHaveLength(2)
  })
  it('respects stage bounds', () => {
    const { project, proto, daughter, rs, program } = setup()
    const rows = planEvolution(project, {
      ruleSet: rs,
      program,
      sourceLanguageId: proto.id,
      targetLanguageId: daughter.id,
      stopAt: 'P'
    })
    expect(rows[0].output).toBe('pata')
  })
})

describe('dictionary export', () => {
  const p = parseProject(
    readFileSync(join(__dirname, '..', '..', 'examples', 'Aelith.laim.json'), 'utf8')
  )
  const L = p.languages.find((l) => l.name === 'Aelith')!
  const o = {
    title: 'Aelith',
    glossLangs: ['zh', 'en'],
    includeForms: true,
    includeEtymology: true,
    includeScript: true,
    includeNotes: false,
    groupByInitial: true
  }
  it('collects sorted entries with script and senses', () => {
    const es = collectEntries(p, L, o)
    expect(es.length).toBeGreaterThan(10)
    const kaso = es.find((e) => e.lemma === 'kaso')!
    expect(kaso.senses[0].text).toBe('房子')
    expect(kaso.script).toBe('ᚲᚨᛊᛟ')
  })
  it('renders html, markdown and templates', () => {
    expect(dictionaryHtml(p, L, o)).toContain('<span class="lemma">kaso</span>')
    expect(dictionaryMarkdown(p, L, o)).toContain('**kaso**')
    const out = renderEntries(p, L, '{{lemma}}|{{#senses}}{{n}}.{{text}};{{/senses}}', o)
    expect(out.split('\n').find((l) => l.startsWith('kaso|'))).toBe(
      'kaso|1.房子;2.house;3.家；家庭;4.home; household;'
    )
  })
})
