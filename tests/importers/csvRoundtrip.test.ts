/**
 * 导出的 CSV 直接导回来：义项、语域、标签、语素的意义都在。
 */
import { describe, it, expect } from 'vitest'
import { parseCsv, toCsv } from '$lib/core/csv'
import { createLexeme, createMorpheme, createProject, createSense } from '$lib/core/factory'
import {
  applyCsvImport,
  defaultMapping,
  findMarkers,
  guessMapping,
  lexemesToRows,
  morphemesToRows
} from '$lib/importers/csvImport'

const blank = (): ReturnType<typeof createProject> =>
  createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })

describe('CSV 导出再导入', () => {
  it('词条：义项用分号分开，语域写成【语域】，导回来原样', () => {
    const p = blank()
    const l = createLexeme(p.languages[0].id, 'kala')
    l.senses[0].definition = { zh: '宅第' }
    l.senses[0].register = '古语'
    l.senses.push({ ...createSense(), definition: { zh: '房屋' } })
    l.tags = ['基础']
    p.lexemes.push(l)
    const rows = parseCsv(toCsv(lexemesToRows(p, p.lexemes, ['zh']))).rows
    expect(rows[1][2]).toBe('【古语】宅第；房屋')

    const q = blank()
    const m = guessMapping(rows[0], defaultMapping(q.languages[0].id, rows[0].length))
    m.senseMarkers = Object.fromEntries(
      findMarkers(rows, m).map((st) => [st.label, { action: 'register', value: st.label }])
    )
    applyCsvImport(q, rows, m)
    const back = q.lexemes[0]
    expect(back.lemma).toBe('kala')
    expect(back.senses.map((s) => [s.definition.zh, s.register])).toEqual([
      ['宅第', '古语'],
      ['房屋', '']
    ])
    expect(back.tags).toEqual(['基础'])
  })

  it('语素：meaning_zh 这类带语言代码的列自动认成意义', () => {
    const p = blank()
    const mo = createMorpheme(p.languages[0].id, 'suffix')
    mo.form = '-lar'
    mo.gloss = 'PL'
    mo.meaning = { zh: '复数' }
    const rows = parseCsv(toCsv(morphemesToRows([mo], ['zh']))).rows
    const q = blank()
    const m = guessMapping(rows[0], defaultMapping(q.languages[0].id, rows[0].length))
    m.target = 'morphemes'
    applyCsvImport(q, rows, m)
    expect(q.morphemes[0]).toMatchObject({
      form: '-lar',
      type: 'suffix',
      gloss: 'PL',
      meaning: { zh: '复数' }
    })
  })
})
