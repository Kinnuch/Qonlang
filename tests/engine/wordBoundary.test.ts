/**
 * 一段文字里有好几个词时，`#` 是每个词自己的词首、词尾：自动标音、整库演化、文字转写都逐词跑。
 */
import { describe, it, expect } from 'vitest'
import { parseRuleText, runRules, runRulesOnText } from '$lib/engine/sca'
import { createLanguage, createLexeme, createProject, createRuleSet } from '$lib/core/factory'
import { transcribe } from '$lib/core/pronounce'
import { planEvolution } from '$lib/engine/evolve'

describe('runRulesOnText', () => {
  const final = parseRuleText('a > ə / _#')
  const initial = parseRuleText('k > g / #_')

  it('treats the end and start of every word as a word boundary', () => {
    expect(runRules(final, 'kala mira').output).toBe('kala mirə')
    expect(runRulesOnText(final, 'kala mira')).toBe('kalə mirə')
    expect(runRulesOnText(initial, 'kala kira')).toBe('gala gira')
  })

  it('keeps the spacing and lets punctuation at word edges not block the rules', () => {
    expect(runRulesOnText(final, 'kala,  mira\nsena')).toBe('kalə,  mirə\nsenə')
    expect(runRulesOnText(final, '“kala” mira')).toBe('“kalə” mirə')
  })
})

describe('automatic transcription and evolution of multi-word entries', () => {
  it('applies word-final rules to each word', () => {
    const lang = createLanguage({ name: 'T' })
    const ortho = lang.orthographies[0]
    ortho.rulesToIpa = 'a > ə / _#'
    expect(transcribe(lang, ortho, 'kala mira')).toBe('kalə mirə')
  })

  it('evolves each word of a lemma on its own', () => {
    const project = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'en' })
    const proto = project.languages[0]
    const daughter = createLanguage({ name: 'D' })
    project.languages.push(daughter)
    const l = createLexeme(proto.id, 'kala mira')
    project.lexemes.push(l)
    const text = 'a > / _#'
    const rs = createRuleSet('R', text)
    const rows = planEvolution(project, {
      ruleSet: rs,
      program: parseRuleText(text),
      sourceLanguageId: proto.id,
      targetLanguageId: daughter.id
    })
    expect(rows.map((r) => r.output)).toEqual(['kal mir'])
  })
})
