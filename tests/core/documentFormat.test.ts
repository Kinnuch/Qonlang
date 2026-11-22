import { describe, expect, it } from 'vitest'
import { createDoc, createProject, createSentence, createLanguage } from '$lib/core/factory'
import {
  documentFormat,
  renderDocument,
  documentHtmlPage,
  documentMarkdown,
  safeDocumentHtml,
  documentTextLines
} from '$lib/core/documentFormat'
import { buildSentenceDocReferences } from '$lib/core/docReferences'
import { hasSentenceTextMention } from '$lib/core/docReferences'
import { docLink } from '$lib/core/docLinks'
import {
  parseProject,
  serializeProject,
  projectFromFolder,
  projectToFolder
} from '$lib/core/serialize'

describe('document formats and safety', () => {
  it('keeps old documents Markdown and does not reinterpret HTML-like text', () => {
    const d = { ...createDoc(null, 'Old'), markdown: '**word** <script>alert(1)</script>' }
    expect(documentFormat(d)).toBe('markdown')
    expect(renderDocument(d)).toContain('<strong>word</strong> &lt;script&gt;')
    expect(documentFormat({ format: 'unknown' } as never)).toBe('markdown')
  })
  it('preserves ordinary formatting and reconstructs only allowed attributes', () => {
    const html = safeDocumentHtml(
      '<h2>Title</h2><p dir="rtl" class="fake" id="doc-md">A <b>word</b><br><a href="https://example.org/">link</a></p><table><tr><td colspan="2">cell</td></tr></table>'
    )
    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<p dir="rtl">A <b>word</b><br>')
    expect(html).toContain('colspan="2"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toMatch(/fake|id=/)
  })
  it.each([
    '<img src="https://evil.invalid/x" onerror="alert(1)"><iframe src="https://evil.invalid"></iframe>',
    '<script>location.href="https://evil.invalid"</script><style>@import "https://evil.invalid";</style>',
    '<svg><foreignObject><p onload="evil()">x</p></foreignObject></svg><math><mtext><img src=x></mtext></math>',
    '<form action="https://evil.invalid"><input autofocus onfocus=evil()><button formaction="https://evil.invalid">go</button></form>',
    '<meta http-equiv="refresh" content="0;url=https://evil.invalid"><link rel=stylesheet href="https://evil.invalid">',
    '<p style="background:url(https://evil.invalid)" onclick="evil()" data-kind="sentence" data-id="forged">safe</p>',
    '<a href="jav&#x61;script:evil()">x</a><a href="file:///C:/private">x</a><a href="data:text/html,evil">x</a>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=evil()>">'
  ])('never emits executable or automatically loading markup: %s', (input) => {
    const html = safeDocumentHtml(input)
    expect(html).not.toMatch(
      /<(?:script|style|img|iframe|svg|math|form|input|button|meta|link)\b|\b(?:on\w+|style|src|srcset|data-kind|data-id|id|name)\s*=|(?:javascript|file|data):/i
    )
  })
  it('resolves project links only from text, not attributes or code or forged data attributes', () => {
    const resolve = () => ({ text: 'shown', target: { kind: 'sentence', id: 'real' } })
    const html = safeDocumentHtml(
      '<p title="[[sentence:attr]]">[[sentence:yes]]</p><code>[[sentence:code]]</code><a data-kind="sentence" data-id="fake">fake</a>',
      { resolve }
    )
    expect((html.match(/data-id="real"/g) ?? []).length).toBe(1)
    expect(html).not.toContain('data-id="fake"')
    expect(html).toContain('<code>[[sentence:code]]</code>')
  })
  it('exports safe HTML/PDF input with escaped titles and retains source in project JSON', () => {
    const p = createProject({ name: 'QA', template: 'blank', appVersion: '1', uiLocale: 'en' })
    const doc = {
      ...createDoc(null, '</title><img src=x onerror=evil()>'),
      format: 'html' as const,
      markdown: '<p>safe</p><script>evil()</script>'
    }
    p.docs.push(doc)
    const output = documentHtmlPage(doc)
    expect(output).toContain('&lt;/title&gt;')
    expect(output).not.toMatch(/<script|<img/)
    expect(output).toContain("default-src 'none'")
    expect(parseProject(serializeProject(p)).docs).toEqual(p.docs)
    expect(documentMarkdown(doc)).toBe('safe')
    expect(
      documentTextLines({
        ...doc,
        markdown: '<p title="fake-word">real text</p><script>bad-word</script>'
      })
    ).toEqual(['real text', ''])
  })
  it('bounds recursive rendering for deeply nested pasted HTML', () => {
    expect(() =>
      safeDocumentHtml('<div>'.repeat(2000) + 'text' + '</div>'.repeat(2000))
    ).not.toThrow()
    expect(() =>
      documentMarkdown({
        format: 'html',
        markdown: '<div>'.repeat(2000) + 'text' + '</div>'.repeat(2000)
      })
    ).not.toThrow()
  })
  it('roundtrips mixed-format folders with IDs/language/unknown metadata and older MD-only folders', () => {
    const p = createProject({ name: 'QA', template: 'blank', appVersion: '1', uiLocale: 'en' })
    p.docs = [
      { ...createDoc(p.languages[0].id, 'A/B'), markdown: '**first**' },
      { ...createDoc(null, 'a_b'), format: 'html', markdown: '<p>second</p>' }
    ]
    const files = projectToFolder(p)
    expect(Object.keys(files)).toContain('docs/A_B.md')
    expect(Object.keys(files)).toContain('docs/a_b (2).html')
    expect(projectFromFolder(files).docs).toEqual(p.docs)
    delete files['docs.json']
    expect(
      projectFromFolder(files).docs.map((d) => [d.title, documentFormat(d), d.markdown])
    ).toEqual([
      ['A_B', 'markdown', '**first**'],
      ['a_b (2)', 'html', '<p>second</p>']
    ])
    expect(
      projectFromFolder({ ...files, 'docs/../unrelated.html': '<p>not a document</p>' }).docs
    ).toHaveLength(2)
  })
})

describe('sentence backlinks', () => {
  it.each(['“…”', '‘…’', '「…」', '『…』', '"…"', "'…'", '«…»'])(
    'finds a complete sentence inside paired quotation marks: %s',
    (quotes) => {
      const p = createProject({ name: 'QA', template: 'blank', appVersion: '1', uiLocale: 'en' }),
        sentence = createSentence(p.languages[0].id)
      sentence.text = 'ilenler kasoda jatdu.'
      p.sentences.push(sentence)
      const source = '本文以' + quotes.replace('…', sentence.text) + '为例。'
      p.docs = [{ ...createDoc(sentence.languageId, 'Quoted'), markdown: source }]
      expect(
        buildSentenceDocReferences(p)
          .get(sentence.id)
          ?.map((r) => r.kind)
      ).toEqual(['text'])
      expect(hasSentenceTextMention(source, sentence.text)).toBe(true)
      expect(
        hasSentenceTextMention('本文以“' + sentence.text + ' extra”为例。', sentence.text)
      ).toBe(false)
    }
  )
  it('recognizes HTML q and split inline formatting without reading attributes or code', () => {
    const p = createProject({ name: 'QA', template: 'blank', appVersion: '1', uiLocale: 'en' }),
      sentence = createSentence(p.languages[0].id)
    sentence.text = 'ilenler kasoda jatdu.'
    p.sentences.push(sentence)
    p.docs = [
      {
        ...createDoc(sentence.languageId, 'HTML q'),
        format: 'html',
        markdown: `<p>本文以<q>${sentence.text}</q>为例。</p>`
      },
      {
        ...createDoc(sentence.languageId, 'Inline quote'),
        format: 'html',
        markdown: '<p>本文以“<em>ilenler kasoda</em> jatdu.”为例。</p>'
      },
      {
        ...createDoc(sentence.languageId, 'Code/attribute'),
        format: 'html',
        markdown: `<p title='“${sentence.text}”'>not a reference</p><p><code>“${sentence.text}”</code></p><pre><q>${sentence.text}</q></pre>`
      }
    ]
    expect(
      buildSentenceDocReferences(p)
        .get(sentence.id)
        ?.map((r) => r.title)
    ).toEqual(['HTML q', 'Inline quote'])
  })
  it('keeps short explicit links while quoted short text and ambiguous quoted sentences remain unresolved', () => {
    const p = createProject({ name: 'QA', template: 'blank', appVersion: '1', uiLocale: 'en' }),
      sentence = createSentence(p.languages[0].id),
      duplicate = createSentence(p.languages[0].id)
    sentence.text = 'hi.'
    duplicate.text = 'A long sample sentence.'
    p.sentences.push(sentence, duplicate, { ...duplicate, id: 'duplicate' })
    p.docs = [
      { ...createDoc(sentence.languageId, 'Explicit short'), markdown: '[[例句:hi.]]' },
      { ...createDoc(sentence.languageId, 'Short quote'), markdown: 'We say “hi.” here.' },
      {
        ...createDoc(sentence.languageId, 'Ambiguous quote'),
        markdown: 'We use “A long sample sentence.” here.'
      }
    ]
    expect(
      buildSentenceDocReferences(p)
        .get(sentence.id)
        ?.map((r) => r.title)
    ).toEqual(['Explicit short'])
    expect(buildSentenceDocReferences(p).has(duplicate.id)).toBe(false)
  })
  it('uses g/ɡ equivalence for forward links and both backlink kinds without rewriting text', () => {
    const p = createProject({ name: 'QA', template: 'blank', appVersion: '1', uiLocale: 'en' }),
      sentence = createSentence(p.languages[0].id)
    sentence.text = 'A long g sample sentence.'
    p.sentences.push(sentence)
    const source = sentence.text.replaceAll('g', 'ɡ')
    p.docs = [
      { ...createDoc(sentence.languageId, 'Link'), markdown: `[[sentence:${source}]]` },
      { ...createDoc(sentence.languageId, 'Plain'), format: 'html', markdown: `<p>${source}</p>` }
    ]
    expect(docLink(p, 'sentence:' + source, sentence.languageId).hit?.id).toBe(sentence.id)
    expect(
      buildSentenceDocReferences(p)
        .get(sentence.id)
        ?.map((r) => r.kind)
    ).toEqual(['link', 'text'])
    expect(sentence.text).toBe('A long g sample sentence.')
    expect(p.docs[1].markdown).toContain(source)
  })
  function fixture() {
    const p = createProject({ name: 'A', template: 'blank', appVersion: '1', uiLocale: 'en' }),
      b = createLanguage({ name: 'B' })
    p.languages.push(b)
    const a = createSentence(p.languages[0].id),
      other = createSentence(b.id)
    a.text = 'This is a full sentence.'
    other.text = a.text
    p.sentences.push(a, other)
    return { p, a, other }
  }
  it('resolves identical sentences in the document language and does not guess project-wide duplicates', () => {
    const { p, a, other } = fixture()
    expect(docLink(p, 'sentence:' + a.text, a.languageId).hit?.id).toBe(a.id)
    expect(docLink(p, '例句:' + a.text, other.languageId).hit?.id).toBe(other.id)
    expect(docLink(p, 'sentence:' + a.text, null).hit).toBeNull()
    p.sentences.push({ ...a, id: 'duplicate' })
    expect(docLink(p, 'sentence:' + a.text, a.languageId).hit).toBeNull()
  })
  it('indexes multiple MD/HTML documents once per document and ignores code and HTML attributes', () => {
    const { p, a, other } = fixture()
    p.docs = [
      {
        ...createDoc(a.languageId, 'One'),
        markdown: `[[例句:${a.text}]]\n\n\`[[例句:${other.text}]]\``
      },
      {
        ...createDoc(a.languageId, 'Two'),
        format: 'html',
        markdown: `<p>[[sentence:${a.text}]]</p><code>[[sentence:${a.text}]]</code><p title="[[sentence:${a.text}]]">not a sentence</p>`
      },
      { ...createDoc(other.languageId, 'Other'), markdown: `[[sentence:${other.text}]]` }
    ]
    const refs = buildSentenceDocReferences(p)
    expect(refs.get(a.id)?.map((r) => [r.title, r.kind])).toEqual([
      ['One', 'link'],
      ['Two', 'link']
    ])
    expect(refs.get(other.id)?.map((r) => r.title)).toEqual(['Other'])
    p.docs[0].markdown = '```\n[[sentence:' + a.text + ']]\n```'
    expect(
      buildSentenceDocReferences(p)
        .get(a.id)
        ?.map((r) => r.title)
    ).toEqual(['Two'])
  })
  it('marks only independent complete long sentence text, never nearby words, code or ambiguous text', () => {
    const { p, a, other } = fixture()
    p.docs = [
      { ...createDoc(a.languageId, 'Plain'), markdown: a.text },
      { ...createDoc(a.languageId, 'Near'), markdown: 'Before ' + a.text + ' extra' },
      {
        ...createDoc(a.languageId, 'Code'),
        format: 'html',
        markdown: `<code>${a.text}</code><p title="${a.text}">different</p>`
      },
      { ...createDoc(null, 'Ambiguous'), markdown: a.text }
    ]
    expect(
      buildSentenceDocReferences(p)
        .get(a.id)
        ?.map((r) => [r.title, r.kind])
    ).toEqual([['Plain', 'text']])
    expect(buildSentenceDocReferences(p).has(other.id)).toBe(false)
    p.sentences[0].text = 'word'
    p.docs[0].markdown = 'word'
    expect(buildSentenceDocReferences(p).has(a.id)).toBe(false)
  })
})
