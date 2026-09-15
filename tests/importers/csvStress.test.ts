/**
 * CSV 的「对重音影响」一列：写法认得出、导出再导回来原样。
 */
import { describe, it, expect } from 'vitest'
import { parseCsv, toCsv } from '$lib/core/csv'
import { createLexeme, createMorpheme, createProject, newId } from '$lib/core/factory'
import {
  applyCsvImport,
  defaultMapping,
  formatStressCell,
  guessMapping,
  lexemesToRows,
  morphemesToRows,
  parseStressCell
} from '$lib/importers/csvImport'

const blank = (): ReturnType<typeof createProject> => {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  p.posList.push({
    id: newId(),
    name: { zh: '名词', en: 'noun' },
    abbr: 'n.',
    paradigmId: null,
    stemSlots: []
  })
  return p
}

describe('对重音影响的一格', () => {
  it('中英文写法都认', () => {
    expect(parseStressCell('词性, 倒数第1')).toEqual({
      affects: true,
      passPos: true,
      passSpecial: true,
      special: -1
    })
    expect(parseStressCell('特殊:2')).toMatchObject({
      passPos: false,
      passSpecial: true,
      special: 2
    })
    expect(parseStressCell('不重读')).toMatchObject({ passSpecial: true, special: 0 })
    expect(parseStressCell('pos special:-2')).toMatchObject({ passPos: true, special: -2 })
    expect(parseStressCell('第3个音节')).toMatchObject({ special: 3 })
    expect(parseStressCell('随便')).toBeNull()
    const p = blank()
    expect(parseStressCell('算作:名词', p.posList)).toMatchObject({
      passPos: true,
      posId: p.posList[0].id
    })
  })
  it('词条导出再导回来', () => {
    const p = blank()
    const l = createLexeme(p.languages[0].id, 'katana')
    l.stress = { affects: true, passPos: true, passSpecial: true, special: -2 }
    const plain = createLexeme(p.languages[0].id, 'sepe')
    p.lexemes.push(l, plain)
    const rows = parseCsv(toCsv(lexemesToRows(p, p.lexemes, ['zh']))).rows
    expect(rows[0]).toContain('stress')
    expect(rows[1][rows[0].indexOf('stress')]).toBe('pos, special:-2')
    const q = blank()
    const m = guessMapping(rows[0], defaultMapping(q.languages[0].id, rows[0].length))
    applyCsvImport(q, rows, m)
    expect(q.lexemes.find((x) => x.lemma === 'katana')?.stress).toEqual(l.stress)
    expect(q.lexemes.find((x) => x.lemma === 'sepe')?.stress).toBeUndefined()
    // 没人勾过就没有这一列
    expect(lexemesToRows(p, [plain], ['zh'])[0]).not.toContain('stress')
  })
  it('语素导出再导回来，带「算作」的词类', () => {
    const p = blank()
    const mo = createMorpheme(p.languages[0].id, 'suffix')
    mo.form = '-na'
    mo.stress = {
      affects: true,
      passPos: true,
      passSpecial: true,
      special: 1,
      posId: p.posList[0].id
    }
    expect(formatStressCell(mo.stress, p.posList)).toBe('pos, special:1, as:名词')
    const rows = parseCsv(toCsv(morphemesToRows([mo], ['zh'], p.posList))).rows
    const q = blank()
    const m = guessMapping(rows[0], defaultMapping(q.languages[0].id, rows[0].length))
    m.target = 'morphemes'
    applyCsvImport(q, rows, m)
    expect(q.morphemes[0].stress).toEqual({ ...mo.stress, posId: q.posList[0].id })
  })
})
