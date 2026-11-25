/** 画板参数与项目内预设。只影响编辑，不改变字体单位、转写或旧字形。 */
import type { GlyphDrawing } from '$lib/core/model'
import {
  mapStroke,
  transformContour,
  translate,
  type GlyphContour,
  type PathCmd,
  type Pt
} from './glyphGeometry'

export interface GlyphEditorSettings {
  advance: number
  width: number
  showGrid: boolean
  snap: boolean
  step: number
  originX: number
  originY: number
  showGuides: boolean
  guides: { id: string; axis: 'x' | 'y'; position: number; name: string }[]
}
export interface GlyphEditorPreset {
  id: string
  name: string
  settings: GlyphEditorSettings
}
export interface GlyphEditorProject {
  presets: GlyphEditorPreset[]
  defaultPresetId?: string
}
export interface GlyphComponent {
  id: string
  name: string
  drawing: GlyphDrawing
}

export function normalizeEditorSettings(
  value?: Partial<GlyphEditorSettings> | null
): GlyphEditorSettings {
  const finite = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
  return {
    advance: finite(value?.advance, 1000, 100, 3000),
    width: finite(value?.width, 60, 10, 220),
    showGrid: value?.showGrid === true,
    snap: value?.snap === true,
    step: finite(value?.step, 50, 1, 1000),
    originX: finite(value?.originX, 0, -5000, 5000),
    originY: finite(value?.originY, 0, -5000, 5000),
    showGuides: value?.showGuides !== false,
    guides: Array.isArray(value?.guides)
      ? value.guides
          .slice(0, 40)
          .filter(
            (g) =>
              !!g &&
              typeof g.id === 'string' &&
              (g.axis === 'x' || g.axis === 'y') &&
              typeof g.position === 'number' &&
              Number.isFinite(g.position)
          )
          .map((g) => ({
            id: g.id,
            axis: g.axis,
            position: finite(g.position, 0, -5000, 5000),
            name: typeof g.name === 'string' ? g.name.slice(0, 100) : ''
          }))
      : []
  }
}

/** Alt 暂时跳过吸附；原点只决定网格，不平移已有墨迹。 */
export function snapEditorPoint(p: Pt, settings: GlyphEditorSettings, bypass = false): Pt {
  if (!settings.snap || bypass) return p
  const { step, originX, originY } = normalizeEditorSettings(settings)
  return [
    Math.round((p[0] - originX) / step) * step + originX,
    Math.round((p[1] - originY) / step) * step + originY
  ]
}

function end(cmd: PathCmd): Pt | null {
  return cmd[0] === 'M' || cmd[0] === 'L'
    ? [cmd[1], cmd[2]]
    : cmd[0] === 'Q'
      ? [cmd[3], cmd[4]]
      : cmd[0] === 'C'
        ? [cmd[5], cmd[6]]
        : null
}
const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** 转成三次时保留二次曲线的精确形状；直线转曲线给出可直接拖动的手柄。 */
export function convertEditorSegment(
  c: GlyphContour,
  index: number,
  kind: 'L' | 'Q' | 'C'
): GlyphContour {
  const cmd = c.cmds[index],
    a = index > 0 ? end(c.cmds[index - 1]) : null
  const b = cmd && end(cmd)
  if (!a || !b || cmd[0] === 'M' || cmd[0] === 'Z' || cmd[0] === kind) return c
  let next: PathCmd
  if (kind === 'L') next = ['L', ...b]
  else if (kind === 'Q') next = ['Q', ...mix(a, b, 0.5), ...b]
  else if (cmd[0] === 'Q')
    next = ['C', ...mix(a, [cmd[1], cmd[2]], 2 / 3), ...mix(b, [cmd[1], cmd[2]], 2 / 3), ...b]
  else next = ['C', ...mix(a, b, 1 / 3), ...mix(a, b, 2 / 3), ...b]
  return { cmds: c.cmds.map((x, i) => (i === index ? next : ([...x] as PathCmd))) }
}

/** De Casteljau 细分不改变曲线；一次细分作为一次撤销。 */
export function splitEditorSegment(c: GlyphContour, index: number, t = 0.5): GlyphContour {
  const cmd = c.cmds[index],
    a = index > 0 ? end(c.cmds[index - 1]) : null
  const b = cmd && end(cmd)
  if (!a || !b || cmd[0] === 'M' || cmd[0] === 'Z' || !(t > 0 && t < 1)) return c
  let parts: PathCmd[]
  if (cmd[0] === 'L')
    parts = [
      ['L', ...mix(a, b, t)],
      ['L', ...b]
    ]
  else if (cmd[0] === 'Q') {
    const u = mix(a, [cmd[1], cmd[2]], t),
      v = mix([cmd[1], cmd[2]], b, t),
      m = mix(u, v, t)
    parts = [
      ['Q', ...u, ...m],
      ['Q', ...v, ...b]
    ]
  } else {
    const u = mix(a, [cmd[1], cmd[2]], t),
      v = mix([cmd[1], cmd[2]], [cmd[3], cmd[4]], t),
      w = mix([cmd[3], cmd[4]], b, t)
    const l = mix(u, v, t),
      r = mix(v, w, t),
      m = mix(l, r, t)
    parts = [
      ['C', ...u, ...l, ...m],
      ['C', ...r, ...w, ...b]
    ]
  }
  return {
    cmds: [...c.cmds.slice(0, index), ...parts, ...c.cmds.slice(index + 1)].map(
      (x) => [...x] as PathCmd
    )
  }
}

/** 部件是插入时的副本，随后移动、节点编辑和橡皮不会反向修改部件库。 */
export function copyEditorDrawing(d: GlyphDrawing, offset: Pt = [0, 0]): GlyphDrawing {
  const f = translate(...offset)
  return {
    advance: d.advance,
    strokes: d.strokes.map((s) => mapStroke(s, f)),
    ...(d.contours ? { contours: d.contours.map((c) => transformContour(c, f, false)) } : {})
  }
}

/** 创建闭合三次轮廓，每个锚点可带对称的入/出手柄。 */
export function editorBezierContour(nodes: { point: Pt; handle: Pt }[]): GlyphContour | null {
  if (nodes.length < 2) return null
  const cmds: PathCmd[] = [['M', ...nodes[0].point]]
  for (let i = 1; i <= nodes.length; i++) {
    const a = nodes[i - 1],
      b = nodes[i % nodes.length]
    cmds.push([
      'C',
      ...a.handle,
      2 * b.point[0] - b.handle[0],
      2 * b.point[1] - b.handle[1],
      ...b.point
    ])
  }
  cmds.push(['Z'])
  return { cmds }
}
