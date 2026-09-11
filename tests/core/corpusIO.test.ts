/**
 * 语料与短语的表格、JSON 导入导出。
 */
import { describe, it, expect } from 'vitest'
import { createProject, createSentence } from '$lib/core/factory'
import {
  guessColumns,
  importPhraseRecords,
  importSentenceRecords,
  importSentencesJson,
  phraseFields,
  phrasesToRows,
  rowsToRecords,
  sentenceFields,
  sentencesToJson,
  sentencesToRows
} from '$lib/importers/corpusIO'

const LANGS = ['zh', 'en']
const newProject = (): ReturnType<typeof createProject> =>
  createProject({ name: 'p', template: 'blank', appVersion: '0', uiLocale: 'zh' })

describe('语料导入导出', () => {
  it('按表头猜列：带语言的译文、只写译文的、出处标签', () => {
    const fields = sentenceFields(LANGS)
    expect(
      guessColumns(['原文', '译文（中文）', 'English translation', '出处', '标签'], fields, 5)
    ).toEqual(['text', 'tr:zh', 'tr:en', 'source', 'tags'])
    expect(guessColumns(['句子', '译文', 'translation', '备注'], fields, 4)).toEqual([
      'text',
      'tr:zh',
      'tr:en',
      'notes'
    ])
    expect(guessColumns(null, fields, 3)).toEqual(['text', 'tr:zh', ''])
  })

  it('同一字段挑了几列就连起来；空行不要', () => {
    expect(
      rowsToRecords(
        [
          ['a', 'x', 'y'],
          ['', '', '']
        ],
        ['text', 'notes', 'notes']
      )
    ).toEqual([{ text: 'a', notes: 'x；y' }])
  })

  it('导入例句：原文重复的跳过，标签拆开', () => {
    const p = newProject()
    const lang = p.languages[0].id
    const old = createSentence(lang)
    old.text = 'kam sen'
    p.sentences.push(old)
    const r = importSentenceRecords(p, lang, [
      { text: 'kam sen', 'tr:zh': '重复' },
      { text: 'hân anar', 'tr:zh': '看太阳', tags: '日常、天象', source: '手记' },
      { 'tr:zh': '没有原文' }
    ])
    expect(r).toMatchObject({ created: 1, skipped: 2 })
    const s = p.sentences[0]
    expect(s.text).toBe('hân anar')
    expect(s.translation).toEqual({ zh: '看太阳' })
    expect(s.tags).toEqual(['日常', '天象'])
    expect(s.source).toBe('手记')
  })

  it('导出的表格能原样导回来', () => {
    const a = newProject()
    const la = a.languages[0].id
    importSentenceRecords(a, la, [{ text: 'x y', 'tr:zh': '甲', 'tr:en': 'A', tags: 't1' }])
    const rows = sentencesToRows(a, a.sentences, LANGS)
    const b = newProject()
    const lb = b.languages[0].id
    const cols = guessColumns(rows[0], sentenceFields(LANGS), rows[0].length)
    importSentenceRecords(b, lb, rowsToRecords(rows.slice(1), cols))
    expect(b.sentences[0]).toMatchObject({
      text: 'x y',
      translation: { zh: '甲', en: 'A' },
      tags: ['t1']
    })
  })

  it('JSON：换项目时对不上的分析丢掉，原文重复的跳过；不是千语集的 JSON 返回 null', () => {
    const a = newProject()
    const la = a.languages[0].id
    const s = createSentence(la)
    s.text = 'kam'
    s.tokens = [
      {
        surface: 'kam',
        analyses: [
          { lexemeId: 'gone', slot: null, morphs: [{ form: 'kam', gloss: '看', morphemeId: null }] }
        ],
        chosen: 0,
        confirmed: true
      }
    ]
    a.sentences.push(s)
    const json = sentencesToJson(a.sentences)
    const b = newProject()
    const lb = b.languages[0].id
    expect(importSentencesJson(b, lb, json)).toMatchObject({ created: 1, skipped: 0 })
    expect(b.sentences[0].tokens).toEqual([])
    expect(b.sentences[0].id).not.toBe(s.id)
    expect(importSentencesJson(b, lb, json)).toMatchObject({ created: 0, skipped: 1 })
    expect(importSentencesJson(b, lb, '{"sentences": []}')).toBeNull()
  })

  it('短语：分类、变体；导出表头能认回来', () => {
    const p = newProject()
    const lang = p.languages[0].id
    importPhraseRecords(p, lang, [
      { text: 'sa kira', 'tr:zh': '你好', category: '问候', variants: 'sa k.; kira' }
    ])
    expect(p.phrasebook[0]).toMatchObject({
      category: '问候',
      variants: [
        { text: 'sa k.', note: '' },
        { text: 'kira', note: '' }
      ]
    })
    const rows = phrasesToRows(p.phrasebook, LANGS)
    expect(guessColumns(rows[0], phraseFields(LANGS), rows[0].length)).toEqual([
      'category',
      'text',
      'tr:zh',
      'tr:en',
      'tags',
      'variants'
    ])
  })
})
