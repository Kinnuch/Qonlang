/**
 * 整个项目导出成一个 CSV 再读回来：示例项目逐字段一样；空字符串、没有这个字段、null 分得清；
 * 超长的格子分段；在表格软件里加的行（id 空着）也读得回来。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseCsv, toCsv } from '$lib/core/csv'
import { parseProject } from '$lib/core/serialize'
import { isProjectCsv, projectFromCsv, projectToCsv } from '$lib/core/projectCsv'

const example = (name: string): ReturnType<typeof parseProject> =>
  parseProject(readFileSync(join(__dirname, '..', '..', 'examples', name), 'utf8'))

describe('project csv', () => {
  it.each(['Aelith.laim.json', 'Tsahun.laim.json'])('round-trips %s exactly', (name) => {
    const p = example(name)
    const csv = '﻿' + projectToCsv(p)
    expect(isProjectCsv(csv)).toBe(true)
    expect(projectFromCsv(csv)).toStrictEqual(p)
  })

  it('keeps empty, missing and null apart and splits very long cells', () => {
    const p = example('Tsahun.laim.json')
    const [a, b, c, d] = p.lexemes
    a.paradigmId = null
    delete b.paradigmId
    c.notes = ''
    a.notes = 'x'.repeat(70000)
    d.notes = '@@chunk:1 看起来像分段引用的普通文字'
    p.abbreviations.push({ abbr: ' ', name: {} })
    const csv = projectToCsv(p)
    expect(parseCsv(csv, ',').rows.every((r) => r.every((cell) => cell.length <= 30000))).toBe(true)
    expect(projectFromCsv(csv)).toStrictEqual(p)
  })

  it('reads back a row added in a spreadsheet without an id', () => {
    const p = example('Tsahun.laim.json')
    const rows = parseCsv(projectToCsv(p), ',').rows
    const at = rows.findIndex((r) => r[0] === '#table' && r[1] === 'lexemes')
    const header = rows[at + 1]
    const copy = [...rows[at + 2]]
    copy[header.indexOf('id')] = ''
    copy[header.indexOf('lemma')] = 'qa-new'
    copy[header.indexOf('~language')] = '随便写'
    rows.splice(at + 3, 0, copy)
    const q = projectFromCsv(toCsv(rows))
    expect(q.lexemes).toHaveLength(p.lexemes.length + 1)
    expect(q.lexemes.find((l) => l.lemma === 'qa-new')?.id).toBeTruthy()
  })

  it('refuses files that are not project csv', () => {
    expect(isProjectCsv('lemma,pos')).toBe(false)
    expect(() => projectFromCsv('lemma,pos\nkala,n.')).toThrow()
  })
})
