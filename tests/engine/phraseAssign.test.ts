/**
 * 短语与语料共用的「改」：切分块的下标要跟分析对得上，写进分析不碰原文，
 * 勾了「同时改原文」才按位置换那一处。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import { analyzeSentence } from '$lib/engine/gloss'
import { rewriteWordInText, writeChoice } from '$lib/engine/gloss/assign'
import { spanTokens, tokensMatchText } from '$lib/engine/gloss/tokens'
import type { Token } from '$lib/core/model'

const p = parseProject(
  readFileSync(join(__dirname, '..', '..', 'examples', 'Aelith.laim.json'), 'utf8')
)
const L = p.languages.find((l) => l.name === 'Aelith')!
const analyze = (text: string): { languageId: string; text: string; tokens: Token[] } =>
  analyzeSentence(p, { languageId: L.id, text, tokens: [] })

describe('原文的段与分析的下标对齐', () => {
  it('每一段指着第几个分析：标点、空白不算词', () => {
    const spans = spanTokens('«nöl», sen!', ['nöl', 'sen'])
    expect(spans.filter((s) => s.word).map((s) => [s.text, s.at])).toEqual([
      ['nöl', 0],
      ['sen', 1]
    ])
    expect(spans.filter((s) => !s.word).every((s) => s.at === -1)).toBe(true)
    expect(spans.map((s) => s.text).join('')).toBe('«nöl», sen!')
  })
  it('词典里带空格的形式并成一个分析：它占的两个词都指同一个下标', () => {
    const spans = spanTokens('ar mae kel', ['ar mae', 'kel'])
    expect(spans.filter((s) => s.word).map((s) => s.at)).toEqual([0, 0, 1])
  })
  it('原文比分析长：多出来的词不指任何分析', () => {
    expect(
      spanTokens('nöl sen oru', ['nöl', 'sen'])
        .filter((s) => s.word)
        .map((s) => s.at)
    ).toEqual([0, 1, -1])
  })
  it('逐字分词也对得上', () => {
    expect(
      spanTokens('红学红', ['红', '学', '红'], { mode: 'character' })
        .filter((s) => s.word)
        .map((s) => s.at)
    ).toEqual([0, 1, 2])
  })
  it('原文改过之后，存下来的分析就作废', () => {
    expect(tokensMatchText('«nöl», sen!', ['nöl', 'sen'])).toBe(true)
    expect(tokensMatchText('nöl sen', ['nöl'])).toBe(false)
    expect(tokensMatchText('nöl sen', ['nöl', 'kel'])).toBe(false)
    expect(tokensMatchText('ar mae kel', ['ar mae', 'kel'])).toBe(true)
    expect(tokensMatchText('nöl sen', [])).toBe(false)
  })
})

describe('挑中一个词条写进分析', () => {
  const oru = p.lexemes.find((l) => l.languageId === L.id && l.lemma === 'oru')!
  it('整个词：原文一个字都不动，分析记下挑中的词条并算已确认', () => {
    const s = analyze('nöl sen')
    expect(writeChoice(p, s.tokens[0], null, { lexemeId: oru.id })).toBe(true)
    expect(s.text).toBe('nöl sen')
    const a = s.tokens[0].analyses[s.tokens[0].chosen]
    expect(a.lexemeId).toBe(oru.id)
    expect(a.morphs).toHaveLength(1)
    expect(a.morphs[0].form).toBe('nöl')
    expect(s.tokens[0].confirmed).toBe(true)
    // 另一个词没被碰过
    expect(s.tokens[1].analyses[s.tokens[1].chosen].lexemeId).not.toBe(oru.id)
  })
  it('切分里的第几块，就只改第几块', () => {
    const s = analyze('ilenkasodamü')
    const tk = s.tokens[0]
    const i = tk.analyses.findIndex((a) => a.morphs.length === 3)
    expect(i).toBeGreaterThanOrEqual(0)
    tk.chosen = i
    const before = tk.analyses[i].morphs.map((m) => m.form + '/' + m.gloss)
    expect(writeChoice(p, tk, 1, { lexemeId: oru.id })).toBe(true)
    const morphs = tk.analyses[tk.chosen].morphs
    expect(morphs).toHaveLength(3)
    expect(morphs[1].lexemeId).toBe(oru.id)
    // 前后两块原样
    expect(morphs[0].form + '/' + morphs[0].gloss).toBe(before[0])
    expect(morphs[2].form + '/' + morphs[2].gloss).toBe(before[2])
    expect(s.text).toBe('ilenkasodamü')
  })
  it('什么都没挑中不动分析', () => {
    const s = analyze('nöl sen')
    const before = JSON.stringify(s.tokens[0])
    expect(writeChoice(p, s.tokens[0], null, {})).toBe(false)
    expect(JSON.stringify(s.tokens[0])).toBe(before)
  })
})

describe('勾了「同时改原文」才换原文', () => {
  const oru = p.lexemes.find((l) => l.languageId === L.id && l.lemma === 'oru')!
  it('只换指定的那一处，别处的同一个词不动', () => {
    const s = analyze('nöl sen nöl')
    writeChoice(p, s.tokens[2], null, { lexemeId: oru.id })
    expect(rewriteWordInText(p, s, 2)).toBe(true)
    expect(s.text).toBe('nöl sen oru')
    expect(s.tokens[2].surface).toBe('oru')
    expect(s.tokens[2].analyses[s.tokens[2].chosen].morphs[0].form).toBe('oru')
  })
  it('大小写跟着原来的词走', () => {
    const s = analyze('Nöl sen')
    writeChoice(p, s.tokens[0], null, { lexemeId: oru.id })
    expect(rewriteWordInText(p, s, 0)).toBe(true)
    expect(s.text).toBe('Oru sen')
  })
  it('挑的是切分里的一段时不换原文（形式跟整词对不上）', () => {
    const s = analyze('ilenkasodamü')
    const tk = s.tokens[0]
    tk.chosen = tk.analyses.findIndex((a) => a.morphs.length === 3)
    writeChoice(p, tk, 1, { lexemeId: oru.id })
    expect(rewriteWordInText(p, s, 0)).toBe(false)
    expect(s.text).toBe('ilenkasodamü')
  })
  it('没有分析的短语不动原文', () => {
    expect(rewriteWordInText(p, { languageId: L.id, text: 'nöl sen' }, 0)).toBe(false)
  })
})
