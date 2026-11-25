import { describe, expect, it } from 'vitest'
import { createDoc, createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import { referenceOptions, rankReferences } from '$lib/core/referenceSearch'
import { findExamples } from '$lib/core/examples'
import { parseFragment, serialize } from 'parse5'
function project() {
  return createProject({
    name: 'refs',
    template: 'blank',
    uiLocale: 'zh',
    appVersion: '1.1.0-local'
  })
}
describe('record search and document examples', () => {
  it('finds an exact form beyond the old thirty-item cutoff before prefixes and gloss matches', () => {
    const p = project(),
      lid = p.languages[0].id
    for (let i = 0; i < 40; i++) {
      const w = createLexeme(lid, 'abc' + i)
      w.senses[0].definition.en = 'he has'
      p.lexemes.push(w)
    }
    for (const form of ['hen', 'He', 'he']) p.lexemes.push(createLexeme(lid, form))
    const hits = rankReferences(
      p,
      referenceOptions(p, {
        kind: 'lexeme',
        languageId: lid,
        glossLangs: ['en'],
        typeName: (k) => k
      }),
      'he',
      lid,
      4
    )
    expect(hits.slice(0, 2).map((h) => h.label.toLowerCase())).toEqual(['he', 'he'])
    expect(hits[2].label).toBe('hen')
  })
  it('honours custom alphabet, type and local language scope in slots', () => {
    const p = project(),
      l = p.languages[0]
    l.alphabet = ['z', 't', 'a']
    for (const [form, type] of [
      ['a', 'prefix'],
      ['z', 'prefix'],
      ['t', 'root']
    ] as const) {
      const m = createMorpheme(l.id, type)
      m.form = form
      p.morphemes.push(m)
    }
    const other = createMorpheme('other', 'prefix')
    other.form = 'z'
    p.morphemes.push(other)
    const opts = referenceOptions(p, {
      kind: 'morpheme',
      languageId: l.id,
      localOnly: true,
      type: 'prefix',
      glossLangs: ['en'],
      typeName: (k) => k
    })
    expect(rankReferences(p, opts, '', l.id).map((m) => m.label)).toEqual(['z', 'a'])
  })
  it('separates different paragraphs in the same HTML cell', () => {
    const p = project(),
      lid = p.languages[0].id,
      d = createDoc(lid, 'Table')
    d.format = 'html'
    d.markdown = '<table><tr><td><p>fya</p><p>men</p></td></tr></table>'
    p.docs.push(d)
    expect(findExamples(p, createLexeme(lid, 'fyamen'), ['zh'])).toHaveLength(0)
    expect(findExamples(p, createLexeme(lid, 'men'), ['zh'])[0].text).toContain('fya\nmen')
  })
  it.each(['markdown', 'html'] as const)(
    'renders visible table cells, emphasis and term highlights in %s',
    (format) => {
      const p = project(),
        l = p.languages[0],
        w = createLexeme(l.id, 'fyamen'),
        d = createDoc(l.id, 'Lexicon')
      d.format = format
      d.markdown =
        format === 'html'
          ? '<table><tr><td>first</td><td><b>fya</b><i>men</i> term</td></tr></table><script>fyamen</script>'
          : '| first | **fya**men term |'
      p.docs.push(d)
      const hits = findExamples(p, w, ['zh'])
      expect(hits).toHaveLength(1)
      expect(hits[0].text).toContain('fyamen term')
      const html = hits[0].excerptHtml!
      expect(html).toContain('<table>')
      expect(html).toMatch(/<(strong|b)><mark>fya<\/mark>/)
      expect(html).not.toContain('script')
      expect(html).not.toContain('**')
      expect(serialize(parseFragment(html))).toContain('term')
      d.markdown = 'gone'
      expect(findExamples(p, w, ['zh'])).toHaveLength(0)
    }
  )
})
