/** 词关系图的本机设置；与项目数据及手动位置分开。 */
import type { Id, Lexeme, Morpheme, Project } from '$lib/core/model'
import { lexemePosIds } from '$lib/core/pos'

export type GraphNodeKind = 'lexeme' | 'morpheme' | 'external'
export type GraphColorField = 'all' | 'pos' | 'tag' | 'language'
export interface GraphColorGroup {
  id: string
  name: string
  enabled: boolean
  color: string
  field: GraphColorField
  value: string
}
export interface GraphSettings {
  depth: number
  crossLinks: boolean
  appearance: {
    shape: 'dots' | 'cards'
    nodeScale: number
    frameScale: number
    labelScale: number
    showLabels: boolean
    showEdgeLabels: boolean
    edgeWidth: number
  }
  forces: { center: number; repel: number; link: number; length: number }
  groups: GraphColorGroup[]
  /** 缺失则保留主题自身的默认类别配色。 */
  nodeColors: Partial<Record<GraphNodeKind, string>>
}
export interface GraphColorNode {
  kind: GraphNodeKind
  lexemeId?: Id | null
  morphemeId?: Id | null
  languageId?: Id | null
}
export type GraphColorSettings = Pick<GraphSettings, 'groups' | 'nodeColors'>
export const GRAPH_NODE_KINDS: readonly GraphNodeKind[] = ['lexeme', 'morpheme', 'external']
export const GRAPH_COLOR_FIELDS: readonly GraphColorField[] = ['all', 'pos', 'tag', 'language']
export const GRAPH_GROUP_LIMIT = 32
export const GRAPH_RANGES = {
  depth: { min: 0, max: 6, step: 1 },
  nodeScale: { min: 0.5, max: 2.5, step: 0.05 },
  frameScale: { min: 0.5, max: 2.5, step: 0.05 },
  labelScale: { min: 0.5, max: 2, step: 0.05 },
  edgeWidth: { min: 0.25, max: 5, step: 0.25 },
  center: { min: 0, max: 3, step: 0.05 },
  repel: { min: 0, max: 3, step: 0.05 },
  link: { min: 0, max: 3, step: 0.05 },
  length: { min: 40, max: 600, step: 10 }
} as const
export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  depth: 1,
  crossLinks: true,
  appearance: {
    shape: 'dots',
    nodeScale: 1,
    frameScale: 1,
    labelScale: 1,
    showLabels: true,
    showEdgeLabels: false,
    edgeWidth: 1
  },
  forces: { center: 1, repel: 1, link: 1, length: 160 },
  groups: [],
  nodeColors: {}
}
export const defaultGraphSettings = (): GraphSettings => structuredClone(DEFAULT_GRAPH_SETTINGS)
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const text = (value: unknown, max = 120): string =>
  typeof value === 'string' ? value.slice(0, max) : ''
export const graphColor = (value: unknown): string | null =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null

export function normalizeGraphSettings(value: unknown): GraphSettings {
  const raw = record(value),
    a = record(raw.appearance),
    f = record(raw.forces),
    colors = record(raw.nodeColors),
    out = defaultGraphSettings()
  const n = (value: unknown, range: { min: number; max: number }, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(range.min, Math.min(range.max, value))
      : fallback
  out.depth = Math.round(n(raw.depth, GRAPH_RANGES.depth, out.depth))
  if (typeof raw.crossLinks === 'boolean') out.crossLinks = raw.crossLinks
  if (a.shape === 'cards' || a.shape === 'dots') out.appearance.shape = a.shape
  for (const key of ['nodeScale', 'frameScale', 'labelScale', 'edgeWidth'] as const)
    out.appearance[key] = n(a[key], GRAPH_RANGES[key], out.appearance[key])
  for (const key of ['showLabels', 'showEdgeLabels'] as const)
    if (typeof a[key] === 'boolean') out.appearance[key] = a[key]
  for (const key of ['center', 'repel', 'link', 'length'] as const)
    out.forces[key] = n(f[key], GRAPH_RANGES[key], out.forces[key])
  for (const kind of GRAPH_NODE_KINDS) {
    const color = graphColor(colors[kind])
    if (color) out.nodeColors[kind] = color
  }
  const ids = new Set<string>()
  for (const item of Array.isArray(raw.groups) ? raw.groups.slice(0, GRAPH_GROUP_LIMIT) : []) {
    const group = record(item),
      color = graphColor(group.color),
      id = text(group.id)
    if (
      !id ||
      ids.has(id) ||
      !color ||
      !(GRAPH_COLOR_FIELDS as readonly unknown[]).includes(group.field)
    )
      continue
    ids.add(id)
    out.groups.push({
      id,
      name: text(group.name),
      enabled: group.enabled !== false,
      color,
      field: group.field as GraphColorField,
      value: text(group.value, 500)
    })
  }
  return out
}

function colorOf(
  settings: GraphColorSettings,
  node: GraphColorNode,
  word: Lexeme | undefined,
  morpheme: Morpheme | undefined,
  posIds: () => readonly Id[]
): string | null {
  for (const group of settings.groups) {
    if (!group.enabled) continue
    const hit =
      group.field === 'all' ||
      (group.value !== '' &&
        (group.field === 'pos'
          ? !!word && posIds().includes(group.value)
          : group.field === 'tag'
            ? !!(word ?? morpheme)?.tags.includes(group.value)
            : ((word ?? morpheme)?.languageId ?? node.languageId) === group.value))
    if (hit) return group.color
  }
  return settings.nodeColors[node.kind] ?? null
}

/** 单次查色。批量绘图建议使用下面的索引闭包，避免每帧遍历整份词库。 */
export function graphNodeColor(
  settings: GraphColorSettings,
  node: GraphColorNode,
  project: Project
): string | null {
  if (!settings.groups.some((group) => group.enabled)) return settings.nodeColors[node.kind] ?? null
  const word = node.lexemeId ? project.lexemes.find((word) => word.id === node.lexemeId) : undefined
  const morpheme = node.morphemeId
    ? project.morphemes.find((morpheme) => morpheme.id === node.morphemeId)
    : undefined
  return colorOf(settings, node, word, morpheme, () => (word ? lexemePosIds(project, word) : []))
}

/** 设置或项目内容变更后重建一次；力模拟每帧只按节点ID取色，不扫描词库。 */
export function createGraphColorResolver(
  project: Project,
  settings: GraphColorSettings
): (node: GraphColorNode) => string | null {
  if (!settings.groups.some((group) => group.enabled))
    return (node) => settings.nodeColors[node.kind] ?? null
  const words = new Map(project.lexemes.map((word) => [word.id, word])),
    morphemes = new Map(project.morphemes.map((morpheme) => [morpheme.id, morpheme]))
  return (node) => {
    const word = node.lexemeId ? words.get(node.lexemeId) : undefined,
      morpheme = node.morphemeId ? morphemes.get(node.morphemeId) : undefined
    let poses: Id[] | undefined
    return colorOf(settings, node, word, morpheme, () => {
      if (!word) return []
      return (poses ??= lexemePosIds(project, word))
    })
  }
}
