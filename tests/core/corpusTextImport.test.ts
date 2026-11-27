import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from '$lib/core/csv'
import { splitTextLines } from '$lib/core/textLines'
import { parseTableText, splitForTableFile } from '$lib/importers/tableText'
import {
  importSentenceRecords,
  importSentencesJson,
  previewSentencesJson,
  rowsToRecords,
  sentenceFields,
  guessColumns,
  sentencesToJson
} from '$lib/importers/corpusIO'
import { createProject, createSentence } from '$lib/core/factory'
import { parseProject, serializeProject } from '$lib/core/serialize'
import { decodeTextFile } from '../../src/shared/text-file'

const breaks = ['\r\n', '\n', '\r', '\u000B', '\u000C', '\u0085', '\u2028', '\u2029']
const project = (): ReturnType<typeof createProject> =>
  createProject({ name: 'Import QA', template: 'blank', appVersion: '1', uiLocale: 'en' })

describe('外部语料文本行界', () => {
  it.each(breaks)('按统一行界拆非空纯文本 %j', (br) => {
    const raw = '\uFEFF  alpha  beta ' + br + br + '   ' + br + ' gamma δ ' + br
    expect(splitTextLines(raw)).toEqual(['alpha  beta', 'gamma δ'])
    const parsed = parseTableText(raw)
    expect(parsed).toEqual({ split: 'line', rows: [['alpha  beta'], ['gamma δ']] })
    const p = project(),
      languageId = p.languages[0].id
    const records = rowsToRecords(parsed.rows, ['text'])
    expect(importSentenceRecords(p, languageId, records).created).toBe(2)
    expect(p.sentences.map((s) => s.text)).toEqual(['alpha  beta', 'gamma δ'])
  })

  it('显式按行保留标点、引号与行内空格，不猜表头', () => {
    const text = '"alpha, bravo"\r"charlie, delta"'
    expect(parseTableText(text, 'line').rows).toEqual([['"alpha, bravo"'], ['"charlie, delta"']])
    expect(splitTextLines('  one line only  ')).toEqual(['one line only'])
    expect(splitTextLines('\uFEFF\r\n\r\u2028  ')).toEqual([])
  })

  it.each(breaks)('CSV只在引号外按行界分记录 %j', (br) => {
    const value = 'alpha' + br + 'beta'
    const source = '\uFEFFtext,English translation' + br + '"' + value + '",A' + br + 'gamma,B'
    const parsed = parseTableText(source)
    expect(parsed.split).toBe(',')
    expect(parsed.rows).toEqual([
      ['text', 'English translation'],
      [value, 'A'],
      ['gamma', 'B']
    ])
    const p = project(),
      languageId = p.languages[0].id
    const fields = sentenceFields(['en']),
      header = parsed.rows[0]
    const records = rowsToRecords(parsed.rows.slice(1), guessColumns(header, fields, 2), header)
    importSentenceRecords(p, languageId, records)
    expect(p.sentences.map((s) => s.text)).toEqual([value, 'gamma'])
    expect(parseCsv(toCsv([[value, 'x']]), ',').rows).toEqual([[value, 'x']])
  })

  it('按逻辑CSV记录检测分隔符，不让引号内多行干扰自动识别', () => {
    const source = 'text\ttranslation\r"a\nb\nc\nd"\t"one\ntwo"\rrest\tvalue'
    expect(parseTableText(source)).toEqual({
      split: '\t',
      rows: [
        ['text', 'translation'],
        ['a\nb\nc\nd', 'one\ntwo'],
        ['rest', 'value']
      ]
    })
    expect(parseCsv('"escaped ""quote""";next\rfinal;row', ';').rows).toEqual([
      ['escaped "quote"', 'next'],
      ['final', 'row']
    ])
  })

  it('选择文件的明确格式保留单列CSV引号内换行，txt默认按行', () => {
    const csv = 'text\r"alpha\rbeta"\rgamma'
    expect(parseTableText(csv, splitForTableFile('single.csv', csv)).rows).toEqual([
      ['text'],
      ['alpha\rbeta'],
      ['gamma']
    ])
    const txt = 'alpha, bravo\rcharlie, delta'
    expect(parseTableText(txt, splitForTableFile('notes.TXT', txt)).rows).toEqual([
      ['alpha, bravo'],
      ['charlie, delta']
    ])
  })

  it('JSON导入与预览保持整条结构化记录，不拆原文中的行界和已有分析', () => {
    const p = project(),
      languageId = p.languages[0].id,
      sentence = createSentence(languageId)
    sentence.text = 'alpha\r\nbeta\u2028gamma'
    sentence.tokens = [
      {
        surface: sentence.text,
        analyses: [
          {
            lexemeId: null,
            slot: null,
            morphs: [{ form: sentence.text, gloss: 'QA', morphemeId: null }]
          }
        ],
        chosen: 0,
        confirmed: true
      }
    ]
    p.sentences.push(sentence)
    const source = '\uFEFF' + sentencesToJson(p.sentences),
      before = JSON.stringify(sentence)
    expect(previewSentencesJson(p, languageId, source)?.map((r) => r.text)).toEqual([sentence.text])
    const other = project()
    expect(importSentencesJson(other, other.languages[0].id, source)?.created).toBe(1)
    expect(other.sentences[0].text).toBe(sentence.text)
    expect(other.sentences[0].tokens).toEqual(sentence.tokens)
    expect(JSON.stringify(sentence)).toBe(before)
    expect(parseProject(serializeProject(p)).sentences[0]).toEqual(sentence)
  })

  it('导入新增条目不改变原来的分析记录，重复与空行仍按既有规则处理', () => {
    const p = project(),
      languageId = p.languages[0].id,
      old = createSentence(languageId)
    old.text = 'analysed original'
    old.tokens = [
      {
        surface: old.text,
        analyses: [{ lexemeId: null, slot: null, morphs: [] }],
        chosen: 0,
        confirmed: true
      }
    ]
    p.sentences.push(old)
    const before = JSON.stringify(old)
    const records = rowsToRecords(
      parseTableText('analysed original\runique line\r\nunique line\u2029', 'line').rows,
      ['text']
    )
    expect(importSentenceRecords(p, languageId, records)).toMatchObject({ created: 1, skipped: 2 })
    expect(JSON.stringify(old)).toBe(before)
  })
})

describe('用户选择文件的BOM解码', () => {
  it('UTF-8无BOM与BOM一致，且不改任何行界', () => {
    const raw = 'α\r\n乙\rthird\u2028last'
    expect(decodeTextFile(new TextEncoder().encode(raw))).toBe(raw)
    expect(decodeTextFile(new TextEncoder().encode('\uFEFF' + raw))).toBe(raw)
    expect(decodeTextFile(new Uint8Array())).toBe('')
  })
  it('明确UTF-16LE/BE BOM按同一通路读取，不猜其它编码', () => {
    const raw = 'α\r乙\nlast\u2029'
    const le = new Uint8Array(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(raw, 'utf16le')])
    )
    const be = new Uint8Array(le.length)
    be[0] = 0xfe
    be[1] = 0xff
    for (let i = 2; i < le.length; i += 2) {
      be[i] = le[i + 1]
      be[i + 1] = le[i]
    }
    expect(decodeTextFile(le)).toBe(raw)
    expect(decodeTextFile(be)).toBe(raw)
    expect(splitTextLines(decodeTextFile(be))).toEqual(['α', '乙', 'last'])
  })
})
