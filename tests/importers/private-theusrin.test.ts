/**
 * 本机私有回归：用户的瑟乌丝林语五张 CSV（不入库）。
 * 无损标准：每个非空单元格的内容都能在导入后的记录 JSON 里原样找到。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseCsv } from '$lib/core/csv'
import { createProject } from '$lib/core/factory'
import {
  applyCsvImport,
  defaultMapping,
  type CsvMapping,
  type FieldSpec,
  splitSenseText
} from '$lib/importers/csvImport'

const dir = join(__dirname, '..', 'fixtures', 'private')
const has = existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.csv'))

const H_FIELDS: Record<string, FieldSpec> = {
  原始希克林语: { kind: 'protoForm' },
  释义: { kind: 'definition', lang: 'zh' },
  备注: { kind: 'notes' },
  名词类别: { kind: 'feature', category: '名词类别' },
  重音类别: { kind: 'feature', category: '重音类别' },
  字典形: { kind: 'lemma' },
  强形: { kind: 'stem', name: '强形' },
  弱形: { kind: 'stem', name: '弱形' },
  '（中形）': { kind: 'stem', name: '中形' },
  及物格: { kind: 'form', slot: '及物格' },
  不及物格: { kind: 'form', slot: '不及物格' },
  欠格: { kind: 'form', slot: '欠格' },
  斜格: { kind: 'form', slot: '斜格' },
  复数: { kind: 'form', slot: '复数' }
}
const L_FIELDS: Record<string, FieldSpec> = {
  原始希克林语: { kind: 'protoForm' },
  释义: { kind: 'definition', lang: 'zh' },
  前缀点: { kind: 'notes' },
  动词类别: { kind: 'feature', category: '动词类别' },
  '字典形/无焦点形': { kind: 'lemma' },
  强焦点形: { kind: 'form', slot: '强焦点形' },
  弱焦点形: { kind: 'form', slot: '弱焦点形' },
  弱失焦形: { kind: 'form', slot: '弱失焦形' },
  强失焦形: { kind: 'form', slot: '强失焦形' },
  词干元音: { kind: 'stem', name: '词干元音' },
  副动词型: { kind: 'form', slot: '副动词型' },
  动名词: { kind: 'form', slot: '动名词' },
  动形词: { kind: 'form', slot: '动形词' },
  动副词: { kind: 'form', slot: '动副词' }
}
const X_FIELDS: Record<string, FieldSpec> = {
  原始希克林语: { kind: 'protoForm' },
  释义: { kind: 'definition', lang: 'zh' },
  备注: { kind: 'notes' },
  来源类型: { kind: 'feature', category: '来源类型' },
  字典形: { kind: 'lemma' },
  复数: { kind: 'form', slot: '复数' }
}

function mappingFor(
  header: string[],
  fields: Record<string, FieldSpec>,
  languageId: string,
  target: CsvMapping['target']
): CsvMapping {
  const m = defaultMapping(languageId, header.length)
  m.target = target
  m.columns = header.map((h) => fields[h.trim()] ?? { kind: 'ignore' })
  return m
}

/** 特征存的是 ID，比对前把取值名解析出来附在 JSON 后面 */
function resolvedJson(
  project: ReturnType<typeof createProject>,
  record: { features?: Record<string, string> }
): string {
  const names = Object.entries(record.features ?? {}).map(([cid, vid]) => {
    const cat = project.categories.find((c) => c.id === cid)
    const val = cat?.values.find((v) => v.id === vid)
    return val ? Object.values(val.name).join('|') : ''
  })
  return JSON.stringify(record) + '\n' + JSON.stringify(names)
}

function assertLossless(
  project: ReturnType<typeof createProject>,
  rows: string[][],
  header: string[],
  fields: Record<string, FieldSpec>,
  records: unknown[],
  keyName: string
): void {
  const keyIdx = header.findIndex((h) => fields[h.trim()]?.kind === 'lemma')
  const data = rows.slice(1).filter((r) => (r[keyIdx] ?? '').trim())
  expect(records).toHaveLength(data.length)
  data.forEach((row, i) => {
    const json = resolvedJson(project, records[i] as { features?: Record<string, string> })
    header.forEach((h, ci) => {
      const spec = fields[h.trim()]
      if (!spec || spec.kind === 'ignore') return
      const v = (row[ci] ?? '').trim()
      if (!v) return
      // 释义会按分号拆成多个义项，逐段核对
      const parts = spec.kind === 'definition' ? splitSenseText(v) : [v]
      for (const part of parts) {
        const needle = JSON.stringify(part).slice(1, -1)
        expect(json, `${keyName} 第 ${i + 2} 行「${h}」= ${v}`).toContain(needle)
      }
    })
  })
}

describe.skipIf(!has)('Theusrin CSV (private)', () => {
  const read = (name: string): string[][] => parseCsv(readFileSync(join(dir, name), 'utf8')).rows
  const p = createProject({
    name: 'Thsr',
    template: 'family',
    appVersion: '0',
    uiLocale: 'zh',
    familyNames: { proto: 'PSkr', daughters: ['Theusrin'] }
  })
  const proto = p.languages[0].id
  const tsr = p.languages[1].id

  it('nouns (H) import losslessly', () => {
    const rows = read('瑟乌丝林语词表 - Thsr H..csv')
    const r = applyCsvImport(p, rows, mappingFor(rows[0], H_FIELDS, tsr, 'lexemes'))
    const nouns = p.lexemes.filter((l) => l.languageId === tsr)
    assertLossless(p, rows, rows[0], H_FIELDS, nouns, 'H')
    expect(r.newCategories).toEqual(['名词类别', '重音类别'])
    expect(r.created).toBeGreaterThan(800)
  })

  it('verbs (L) import losslessly', () => {
    const rows = read('瑟乌丝林语词表 - Thsr L..csv')
    const before = p.lexemes.length
    applyCsvImport(p, rows, mappingFor(rows[0], L_FIELDS, tsr, 'lexemes'))
    assertLossless(p, rows, rows[0], L_FIELDS, p.lexemes.slice(before), 'L')
  })

  it('adjectives (X) import losslessly', () => {
    const rows = read('瑟乌丝林语词表 - Thsr X..csv')
    const before = p.lexemes.length
    applyCsvImport(p, rows, mappingFor(rows[0], X_FIELDS, tsr, 'lexemes'))
    assertLossless(p, rows, rows[0], X_FIELDS, p.lexemes.slice(before), 'X')
  })

  it('proto roots (PSkr) import as morphemes losslessly', () => {
    const rows = read('瑟乌丝林语词表 - PSkr.csv')
    const fields: Record<string, FieldSpec> = {
      词根: { kind: 'lemma' },
      释义: { kind: 'definition', lang: 'zh' },
      备注: { kind: 'notes' },
      词性: { kind: 'tags' }
    }
    const m = mappingFor(rows[0], fields, proto, 'morphemes')
    const r = applyCsvImport(p, rows, m)
    expect(r.created).toBeGreaterThan(1200)
    const keyIdx = 0
    const data = rows.slice(1).filter((x) => (x[keyIdx] ?? '').trim())
    expect(p.morphemes).toHaveLength(data.length)
    data.forEach((row, i) => {
      const json = JSON.stringify(p.morphemes[i])
      for (const v of row.slice(0, 3))
        if (v.trim()) expect(json).toContain(JSON.stringify(v.trim()).slice(1, -1))
    })
  })
})
