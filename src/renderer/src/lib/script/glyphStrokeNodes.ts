import type { GlyphStroke, Pt } from './glyphGeometry'

/** 开放中心线的三次贝塞尔锚点。旧绘图只含 points，在首次编辑时转为折点。 */
export interface StrokeNode {
  point: Pt
  in: Pt
  out: Pt
  smooth: boolean
}
const copy = (p: Pt): Pt => [p[0], p[1]]
const corner = (p: Pt): StrokeNode => ({ point: copy(p), in: copy(p), out: copy(p), smooth: false })
const dist = (p: Pt, q: Pt): number => Math.hypot(p[0] - q[0], p[1] - q[1])
const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const clone = (n: StrokeNode): StrokeNode => ({
  point: copy(n.point),
  in: copy(n.in),
  out: copy(n.out),
  smooth: n.smooth
})
export function strokeNodes(stroke: GlyphStroke): StrokeNode[] {
  return stroke.nodes?.length ? stroke.nodes : stroke.points.map(corner)
}
function at(a: StrokeNode, b: StrokeNode, t: number): Pt {
  const ab = mix(a.point, a.out, t),
    bc = mix(a.out, b.in, t),
    cd = mix(b.in, b.point, t)
  return mix(mix(ab, bc, t), mix(bc, cd, t), t)
}
function sample(p: Pt, q: Pt, r: Pt, s: Pt, points: Pt[], depth = 0): void {
  // 控制点到有限弦段的距离也能识别回折；对直线只保留端点。
  const dx = s[0] - p[0],
    dy = s[1] - p[1],
    sq = dx * dx + dy * dy
  const error = (v: Pt): number => {
    const t = sq ? Math.max(0, Math.min(1, ((v[0] - p[0]) * dx + (v[1] - p[1]) * dy) / sq)) : 0
    return dist(v, mix(p, s, t))
  }
  if (
    depth >= 8 ||
    (Math.max(error(q), error(r)) < 0.8 && dist(p, q) + dist(q, r) + dist(r, s) - dist(p, s) < 1.6)
  ) {
    points.push(copy(s))
    return
  }
  const a = mix(p, q, 0.5),
    b = mix(q, r, 0.5),
    c = mix(r, s, 0.5),
    ab = mix(a, b, 0.5),
    bc = mix(b, c, 0.5),
    mid = mix(ab, bc, 0.5)
  sample(p, a, ab, mid, points, depth + 1)
  sample(mid, bc, c, s, points, depth + 1)
}
export function strokeWithNodes(stroke: GlyphStroke, nodes: StrokeNode[]): GlyphStroke {
  const points: Pt[] = nodes.length ? [copy(nodes[0].point)] : []
  for (let i = 1; i < nodes.length; i++)
    sample(nodes[i - 1].point, nodes[i - 1].out, nodes[i].in, nodes[i].point, points)
  return { ...stroke, nodes, points }
}
function along(p: Pt, dx: number, dy: number, length: number): Pt {
  const n = Math.hypot(dx, dy)
  return n ? [p[0] + (dx / n) * length, p[1] + (dy / n) * length] : copy(p)
}
export function moveStrokeNode(
  stroke: GlyphStroke,
  index: number,
  target: Pt,
  handle?: 'in' | 'out'
): GlyphStroke {
  const nodes = strokeNodes(stroke).slice()
  if (!nodes[index]) return stroke
  const n = clone(nodes[index]),
    p = n.point
  if (handle) {
    n[handle] = copy(target)
    if (n.smooth && dist(p, target) > 0) {
      const opposite = handle === 'in' ? 'out' : 'in'
      n[opposite] = along(p, p[0] - target[0], p[1] - target[1], dist(p, n[opposite]))
    }
  } else {
    const delta = (v: Pt): Pt => [v[0] + target[0] - p[0], v[1] + target[1] - p[1]]
    n.in = delta(n.in)
    n.out = delta(n.out)
    n.point = copy(target)
  }
  nodes[index] = n
  return strokeWithNodes(stroke, nodes)
}
export function setStrokeNodeMode(
  stroke: GlyphStroke,
  index: number,
  mode: 'smooth' | 'corner'
): GlyphStroke {
  const nodes = strokeNodes(stroke).slice(),
    n = nodes[index]
  if (!n || n.smooth === (mode === 'smooth')) return stroke
  const p = n.point,
    left = nodes[index - 1]?.point ?? p,
    right = nodes[index + 1]?.point ?? p
  let dx = right[0] - left[0],
    dy = right[1] - left[1]
  if (!dx && !dy) {
    dx = p[0] - left[0]
    dy = p[1] - left[1]
  }
  nodes[index] =
    mode === 'corner'
      ? corner(p)
      : {
          point: copy(p),
          smooth: true,
          in: along(p, -dx, -dy, dist(p, left) / 3),
          out: along(p, dx, dy, dist(p, right) / 3)
        }
  return strokeWithNodes(stroke, nodes)
}
export function insertStrokeNode(stroke: GlyphStroke, segment: number, t = 0.5): GlyphStroke {
  const nodes = strokeNodes(stroke).slice(),
    a = nodes[segment],
    b = nodes[segment + 1]
  if (!a || !b || !(t > 0 && t < 1)) return stroke
  const p = mix(a.point, a.out, t),
    q = mix(a.out, b.in, t),
    r = mix(b.in, b.point, t),
    left = mix(p, q, t),
    right = mix(q, r, t)
  nodes.splice(
    segment,
    2,
    { ...a, out: p },
    { point: mix(left, right, t), in: left, out: right, smooth: true },
    { ...b, in: r }
  )
  return strokeWithNodes(stroke, nodes)
}
export function deleteStrokeNode(stroke: GlyphStroke, index: number): GlyphStroke {
  const nodes = strokeNodes(stroke).slice()
  if (!nodes[index] || nodes.length <= 2) return stroke
  nodes.splice(index, 1)
  return strokeWithNodes(stroke, nodes)
}
export interface StrokeSegmentHit {
  index: number
  t: number
  point: Pt
  distance: number
}
export function nearestStrokeSegment(
  stroke: GlyphStroke,
  point: Pt,
  tolerance = Infinity
): StrokeSegmentHit | null {
  const nodes = strokeNodes(stroke)
  let best: StrokeSegmentHit | null = null
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i],
      b = nodes[i + 1]
    let bestT = 0,
      min = Infinity,
      prev = a.point
    for (let j = 1; j <= 16; j++) {
      const end = at(a, b, j / 16),
        dx = end[0] - prev[0],
        dy = end[1] - prev[1],
        len = dx * dx + dy * dy
      const t = len
        ? Math.min(1, Math.max(0, ((point[0] - prev[0]) * dx + (point[1] - prev[1]) * dy) / len))
        : 0
      const d = dist(point, mix(prev, end, t))
      if (d < min) {
        min = d
        bestT = (j - 1 + t) / 16
      }
      prev = end
    }
    let lo = Math.max(0, bestT - 1 / 16),
      hi = Math.min(1, bestT + 1 / 16)
    for (let j = 0; j < 18; j++) {
      const u = (2 * lo + hi) / 3,
        v = (lo + 2 * hi) / 3
      if (dist(at(a, b, u), point) < dist(at(a, b, v), point)) hi = v
      else lo = u
    }
    const t = (lo + hi) / 2,
      p = at(a, b, t),
      distance = dist(point, p)
    if (distance <= tolerance && (!best || distance < best.distance))
      best = { index: i, t, point: p, distance }
  }
  return best
}
