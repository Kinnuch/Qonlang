/** 圆刷沿轨迹扫过墨迹的几何差。只重建真正擦中的连通组，保留其他曲线原文与 advance。 */
import clipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { GlyphDrawing } from '$lib/core/model'
import {
  segDist,
  signedArea,
  type Box,
  type GlyphContour,
  type GlyphStroke,
  type PathCmd,
  type Pt
} from './glyphGeometry'

export interface EraseOptions {
  /** 字体单位下的曲线近似误差；默认 0.25（1000 单位一 em）。 */
  tolerance?: number
}

interface Source {
  kind: 'stroke' | 'contour'
  index: number
  box: Box
  geometry?: MultiPolygon
  winding: number
}

const finitePoint = (p: readonly number[]): boolean => p.length === 2 && p.every(Number.isFinite)
const same = (a: Pt, b: Pt): boolean => a[0] === b[0] && a[1] === b[1]
const overlaps = (a: Box, b: Box): boolean =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0
const midpoint = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const boxOf = (points: readonly Pt[], radius = 0): Box => {
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const [x, y] of points) {
    box.x0 = Math.min(box.x0, x - radius)
    box.x1 = Math.max(box.x1, x + radius)
    box.y0 = Math.min(box.y0, y - radius)
    box.y1 = Math.max(box.y1, y + radius)
  }
  return box
}

/** 控制点外框是保守范围，不会因采样漏过曲线上的极值。 */
function contourPoints(contour: GlyphContour): Pt[] {
  const points: Pt[] = []
  for (const command of contour.cmds)
    for (let i = 1; i + 1 < command.length; i += 2)
      points.push([command[i] as number, command[i + 1] as number])
  return points
}

function flatten(contour: GlyphContour, tolerance: number): Ring {
  const points: Pt[] = []
  let current: Pt = [0, 0]
  const push = (point: Pt): void => {
    if (!points.length || !same(points[points.length - 1], point)) points.push(point)
  }
  const quad = (a: Pt, control: Pt, b: Pt, depth = 0): void => {
    if (depth >= 18 || segDist(control, a, b) <= tolerance) {
      push(b)
      return
    }
    const ac = midpoint(a, control),
      cb = midpoint(control, b),
      middle = midpoint(ac, cb)
    quad(a, ac, middle, depth + 1)
    quad(middle, cb, b, depth + 1)
  }
  const cubic = (a: Pt, c1: Pt, c2: Pt, b: Pt, depth = 0): void => {
    if (depth >= 18 || Math.max(segDist(c1, a, b), segDist(c2, a, b)) <= tolerance) {
      push(b)
      return
    }
    const a1 = midpoint(a, c1),
      c12 = midpoint(c1, c2),
      c2b = midpoint(c2, b),
      left = midpoint(a1, c12),
      right = midpoint(c12, c2b),
      middle = midpoint(left, right)
    cubic(a, a1, left, middle, depth + 1)
    cubic(middle, right, c2b, b, depth + 1)
  }
  for (const command of contour.cmds) {
    if (command[0] === 'M' || command[0] === 'L') {
      current = [command[1], command[2]]
      push(current)
    } else if (command[0] === 'Q') {
      const end: Pt = [command[3], command[4]]
      quad(current, [command[1], command[2]], end)
      current = end
    } else if (command[0] === 'C') {
      const end: Pt = [command[5], command[6]]
      cubic(current, [command[1], command[2]], [command[3], command[4]], end)
      current = end
    }
  }
  if (points.length > 1 && same(points[0], points[points.length - 1])) points.pop()
  return points.length >= 3 ? [...points, points[0]] : []
}

/** 有限线段距离抽稀，来回折返的共线部分不能按无限直线误删。 */
function thinPath(input: readonly Pt[], tolerance: number): readonly Pt[] {
  const points = input.filter((point, index) => !index || !same(point, input[index - 1]))
  if (points.length < 3) return points
  const keep = new Set([0, points.length - 1]),
    stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let far = -1,
      distance = tolerance
    for (let i = start + 1; i < end; i++) {
      const d = segDist(points[i], points[start], points[end])
      if (d > distance) {
        far = i
        distance = d
      }
    }
    if (far < 0) continue
    keep.add(far)
    stack.push([start, far], [far, end])
  }
  return [...keep].sort((a, b) => a - b).map((index) => points[index])
}

/** 圆角胶囊做并集；擦除轨迹扫过两点之间，不只擦事件落点。 */
function brushGeometry(input: readonly Pt[], radius: number, tolerance: number): MultiPolygon {
  const points = thinPath(input, tolerance / 2)
  const arcTolerance = tolerance / 2
  const polygons: MultiPolygon = []
  const n =
    Math.ceil(
      Math.max(
        12,
        Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - Math.min(arcTolerance, radius) / radius)))
      ) / 4
    ) * 4
  // 极端坐标也不暗中放宽误差预算；由调用方保留原图并报告失败。
  if (!Number.isFinite(n) || n > 4096)
    throw new RangeError('Eraser geometry exceeds supported precision')
  // 去掉 sin(π) 一类的亚像素数值尾差，避免相邻圆弧产生几乎重合的不同顶点。
  const pointAt = (center: Pt, angle: number): Pt => [
    Math.round((center[0] + radius * Math.cos(angle)) * 1e8) / 1e8,
    Math.round((center[1] + radius * Math.sin(angle)) * 1e8) / 1e8
  ]
  if (points.length === 1 || points.every((point) => same(point, points[0]))) {
    const ring: Ring = []
    for (let i = 0; i < n; i++) ring.push(pointAt(points[0], (i * 2 * Math.PI) / n))
    ring.push(ring[0])
    polygons.push([ring])
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy)
    if (!length) continue
    const angle = Math.atan2(dy, dx),
      ring: Ring = []
    // 一段是一个完整胶囊，避免独立圆与矩形恰好相切时的病态布尔输入。
    for (let k = 0; k <= n / 2; k++)
      ring.push(pointAt(a, angle + Math.PI / 2 + (k * 2 * Math.PI) / n))
    for (let k = 0; k <= n / 2; k++)
      ring.push(pointAt(b, angle - Math.PI / 2 + (k * 2 * Math.PI) / n))
    ring.push(ring[0])
    polygons.push([ring])
  }
  return polygons.length ? clipping.union(polygons) : []
}

const combine = (parts: readonly MultiPolygon[]): MultiPolygon => {
  const all = parts.flat()
  return all.length ? clipping.union(all) : []
}
const hasArea = (geometry: MultiPolygon): boolean =>
  geometry.some((polygon) => {
    const area = polygon.reduce(
      (sum, ring, index) => sum + (index ? -1 : 1) * Math.abs(signedArea(ring)),
      0
    )
    return area > 1e-8
  })

/** 按绕数分层，保留非零填充：内洞不会误填，同向嵌套也不会被当成孔洞。 */
function contourFill(sources: Source[]): MultiPolygon {
  if (!sources.length) return []
  if (sources.every((source) => source.winding === sources[0].winding))
    return combine(sources.map((source) => source.geometry!))
  let zones = new Map<number, MultiPolygon>()
  for (const source of sources) {
    const mask = source.geometry!,
      occupied = combine([...zones.values()]),
      next = new Map<number, MultiPolygon[]>()
    const add = (winding: number, geometry: MultiPolygon): void => {
      if (!winding || !geometry.length) return
      const parts = next.get(winding) ?? []
      parts.push(geometry)
      next.set(winding, parts)
    }
    add(source.winding, occupied.length ? clipping.difference(mask, occupied) : mask)
    for (const [winding, zone] of zones) {
      add(winding, clipping.difference(zone, mask))
      add(winding + source.winding, clipping.intersection(zone, mask))
    }
    zones = new Map([...next].map(([winding, parts]) => [winding, combine(parts)]))
  }
  return combine([...zones.values()])
}

function contoursFrom(geometry: MultiPolygon): GlyphContour[] {
  return geometry.flatMap((polygon: Polygon) =>
    polygon.map((ring, index) => {
      const points = ring.slice(
        0,
        same(ring[0], ring[ring.length - 1]) ? ring.length - 1 : ring.length
      )
      if (signedArea(points) > 0 !== (index === 0)) points.reverse()
      const cmds: PathCmd[] = points.map(([x, y], i) => [i ? 'L' : 'M', x, y])
      cmds.push(['Z'])
      return { cmds }
    })
  )
}

/**
 * 以字体单位的轨迹及圆刷半径擦除。输入不变；无实际墨迹命中时返回原对象。
 * 命中部分转为旧 schema 支持的闭合轮廓；其余独立形状保留原贝塞尔和笔画。
 * 几何库异常向上传递，调用方应保留本次手势前的状态，不提交半成品。
 */
export function eraseDrawing(
  drawing: GlyphDrawing,
  eraserPath: readonly Pt[],
  radius: number,
  options: EraseOptions = {}
): GlyphDrawing {
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !eraserPath.length ||
    eraserPath.some((point) => !finitePoint(point))
  )
    return drawing
  const tolerance =
    Number.isFinite(options.tolerance) && options.tolerance! > 0
      ? Math.max(0.01, options.tolerance!)
      : 0.25
  const path = eraserPath.filter((point, index) => !index || !same(point, eraserPath[index - 1]))
  const eraseBox = boxOf(path, radius),
    sources: Source[] = []
  drawing.strokes.forEach((stroke, index) => {
    if (
      stroke.points.length &&
      stroke.points.every(finitePoint) &&
      Number.isFinite(stroke.width) &&
      stroke.width > 0
    )
      sources.push({
        kind: 'stroke',
        index,
        box: boxOf(stroke.points, stroke.width / 2),
        winding: 1
      })
  })
  ;(drawing.contours ?? []).forEach((contour, index) => {
    const points = contourPoints(contour)
    if (points.length && points.every(finitePoint))
      sources.push({ kind: 'contour', index, box: boxOf(points), winding: 1 })
  })
  if (!sources.some((source) => overlaps(source.box, eraseBox))) return drawing
  const eraser = brushGeometry(path, radius, tolerance)
  const geometry = (source: Source): MultiPolygon => {
    if (!source.geometry) {
      if (source.kind === 'stroke') {
        const stroke: GlyphStroke = drawing.strokes[source.index]
        source.geometry = brushGeometry(stroke.points, stroke.width / 2, tolerance)
      } else {
        const ring = flatten(drawing.contours![source.index], tolerance)
        source.winding = signedArea(ring) < 0 ? -1 : 1
        source.geometry = ring.length ? clipping.union([[ring]]) : []
      }
    }
    return source.geometry
  }
  const visited = new Set<Source>(),
    removedStrokes = new Set<number>(),
    removedContours = new Set<number>(),
    added: GlyphContour[] = []
  for (const seed of sources) {
    if (visited.has(seed) || !overlaps(seed.box, eraseBox)) continue
    const group: Source[] = [seed]
    visited.add(seed)
    for (let index = 0; index < group.length; index++) {
      const current = group[index],
        currentGeometry = geometry(current)
      if (!currentGeometry.length) continue
      for (const candidate of sources) {
        if (visited.has(candidate) || !overlaps(current.box, candidate.box)) continue
        if (hasArea(clipping.intersection(currentGeometry, geometry(candidate)))) {
          visited.add(candidate)
          group.push(candidate)
        }
      }
    }
    const contours = contourFill(group.filter((source) => source.kind === 'contour'))
    const subject = combine([
      contours,
      ...group.filter((source) => source.kind === 'stroke').map(geometry)
    ])
    if (!subject.length || !hasArea(clipping.intersection(subject, eraser))) continue
    const result = clipping.difference(subject, eraser)
    for (const source of group)
      (source.kind === 'stroke' ? removedStrokes : removedContours).add(source.index)
    added.push(...contoursFrom(result))
  }
  if (!removedStrokes.size && !removedContours.size) return drawing
  const contours = [
    ...(drawing.contours ?? []).filter((_, index) => !removedContours.has(index)),
    ...added
  ]
  return {
    ...drawing,
    strokes: drawing.strokes.filter((_, index) => !removedStrokes.has(index)),
    ...(drawing.contours !== undefined || contours.length ? { contours } : {})
  }
}
