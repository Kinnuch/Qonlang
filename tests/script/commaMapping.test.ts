import { describe, it, expect } from 'vitest'
import {
  createProject,
  createScript,
  createLexeme,
  createSentence,
  createCustomField
} from '$lib/core/factory'
import type { Glyph } from '$lib/core/model'
import {
  autoMappingRows,
  glyphValues,
  renderScript,
  lexemeScript,
  scriptProgram
} from '$lib/script/render'
import { sentenceScriptText, textScript } from '$lib/script/lexiconScript'
import { interlinear } from '$lib/engine/gloss'

function fixture() {
  const p = createProject({
      name: 'Comma QA',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.1'
    }),
    lang = p.languages[0],
    script = createScript('Synthetic script')
  script.id = 'sc'
  script.glyphs = [
    ['a', 'α'],
    ['b', 'β'],
    [',', '⸒']
  ].map(([value, char], i): Glyph => ({
    id: 'g' + i,
    value,
    char,
    name: '',
    category: 'punct',
    notes: ''
  }))
  lang.scripts.push(script)
  return { p, lang, script }
}
describe('halfwidth comma in explicit script mapping', () => {
  it('a lone comma is a literal value, ordinary alternate readings keep their existing meaning', () => {
    expect(glyphValues({ value: ',' })).toEqual([','])
    expect(glyphValues({ value: ' , ' })).toEqual([','])
    expect(glyphValues({ value: 'a,b' })).toEqual(['a', 'b'])
  })
  it('glyph-table automatic mapping converts comma and user mapping rules still work', () => {
    const { lang, script } = fixture()
    expect(autoMappingRows(script, lang).some((row) => row.from === '\\,' && row.to === '⸒')).toBe(
      true
    )
    expect(renderScript(lang, script, 'a,b, b,')).toBe('α⸒β⸒ β⸒')
    expect(scriptProgram(lang, script)?.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    )
    script.glyphs = script.glyphs.filter((g) => g.value !== ',')
    script.rules = ', > ⸒\n@glyphs'
    expect(renderScript(lang, script, 'a,b')).toBe('α⸒β')
  })
  it('unmapped comma and neighbouring punctuation are preserved without changing the source', () => {
    const { lang, script } = fixture()
    script.glyphs = script.glyphs.filter((g) => g.value !== ',')
    const input = 'a,b, b;'
    expect(renderScript(lang, script, input)).toBe('α,β, β;')
    expect(input).toBe('a,b, b;')
  })
  it.each(['ltr', 'rtl', 'ttb'] as const)(
    '%s output uses the same literal mapping and keeps selected token identity',
    (direction) => {
      const { p, lang, script } = fixture()
      script.direction = direction
      const w = createLexeme(lang.id, 'a')
      w.id = 'entry'
      w.scriptForms[script.id] = 'WORD'
      p.lexemes.push(w)
      const s = createSentence(lang.id)
      s.text = 'a,b'
      s.tokens = [
        {
          surface: 'a',
          chosen: 0,
          confirmed: true,
          analyses: [
            {
              lexemeId: w.id,
              slot: null,
              morphs: [{ form: 'a', gloss: 'light', morphemeId: null }]
            }
          ]
        },
        { surface: 'b', chosen: 0, analyses: [] }
      ]
      const before = JSON.stringify(s)
      expect(sentenceScriptText(p, lang, script, s)).toBe('α⸒β')
      expect(interlinear(p, s).scripts[0].text).toBe('α⸒β')
      expect(JSON.stringify(s)).toBe(before)
    }
  )
  it('custom-field script lookup maps separator commas while preserving the chosen homograph and manual overrides', () => {
    const { p, lang, script } = fixture(),
      field = createCustomField({ en: 'Codes' })
    p.customFields.push(field)
    script.from = 'custom:' + field.id
    for (const [id, codes] of [
      ['one', 'a'],
      ['two', 'b']
    ]) {
      const w = createLexeme(lang.id, 'same')
      w.id = id
      w.custom = { [field.id]: codes }
      p.lexemes.push(w)
    }
    const s = createSentence(lang.id)
    s.text = 'same, same'
    s.tokens = [
      {
        surface: 'same',
        chosen: 0,
        confirmed: true,
        analyses: [
          {
            lexemeId: 'two',
            slot: null,
            morphs: [{ form: 'same', gloss: 'other', morphemeId: null }]
          }
        ]
      },
      {
        surface: 'same',
        chosen: 0,
        confirmed: true,
        analyses: [
          {
            lexemeId: 'one',
            slot: null,
            morphs: [{ form: 'same', gloss: 'one', morphemeId: null }]
          }
        ]
      }
    ]
    const before = JSON.stringify(s.tokens)
    expect(sentenceScriptText(p, lang, script, s)).toBe('β⸒ α')
    expect(textScript(p, lang, script, 'same, same', s.tokens)).toBe('β⸒ α')
    expect(JSON.stringify(s.tokens)).toBe(before)
    s.scriptForms[script.id] = 'a,b'
    expect(sentenceScriptText(p, lang, script, s)).toBe('α⸒β')
    p.lexemes[0].scriptForms[script.id] = 'a,b'
    expect(lexemeScript(lang, script, p.lexemes[0])).toBe('α⸒β')
  })
  it('ordinary manual script text remains literal, including unmapped or hand-entered commas', () => {
    const { p, lang, script } = fixture(),
      s = createSentence(lang.id)
    s.text = 'a,b'
    s.scriptForms[script.id] = 'MANUAL,⸒'
    expect(sentenceScriptText(p, lang, script, s)).toBe('MANUAL,⸒')
    expect(s.scriptForms[script.id]).toBe('MANUAL,⸒')
  })
  it('syllable packing reads the same lone-comma value', () => {
    const { lang, script } = fixture()
    script.packing = { enabled: true }
    expect(renderScript(lang, script, ',')).toBe('⸒')
    script.rules = ', > §\n@glyphs'
    expect(renderScript(lang, script, ',')).toBe('§')
    script.rules = '@glyphs'
    script.glyphs = script.glyphs.filter((glyph) => glyph.value !== ',')
    expect(renderScript(lang, script, ',')).toBe(',')
  })
})
