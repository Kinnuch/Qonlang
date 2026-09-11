/**
 * 检视器模块：存盘读回与项目 CSV 往返、按标题或别名找、按语言限定、CSV 按列名对上（没有的新建）、导出再导回。
 */
import { describe, it, expect } from 'vitest'
import { createCustomField, createLexeme, createProject } from '$lib/core/factory'
import { parseProject, serializeProject } from '$lib/core/serialize'
import { projectFromCsv, projectToCsv } from '$lib/core/projectCsv'
import {
  customFieldsFor,
  customItems,
  findCustomField,
  setCustomValue
} from '$lib/core/customFields'
import {
  applyCsvImport,
  defaultMapping,
  guessMapping,
  lexemesToRows
} from '$lib/importers/csvImport'

function make() {
  const p = createProject({ name: 't', template: 'blank', appVersion: '', uiLocale: 'zh' })
  const variants = createCustomField({ zh: '异体字', en: 'Variants' })
  variants.kind = 'list'
  variants.aliases = ['variant forms']
  const note = createCustomField({ zh: '文化注释' })
  note.position = 'end'
  note.languageIds = ['another-language']
  p.customFields.push(variants, note)
  return { p, variants, note }
}

describe('inspector modules', () => {
  it('survive saving, loading and the project CSV; older files get an empty list', () => {
    const { p, variants } = make()
    const lx = createLexeme(p.languages[0].id, 'kalo')
    setCustomValue(lx, variants.id, 'kalo、kallo')
    p.lexemes.push(lx)
    expect(parseProject(serializeProject(p))).toEqual(p)
    expect(projectFromCsv(projectToCsv(p))).toEqual(p)
    const old = JSON.parse(serializeProject(p))
    delete old.customFields
    expect(parseProject(JSON.stringify(old)).customFields).toEqual([])
    setCustomValue(lx, variants.id, '  ')
    expect(lx.custom).toBeUndefined()
  })

  it('are found by title or alias and limited to their languages', () => {
    const { p, variants, note } = make()
    expect(findCustomField(p.customFields, 'variants')).toBe(variants)
    expect(findCustomField(p.customFields, 'Variant Forms')).toBe(variants)
    expect(findCustomField(p.customFields, '文化注释')).toBe(note)
    expect(customFieldsFor(p, p.languages[0].id)).toEqual([variants])
    expect(customItems('a、b, c；d\ne')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('take CSV columns by name, get created when missing and round-trip the export', () => {
    const { p, variants } = make()
    const rows = [
      ['word', '异体字', 'origin story'],
      ['kalo', 'kallo、qalo', 'first told by fishers']
    ]
    const m = guessMapping(rows[0], defaultMapping(p.languages[0].id, 3), p.customFields)
    expect(m.columns[1]).toEqual({ kind: 'custom', name: '异体字' })
    m.columns[2] = { kind: 'custom', name: 'origin story' }
    const report = applyCsvImport(p, rows, m)
    expect(report.newCustomFields).toEqual(['origin story'])
    const story = p.customFields.find((f) => f.name.zh === 'origin story')!
    expect(p.lexemes[0].custom).toEqual({
      [variants.id]: 'kallo、qalo',
      [story.id]: 'first told by fishers'
    })
    // 导出的列名写标题，再导入时对得上
    const out = lexemesToRows(p, p.lexemes, p.settings.glossLanguages)
    const back = guessMapping(
      out[0],
      defaultMapping(p.languages[0].id, out[0].length),
      p.customFields
    )
    expect(back.columns.filter((c) => c.kind === 'custom')).toEqual([
      { kind: 'custom', name: '异体字' },
      { kind: 'custom', name: '文化注释' },
      { kind: 'custom', name: 'origin story' }
    ])
    expect(out[1].slice(-3)).toEqual(['kallo、qalo', '', 'first told by fishers'])
  })
})
