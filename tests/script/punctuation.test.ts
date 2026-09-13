import { describe, it, expect } from 'vitest'
import { createLanguage, createScript } from '$lib/core/factory'
import { autoMappingLines, renderScript } from '$lib/script/render'
import type { Language } from '$lib/core/model'

function withGlyphs(pairs: [string, string][], classes: Record<string, string> = {}) {
  const lang = createLanguage({ name: 'T' })
  for (const [name, members] of Object.entries(classes))
    lang.classes.push({
      id: 'c' + name,
      name,
      members: Array.from(members)
    } as Language['classes'][number])
  const sc = createScript('S')
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

describe('glyphs for punctuation and rule symbols', () => {
  it('a glyph for "?" only replaces question marks', () => {
    const { lang, sc } = withGlyphs([
      ['k', 'ᚲ'],
      ['a', 'ᚨ'],
      ['t', 'ᛏ'],
      ['?', '⸮']
    ])
    expect(renderScript(lang, sc, 'kat')).toBe('ᚲᚨᛏ')
    expect(renderScript(lang, sc, 'ka?')).toBe('ᚲᚨ⸮')
    expect(renderScript(lang, sc, 'ta ka?')).toBe('ᛏᚨ ᚲᚨ⸮')
  })
  it('other rule symbols are plain characters too', () => {
    const { lang, sc } = withGlyphs([
      ['k', 'ᚲ'],
      ['a', 'ᚨ'],
      ['.', '·'],
      ['#', '♯'],
      ['*', '∗'],
      ['=', '⹀'],
      ['-', '‐']
    ])
    expect(renderScript(lang, sc, 'ka.')).toBe('ᚲᚨ·')
    expect(renderScript(lang, sc, 'k*a')).toBe('ᚲ∗ᚨ')
    expect(renderScript(lang, sc, 'ka#')).toBe('ᚲᚨ♯')
    expect(renderScript(lang, sc, 'ka=ka')).toBe('ᚲᚨ⹀ᚲᚨ')
    expect(renderScript(lang, sc, 'ka-ka')).toBe('ᚲᚨ‐ᚲᚨ')
  })
  it('a transliteration value that is also a class name stays literal', () => {
    const { lang, sc } = withGlyphs(
      [
        ['k', 'ᚲ'],
        ['a', 'ᚨ'],
        ['C', 'ᚳ']
      ],
      { C: 'kpt' }
    )
    expect(renderScript(lang, sc, 'kaC')).toBe('ᚲᚨᚳ')
  })
  it('mapping lines escape the symbols', () => {
    const { sc } = withGlyphs([['?', '⸮']])
    expect(autoMappingLines(sc)).toEqual(['\\? > ⸮'])
  })
})
