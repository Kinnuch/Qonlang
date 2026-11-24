import { describe, expect, it } from 'vitest'
import { createLanguage, createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import {
  createGraphColorResolver,
  defaultGraphSettings,
  graphNodeColor,
  normalizeGraphSettings,
  GRAPH_GROUP_LIMIT
} from '$lib/ui/graphSettings'

describe('graph settings validation', () => {
  it('keeps old preferences compatible and creates independent defaults', () => {
    const a = normalizeGraphSettings(undefined),
      b = normalizeGraphSettings(null)
    expect(a).toEqual(defaultGraphSettings())
    expect(a.forces).toEqual({ center: 1, repel: 1, link: 1, length: 160 })
    a.appearance.nodeScale = 2
    a.groups.push({ id: 'x', name: 'X', enabled: true, color: '#123456', field: 'all', value: '' })
    expect(b.appearance.nodeScale).toBe(1)
    expect(b.groups).toEqual([])
  })
  it('clamps all finite ranges while malformed numbers use defaults', () => {
    const got = normalizeGraphSettings({
      depth: 100,
      appearance: {
        nodeScale: -5,
        frameScale: 999,
        labelScale: NaN,
        edgeWidth: 99,
        shape: 'invalid',
        showLabels: false,
        showEdgeLabels: true
      },
      forces: { center: 0, repel: Infinity, link: -1, length: 9999 },
      crossLinks: false
    })
    expect(got.depth).toBe(6)
    expect(got.appearance).toEqual({
      shape: 'dots',
      nodeScale: 0.5,
      frameScale: 2.5,
      labelScale: 1,
      edgeWidth: 5,
      showLabels: false,
      showEdgeLabels: true
    })
    expect(got.forces).toEqual({ center: 0, repel: 1, link: 0, length: 600 })
    expect(got.crossLinks).toBe(false)
  })
  it('rejects CSS expressions, unknown matching fields and duplicate group IDs', () => {
    const got = normalizeGraphSettings({
      nodeColors: { lexeme: 'url(evil)', morpheme: '#ABCDEF', external: 'red' },
      groups: [
        { id: 'same', field: 'tag', value: 'x', color: '#123456' },
        { id: 'same', field: 'all', color: '#654321' },
        { id: 'other', field: 'unknown', color: '#abcdef' },
        { id: 'bad-color', field: 'all', color: 'var(--x)' }
      ]
    })
    expect(got.nodeColors).toEqual({ morpheme: '#abcdef' })
    expect(got.groups.map((g) => g.id)).toEqual(['same'])
  })
  it('bounds group count and stored user text without mutating the input', () => {
    const input = {
      groups: Array.from({ length: 100 }, (_, i) => ({
        id: '' + i,
        name: 'x'.repeat(1000),
        field: 'tag',
        value: 'y'.repeat(1000),
        color: '#abcdef'
      }))
    }
    const got = normalizeGraphSettings(input)
    expect(got.groups).toHaveLength(GRAPH_GROUP_LIMIT)
    expect(got.groups[0].name).toHaveLength(120)
    expect(got.groups[0].value).toHaveLength(500)
    expect(input.groups).toHaveLength(100)
  })
})
describe('graph color groups', () => {
  function fixture() {
    const p = createProject({ name: 'QA', template: 'blank', appVersion: '1', uiLocale: 'en' }),
      other = createLanguage({ name: 'Other' })
    p.languages.push(other)
    p.posList = [
      { id: 'noun', name: { en: 'Noun' }, abbr: 'n', paradigmId: null },
      { id: 'verb', name: { en: 'Verb' }, abbr: 'v', paradigmId: null },
      {
        id: 'compound',
        name: { en: 'N/V' },
        abbr: 'n/v',
        paradigmId: null,
        components: ['noun', 'verb']
      }
    ]
    const word = createLexeme(p.languages[0].id, 'sample')
    word.posId = 'compound'
    word.tags = ['chosen']
    const morpheme = createMorpheme(other.id)
    morpheme.tags = ['chosen']
    p.lexemes.push(word)
    p.morphemes.push(morpheme)
    return {
      p,
      word,
      morpheme,
      node: { kind: 'lexeme' as const, lexemeId: word.id },
      mn: { kind: 'morpheme' as const, morphemeId: morpheme.id }
    }
  }
  it('uses the first enabled matching group and falls back to node category or theme', () => {
    const { p, node } = fixture(),
      s = defaultGraphSettings()
    s.nodeColors.lexeme = '#111111'
    s.groups = [
      { id: 'tag', name: 'Tag', enabled: false, field: 'tag', value: 'chosen', color: '#222222' },
      { id: 'noun', name: 'Noun', enabled: true, field: 'pos', value: 'noun', color: '#333333' },
      { id: 'all', name: 'All', enabled: true, field: 'all', value: '', color: '#444444' }
    ]
    expect(graphNodeColor(s, node, p)).toBe('#333333')
    s.groups[0].enabled = true
    expect(graphNodeColor(s, node, p)).toBe('#222222')
    s.groups = []
    expect(graphNodeColor(s, node, p)).toBe('#111111')
    s.nodeColors = {}
    expect(graphNodeColor(s, node, p)).toBeNull()
  })
  it('matches composite and sense-specific POS, tags and project language IDs', () => {
    const { p, word, node, morpheme, mn } = fixture(),
      s = defaultGraphSettings()
    word.senses[0].posId = 'verb'
    s.groups = [
      { id: 'x', name: 'X', enabled: true, field: 'pos', value: 'verb', color: '#123456' }
    ]
    expect(graphNodeColor(s, node, p)).toBe('#123456')
    expect(graphNodeColor(s, mn, p)).toBeNull()
    s.groups[0].field = 'language'
    s.groups[0].value = morpheme.languageId
    expect(graphNodeColor(s, { kind: 'external', languageId: morpheme.languageId }, p)).toBe(
      '#123456'
    )
    expect(
      createGraphColorResolver(p, s)({ kind: 'external', languageId: morpheme.languageId })
    ).toBe('#123456')
    expect(graphNodeColor(s, mn, p)).toBe('#123456')
    expect(graphNodeColor(s, node, p)).toBeNull()
    s.groups[0].field = 'tag'
    s.groups[0].value = 'chosen'
    expect(graphNodeColor(s, mn, p)).toBe('#123456')
    expect(graphNodeColor(s, node, p)).toBe('#123456')
  })
  it('keeps missing selector values inert and all-node rules explicit', () => {
    const { p, node } = fixture(),
      s = defaultGraphSettings()
    s.groups = [{ id: 'x', name: 'X', enabled: true, field: 'tag', value: '', color: '#123456' }]
    expect(graphNodeColor(s, node, p)).toBeNull()
    s.groups[0].field = 'all'
    expect(graphNodeColor(s, { kind: 'external' }, p)).toBe('#123456')
  })
  it('provides the same colors through a batch resolver without changing project data', () => {
    const { p, node, mn } = fixture(),
      s = defaultGraphSettings()
    s.groups = [
      { id: 'x', name: 'X', enabled: true, field: 'tag', value: 'chosen', color: '#123456' }
    ]
    const before = JSON.stringify(p),
      resolve = createGraphColorResolver(p, s)
    expect(resolve(node)).toBe(graphNodeColor(s, node, p))
    expect(resolve(mn)).toBe(graphNodeColor(s, mn, p))
    expect(resolve({ kind: 'external' })).toBeNull()
    expect(JSON.stringify(p)).toBe(before)
  })
  it('reuses one resolver while entry and sense parts of speech are edited', () => {
    const { p, word, node } = fixture(),
      settings = defaultGraphSettings()
    settings.groups = [
      { id: 'noun', name: 'Noun', enabled: true, field: 'pos', value: 'noun', color: '#123456' }
    ]
    const resolve = createGraphColorResolver(p, settings)
    expect(resolve(node)).toBe('#123456')
    word.posId = 'verb'
    expect(resolve(node)).toBeNull()
    word.senses[0].posId = 'noun'
    expect(resolve(node)).toBe('#123456')
    word.senses[0].posId = 'verb'
    expect(resolve(node)).toBeNull()
  })
})
