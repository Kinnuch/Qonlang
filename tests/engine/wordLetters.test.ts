/**
 * 撇号这类符号算字母：词库里有词以它开头 / 结尾时，语料分词不再把它当标点剥掉。
 */
import { describe, it, expect } from 'vitest'
import { createLexeme, createProject, createSentence } from '$lib/core/factory'
import { analyzeSentence, buildIndex } from '$lib/engine/gloss'
import { tokenize, tokenSpans } from '$lib/engine/gloss/tokens'

describe('算作字母的符号', () => {
  it('切词时留着，标点照旧剥掉', () => {
    expect(tokenize("bismi 'llhi, “kala”")).toEqual(['bismi', 'llhi', 'kala'])
    expect(tokenize("bismi 'llhi, “kala”", { letters: "'" })).toEqual(['bismi', "'llhi", 'kala'])
    const spans = tokenSpans("bismi 'llhi.", { letters: "'" })
    expect(spans.map((x) => x.text).join('')).toBe("bismi 'llhi.")
    expect(spans.filter((x) => x.word).map((x) => x.text)).toEqual(['bismi', "'llhi"])
  })
  it('词库里有以撇号开头的词时自动算上，语料能认出来', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
    const L = p.languages[0]
    const add = (lemma: string, zh: string): void => {
      const l = createLexeme(L.id, lemma)
      l.senses[0].definition = { zh }
      p.lexemes.push(l)
    }
    add('bismi', '以…之名')
    add("'llhi", '真主')
    expect(buildIndex(p, L.id).wordChars).toBe("'")
    const s = createSentence(L.id)
    s.text = "bismi 'llhi."
    analyzeSentence(p, s)
    expect(s.tokens.map((t) => t.surface)).toEqual(['bismi', "'llhi"])
    expect(s.tokens.every((t) => t.analyses[t.chosen]?.lexemeId)).toBe(true)
  })
})
