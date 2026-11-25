import { describe, it, expect } from 'vitest'
import { createLexeme, createMorpheme } from '$lib/core/factory'
import { parseProject } from '$lib/core/serialize'
import { buildIndex, analyzeToken } from '$lib/engine/gloss'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function fixture(lemma: string, addHomophone = false) {
  const p = parseProject(readFileSync(join(__dirname, '../../examples/Aelith.laim.json'), 'utf8'))
  const paradigm = p.paradigms.find((x) => x.appliesToAll)!
  const gen = Object.values(paradigm.generators)[0]
  if (gen.kind !== 'pipeline' || gen.steps[0].kind !== 'adjust') throw Error('fixture')
  gen.steps[0].text = 'd > dh / #_'
  const lang = paradigm.appliesToLanguageId!
  const root = createLexeme(lang, lemma)
  root.senses[0].definition = { zh: '芒草' }
  p.lexemes = [root]
  p.morphemes = []
  p.sentences = []
  if (addHomophone) {
    const same = createMorpheme(lang, 'root')
    same.form = 'dhenrú'
    same.gloss = 'grass'
    p.morphemes.push(same)
  }
  return { p, lang, root }
}
describe('initial alternation in corpus analysis', () => {
  it.each([
    ['denru', 'dhenru'],
    ['denrú', 'dhenrú'],
    ['denrú-', 'dhenrú'],
    ['denru', 'dhenrú']
  ])('recognises %s in %s', (lemma, surface) => {
    const { p, lang, root } = fixture(lemma)
    expect(
      analyzeToken(buildIndex(p, lang), surface, p.settings.morphemeBoundaries).some(
        (a) => a.lexemeId === root.id && a.morphs.length === 1
      )
    ).toBe(true)
  })
  it('keeps an attested lexeme candidate when a same-form root morpheme is also available', () => {
    const { p, lang, root } = fixture('denrú', true)
    expect(
      analyzeToken(buildIndex(p, lang), 'dhenrú', p.settings.morphemeBoundaries).some(
        (a) => a.lexemeId === root.id
      )
    ).toBe(true)
  })
})
