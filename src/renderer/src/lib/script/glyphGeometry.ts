/**
 * 手写板与字体读写共用的几何：全是纯函数，不碰界面也不碰 opentype.js。
 * 坐标都是字体单位（一个 em = 1000，基线 y = 0、向上为正）。
 * 轮廓是一条闭合的路径命令（M / L / Q / C / Z），笔画是点列加粗细；
 * 外轮廓统一逆时针（y 向上时面积为正），跟笔画描出来的轮廓同一个绕向，叠在一起按非零规则填。
 */
import type { GlyphDrawing } from '$lib/core/model'

export type Pt = [number, number]
export type GlyphContour = NonNullable<GlyphDrawing['contours']>[number]
export type PathCmd = GlyphContour['cmds'][number]
export interface GlyphStroke {
  points: Pt[]
  width: number
}
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

// ───── 点列 ─────

/** 点列抽稀（Ramer–Douglas–Peucker），手抖的小弯去掉，轮廓少很多点 */
export function simplify(points: Pt[], epsilon = 3): Pt[] {
  if (points.length < 3) return points.slice()
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  let far = -1
  let farDist = 0
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]
    const d = len
      ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
      : Math.hypot(px - ax, py - ay)
    if (d > farDist) {
      farDist = d
      far = i
    }
  }
  if (farDist <= epsilon || far < 0) return [points[0], points[points.length - 1]]
  const left = simplify(points.slice(0, far + 1), epsilon)
  const right = simplify(points.slice(far), epsilon)
  return [...left.slice(0, -1), ...right]
}

/** Chaikin 切角：每轮把折线的角削圆一点，两头的点不动 */
export function chaikin(points: Pt[], iterations = 1): Pt[] {
  let pts = points
  for (let it = 0; it < iterations && pts.length > 2; it++) {
    const out: Pt[] = [pts[0]]
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[i + 1]
      if (i > 0) out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25])
      if (i + 2 < pts.length) out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75])
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}

/** 滑动平均：窗口里前后各 radius 个点取平均，两头的点不动 */
export function movingAverage(points: Pt[], radius = 2): Pt[] {
  if (points.length < 3 || radius < 1) return points.slice()
  const n = points.length
  return points.map((p, i) => {
    if (i === 0 || i === n - 1) return p
    const r = Math.min(radius, i, n - 1 - i)
    let sx = 0
    let sy = 0
    for (let k = i - r; k <= i + r; k++) {
      sx += points[k][0]
      sy += points[k][1]
    }
    return [sx / (2 * r + 1), sy / (2 * r + 1)] as Pt
  })
}

/**
 * 防抖（拉绳式）：笔尖挂在指针后面一根长 radius 的绳子上，指针走出绳长笔尖才跟过去，
 * 跟过去的那一步再按指数平滑打个折（强度越大折得越狠，手抖主要靠这一步压）。
 * strength 0～10，0 就是不防抖。unit 是一个屏幕像素合多少字体单位（缩放后绳长在屏幕上看着一样长）。
 * 指针停着不动时也该每帧 push 一次同一个点，笔尖才会慢慢收过去。
 */
export function createStabilizer(
  strength: number,
  start: Pt,
  unit = 1
): {
  radius: number
  ink: () => Pt
  push: (p: Pt) => Pt | null
  finish: (p: Pt) => Pt[]
} {
  const s = Math.max(0, Math.min(10, strength))
  const radius = s * 4 * unit
  const follow = 0.1 + 0.9 * (1 - s / 10) ** 2.5
  let ink: Pt = [start[0], start[1]]
  const step = (p: Pt, r: number, a: number): Pt | null => {
    const dx = p[0] - ink[0]
    const dy = p[1] - ink[1]
    const d = Math.hypot(dx, dy)
    if (d <= r || d === 0) return null
    const k = ((d - r) / d) * a
    ink = [ink[0] + dx * k, ink[1] + dy * k]
    return ink
  }
  return {
    radius,
    ink: () => ink,
    push: (p) => (s === 0 ? (ink = [p[0], p[1]]) : step(p, radius, follow)),
    // 抬笔时笔尖收绳追到指针上：绳子一步步收短、跟得一步步变紧，笔画不会停在半路也不会甩出一个尖
    finish: (p) => {
      const out: Pt[] = []
      if (s === 0) return out
      const n = 12
      for (let i = 1; i <= n; i++) {
        const q = step(p, radius * (1 - i / n), Math.max(follow, i / n))
        if (q) out.push([q[0], q[1]])
      }
      return out
    }
  }
}

/** 折线按固定间距重新取点（两头的点保留）：平滑窗口按距离算，不受指针事件疏密影响 */
export function resample(points: Pt[], spacing: number): Pt[] {
  if (points.length < 2 || spacing <= 0) return points.slice()
  const out: Pt[] = [points[0]]
  let carry = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[i + 1]
    const len = Math.hypot(bx - ax, by - ay)
    let d = spacing - carry
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len])
      d += spacing
    }
    carry = len - (d - spacing)
  }
  const last = points[points.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > spacing * 0.25) out.push(last)
  else out[out.length - 1] = last
  return out
}

/** 抬笔后的收尾：按防抖强度等距取点、滑动平均、切角平滑，再抽稀 */
export function finishStroke(points: Pt[], strength: number): Pt[] {
  const s = Math.max(0, Math.min(10, strength))
  let pts = points
  if (s > 0 && pts.length > 2) {
    pts = resample(pts, 2 + s * 0.6)
    pts = movingAverage(pts, Math.ceil(s))
    pts = chaikin(pts, Math.min(3, Math.ceil(s / 4)))
  }
  const out = simplify(pts, 1.2 + s * 0.12)
  return out.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as Pt)
}

// ───── 轮廓 ─────

/** 二次曲线上的点 */
function quadAt(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t
  return [
    u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
    u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]
  ]
}
/** 三次曲线上的点 */
export function cubicAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]
  ]
}

/** 命令的终点（Z 没有终点） */
export function cmdEnd(c: PathCmd): Pt | null {
  switch (c[0]) {
    case 'M':
    case 'L':
      return [c[1], c[2]]
    case 'Q':
      return [c[3], c[4]]
    case 'C':
      return [c[5], c[6]]
    default:
      return null
  }
}

/** 轮廓展平成多边形（不重复首点）；曲线按长短切成若干小段 */
export function flattenContour(c: GlyphContour, step = 12): Pt[] {
  const out: Pt[] = []
  let cur: Pt = [0, 0]
  for (const cmd of c.cmds) {
    if (cmd[0] === 'M' || cmd[0] === 'L') {
      cur = [cmd[1], cmd[2]]
      out.push(cur)
    } else if (cmd[0] === 'Q') {
      const ctl: Pt = [cmd[1], cmd[2]]
      const end: Pt = [cmd[3], cmd[4]]
      const len =
        Math.hypot(ctl[0] - cur[0], ctl[1] - cur[1]) + Math.hypot(end[0] - ctl[0], end[1] - ctl[1])
      const n = Math.max(2, Math.min(32, Math.ceil(len / step)))
      for (let i = 1; i <= n; i++) out.push(quadAt(cur, ctl, end, i / n))
      cur = end
    } else if (cmd[0] === 'C') {
      const c1: Pt = [cmd[1], cmd[2]]
      const c2: Pt = [cmd[3], cmd[4]]
      const end: Pt = [cmd[5], cmd[6]]
      const len =
        Math.hypot(c1[0] - cur[0], c1[1] - cur[1]) +
        Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) +
        Math.hypot(end[0] - c2[0], end[1] - c2[1])
      const n = Math.max(3, Math.min(48, Math.ceil(len / step)))
      for (let i = 1; i <= n; i++) out.push(cubicAt(cur, c1, c2, end, i / n))
      cur = end
    }
  }
  // 末点和首点重合就去掉一个
  if (out.length > 1) {
    const a = out[0]
    const b = out[out.length - 1]
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop()
  }
  return out
}

/** 多边形有向面积：y 向上时逆时针为正 */
export function signedArea(poly: Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]
    const [bx, by] = poly[(i + 1) % poly.length]
    s += ax * by - bx * ay
  }
  return s / 2
}

export const contourArea = (c: GlyphContour): number => signedArea(flattenContour(c))

/**
 * 轮廓反向：M p0, 各段…, Z 倒过来走。每段从终点走回起点，
 * 二次曲线控制点不变，三次曲线两个控制点对调；原来隐含的闭合线段变成开头的一条直线。
 */
export function reverseContour(c: GlyphContour): GlyphContour {
  const segs: { from: Pt; cmd: PathCmd }[] = []
  let start: Pt | null = null
  let cur: Pt = [0, 0]
  for (const cmd of c.cmds) {
    if (cmd[0] === 'M') {
      if (start) break // 一条轮廓只认第一个 M
      start = [cmd[1], cmd[2]]
      cur = start
    } else if (cmd[0] !== 'Z') {
      segs.push({ from: cur, cmd })
      cur = cmdEnd(cmd)!
    }
  }
  if (!start) return { cmds: [] }
  const out: PathCmd[] = [['M', start[0], start[1]]]
  if (cur[0] !== start[0] || cur[1] !== start[1]) out.push(['L', cur[0], cur[1]])
  for (let i = segs.length - 1; i >= 0; i--) {
    const { from, cmd } = segs[i]
    if (cmd[0] === 'L') out.push(['L', from[0], from[1]])
    else if (cmd[0] === 'Q') out.push(['Q', cmd[1], cmd[2], from[0], from[1]])
    else if (cmd[0] === 'C') out.push(['C', cmd[3], cmd[4], cmd[1], cmd[2], from[0], from[1]])
  }
  // 最后一段直线正好回到起点：交给 Z 去闭合
  const last = out[out.length - 1]
  if (out.length > 2 && last[0] === 'L' && last[1] === start[0] && last[2] === start[1]) out.pop()
  out.push(['Z'])
  return { cmds: out }
}

/** 一个字的轮廓统一绕向：面积最大的那条（外轮廓）是顺时针，就整组反过来，内洞跟着保持相反 */
export function normalizeContours(contours: GlyphContour[]): GlyphContour[] {
  let big = 0
  for (const c of contours) {
    const a = contourArea(c)
    if (Math.abs(a) > Math.abs(big)) big = a
  }
  return big < 0 ? contours.map(reverseContour) : contours
}

/** 路径命令（opentype.js 那种 {type, x, y, x1…}）按 M 切成一条条轮廓，顺手缩放 */
export function commandsToContours(
  commands: {
    type: string
    x?: number
    y?: number
    x1?: number
    y1?: number
    x2?: number
    y2?: number
  }[],
  scale = 1,
  digits = 1
): GlyphContour[] {
  const f = 10 ** digits
  const r = (v: number | undefined): number => Math.round((v ?? 0) * scale * f) / f
  const out: GlyphContour[] = []
  let cur: PathCmd[] = []
  const same = (a: Pt | null, x: number, y: number): boolean => !!a && a[0] === x && a[1] === y
  const flush = (): void => {
    if (cur[cur.length - 1]?.[0] === 'Z') cur.pop()
    // 最后一段直线回到起点：交给 Z 闭合，免得起点、终点两个节点叠在一起
    const last = cur[cur.length - 1]
    if (cur.length > 2 && last[0] === 'L' && same(cmdEnd(cur[0]), last[1], last[2])) cur.pop()
    if (cur.some((c) => c[0] !== 'M')) out.push({ cmds: [...cur, ['Z']] })
    cur = []
  }
  for (const c of commands) {
    if (c.type === 'M') {
      flush()
      cur.push(['M', r(c.x), r(c.y)])
    } else if (!cur.length) continue
    else if (c.type === 'L') {
      // opentype.js 读 TrueType 时曲线后面常跟一条原地不动的直线，去掉
      const [x, y] = [r(c.x), r(c.y)]
      if (!same(cmdEnd(cur[cur.length - 1]), x, y)) cur.push(['L', x, y])
    } else if (c.type === 'Q') cur.push(['Q', r(c.x1), r(c.y1), r(c.x), r(c.y)])
    else if (c.type === 'C') cur.push(['C', r(c.x1), r(c.y1), r(c.x2), r(c.y2), r(c.x), r(c.y)])
    else if (c.type === 'Z') {
      cur.push(['Z'])
      flush()
    }
  }
  flush()
  return out
}

/** 轮廓 → SVG path 的 d（SVG 的 y 向下，这里翻过来） */
export function contourSvg(c: GlyphContour): string {
  return c.cmds
    .map((cmd) => {
      switch (cmd[0]) {
        case 'M':
        case 'L':
          return `${cmd[0]}${cmd[1]} ${-cmd[2]}`
        case 'Q':
          return `Q${cmd[1]} ${-cmd[2]} ${cmd[3]} ${-cmd[4]}`
        case 'C':
          return `C${cmd[1]} ${-cmd[2]} ${cmd[3]} ${-cmd[4]} ${cmd[5]} ${-cmd[6]}`
        default:
          return 'Z'
      }
    })
    .join('')
}

/** 轮廓的闭合边线（首点接回首点），勾线、加粗拿它当笔画用 */
export function contourOutline(c: GlyphContour): Pt[] {
  const poly = flattenContour(c, 8)
  if (!poly.length) return []
  const closed = [...poly, poly[0]]
  return simplify(closed, 0.8).map(
    (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as Pt
  )
}

// ───── 外框与变换 ─────

export function strokeBox(s: GlyphStroke, withWidth = true): Box | null {
  if (!s.points.length) return null
  const r = withWidth ? s.width / 2 : 0
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const [x, y] of s.points) {
    b.x0 = Math.min(b.x0, x - r)
    b.y0 = Math.min(b.y0, y - r)
    b.x1 = Math.max(b.x1, x + r)
    b.y1 = Math.max(b.y1, y + r)
  }
  return b
}
export function polyBox(poly: Pt[]): Box | null {
  if (!poly.length) return null
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const [x, y] of poly) {
    b.x0 = Math.min(b.x0, x)
    b.y0 = Math.min(b.y0, y)
    b.x1 = Math.max(b.x1, x)
    b.y1 = Math.max(b.y1, y)
  }
  return b
}
export const contourBox = (c: GlyphContour): Box | null => polyBox(flattenContour(c))

export function unionBox(boxes: (Box | null)[]): Box | null {
  let out: Box | null = null
  for (const b of boxes) {
    if (!b) continue
    if (!out) out = { ...b }
    else {
      out.x0 = Math.min(out.x0, b.x0)
      out.y0 = Math.min(out.y0, b.y0)
      out.x1 = Math.max(out.x1, b.x1)
      out.y1 = Math.max(out.y1, b.y1)
    }
  }
  return out
}

/** 笔画与轮廓的外框（笔画算上粗细） */
export function shapesBox(strokes: GlyphStroke[], contours: GlyphContour[]): Box | null {
  return unionBox([...strokes.map((s) => strokeBox(s)), ...contours.map(contourBox)])
}

export type PointMap = (p: Pt) => Pt

/** 把轮廓里每个坐标（控制点也算）过一遍 f */
export function mapContour(c: GlyphContour, f: PointMap): GlyphContour {
  return {
    cmds: c.cmds.map((cmd): PathCmd => {
      switch (cmd[0]) {
        case 'M':
        case 'L': {
          const [x, y] = f([cmd[1], cmd[2]])
          return [cmd[0], x, y]
        }
        case 'Q': {
          const [cx, cy] = f([cmd[1], cmd[2]])
          const [x, y] = f([cmd[3], cmd[4]])
          return ['Q', cx, cy, x, y]
        }
        case 'C': {
          const [ax, ay] = f([cmd[1], cmd[2]])
          const [bx, by] = f([cmd[3], cmd[4]])
          const [x, y] = f([cmd[5], cmd[6]])
          return ['C', ax, ay, bx, by, x, y]
        }
        default:
          return ['Z']
      }
    })
  }
}
export function mapStroke(s: GlyphStroke, f: PointMap): GlyphStroke {
  return { width: s.width, points: s.points.map((p) => f(p)) }
}

export const translate =
  (dx: number, dy: number): PointMap =>
  (p) => [p[0] + dx, p[1] + dy]
/** 以 (ox, oy) 为原点缩放；sx 或 sy 为负就是翻转 */
export const scaleAbout =
  (ox: number, oy: number, sx: number, sy: number): PointMap =>
  (p) => [ox + (p[0] - ox) * sx, oy + (p[1] - oy) * sy]

/** 变换轮廓：翻转（sx·sy < 0）会把绕向也翻了，这里再反回来，免得跟别的轮廓相消 */
export function transformContour(c: GlyphContour, f: PointMap, mirrors: boolean): GlyphContour {
  const m = mapContour(c, f)
  return mirrors ? reverseContour(m) : m
}

/** 坐标保留一位小数，存盘前用 */
export function roundContour(c: GlyphContour, digits = 1): GlyphContour {
  const k = 10 ** digits
  return mapContour(c, (p) => [Math.round(p[0] * k) / k, Math.round(p[1] * k) / k])
}

// ───── 基本形状（都是逆时针的闭合轮廓） ─────

export function rectContour(x0: number, y0: number, x1: number, y1: number): GlyphContour {
  const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)]
  const [b, t] = [Math.min(y0, y1), Math.max(y0, y1)]
  return {
    cmds: [['M', l, b], ['L', r, b], ['L', r, t], ['L', l, t], ['Z']]
  }
}

/** 圆角矩形：四个角各一段三次曲线 */
export function roundRectContour(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number
): GlyphContour {
  const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)]
  const [b, t] = [Math.min(y0, y1), Math.max(y0, y1)]
  const rr = Math.max(0, Math.min(radius, (r - l) / 2, (t - b) / 2))
  if (!rr) return rectContour(l, b, r, t)
  const k = rr * (1 - 0.5523)
  return {
    cmds: [
      ['M', l + rr, b],
      ['L', r - rr, b],
      ['C', r - k, b, r, b + k, r, b + rr],
      ['L', r, t - rr],
      ['C', r, t - k, r - k, t, r - rr, t],
      ['L', l + rr, t],
      ['C', l + k, t, l, t - k, l, t - rr],
      ['L', l, b + rr],
      ['C', l, b + k, l + k, b, l + rr, b],
      ['Z']
    ]
  }
}

/** 椭圆：四段三次曲线，从最右边那点开始往上转 */
export function ellipseContour(cx: number, cy: number, rx: number, ry: number): GlyphContour {
  const k = 0.5523
  const ox = rx * k
  const oy = ry * k
  return {
    cmds: [
      ['M', cx + rx, cy],
      ['C', cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry],
      ['C', cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy],
      ['C', cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry],
      ['C', cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy],
      ['Z']
    ]
  }
}

/** 正多边形：内切在椭圆里，第一个顶点朝正上方 */
export function polygonContour(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number
): GlyphContour {
  const n = Math.max(3, Math.min(64, Math.round(sides)))
  const cmds: PathCmd[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n
    const x = cx + rx * Math.cos(a)
    const y = cy + ry * Math.sin(a)
    cmds.push([i ? 'L' : 'M', x, y])
  }
  cmds.push(['Z'])
  return { cmds }
}

// ───── 笔画描成轮廓（字体里用） ─────

/** 圆：八段二次曲线近似，角度从 0 往上转一圈，y 向上时是逆时针 */
export function circleContour(cx: number, cy: number, r: number): GlyphContour {
  const n = 8
  const c = r / Math.cos(Math.PI / n)
  const cmds: PathCmd[] = [['M', cx + r, cy]]
  for (let i = 0; i < n; i++) {
    const a1 = ((i + 1) * 2 * Math.PI) / n
    const am = ((i + 0.5) * 2 * Math.PI) / n
    cmds.push([
      'Q',
      cx + c * Math.cos(am),
      cy + c * Math.sin(am),
      cx + r * Math.cos(a1),
      cy + r * Math.sin(a1)
    ])
  }
  cmds.push(['Z'])
  return { cmds }
}

/** 两点之间的矩形（宽 w），逆时针；两点重合时没有 */
export function segmentContour(a: Pt, b: Pt, w: number): GlyphContour | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (!len) return null
  const nx = (-dy / len) * (w / 2)
  const ny = (dx / len) * (w / 2)
  // a - n → b - n → b + n → a + n：法线在左边，这样走是逆时针
  return {
    cmds: [
      ['M', a[0] - nx, a[1] - ny],
      ['L', b[0] - nx, b[1] - ny],
      ['L', b[0] + nx, b[1] + ny],
      ['L', a[0] + nx, a[1] + ny],
      ['Z']
    ]
  }
}

/** 一笔描成轮廓：相邻两点之间一个矩形、每个点一个圆（圆头圆角） */
export function strokeContours(st: GlyphStroke): GlyphContour[] {
  const w = Math.max(4, st.width)
  const pts = simplify(st.points)
  const out: GlyphContour[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = segmentContour(pts[i], pts[i + 1], w)
    if (seg) out.push(seg)
  }
  for (const p of pts) out.push(circleContour(p[0], p[1], w / 2))
  return out
}

/** 一个字要进字体的全部轮廓：画好的轮廓原样，加上笔画描出来的 */
export function drawingContours(d: GlyphDrawing): GlyphContour[] {
  return [...(d.contours ?? []), ...d.strokes.flatMap(strokeContours)]
}

/** 这个字有没有画东西（笔画或轮廓） */
export function hasDrawingContent(d: GlyphDrawing | undefined | null): boolean {
  return !!d && (d.strokes.length > 0 || (d.contours?.length ?? 0) > 0)
}

// ───── 命中 ─────

/** 点到线段的距离 */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const u = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
  return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy))
}

/** 点在多边形里（奇偶规则） */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

/** 点到闭合多边形边的最近距离 */
export function polygonEdgeDist(p: Pt, poly: Pt[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++)
    best = Math.min(best, segDist(p, poly[i], poly[(i + 1) % poly.length]))
  return best
}

/** 点到笔画（折线）的距离 */
export function strokeDist(p: Pt, s: GlyphStroke): number {
  if (!s.points.length) return Infinity
  if (s.points.length === 1) return Math.hypot(p[0] - s.points[0][0], p[1] - s.points[0][1])
  let best = Infinity
  for (let j = 0; j + 1 < s.points.length; j++)
    best = Math.min(best, segDist(p, s.points[j], s.points[j + 1]))
  return best
}
