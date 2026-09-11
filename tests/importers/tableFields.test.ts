/**
 * 表格导入语料、短语时能填到录入页面上的每一处：例句的别的正字法写法、文字写法、自由行；
 * 短语各正字法的发音、带备注的变体。例词都是随手编的。
 */
import { describe, it, expect } from 'vitest'
import { createLanguage, createOrthography, createProject, createScript } from '$lib/core/factory'
import {
  guessColumns,
  importPhraseRecords,
  importSentenceRecords,
  phraseFields,
  rowsToRecords,
  sentenceFields
} from '$lib/importers/corpusIO'

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  const lang = createLanguage({ name: '甲语' })
  const translit = createOrthography('转写', false)
  lang.orthographies.push(translit)
  const script = createScript('甲文')
  lang.scripts.push(script)
  p.languages = [lang]
  return { p, lang, translit, script }
}

describe('table import fields', () => {
  it('imports other spellings, script forms and free lines for sentences', () => {
    const { p, lang, translit, script } = setup()
    const fields = sentenceFields(['zh'], lang)
    expect(fields.map((f) => f.key)).toEqual([
      'text',
      'tr:zh',
      `ortho:${translit.id}`,
      `script:${script.id}`,
      'source',
      'tags',
      'notes',
      'extra'
    ])
    const header = ['text', '译文(中)', '转写', '甲文', '直译', 'gloss']
    const columns = guessColumns(header, fields, header.length)
    expect(columns).toEqual([
      'text',
      'tr:zh',
      `ortho:${translit.id}`,
      `script:${script.id}`,
      'extra',
      ''
    ])
    columns[5] = 'extra'
    importSentenceRecords(
      p,
      lang.id,
      rowsToRecords([['sa kela', '我看见', 'sá kéla', '𐀀𐀁', '我 看见', 'I see']], columns, header)
    )
    const [s] = p.sentences
    expect(s.translation.zh).toBe('我看见')
    expect(s.orthoTexts[translit.id]).toBe('sá kéla')
    expect(s.scriptForms[script.id]).toBe('𐀀𐀁')
    expect(s.extraLines).toEqual([
      { label: '直译', text: '我 看见' },
      { label: 'gloss', text: 'I see' }
    ])
  })

  it('imports pronunciations per orthography and variant notes for phrases', () => {
    const { p, lang, translit } = setup()
    const primary = lang.orthographies.find((o) => o.isPrimary)!
    const fields = phraseFields(['zh'], lang)
    const header = ['text', '发音', '转写', 'variants']
    const columns = guessColumns(header, fields, header.length)
    expect(columns).toEqual(['text', `pron:${primary.id}`, `pron:${translit.id}`, 'variants'])
    importPhraseRecords(
      p,
      lang.id,
      rowsToRecords([['sa', 'sa', 'sá', 'saa（口语）；sai']], columns, header)
    )
    const [ph] = p.phrasebook
    expect(ph.pronunciations[primary.id]).toEqual({ ipa: 'sa', irregular: true })
    expect(ph.pronunciations[translit.id]).toEqual({ ipa: 'sá', irregular: true })
    expect(ph.variants).toEqual([
      { text: 'saa', note: '口语' },
      { text: 'sai', note: '' }
    ])
  })
})
