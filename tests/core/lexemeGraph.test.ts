import { describe, expect, it } from 'vitest'
import { createLanguage, createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import type { Lexeme, Project } from '$lib/core/model'
import { resolveFormInLanguage } from '$lib/core/etymology'
import {
  collectLexemeGraph,
  createLexemeGraph,
  externalGraphKey,
  graphLabelText
} from '$lib/core/lexemeGraph'

const project = (): Project =>
  createProject({ name: 'Graph QA', template: 'blank', uiLocale: 'zh', appVersion: '1.0.5' })
const lex = (p: Project, name: string, parents: Lexeme[] = []): Lexeme => {
  const l = createLexeme(p.languages[0].id, name)
  l.id = name
  l.etymology.type = 'derived'
  l.etymology.sources = parents.map((x) => ({ kind: 'lexeme', id: x.id }))
  p.lexemes.push(l)
  return l
}
const model = (p: Project) => createLexemeGraph(p, ['zh', 'en'])
const keys = (graph: ReturnType<typeof collectLexemeGraph>) => graph.nodes.map((x) => x.node.key)

describe('词关系纯拓扑与遍历', () => {
  it('按真实最短距离BFS，保留多父边与边界节点之间的非树连线', () => {
    const p = project(),
      a = lex(p, 'a'),
      b = lex(p, 'b', [a]),
      c = lex(p, 'c', [a])
    lex(p, 'd', [b, c])
    const g = model(p),
      one = collectLexemeGraph(g, 'l:a', { depth: 1 }),
      two = collectLexemeGraph(g, 'l:a', { depth: 2 })
    expect(keys(one)).toEqual(['l:a', 'l:b', 'l:c'])
    expect(
      one.edges.some((e) => e.type === 'cognate' && !e.tree && new Set([e.from, e.to]).has('l:b'))
    ).toBe(true)
    expect(two.byKey.get('l:d')).toMatchObject({ depth: 2, parent: 'l:b' })
    expect(
      two.edges
        .filter((e) => e.type === 'source' && e.to === 'l:d')
        .map((e) => e.from)
        .sort()
    ).toEqual(['l:b', 'l:c'])
    expect(two.treeEdgeKeys.size).toBe(two.nodes.length - 1)
  })

  it('局部展开只加一圈，收起不让不可达的旧展开项复活；共享后代仍可从另一父到达', () => {
    const p = project(),
      a = lex(p, 'a'),
      b = lex(p, 'b', [a]),
      c = lex(p, 'c', [a]),
      d = lex(p, 'd', [b, c])
    lex(p, 'e', [d])
    const g = model(p),
      expanded = new Set(['l:b', 'l:d'])
    expect(keys(collectLexemeGraph(g, 'l:a', { depth: 1, expanded }))).toContain('l:e')
    expect(
      keys(collectLexemeGraph(g, 'l:a', { depth: 1, expanded, collapsed: new Set(['l:b']) }))
    ).toEqual(['l:a', 'l:b', 'l:c'])
    expanded.add('l:c')
    expect(
      keys(collectLexemeGraph(g, 'l:a', { depth: 1, expanded, collapsed: new Set(['l:b']) }))
    ).toContain('l:e')
    expect(keys(collectLexemeGraph(g, 'l:a', { depth: 0, expanded: new Set(['l:a']) }))).toEqual([
      'l:a',
      'l:b',
      'l:c'
    ])
  })

  it('环、自环和双向标注不会重复节点或无限遍历', () => {
    const p = project(),
      a = lex(p, 'a'),
      b = lex(p, 'b', [a]),
      c = lex(p, 'c', [b])
    a.etymology.sources = [{ kind: 'lexeme', id: c.id }]
    a.relations = [
      { kind: 'custom', lexemeId: a.id },
      { kind: 'contrast', lexemeId: b.id }
    ]
    b.relations = [{ kind: 'contrast', lexemeId: a.id }]
    const graph = collectLexemeGraph(model(p), 'l:a', { depth: 100 })
    expect(new Set(keys(graph)).size).toBe(3)
    expect(graph.edges.filter((e) => e.type === 'source')).toHaveLength(3)
    expect(graph.edges.filter((e) => e.type === 'relation')).toHaveLength(3)
    expect(graph.edges.some((e) => e.from === e.to && !e.tree)).toBe(true)
    expect(graph.truncated).toBe(false)
  })

  it('重复同种边去重，同对节点的来源、标注、同源与同义语义都保留', () => {
    const p = project(),
      root = lex(p, 'root'),
      a = lex(p, 'a', [root]),
      b = lex(p, 'b', [root, a])
    a.senses[0].definition = { zh: '相同释义' }
    b.senses[0].definition = { zh: '相同释义' }
    b.etymology.sources.push({ kind: 'lexeme', id: a.id })
    a.relations = [
      { kind: 'custom', lexemeId: b.id },
      { kind: 'custom', lexemeId: b.id }
    ]
    const graph = collectLexemeGraph(model(p), 'l:a', { depth: 1 })
    const pair = graph.edges.filter(
      (e) => new Set([e.from, e.to]).has('l:a') && new Set([e.from, e.to]).has('l:b')
    )
    expect(pair.map((e) => e.type).sort()).toEqual(['cognate', 'relation', 'source', 'synonym'])
    expect(new Set(pair.map((e) => e.key)).size).toBe(4)
  })

  it('语素自己的来源、环缀形式、直接与自定义来源的反查路径都保留', () => {
    const p = project(),
      base = createMorpheme(p.languages[0].id),
      m = createMorpheme(p.languages[0].id, 'circumfix')
    base.id = 'base'
    base.form = 'pa'
    m.id = 'circ'
    m.form = 'pre'
    m.form2 = 'post'
    m.etymology.sources = [{ kind: 'morpheme', id: base.id }]
    p.morphemes.push(base, m)
    const a = lex(p, 'a')
    a.etymology.sources = [{ kind: 'morpheme', id: m.id }]
    const written = lex(p, 'written')
    written.etymology.sources = [
      { kind: 'external', language: p.languages[0].name, form: 'PRE', meaning: '' }
    ]
    const g = model(p)
    expect(g.nodes.get('m:circ')?.label).toBe('pre…post')
    expect(
      g
        .linksOf('m:circ')
        .filter((l) => l.group === 'derived')
        .map((l) => l.node.key)
    ).toEqual(['l:a', 'l:written'])
    const expanded = new Set(['m:circ'])
    expect(keys(collectLexemeGraph(g, 'l:a', { depth: 1, expanded }))).toContain('m:base')
  })

  it('未知外来词成分独立保留语言、字形与含义，中间态可回查拥有者', () => {
    const p = project(),
      a = lex(p, 'a'),
      b = lex(p, 'b')
    a.etymology.sources = [
      { kind: 'external', language: 'Outside', form: '*ɡá + tu', meaning: 'parts' }
    ]
    b.etymology.sources = [
      { kind: 'external', language: 'outside', form: 'gA', meaning: 'other meaning' }
    ]
    a.etymology.stages = [{ id: 'historic', form: 'middle', type: 'custom stage', notes: '' }]
    const g = model(p),
      ga = externalGraphKey('Outside', 'ɡá')
    expect(g.nodes.get(ga)?.label).toBe('ɡá')
    expect(g.nodes.get(ga)?.sub).toContain('other meaning')
    expect(
      g
        .linksOf(ga)
        .filter((l) => l.group === 'derived')
        .map((l) => l.node.key)
    ).toEqual(['l:a', 'l:b'])
    expect(
      g
        .linksOf(externalGraphKey('', 'middle'))
        .some((l) => l.node.key === 'l:a' && l.edge.type === 'stage')
    ).toBe(true)
    const sourceEdges = g.linksOf('l:a').filter((l) => l.edge.type === 'source')
    expect(sourceEdges.map((l) => l.edge.label.part)).toEqual([1, 2])
  })

  it('自定义外来词解析与旧纯解析器保持各匹配档优先级、跨语言与忽略字符', () => {
    const p = project(),
      other = createLanguage({ name: 'Other', abbr: 'OT', matchIgnore: '1.' })
    p.languages.push(other)
    const a = lex(p, 'ges')
    a.lemma = 'gēs'
    const foreign = lex(p, 'foreign')
    foreign.languageId = other.id
    foreign.lemma = 'h₁.a'
    const m = createMorpheme(p.languages[0].id)
    m.id = 'exact'
    m.form = 'ges'
    p.morphemes.push(m)
    const cases: [[string, string], ...[string, string][]] = [
      [p.languages[0].name, 'ges'],
      [p.languages[0].name, 'GĒS'],
      ['OT', 'ha'],
      ['unknown', 'ges'],
      ['', 'ɡēs']
    ]
    for (const [i, [language, form]] of cases.entries()) {
      const owner = lex(p, 'owner' + i)
      owner.etymology.sources = [{ kind: 'external', language, form, meaning: '' }]
      const expected = resolveFormInLanguage(p, language, form)!
      const links = model(p)
        .linksOf('l:' + owner.id)
        .filter((l) => l.edge.type === 'source')
      expect(
        links.some((l) => l.node.key === `${expected.kind === 'lexeme' ? 'l' : 'm'}:${expected.id}`)
      ).toBe(true)
    }
  })

  it('同源保留旧的完整外来来源形判据，g/ɡ同值，节点语言仍分开', () => {
    const p = project(),
      a = lex(p, 'a'),
      b = lex(p, 'b')
    a.etymology.sources = [{ kind: 'external', language: 'Outside A', form: 'ɡa', meaning: '' }]
    b.etymology.sources = [{ kind: 'external', language: 'Outside B', form: 'ga', meaning: '' }]
    const g = model(p)
    expect(g.linksOf('l:a').some((l) => l.node.key === 'l:b' && l.group === 'cognates')).toBe(true)
    expect(g.nodes.has(externalGraphKey('Outside A', 'ga'))).toBe(true)
    expect(g.nodes.has(externalGraphKey('Outside B', 'ga'))).toBe(true)
  })

  it('同义仍是同语言完整释义一致，其他语言不混入；断链不生成虚假实体', () => {
    const p = project(),
      a = lex(p, 'a'),
      b = lex(p, 'b'),
      c = lex(p, 'c')
    a.senses[0].definition = { zh: '义项' }
    b.senses[0].definition = { en: ' 义项 ' }
    c.senses[0].definition = { zh: '义项' }
    c.languageId = 'different'
    a.relations = [{ kind: 'custom', lexemeId: 'missing' }]
    a.etymology.sources = [{ kind: 'morpheme', id: 'missing' }]
    const g = model(p)
    expect(g.linksOf('l:a').map((l) => l.node.key)).toEqual(['l:b'])
    expect(g.linksOf('l:missing')).toEqual([])
    expect(collectLexemeGraph(g, 'l:missing').nodes).toEqual([])
  })

  it('不改工程数据；重建读取实际修改，标识稳定', () => {
    const p = project(),
      a = lex(p, 'a'),
      b = lex(p, 'b', [a]),
      snapshot = JSON.stringify(p)
    const first = collectLexemeGraph(model(p), 'l:a', { depth: 2 })
    expect(collectLexemeGraph(model(p), 'l:a', { depth: 2 })).toEqual(first)
    expect(JSON.stringify(p)).toBe(snapshot)
    b.etymology.sources = []
    expect(keys(collectLexemeGraph(model(p), 'l:a', { depth: 2 }))).toEqual(['l:a'])
  })

  it('统一节点与边预算会报告截断，树边优先且不输出无端点边', () => {
    const p = project(),
      a = lex(p, 'a')
    for (let i = 0; i < 20; i++) lex(p, 'child' + i, [a])
    const g = model(p),
      small = collectLexemeGraph(g, 'l:a', { depth: 2, maxNodes: 5, maxEdges: 6 })
    expect(small.nodes).toHaveLength(5)
    expect(small.edges).toHaveLength(6)
    expect(small.truncated && small.nodeLimitReached && small.edgeLimitReached).toBe(true)
    expect(small.omittedNodes).toBeGreaterThan(0)
    expect(small.edges.filter((e) => e.tree)).toHaveLength(4)
    expect(small.edges.every((e) => small.byKey.has(e.from) && small.byKey.has(e.to))).toBe(true)
    expect(collectLexemeGraph(g, 'l:a', { maxEdges: 0 }).nodes).toHaveLength(1)
  })

  it('大共同词根群只按需生成可见边，遵守统一硬上限', () => {
    const p = project(),
      root = createMorpheme(p.languages[0].id)
    root.id = 'root'
    root.form = 'pa'
    p.morphemes.push(root)
    for (let i = 0; i < 10000; i++) {
      const x = lex(p, 'word' + i)
      x.etymology.sources = [{ kind: 'morpheme', id: root.id }]
    }
    const graph = collectLexemeGraph(model(p), 'l:word0', {
      depth: 3,
      maxNodes: 100000,
      maxEdges: 100000
    })
    expect(graph.nodes).toHaveLength(1500)
    expect(graph.edges).toHaveLength(6000)
    expect(graph.truncated).toBe(true)
    expect(graph.legend.find((g) => g.key === 'cognates')?.n).toBe(9999)
  })

  it('标签由既有翻译与自定义标签工具转换', () => {
    const tools = {
      t: (key: string) => 't:' + key,
      etymology: (value: string) => 'e:' + value,
      relation: (value: string) => 'r:' + value
    }
    expect(graphLabelText({ kind: 'etymology', value: '自定义' }, tools)).toBe('e:自定义')
    expect(graphLabelText({ kind: 'relation', value: 'custom' }, tools)).toBe('r:custom')
    expect(
      graphLabelText({ kind: 'source', sourceKind: 'external', part: 1, parts: 2 }, tools)
    ).toBe('t:lexicon.sourceKinds.external 1/2')
  })
})
