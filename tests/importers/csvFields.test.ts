/**
 * CSV 导入能填到录入页面上的每一处：语言、方言、词源类别 / 来源（链到单词、语素）/ 中间态、关系、
 * 各正字法的发音、文字写法、构形与变体、带前缀的备注；语素的第二形式、异体形；释义开头的数字编码。
 * 例词都是随手编的，不对应任何一门语言。
 */
import { describe, it, expect } from 'vitest'
import {
  createLanguage,
  createLexeme,
  createMorpheme,
  createOrthography,
  createProject,
  createScript
} from '$lib/core/factory'
import type { Paradigm } from '$lib/core/model'
import {
  applyCsvImport,
  defaultMapping,
  etymologyTypeOf,
  findPrefixCodes,
  guessMapping,
  type CsvMapping,
  type FieldSpec
} from '$lib/importers/csvImport'

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  const lang = createLanguage({ name: '甲语', abbr: 'A' })
  const proto = createLanguage({ name: '古甲语', abbr: 'PA' })
  const translit = createOrthography('转写', false)
  lang.orthographies.push(translit)
  const script = createScript('甲文')
  lang.scripts.push(script)
  lang.dialects.push({ id: 'd-north', name: '北方', abbr: 'N' })
  p.languages = [lang, proto]
  p.posList = []
  const root = createLexeme(proto.id, 'kal')
  p.lexemes.push(root)
  const affix = createMorpheme(proto.id, 'suffix')
  affix.form = '-ri'
  p.morphemes.push(affix)
  return { p, lang, proto, translit, script, root, affix }
}
const mapping = (
  id: string,
  columns: FieldSpec[],
  extra: Partial<CsvMapping> = {}
): CsvMapping => ({
  ...defaultMapping(id, columns.length),
  columns,
  ...extra
})

describe('csv import fields', () => {
  it('fills etymology, dialects, relations, spellings and notes', () => {
    const { p, lang, root, affix, translit, script } = setup()
    const report = applyCsvImport(
      p,
      [
        ['word', 'from', 'PA', 'PAF', 'etym', 'dialect', 'syn', 'script', '转写', 'ref'],
        [
          'kala',
          'inherited',
          'kal ‘stone’ + ri + zo',
          'kalo',
          '古语里常见',
          '北方、南方',
          'tavi',
          '𐀀',
          'kála',
          '某书 12 页'
        ],
        ['tavi', '借词', '', '', '', 'N', 'kala、nothere', '', '', '']
      ],
      mapping(lang.id, [
        { kind: 'lemma' },
        { kind: 'etymologyType' },
        { kind: 'protoForm', language: 'PA' },
        { kind: 'etymologyStage', label: 'PAF' },
        { kind: 'etymologyNotes' },
        { kind: 'dialects' },
        { kind: 'relation', relKind: 'synonym' },
        { kind: 'scriptForm', script: '' },
        { kind: 'pronunciation', orthography: '转写' },
        { kind: 'notes', label: 'Ref' }
      ])
    )
    const kala = p.lexemes.find((l) => l.lemma === 'kala')!
    const tavi = p.lexemes.find((l) => l.lemma === 'tavi')!
    expect(kala.etymology.type).toBe('inherited')
    expect(kala.etymology.sources).toEqual([
      { kind: 'lexeme', id: root.id },
      { kind: 'morpheme', id: affix.id },
      { kind: 'external', language: '古甲语', form: 'zo', meaning: '' }
    ])
    expect(kala.etymology.stages.map((s) => [s.form, s.notes])).toEqual([['kalo', 'PAF']])
    expect(kala.etymology.notes).toBe('古语里常见')
    expect(lang.dialects.map((d) => d.name)).toEqual(['北方', '南方'])
    expect(report.newDialects).toEqual(['南方'])
    expect(kala.dialectIds[0]).toBe('d-north')
    expect(tavi.dialectIds).toEqual(['d-north'])
    expect(tavi.etymology.type).toBe('borrowing')
    expect(kala.relations).toEqual([{ kind: 'synonym', lexemeId: tavi.id }])
    expect(tavi.relations).toEqual([{ kind: 'synonym', lexemeId: kala.id }])
    expect(report.warnings.some((w) => w.includes('nothere'))).toBe(true)
    expect(kala.scriptForms[script.id]).toBe('𐀀')
    expect(kala.pronunciations[translit.id]).toEqual({ ipa: 'kála', irregular: true })
    expect(kala.notes).toBe('Ref: 某书 12 页')
  })

  it('puts rows into the language they name and picks paradigm and variant', () => {
    const { p, lang, proto } = setup()
    p.paradigms.push({
      id: 'pd',
      name: { zh: '名词变格' },
      variants: [{ id: 'v-old', name: '古式' }]
    } as unknown as Paradigm)
    const report = applyCsvImport(
      p,
      [
        ['word', 'lang', '构形', '变体'],
        ['kami', 'PA', '名词变格', '古式'],
        ['sumi', 'ZZ', '', '']
      ],
      mapping(lang.id, [
        { kind: 'lemma' },
        { kind: 'language' },
        { kind: 'paradigm' },
        { kind: 'paradigmVariant' }
      ])
    )
    const kami = p.lexemes.find((l) => l.lemma === 'kami')!
    expect(kami.languageId).toBe(proto.id)
    expect(kami.paradigmId).toBe('pd')
    expect(kami.paradigmVariantId).toBe('v-old')
    expect(p.lexemes.find((l) => l.lemma === 'sumi')?.languageId).toBe(lang.id)
    expect(report.warnings.some((w) => w.includes('ZZ'))).toBe(true)
  })

  it('fills morpheme second form, allomorphs and etymology', () => {
    const { p, lang, root } = setup()
    applyCsvImport(
      p,
      [
        ['form', 'type', 'form2', 'allo', 'from', 'proto'],
        ['-lar', 'suffix', '-ler', 'lar / _V；ler / Front_', 'derived', 'kal']
      ],
      mapping(
        lang.id,
        [
          { kind: 'lemma' },
          { kind: 'morphemeType' },
          { kind: 'form2' },
          { kind: 'allomorphs' },
          { kind: 'etymologyType' },
          { kind: 'protoForm', language: 'PA' }
        ],
        { target: 'morphemes' }
      )
    )
    const m = p.morphemes.find((x) => x.form === '-lar')!
    expect(m.form2).toBe('-ler')
    expect(m.allomorphs).toEqual([
      { form: 'lar', environment: '_V' },
      { form: 'ler', environment: 'Front_' }
    ])
    expect(m.etymology.type).toBe('derivation')
    expect(m.etymology.sources).toEqual([{ kind: 'lexeme', id: root.id }])
  })

  it('finds codes at the start of definitions and turns them into sense tags', () => {
    const { p, lang } = setup()
    const rows = [
      ['word', 'meaning'],
      ['keto', '1离开；2前往；01出发；2020年建成']
    ]
    const m = mapping(lang.id, [{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }])
    expect(findPrefixCodes(rows, m).map((s) => [s.code, s.count])).toEqual([
      ['0', 1],
      ['1', 2],
      ['2', 1]
    ])
    applyCsvImport(p, rows, {
      ...m,
      senseCodes: {
        1: { action: 'tag', value: '一价' },
        2: { action: 'tag', value: '二价' },
        0: { action: 'drop', value: '' }
      }
    })
    const keto = p.lexemes.find((l) => l.lemma === 'keto')!
    expect(keto.senses.map((s) => [s.definition.zh, s.tags])).toEqual([
      ['离开', ['一价']],
      ['前往', ['二价']],
      ['出发', ['一价']],
      ['2020年建成', []]
    ])
  })

  it('guesses the new columns and etymology type names', () => {
    const { lang } = setup()
    const g = guessMapping(
      ['语言', '方言', '词源类别', '同义词', '异体形', '中间态'],
      defaultMapping(lang.id, 6)
    )
    expect(g.columns).toEqual([
      { kind: 'language' },
      { kind: 'dialects' },
      { kind: 'etymologyType' },
      { kind: 'relation', relKind: 'synonym' },
      { kind: 'allomorphs' },
      { kind: 'etymologyStage' }
    ])
    expect(etymologyTypeOf('借词')).toBe('borrowing')
    expect(etymologyTypeOf('Loan')).toBe('borrowing')
    expect(etymologyTypeOf('神话')).toBe('神话')
  })
})
