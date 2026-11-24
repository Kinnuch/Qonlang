/** 词关系图的纯拓扑；不依赖界面、坐标或可变项目缓存。 */
import type { Etymology, Id, LocalizedText, Project } from './model'
import { looseKey, morphemeLabel, splitSourceForm } from './etymology'
import { canonicalG } from '$lib/ipa/equivalence'

export type GraphGroup = 'sources' | 'derived' | 'cognates' | 'relations' | 'synonyms'
export interface GNode {
  key: string
  label: string
  sub: string
  lexemeId: Id | null
  morphemeId: Id | null
  kind: 'lexeme' | 'morpheme' | 'external'
  languageId: Id | null
  languageLabel: string
}
export interface GraphLabel {
  kind: 'source' | 'etymology' | 'stage' | 'relation' | 'cognate' | 'synonym'
  value?: string
  sourceKind?: 'lexeme' | 'morpheme' | 'external'
  part?: number
  parts?: number
}
export interface GraphEdge {
  key: string
  from: string
  to: string
  type: 'source' | 'stage' | 'relation' | 'cognate' | 'synonym'
  directed: boolean
  label: GraphLabel
}
export interface GraphLink {
  node: GNode
  edge: GraphEdge
  group: GraphGroup
  reversed: boolean
}
export interface LexemeGraphModel {
  nodes: ReadonlyMap<string, GNode>
  linksOf: (key: string) => GraphLink[]
  /** 遍历器按需生成同源 / 同义边，避免预先构建大群的完全图。 */
  neighborsOf: (key: string) => Iterable<GraphLink>
}
export interface GraphCollectOptions {
  depth?: number
  expanded?: ReadonlySet<string>
  collapsed?: ReadonlySet<string>
  maxNodes?: number
  maxEdges?: number
}
export interface CollectedGraphNode {
  node: GNode
  depth: number
  parent: string | null
  group: GraphGroup | null
}
export interface CollectedGraphEdge extends GraphEdge {
  tree: boolean
}
export interface CollectedLexemeGraph {
  centerKey: string
  nodes: CollectedGraphNode[]
  edges: CollectedGraphEdge[]
  byKey: Map<string, CollectedGraphNode>
  treeEdgeKeys: Set<string>
  legend: { key: GraphGroup; n: number }[]
  truncated: boolean
  nodeLimitReached: boolean
  edgeLimitReached: boolean
  /** 预算停止前已遇到的未展示节点数，是下界，不为计数继续枚举整个连通分量。 */
  omittedNodes: number
}
export interface GraphLabelTools {
  t: (key: string) => string
  etymology: (value: string) => string
  relation: (value: string) => string
}

/** 沿用现有翻译工具；自定义词源 / 标注关系交回原标签函数。 */
export function graphLabelText(label: GraphLabel, tools: GraphLabelTools): string {
  let text: string
  if (label.kind === 'source')
    text = tools.t(
      label.sourceKind === 'morpheme'
        ? 'morphemes.title'
        : `lexicon.sourceKinds.${label.sourceKind ?? 'external'}`
    )
  else if (label.kind === 'etymology')
    text = tools.etymology(label.value ?? '') || tools.t('lexicon.groups.derived')
  else if (label.kind === 'stage') text = tools.t('lexicon.etyAddStage')
  else if (label.kind === 'relation') text = tools.relation(label.value ?? '')
  else text = tools.t(`lexicon.groups.${label.kind === 'cognate' ? 'cognates' : 'synonyms'}`)
  return label.parts && label.parts > 1 ? `${text} ${label.part}/${label.parts}` : text
}

const GROUPS: GraphGroup[] = ['sources', 'derived', 'cognates', 'relations', 'synonyms']
const fold = (s: string): string =>
  canonicalG(s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim())
const strip = (s: string): string => s.replace(/^[-=*·]+|[-=*·]+$/g, '').trim()
const tuple = (...values: unknown[]): string => JSON.stringify(values)
const pick = (text: LocalizedText | undefined, langs: string[]): string => {
  if (!text) return ''
  return langs.map((l) => text[l]).find(Boolean) ?? Object.values(text).find(Boolean) ?? ''
}
export const externalGraphKey = (language: string, piece: string): string =>
  `x:${language.trim().toLowerCase()}|${fold(strip(piece))}`

/** 与 resolveFormInLanguage 同一优先级的索引；模糊档仍用候选自身语言的 matchIgnore。 */
function formResolver(project: Project): {
  language: (name: string) => Project['languages'][number] | undefined
  resolve: (language: string, form: string) => string | undefined
} {
  const languages = new Map<string, Project['languages'][number]>()
  for (const l of project.languages)
    if (!languages.has(l.name.trim().toLowerCase())) languages.set(l.name.trim().toLowerCase(), l)
  for (const l of project.languages)
    if (!languages.has(l.abbr.trim().toLowerCase())) languages.set(l.abbr.trim().toLowerCase(), l)
  const language = (name: string): Project['languages'][number] | undefined =>
    name.trim() ? languages.get(name.trim().toLowerCase()) : undefined
  const ignores = new Map(project.languages.map((l) => [l.id, l.matchIgnore ?? '']))
  const exact = new Map<string, string>(),
    lower = new Map<string, string>(),
    folded = new Map<string, string>()
  const loose = new Map<string, Map<string, { key: string; order: number }>>()
  const scopedLoose = new Map<string, Map<string, string>>()
  const remember = (map: Map<string, string>, scope: string, text: string, key: string): void => {
    const k = tuple(scope, text)
    if (!map.has(k)) map.set(k, key)
  }
  const forms = [
    ...project.lexemes.map((l) => ({ key: `l:${l.id}`, languageId: l.languageId, form: l.lemma })),
    ...project.morphemes.map((m) => ({ key: `m:${m.id}`, languageId: m.languageId, form: m.form }))
  ]
  forms.forEach((item, order) => {
    // 此处沿用原解析器的清理边界，不把存下的词形改写为查询键。
    const clean = item.form.replace(/^[-=*·]+|[-=·]+$/g, '')
    for (const scope of ['*', item.languageId]) {
      remember(exact, scope, canonicalG(clean), item.key)
      remember(lower, scope, canonicalG(clean.toLowerCase()), item.key)
      remember(folded, scope, fold(clean), item.key)
    }
    const ignore = ignores.get(item.languageId) ?? ''
    const k = looseKey(clean, ignore)
    if (!loose.has(ignore)) loose.set(ignore, new Map())
    if (!loose.get(ignore)!.has(k)) loose.get(ignore)!.set(k, { key: item.key, order })
    if (!scopedLoose.has(item.languageId)) scopedLoose.set(item.languageId, new Map())
    if (!scopedLoose.get(item.languageId)!.has(k))
      scopedLoose.get(item.languageId)!.set(k, item.key)
  })
  return {
    language,
    resolve: (name, form) => {
      const clean = form.replace(/^\*+/, '').trim()
      if (!clean) return undefined
      const lang = language(name),
        scope = lang?.id ?? '*'
      const hit =
        exact.get(tuple(scope, canonicalG(clean))) ??
        lower.get(tuple(scope, canonicalG(clean.toLowerCase()))) ??
        folded.get(tuple(scope, fold(clean)))
      if (hit) return hit
      if (lang) {
        const key = looseKey(clean, ignores.get(lang.id) ?? '')
        return key ? scopedLoose.get(lang.id)?.get(key) : undefined
      }
      let best: { key: string; order: number } | undefined
      for (const [ignore, index] of loose) {
        const key = looseKey(clean, ignore)
        const candidate = key ? index.get(key) : undefined
        if (candidate && (!best || candidate.order < best.order)) best = candidate
      }
      return best?.key
    }
  }
}

function groupOf(edge: GraphEdge, key: string): GraphGroup {
  if (edge.type === 'source' || edge.type === 'stage')
    return edge.to === key ? 'sources' : 'derived'
  return edge.type === 'cognate' ? 'cognates' : edge.type === 'synonym' ? 'synonyms' : 'relations'
}

/**
 * 项目相关字段变更时重建一次；显式边建邻接表，同源 / 同义仅记群成员，查询时才生成边。
 * 不对关系施加旧的 16/24/40 条静默截断，由收集器统一报告预算。
 */
export function createLexemeGraph(project: Project, glossLangs: string[]): LexemeGraphModel {
  const nodes = new Map<string, GNode>()
  const langById = new Map(project.languages.map((l) => [l.id, l]))
  const languageLabel = (id: Id): string => langById.get(id)?.abbr || langById.get(id)?.name || ''
  for (const l of project.lexemes)
    nodes.set(`l:${l.id}`, {
      key: `l:${l.id}`,
      label: l.lemma,
      sub: pick(l.senses[0]?.definition, glossLangs),
      lexemeId: l.id,
      morphemeId: null,
      kind: 'lexeme',
      languageId: l.languageId,
      languageLabel: languageLabel(l.languageId)
    })
  for (const m of project.morphemes)
    nodes.set(`m:${m.id}`, {
      key: `m:${m.id}`,
      label: morphemeLabel(m) || '?',
      sub: m.gloss || pick(m.meaning, glossLangs),
      lexemeId: null,
      morphemeId: m.id,
      kind: 'morpheme',
      languageId: m.languageId,
      languageLabel: languageLabel(m.languageId)
    })
  const resolver = formResolver(project)
  const adjacency = new Map<string, GraphEdge[]>()
  const edges = new Map<string, GraphEdge>()
  const addEdge = (edge: GraphEdge): void => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to) || edges.has(edge.key)) return
    edges.set(edge.key, edge)
    for (const key of new Set([edge.from, edge.to])) {
      if (!adjacency.has(key)) adjacency.set(key, [])
      adjacency.get(key)!.push(edge)
    }
  }
  const sourceEdge = (
    from: string,
    to: string,
    ety: Etymology,
    sourceKind: GraphLabel['sourceKind'],
    part?: number,
    parts?: number
  ): void => {
    addEdge({
      key: tuple('source', from, to),
      from,
      to,
      type: 'source',
      directed: true,
      label: {
        kind: 'etymology',
        value: ety.type,
        sourceKind,
        ...(parts && parts > 1 ? { part, parts } : {})
      }
    })
  }
  const origins = new Map<string, Set<string>>(),
    definitions = new Map<string, Set<string>>()
  const originsOf = new Map<string, Set<string>>(),
    definitionsOf = new Map<string, Set<string>>()
  const addMember = (
    index: Map<string, Set<string>>,
    reverse: Map<string, Set<string>>,
    group: string,
    key: string
  ): void => {
    if (!index.has(group)) index.set(group, new Set())
    index.get(group)!.add(key)
    if (!reverse.has(key)) reverse.set(key, new Set())
    reverse.get(key)!.add(group)
  }
  const morphemeForms = new Map<string, string[]>()
  for (const m of project.morphemes) {
    const piece = fold(strip(m.form))
    if (!piece) continue
    const key = tuple(m.languageId, piece)
    if (!morphemeForms.has(key)) morphemeForms.set(key, [])
    morphemeForms.get(key)!.push(`m:${m.id}`)
  }
  const external = (
    language: string,
    form: string,
    meaning: string
  ): { key: string; part: number; parts: number; piece: string }[] => {
    const pieces = splitSourceForm(project, form)
    const list = pieces.length > 1 ? pieces : [form.replace(/^\*+/, '').trim() || form]
    const lang = resolver.language(language),
      tag = lang?.abbr || lang?.name || language
    return list
      .filter((piece) => piece.trim())
      .map((piece, i) => {
        const hit = resolver.resolve(language, piece)
        if (hit) return { key: hit, part: i + 1, parts: list.length, piece }
        const key = externalGraphKey(language, piece)
        if (!nodes.has(key))
          nodes.set(key, {
            key,
            label: (list.length === 1 && form.startsWith('*') ? '*' : '') + piece,
            sub: [tag, list.length === 1 ? meaning : ''].filter(Boolean).join(' · '),
            lexemeId: null,
            morphemeId: null,
            kind: 'external',
            languageId: lang?.id ?? null,
            languageLabel: tag
          })
        else if (
          list.length === 1 &&
          meaning &&
          !nodes.get(key)!.sub.split(' · ').includes(meaning)
        ) {
          const old = nodes.get(key)!
          nodes.set(key, { ...old, sub: [old.sub, meaning].filter(Boolean).join(' · ') })
        }
        return { key, part: i + 1, parts: list.length, piece }
      })
  }
  const owners = [
    ...project.lexemes.map((l) => ({ key: `l:${l.id}`, ety: l.etymology, lexeme: true })),
    ...project.morphemes.map((m) => ({ key: `m:${m.id}`, ety: m.etymology, lexeme: false }))
  ]
  for (const owner of owners) {
    for (const s of owner.ety.sources) {
      if (s.kind !== 'external') {
        const key = `${s.kind === 'lexeme' ? 'l' : 'm'}:${s.id}`
        if (nodes.has(key)) sourceEdge(key, owner.key, owner.ety, s.kind)
        if (owner.lexeme) addMember(origins, originsOf, tuple('source', key), owner.key)
      } else {
        if (owner.lexeme && s.form)
          addMember(origins, originsOf, tuple('external', canonicalG(s.form)), owner.key)
        for (const part of external(s.language, s.form, s.meaning)) {
          sourceEdge(part.key, owner.key, owner.ety, 'external', part.part, part.parts)
          // 旧图从语素侧还能找到自定义来源里的同语言同成分，保留这条反查路径。
          const lang = resolver.language(s.language)
          if (lang)
            for (const key of morphemeForms.get(tuple(lang.id, fold(strip(part.piece)))) ?? [])
              sourceEdge(key, owner.key, owner.ety, 'morpheme')
        }
      }
    }
    for (const stage of owner.ety.stages) {
      if (!stage.form) continue
      for (const part of external('', stage.form, ''))
        addEdge({
          key: tuple('stage', part.key, owner.key, stage.id),
          from: part.key,
          to: owner.key,
          type: 'stage',
          directed: true,
          label: {
            kind: 'stage',
            value: stage.type || owner.ety.type,
            ...(part.parts > 1 ? { part: part.part, parts: part.parts } : {})
          }
        })
    }
  }
  for (const l of project.lexemes) {
    const from = `l:${l.id}`
    for (const r of l.relations) {
      const to = `l:${r.lexemeId}`
      addEdge({
        key: tuple('relation', from, to, r.kind),
        from,
        to,
        type: 'relation',
        directed: true,
        label: { kind: 'relation', value: r.kind }
      })
    }
    for (const s of l.senses)
      for (const text of Object.values(s.definition)) {
        const definition = text.trim()
        if (definition) addMember(definitions, definitionsOf, tuple(l.languageId, definition), from)
      }
  }
  const virtual = function* (key: string, type: 'cognate' | 'synonym'): Iterable<GraphEdge> {
    const index = type === 'cognate' ? origins : definitions,
      reverse = type === 'cognate' ? originsOf : definitionsOf
    const seen = new Set<string>([key])
    for (const group of reverse.get(key) ?? [])
      for (const other of index.get(group) ?? []) {
        if (seen.has(other)) continue
        seen.add(other)
        const [from, to] = [key, other].sort()
        yield { key: tuple(type, from, to), from, to, type, directed: false, label: { kind: type } }
      }
  }
  const neighborsOf = function* (key: string): Iterable<GraphLink> {
    if (!nodes.has(key)) return
    for (const group of GROUPS) {
      const list =
        group === 'cognates'
          ? virtual(key, 'cognate')
          : group === 'synonyms'
            ? virtual(key, 'synonym')
            : (adjacency.get(key) ?? [])
      for (const edge of list) {
        if (groupOf(edge, key) !== group) continue
        const node = nodes.get(edge.from === key ? edge.to : edge.from)!
        yield { node, edge, group, reversed: edge.directed && edge.to === key }
      }
    }
  }
  return { nodes, neighborsOf, linksOf: (key) => [...neighborsOf(key)] }
}

/** 真正按最短距离分层；折叠只阻断该分支，其他父节点仍可到达共享节点。 */
export function collectLexemeGraph(
  model: LexemeGraphModel,
  centerKey: string,
  options: GraphCollectOptions = {}
): CollectedLexemeGraph {
  const budget = (value: number | undefined, fallback: number, min: number, max: number): number =>
    value === undefined || !Number.isFinite(value)
      ? fallback
      : Math.max(min, Math.min(max, Math.floor(value)))
  const maxNodes = budget(options.maxNodes, 300, 1, 1500),
    maxEdges = budget(options.maxEdges, 1200, 0, 6000),
    depth = options.depth === Infinity ? 1500 : budget(options.depth, 1, 0, 1500)
  const root = model.nodes.get(centerKey),
    nodes: CollectedGraphNode[] = root ? [{ node: root, depth: 0, parent: null, group: null }] : []
  const byKey = new Map(nodes.map((n) => [n.node.key, n])),
    treeEdges = new Map<string, GraphEdge>(),
    treeEdgeKeys = new Set<string>(),
    omitted = new Set<string>()
  let nodeLimitReached = false,
    edgeLimitReached = false
  traversal: for (let i = 0; i < nodes.length; i++) {
    const current = nodes[i],
      key = current.node.key
    if (options.collapsed?.has(key) || !(current.depth < depth || options.expanded?.has(key)))
      continue
    for (const link of model.neighborsOf(key)) {
      if (byKey.has(link.node.key)) continue
      if (nodes.length >= maxNodes || treeEdges.size >= maxEdges) {
        omitted.add(link.node.key)
        if (nodes.length >= maxNodes) nodeLimitReached = true
        if (treeEdges.size >= maxEdges) edgeLimitReached = true
        // 预算已满，再扫其余展开节点不能增加可见节点；只记已遇到的遗漏下界。
        break traversal
      }
      const next = { node: link.node, depth: current.depth + 1, parent: key, group: link.group }
      nodes.push(next)
      byKey.set(link.node.key, next)
      treeEdges.set(link.edge.key, link.edge)
      treeEdgeKeys.add(link.edge.key)
    }
  }
  const edges: CollectedGraphEdge[] = [...treeEdges.values()].map((edge) => ({
      ...edge,
      tree: true
    })),
    edgeKeys = new Set(treeEdgeKeys)
  outer: for (const current of nodes)
    for (const link of model.neighborsOf(current.node.key)) {
      const edge = link.edge
      if (!byKey.has(link.node.key) || edgeKeys.has(edge.key)) continue
      if (edges.length >= maxEdges) {
        edgeLimitReached = true
        break outer
      }
      edges.push({ ...edge, tree: false })
      edgeKeys.add(edge.key)
    }
  const legend: CollectedLexemeGraph['legend'] = []
  if (root) {
    const seen = new Map<GraphGroup, Set<string>>()
    for (const link of model.neighborsOf(centerKey)) {
      if (!seen.has(link.group)) seen.set(link.group, new Set())
      seen.get(link.group)!.add(link.node.key)
    }
    for (const key of GROUPS) if (seen.get(key)?.size) legend.push({ key, n: seen.get(key)!.size })
  }
  for (const key of byKey.keys()) omitted.delete(key)
  return {
    centerKey,
    nodes,
    edges,
    byKey,
    treeEdgeKeys,
    legend,
    truncated: nodeLimitReached || edgeLimitReached,
    nodeLimitReached,
    edgeLimitReached,
    omittedNodes: omitted.size
  }
}
