import { describe, expect, it } from 'vitest'
import { createLanguage, createScript } from '$lib/core/factory'
import type { Glyph } from '$lib/core/model'
import { decodeGlyphs, encodeGlyphs, pasteGlyphs } from '$lib/script/glyphClipboard'
import { parseGlyphLines } from '$lib/importers/glyphLines'
import { renderScript } from '$lib/script/render'

function glyph(char: string, value: string): Glyph {
  return { id: char, char, value, name: value, category: 'letter', notes: 'note' }
}
describe('copying selected glyphs', () => {
  it('preserves order, metadata and drawings, skips existing characters and makes new IDs', () => {
    const first = glyph('क', 'k'),
      second = glyph('ि', 'i')
    second.drawing = {
      strokes: [
        {
          width: 2,
          points: [
            [0, 0],
            [2, 3]
          ]
        }
      ],
      advance: 100
    }
    const decoded = decodeGlyphs(encodeGlyphs([first, second]))!
    const [copy] = pasteGlyphs([first], decoded)
    expect(copy).toEqual({ ...second, id: expect.any(String) })
    expect(copy.id).not.toBe(second.id)
    expect(copy.drawing).not.toBe(second.drawing)
    expect(pasteGlyphs([first, copy], decoded)).toEqual([])
    expect(pasteGlyphs([], decoded).map((g) => g.char)).toEqual(['क', 'ि'])
    expect(pasteGlyphs([glyph('g', 'g')], [glyph('ɡ', 'ɡ')])).toEqual([])
  })
  it('rejects malformed or unknown-version clipboard records without adding any partial rows', () => {
    const bad = {
      ...glyph('x', 'x'),
      drawing: { advance: 100, strokes: [], contours: [{ cmds: [['M', 'x', 1]] }] }
    }
    expect(decodeGlyphs(JSON.stringify({ version: 1, glyphs: [glyph('a', 'a'), bad] }))).toBeNull()
    expect(decodeGlyphs('plain text')).toBeNull()
    expect(decodeGlyphs('{"version":2,"glyphs":[]}')).toBeNull()
  })
  it('renders the mapping examples in the Rime migration guide', () => {
    const lang = createLanguage({ name: 'demo' }),
      sc = createScript('marks')
    sc.glyphs = parseGlyphLines('क\tk\nि\ti').map(({ char, value }) => glyph(char, value))
    sc.rules = 'C=k\nC > C् / _#\na > / C_\n@glyphs'
    expect(renderScript(lang, sc, 'ka ki k')).toBe('क कि क्')
    sc.glyphs.push(glyph('त', 't'))
    sc.rules = sc.rules.replace('C=k', 'C=k t')
    expect(renderScript(lang, sc, 'ti')).toBe('ति')
    const syllables = createScript('complete syllables')
    syllables.glyphs = parseGlyphLines('क\tka\nकि\tki\nक्\tk').map(({ char, value }) =>
      glyph(char, value)
    )
    expect(renderScript(lang, syllables, 'ka ki k')).toBe('क कि क्')
    const abjad = createScript('consonants')
    abjad.glyphs = [glyph('כ', 'k'), glyph('ת', 't')]
    abjad.rules = '[aiu] > / _\n@glyphs'
    expect(renderScript(lang, abjad, 'kat')).toBe('כת')
  })
})
