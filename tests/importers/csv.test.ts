import { describe, it, expect } from 'vitest'
import { parseCsv, detectDelimiter, toCsv } from '$lib/core/csv'
import { makeCollator } from '$lib/core/collate'
import { createProject } from '$lib/core/factory'
import { applyCsvImport, defaultMapping, guessMapping } from '$lib/importers/csvImport'

describe('csv parsing', () => {
  it('handles quotes, escaped quotes and newlines inside quotes', () => {
    const { rows } = parseCsv('a,b,c\n"x, y","he said ""hi""","line1\nline2"\n')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2']
    ])
  })
  it('detects delimiters and strips BOM', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(parseCsv('﻿a,b\n1,2').rows[0]).toEqual(['a', 'b'])
  })
  it('drops empty lines and roundtrips', () => {
    const rows = [
      ['a', 'b,c'],
      ['"q"', '']
    ]
    expect(parseCsv(toCsv(rows)).rows).toEqual(rows)
  })
})

describe('collation', () => {
  it('orders by custom alphabet with multi-character graphemes', () => {
    const cmp = makeCollator(['a', 'th', 't', 'e'])
    expect(['te', 'the', 'ta', 'ae'].sort(cmp)).toEqual(['ae', 'the', 'ta', 'te'])
  })
  it('falls back to Unicode for unknown characters', () => {
    const cmp = makeCollator(['a', 'b'])
    expect(['z', 'b', 'a', 'ç'].sort(cmp)).toEqual(['a', 'b', 'z', 'ç'])
  })
})

describe('csv import', () => {
  const rows = [
    ['词头', '词类', '释义', '标签', '原始形', '名词类别'],
    ['kama', '名词', '房子', '基础,常用', 'kam-a', '核心'],
    ['thal', '动词', '看见', '', '', ''],
    ['', '名词', '孤儿行', '', '', ''],
    ['kama', '名词', '重复', '', '', '']
  ]
  it('guesses a mapping from headers', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
    const m = guessMapping(rows[0], defaultMapping(p.languages[0].id, 6))
    expect(m.columns.map((c) => c.kind)).toEqual([
      'lemma',
      'pos',
      'definition',
      'tags',
      'protoForm',
      'ignore'
    ])
  })
  it('creates lexemes, parts of speech and categories; reports skips and duplicates', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
    const m = guessMapping(rows[0], defaultMapping(p.languages[0].id, 6))
    m.columns[5] = { kind: 'feature', category: '名词类别' }
    const r = applyCsvImport(p, rows, m)
    expect(r.created).toBe(3)
    expect(r.skipped).toBe(1)
    expect(r.duplicates).toEqual(['kama'])
    expect(r.newPos).toEqual(['名词', '动词'])
    expect(r.newCategories).toEqual(['名词类别'])
    const kama = p.lexemes[0]
    expect(kama.lemma).toBe('kama')
    expect(kama.senses[0].definition.zh).toBe('房子')
    expect(kama.tags).toEqual(['基础', '常用'])
    expect(kama.etymology.protoForm).toBe('kam-a')
    expect(Object.keys(kama.features)).toHaveLength(1)
    expect(p.posList.find((x) => x.id === kama.posId)?.name.zh).toBe('名词')
  })
  it('imports morphemes with type aliases and > splitting', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
    const m = defaultMapping(p.languages[0].id, 3)
    m.target = 'morphemes'
    m.hasHeader = false
    m.columns = [{ kind: 'lemma' }, { kind: 'morphemeType' }, { kind: 'definition', lang: 'zh' }]
    m.splitProtoArrow = true
    const r = applyCsvImport(
      p,
      [
        ['KAM', '词根', '住所'],
        ['-a', 'suffix', '名词化'],
        ['seuk-ren > sokren', '词根', '白发']
      ],
      m
    )
    expect(r.created).toBe(3)
    expect(p.morphemes.map((x) => [x.form, x.type])).toEqual([
      ['KAM', 'root'],
      ['-a', 'suffix'],
      ['sokren', 'root']
    ])
    expect(p.morphemes[2].notes).toBe('')
  })
})
