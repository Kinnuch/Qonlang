import { describe, expect, it } from 'vitest'
import { createLanguage, createLexeme, createProject } from '$lib/core/factory'
import {
  badgeColorStyle,
  badgeForeground,
  followLexiconTagRename,
  lexiconTagColor,
  normalizeBadgeColor,
  normalizeLexiconTagColors,
  pruneLexiconTagColors,
  setLexiconTagColor
} from '$lib/core/lexemeColors'
import { ensureCompoundPos } from '$lib/core/pos'
import {
  parseProject,
  projectFromFolder,
  projectToFolder,
  serializeProject
} from '$lib/core/serialize'
const fixture = () => {
  const p = createProject({
      name: 'Badge color QA',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.1'
    }),
    word = createLexeme(p.languages[0].id, 'synthetic')
  p.lexemes.push(word)
  return { p, word }
}
function contrast(color: string, foreground: string): number {
  const luminance = (hex: string): number => {
    const values = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
  }
  const a = luminance(color),
    b = luminance(foreground)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
describe('safe readable badge colors', () => {
  it('normalizes six/three digit hex without accepting arbitrary CSS', () => {
    expect(normalizeBadgeColor(' #ABC ')).toBe('#aabbcc')
    expect(normalizeBadgeColor('#F0bC91')).toBe('#f0bc91')
    for (const bad of [
      '',
      null,
      5,
      {},
      '#1234',
      '#12345678',
      'red',
      'rgb(0,0,0)',
      '#fff;background:url(x)',
      'var(--danger)'
    ])
      expect(normalizeBadgeColor(bad)).toBeUndefined()
  })
  it('only emits strict color CSS and defaults to inherited theme styles', () => {
    expect(badgeColorStyle(undefined)).toBe('')
    expect(badgeColorStyle('url(x)')).toBe('')
    expect(badgeColorStyle('#fff')).toBe(
      'background-color:#ffffff;color:#000000;border-color:#ffffff;'
    )
    expect(badgeForeground('#000')).toBe('#ffffff')
  })
  it('selects a foreground with at least WCAG 4.5:1 contrast across the RGB cube', () => {
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 17)
        for (let b = 0; b < 256; b += 17) {
          const color = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
          expect(contrast(color, badgeForeground(color))).toBeGreaterThanOrEqual(4.5)
        }
  })
  it('normalizes optional dictionaries and rejects arrays or inherited entries', () => {
    expect(normalizeLexiconTagColors(['#ffffff'])).toBeUndefined()
    expect(normalizeLexiconTagColors({ a: '#fff', b: 'red', '': '#fff' })).toEqual({ a: '#ffffff' })
    const { p } = fixture()
    p.settings.lexiconTagColors = Object.create({ inherited: '#ffffff' })
    expect(lexiconTagColor(p, 'inherited')).toBeUndefined()
  })
  it('supports literal special tag names without prototype pollution', () => {
    const { p } = fixture()
    for (const tag of ['__proto__', 'constructor', 'toString']) {
      expect(setLexiconTagColor(p, tag, '#123')).toBe(true)
      expect(lexiconTagColor(p, tag)).toBe('#112233')
    }
    expect(({} as Record<string, unknown>).color).toBeUndefined()
    expect(Object.getPrototypeOf(p.settings.lexiconTagColors)).toBe(Object.prototype)
  })
})
describe('project tag color lifecycle', () => {
  it('shares a tag color across records and languages but not separate projects', () => {
    const { p, word } = fixture()
    word.tags = ['shared']
    const other = createLanguage({ name: 'Other' })
    p.languages.push(other)
    const foreign = createLexeme(other.id, 'other')
    foreign.tags = ['shared']
    p.lexemes.push(foreign)
    setLexiconTagColor(p, 'shared', '#123456')
    expect(lexiconTagColor(p, foreign.tags[0])).toBe('#123456')
    expect(lexiconTagColor(fixture().p, 'shared')).toBeUndefined()
  })
  it('edits or resets only the named color, removing the optional map when empty', () => {
    const { p } = fixture()
    expect(setLexiconTagColor(p, 'a', '#123')).toBe(true)
    expect(setLexiconTagColor(p, 'a', '#112233')).toBe(false)
    setLexiconTagColor(p, 'b', '#fff')
    expect(setLexiconTagColor(p, 'a', 'invalid')).toBe(false)
    expect(lexiconTagColor(p, 'a')).toBe('#112233')
    setLexiconTagColor(p, 'a', undefined)
    expect(lexiconTagColor(p, 'b')).toBe('#ffffff')
    setLexiconTagColor(p, 'b', undefined)
    expect(p.settings).not.toHaveProperty('lexiconTagColors')
  })
  it('inherits the old color on rename, removing old metadata only when its last record is renamed', () => {
    const { p, word } = fixture()
    word.tags = ['old']
    const other = createLexeme(word.languageId, 'other')
    other.tags = ['old']
    p.lexemes.push(other)
    setLexiconTagColor(p, 'old', '#123456')
    word.tags = ['new']
    followLexiconTagRename(p, 'old', 'new')
    expect(lexiconTagColor(p, 'new')).toBe('#123456')
    expect(lexiconTagColor(p, 'old')).toBe('#123456')
    other.tags = ['new']
    followLexiconTagRename(p, 'old', 'new')
    expect(lexiconTagColor(p, 'old')).toBeUndefined()
  })
  it('keeps a preexisting destination color when merging tag names', () => {
    const { p, word } = fixture()
    word.tags = ['new']
    setLexiconTagColor(p, 'old', '#123456')
    setLexiconTagColor(p, 'new', '#abcdef')
    followLexiconTagRename(p, 'old', 'new')
    expect(lexiconTagColor(p, 'new')).toBe('#abcdef')
    expect(lexiconTagColor(p, 'old')).toBeUndefined()
  })
  it('keeps metadata while a legacy sense tag or another language still uses the tag', () => {
    const { p, word } = fixture()
    word.senses[0].tags = ['sense']
    setLexiconTagColor(p, 'sense', '#123456')
    expect(pruneLexiconTagColors(p)).toBe(false)
    word.senses[0].tags = []
    expect(pruneLexiconTagColors(p)).toBe(true)
    expect(p.settings).not.toHaveProperty('lexiconTagColors')
  })
  it('does not change records, IDs, tag order or spelling when changing colors', () => {
    const { p, word } = fixture()
    word.tags = ['second', 'first']
    const before = JSON.stringify(p.lexemes)
    setLexiconTagColor(p, 'first', '#123456')
    setLexiconTagColor(p, 'first', '#ffffff')
    setLexiconTagColor(p, 'first', undefined)
    expect(JSON.stringify(p.lexemes)).toBe(before)
  })
})
describe('part-of-speech colors and compatibility', () => {
  it('compound parts and an independently colored compound keep their own colors', () => {
    const { p } = fixture()
    p.posList = [
      { id: 'n', name: { en: 'Noun' }, abbr: 'N', paradigmId: null, color: '#123456' },
      { id: 'v', name: { en: 'Verb' }, abbr: 'V', paradigmId: null, color: '#abcdef' }
    ]
    const result = ensureCompoundPos(p, ['n', 'v'])!
    expect(result.created).toBe(true)
    expect(result.pos.color).toBeUndefined()
    result.pos.color = '#ff0000'
    p.posList[0].name = { en: 'Renamed' }
    expect(result.pos.components).toEqual(['n', 'v'])
    expect(p.posList.map((pos) => pos.color)).toEqual(['#123456', '#abcdef', '#ff0000'])
    expect(ensureCompoundPos(p, ['v', 'n'])!.pos.color).toBe('#ff0000')
  })
  it.each(['json', 'folder'] as const)(
    '%s keeps tag and POS colors without changing records',
    (format) => {
      const { p, word } = fixture()
      word.tags = ['tag']
      setLexiconTagColor(p, 'tag', '#123456')
      p.posList = [{ id: 'n', name: { en: 'Noun' }, abbr: 'N', paradigmId: null, color: '#abcdef' }]
      word.posId = 'n'
      const back =
        format === 'json'
          ? parseProject(serializeProject(p))
          : projectFromFolder(projectToFolder(p))
      expect(back.settings.lexiconTagColors).toEqual(p.settings.lexiconTagColors)
      expect(back.posList).toEqual(p.posList)
      expect(back.lexemes).toEqual(p.lexemes)
    }
  )
  it('old projects gain no explicit color fields and retain their existing POS and tags', () => {
    const { p, word } = fixture()
    word.tags = ['legacy']
    p.posList = [{ id: 'old', name: { en: 'Old' }, abbr: 'O', paradigmId: null }]
    const back = parseProject(serializeProject(p))
    expect(back.settings).not.toHaveProperty('lexiconTagColors')
    expect(back.posList[0]).not.toHaveProperty('color')
    expect(back.lexemes[0].tags).toEqual(['legacy'])
  })
  it('malformed colors are cleaned on read and never become CSS', () => {
    const { p } = fixture(),
      raw = JSON.parse(serializeProject(p))
    raw.settings.lexiconTagColors = { safe: '#ABC', unsafe: 'url(x)' }
    raw.posList = [
      { id: 'bad', name: {}, abbr: '', paradigmId: null, color: 'red' },
      { id: 'safe', name: {}, abbr: '', paradigmId: null, color: '#ABC' }
    ]
    const back = parseProject(JSON.stringify(raw))
    expect(back.settings.lexiconTagColors).toEqual({ safe: '#aabbcc' })
    expect(back.posList[0]).not.toHaveProperty('color')
    expect(back.posList[1].color).toBe('#aabbcc')
  })
})
