/**
 * 转写来源是检视器模块的文字（意音文字把字号填在词条里）：语料、短语逐词查词库写字；
 * 来源是单词的文字照旧直接转句子。另测切词留原样的空白与标点。
 */
import { describe, it, expect } from 'vitest'
import {
  createCustomField,
  createLexeme,
  createProject,
  createScript,
  createSentence,
  newId
} from '$lib/core/factory'
import type { Glyph, Project, Script, Token } from '$lib/core/model'
import { tokenize, tokenSpans } from '$lib/engine/gloss/tokens'
import { lexemeScript } from '$lib/script/render'
import { sentenceScriptText, textScript, writesFromLexicon } from '$lib/script/lexiconScript'

const glyph = (char: string, value: string): Glyph => ({
  id: newId(),
  char,
  name: '',
  value,
  category: 'glyph',
  notes: ''
})

function setup(): { p: Project; sc: Script; field: string } {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  const L = p.languages[0]
  const f = createCustomField({ zh: '字号' })
  p.customFields.push(f)
  const sc = createScript('表意字')
  sc.glyphs = [glyph('木', 'aa01'), glyph('水', 'aa02'), glyph('火', 'ab10'), glyph('。', '.')]
  sc.from = `custom:${f.id}`
  L.scripts.push(sc)
  const add = (lemma: string, codes: string): void => {
    const l = createLexeme(L.id, lemma)
    l.custom = { [f.id]: codes }
    p.lexemes.push(l)
  }
  add('kala', 'aa01')
  add('tùmo', 'aa02 ab10')
  add('(le)sepe', 'ab10')
  return { p, sc, field: f.id }
}

describe('切词留着空白与标点', () => {
  it('词依次跟 tokenize 一样，拼回去是原文', () => {
    const texts = ['Nù nàe, thjēha  gò…', '“kala” tùmo.', '  sepe  ']
    for (const text of texts) {
      const spans = tokenSpans(text)
      expect(spans.map((x) => x.text).join('')).toBe(text)
      expect(spans.filter((x) => x.word).map((x) => x.text)).toEqual(tokenize(text))
    }
    const chars = tokenSpans('木，水', { mode: 'character' })
    expect(chars.map((x) => x.text).join('')).toBe('木，水')
    expect(chars.filter((x) => x.word).map((x) => x.text)).toEqual(
      tokenize('木，水', { mode: 'character' })
    )
    const custom = tokenSpans('kala|tùmo', { mode: 'custom', pattern: '\\|' })
    expect(custom.filter((x) => x.word).map((x) => x.text)).toEqual(['kala', 'tùmo'])
  })
})

describe('逐词查词库写文字', () => {
  it('例句按分析里的词条写字，找不到的词照原文，标点照转', () => {
    const { p, sc } = setup()
    const L = p.languages[0]
    expect(writesFromLexicon(sc)).toBe(true)
    const s = createSentence(L.id)
    s.text = 'Kala tùmo mira.'
    const tk = (surface: string, lexemeId: string | null): Token => ({
      surface,
      analyses: [
        { lexemeId, slot: null, morphs: [{ form: surface, gloss: '', morphemeId: null }] }
      ],
      chosen: 0,
      confirmed: true
    })
    s.tokens = [tk('Kala', p.lexemes[0].id), tk('tùmo', p.lexemes[1].id), tk('mira', null)]
    expect(sentenceScriptText(p, L, sc, s)).toBe('木 水 火 mira。')
    // 手填的写法里写字号也换成字
    s.scriptForms[sc.id] = 'aa02 aa01'
    expect(sentenceScriptText(p, L, sc, s)).toBe('水 木')
  })
  it('短语没有分析：按词头找（大小写、附加符、括号里可省的都算）', () => {
    const { p, sc } = setup()
    const L = p.languages[0]
    expect(textScript(p, L, sc, 'tumo lesepe, sepe')).toBe('水 火 火, 火')
    // 词条里手填了字号
    p.lexemes[0].scriptForms = { [sc.id]: 'ab10' }
    expect(lexemeScript(L, sc, p.lexemes[0])).toBe('火')
  })
  it('来源是单词的文字照旧直接转句子', () => {
    const { p, sc } = setup()
    const L = p.languages[0]
    const plain = createScript('拼音字')
    plain.glyphs = [glyph('K', 'ka'), glyph('L', 'la')]
    L.scripts.push(plain)
    expect(writesFromLexicon(plain)).toBe(false)
    expect(textScript(p, L, plain, 'kala tùmo')).toBe('KL tùmo')
    const s = createSentence(L.id)
    s.text = 'kala'
    s.scriptForms[plain.id] = 'ka'
    // 手填的原样用
    expect(sentenceScriptText(p, L, plain, s)).toBe('ka')
    expect(sc.from).toContain('custom:')
  })
})
