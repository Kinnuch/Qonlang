import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createLanguage, createScript, createLexeme, createSentence } from '$lib/core/factory'
import { parseFont, guessCategory } from '$lib/script/fontParse'
import { autoMappingLines, expandRules, renderScript, lexemeScript } from '$lib/script/render'
import { interlinear, toLeipzig, renderTemplate } from '$lib/engine/gloss'
import { parseProject } from '$lib/core/serialize'
import type { Project } from '$lib/core/model'

function runic() {
  const lang = createLanguage({ name: 'T' })
  const sc = createScript('Runes')
  const pairs: [string, string][] = [
    ['f', 'ᚠ'],
    ['u', 'ᚢ'],
    ['th', 'ᚦ'],
    ['a', 'ᚨ'],
    ['r', 'ᚱ'],
    ['k', 'ᚲ'],
    ['n', 'ᚾ'],
    ['i', 'ᛁ'],
    ['s', 'ᛊ'],
    ['t', 'ᛏ']
  ]
  sc.glyphs = pairs.map(([value, char], i) => ({
    id: 'g' + i,
    char,
    name: '',
    value,
    category: 'letter',
    notes: ''
  }))
  lang.scripts.push(sc)
  return { lang, sc }
}

describe('script mapping', () => {
  it('generates longest-first mapping lines and expands @glyphs', () => {
    const { sc } = runic()
    const lines = autoMappingLines(sc)
    expect(lines[0]).toBe('th > ᚦ')
    expect(expandRules(sc)).toContain('th > ᚦ')
  })
  it('renders words word by word, keeping spaces', () => {
    const { lang, sc } = runic()
    expect(renderScript(lang, sc, 'tharf sun')).toBe('ᚦᚨᚱᚠ ᛊᚢᚾ')
  })
  it('user rules before @glyphs run first', () => {
    const { lang, sc } = runic()
    sc.rules = 'n > t / _#\n@glyphs'
    expect(renderScript(lang, sc, 'sun')).toBe('ᛊᚢᛏ')
  })
  it('lexeme override wins over automatic rendering', () => {
    const { lang, sc } = runic()
    const l = createLexeme(lang.id, 'fust')
    expect(lexemeScript(lang, sc, l)).toBe('ᚠᚢᛊᛏ')
    l.scriptForms[sc.id] = 'ᚠ·'
    expect(lexemeScript(lang, sc, l)).toBe('ᚠ·')
  })
  it('interlinear carries a script line into exports and templates', () => {
    const { lang, sc } = runic()
    const project = parseProject(
      JSON.stringify({ schemaVersion: 1, meta: { name: 'x' }, languages: [lang], sentences: [] })
    ) as Project
    const s = createSentence(lang.id)
    s.text = 'sun tharf'
    s.translation = { en: 'sun' }
    project.sentences.push(s)
    const il = interlinear(project, s)
    expect(il.scripts[0]?.text).toBe('ᛊᚢᚾ ᚦᚨᚱᚠ')
    expect(toLeipzig(il).split('\n')[0]).toBe('ᛊᚢᚾ ᚦᚨᚱᚠ')
    expect(renderTemplate('{{script}} | {{text}}', il, s)).toBe('ᛊᚢᚾ ᚦᚨᚱᚠ | sun tharf')
    expect(sc.id).toBe(project.languages[0].scripts[0].id)
  })
  it('migration adds scripts and scriptForms to old projects', () => {
    const p = parseProject(
      JSON.stringify({
        schemaVersion: 1,
        meta: { name: 'x' },
        languages: [{ id: 'l', name: 'L' }],
        lexemes: [{ id: 'x', languageId: 'l', lemma: 'a' }]
      })
    ) as Project
    expect(p.languages[0].scripts).toEqual([])
    expect(p.lexemes[0].scriptForms).toEqual({})
  })
})

describe('font parsing', () => {
  it('categorizes characters', () => {
    expect(guessCategory('a')).toBe('letter')
    expect(guessCategory('\u0301')).toBe('mark')
    expect(guessCategory('\ue000')).toBe('glyph')
    expect(guessCategory('3')).toBe('number')
    expect(guessCategory('!')).toBe('punct')
  })
  const candidates = [
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  ]
  const fontPath = candidates.find((p) => existsSync(p))
  it.skipIf(!fontPath)('reads cmap, family and glyph names from a system font', () => {
    const buf = readFileSync(fontPath!)
    const parsed = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    expect(parsed.family.length).toBeGreaterThan(0)
    const a = parsed.glyphs.find((g) => g.char === 'A')
    expect(a).toBeTruthy()
    expect(parsed.glyphs.length).toBeGreaterThan(100)
  })
})
