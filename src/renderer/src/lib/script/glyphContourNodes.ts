import { convertEditorSegment, splitEditorSegment } from './glyphEditor'
import type { GlyphContour, PathCmd, Pt } from './glyphGeometry'
const endpoint = (cmd: PathCmd): Pt | null =>
  cmd[0] === 'M' || cmd[0] === 'L'
    ? [cmd[1], cmd[2]]
    : cmd[0] === 'Q'
      ? [cmd[3], cmd[4]]
      : cmd[0] === 'C'
        ? [cmd[5], cmd[6]]
        : null
const equal = (a: Pt, b: Pt): boolean => a[0] === b[0] && a[1] === b[1]
const copy = (c: GlyphContour): GlyphContour => ({
  ...c,
  cmds: c.cmds.map((x) => [...x] as PathCmd),
  ...(c.smooth ? { smooth: [...c.smooth] } : {})
})
function adjacent(
  c: GlyphContour,
  index: number
): { index: number; incoming: number; outgoing: number; point: Pt } | null {
  const point = endpoint(c.cmds[index])
  if (!point) return null
  const last = c.cmds.findLastIndex((cmd) => cmd[0] !== 'Z'),
    first = endpoint(c.cmds[0])!,
    closed = equal(first, endpoint(c.cmds[last])!)
  if (index === last && closed) index = 0
  return {
    index,
    incoming: index === 0 ? (closed ? last : -1) : index,
    outgoing: index + 1 < c.cmds.length && c.cmds[index + 1][0] !== 'Z' ? index + 1 : -1,
    point
  }
}
function cubicNeighbors(c: GlyphContour, index: number): GlyphContour {
  const last = c.cmds.findLastIndex((cmd) => cmd[0] !== 'Z'),
    first = endpoint(c.cmds[0]),
    tail = endpoint(c.cmds[last])
  if (index === 0 && first && tail && !equal(first, tail) && c.cmds.at(-1)?.[0] === 'Z')
    c = { ...c, cmds: [...c.cmds.slice(0, -1), ['L', ...first], ['Z']] }
  const a = adjacent(c, index)
  if (!a) return c
  let out = c
  for (const i of [a.incoming, a.outgoing]) if (i > 0) out = convertEditorSegment(out, i, 'C')
  return out
}
export function contourNodeSmooth(c: GlyphContour, index: number): boolean {
  const a = adjacent(c, index)
  return !!a && !!c.smooth?.includes(a.index)
}
export function setContourNodeMode(
  c: GlyphContour,
  index: number,
  mode: 'smooth' | 'corner'
): GlyphContour {
  const out = copy(cubicNeighbors(c, index))
  const a = adjacent(out, index)
  if (!a) return c
  const { incoming, outgoing, point: p } = a,
    inc = out.cmds[incoming],
    next = out.cmds[outgoing]
  const prior = incoming > 0 ? endpoint(out.cmds[incoming - 1]) : null,
    after = next ? endpoint(next) : null
  let dx = (after?.[0] ?? p[0]) - (prior?.[0] ?? p[0]),
    dy = (after?.[1] ?? p[1]) - (prior?.[1] ?? p[1])
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  if (inc?.[0] === 'C') {
    const length =
      mode === 'corner'
        ? 0
        : Math.hypot(p[0] - inc[3], p[1] - inc[4]) ||
          Math.hypot(p[0] - (prior?.[0] ?? p[0]), p[1] - (prior?.[1] ?? p[1])) / 3
    inc[3] = p[0] - dx * length
    inc[4] = p[1] - dy * length
  }
  if (next?.[0] === 'C') {
    const length =
      mode === 'corner'
        ? 0
        : Math.hypot(next[1] - p[0], next[2] - p[1]) ||
          Math.hypot((after?.[0] ?? p[0]) - p[0], (after?.[1] ?? p[1]) - p[1]) / 3
    next[1] = p[0] + dx * length
    next[2] = p[1] + dy * length
  }
  out.smooth = [
    ...new Set([
      ...(c.smooth ?? []).filter((i) => i !== a.index),
      ...(mode === 'smooth' ? [a.index] : [])
    ])
  ]
  return out
}
/** slot 0端点、1第一柄、2第二柄；平滑点的另一柄保持长度并共线。 */
export function moveContourNode(
  c: GlyphContour,
  cmdIndex: number,
  slot: number,
  point: Pt
): GlyphContour {
  const original = c.cmds[cmdIndex]
  if (!original) return c
  const out = copy(c),
    cmd = out.cmds[cmdIndex]
  if (slot === 0) {
    const a = adjacent(out, cmdIndex)
    if (!a) return c
    const dx = point[0] - a.point[0],
      dy = point[1] - a.point[1]
    const at = cmd[0] === 'C' ? 5 : cmd[0] === 'Q' ? 3 : 1
    ;(cmd as (string | number)[])[at] = point[0]
    ;(cmd as (string | number)[])[at + 1] = point[1]
    const first = endpoint(c.cmds[0])!,
      last = c.cmds.findLastIndex((x) => x[0] !== 'Z')
    if (a.index === 0 && equal(first, endpoint(c.cmds[last])!)) {
      const lastCmd = out.cmds[last]
      const end = lastCmd[0] === 'C' ? 5 : lastCmd[0] === 'Q' ? 3 : 1
      ;(out.cmds[0] as (string | number)[])[1] = point[0]
      ;(out.cmds[0] as (string | number)[])[2] = point[1]
      ;(lastCmd as (string | number)[])[end] = point[0]
      ;(lastCmd as (string | number)[])[end + 1] = point[1]
    }
    const before = out.cmds[a.incoming],
      next = out.cmds[a.outgoing]
    if (before?.[0] === 'C') {
      before[3] += dx
      before[4] += dy
    } else if (before?.[0] === 'Q') {
      before[1] += dx
      before[2] += dy
    }
    if (next?.[0] === 'C') {
      next[1] += dx
      next[2] += dy
    }
    return out
  }
  if (cmd[0] === 'Q') {
    cmd[1] = point[0]
    cmd[2] = point[1]
    return out
  }
  if (cmd[0] !== 'C') return c
  const at = slot === 1 ? 1 : 3
  cmd[at] = point[0]
  cmd[at + 1] = point[1]
  const nodeIndex = slot === 1 ? cmdIndex - 1 : cmdIndex,
    a = adjacent(out, nodeIndex)
  if (!a || !out.smooth?.includes(a.index)) return out
  const opposite = slot === 1 ? out.cmds[a.incoming] : out.cmds[a.outgoing],
    oa = slot === 1 ? 3 : 1
  if (opposite?.[0] !== 'C') return out
  const length = Math.hypot(
      Number(opposite[oa]) - a.point[0],
      Number(opposite[oa + 1]) - a.point[1]
    ),
    dx = point[0] - a.point[0],
    dy = point[1] - a.point[1],
    len = Math.hypot(dx, dy)
  if (len) {
    opposite[oa] = a.point[0] - (dx / len) * length
    opposite[oa + 1] = a.point[1] - (dy / len) * length
  }
  return out
}
export function splitContourNode(c: GlyphContour, index: number, t = 0.5): GlyphContour {
  const next = splitEditorSegment(c, index, t)
  if (next === c) return c
  return { ...next, smooth: [...(c.smooth ?? []).map((i) => (i >= index ? i + 1 : i)), index] }
}
export function deleteContourNode(c: GlyphContour, index: number): GlyphContour {
  if (c.cmds.filter((x) => x[0] !== 'Z').length <= 3) return c
  const a = adjacent(c, index)
  if (!a) return c
  index = a.index
  const out = copy(c)
  if (index === 0) {
    const p = endpoint(out.cmds[1])
    if (!p) return c
    const last = out.cmds.findLastIndex((cmd) => cmd[0] !== 'Z')
    if (equal(endpoint(out.cmds[last])!, endpoint(out.cmds[0])!) && last > 1)
      out.cmds.splice(last, 1)
    out.cmds[0] = ['M', ...p]
    out.cmds.splice(1, 1)
  } else out.cmds.splice(index, 1)
  // 新连接段改变相邻端点的切线，不能留下与实际几何矛盾的平滑标记。
  const previous = index === 0 ? c.cmds.findLastIndex((cmd) => cmd[0] !== 'Z') - 1 : index - 1
  out.smooth = (c.smooth ?? [])
    .filter((i) => i !== index && i !== previous && !(index === 0 && i === 1))
    .map((i) => (i > index ? i - 1 : i))
  return out
}
export function nearestContourSegment(
  c: GlyphContour,
  p: Pt,
  tolerance = Infinity
): { index: number; t: number; point: Pt; distance: number } | null {
  let best: { index: number; t: number; point: Pt; distance: number } | null = null,
    prev: Pt | null = null
  for (let index = 0; index < c.cmds.length; index++) {
    const cmd = c.cmds[index]
    if (cmd[0] === 'M') {
      prev = [cmd[1], cmd[2]]
      continue
    }
    if (!prev || cmd[0] === 'Z') continue
    const a = prev,
      b = endpoint(cmd)!
    const at = (t: number): Pt => {
      const q = 1 - t
      return cmd[0] === 'L'
        ? [q * a[0] + t * b[0], q * a[1] + t * b[1]]
        : cmd[0] === 'Q'
          ? [
              q * q * a[0] + 2 * q * t * cmd[1] + t * t * b[0],
              q * q * a[1] + 2 * q * t * cmd[2] + t * t * b[1]
            ]
          : [
              q ** 3 * a[0] + 3 * q * q * t * cmd[1] + 3 * q * t * t * cmd[3] + t ** 3 * b[0],
              q ** 3 * a[1] + 3 * q * q * t * cmd[2] + 3 * q * t * t * cmd[4] + t ** 3 * b[1]
            ]
    }
    let left = 0,
      right = 1
    let bestSample = 0,
      distance = Infinity
    for (let k = 0; k <= 32; k++) {
      const q = at(k / 32),
        d = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (d < distance) {
        distance = d
        bestSample = k
      }
    }
    left = Math.max(0, (bestSample - 1) / 32)
    right = Math.min(1, (bestSample + 1) / 32)
    for (let k = 0; k < 18; k++) {
      const l = left + (right - left) / 3,
        r = right - (right - left) / 3,
        u = at(l),
        v = at(r)
      if (Math.hypot(u[0] - p[0], u[1] - p[1]) < Math.hypot(v[0] - p[0], v[1] - p[1])) right = r
      else left = l
    }
    const t = (left + right) / 2,
      q = at(t),
      d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (t > 0.001 && t < 0.999 && d <= tolerance && (!best || d < best.distance))
      best = { index, t, point: q, distance: d }
    prev = b
  }
  return best
}
