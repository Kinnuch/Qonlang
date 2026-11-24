/** 纯世界坐标力导布局。调用者决定何时 step；没有计时器或常驻动画。 */
export interface ForceNode {
  key: string
  radius?: number
  x?: number
  y?: number
  pinned?: boolean
}
export interface ForceEdge {
  source: string
  target: string
}
export interface ForcePosition {
  x: number
  y: number
  pinned?: boolean
}
export interface ForceParameters {
  /** 三个力是默认强度的倍数；0 单独关闭这一项。 */
  centerForce: number
  repelForce: number
  linkForce: number
  /** 弹簧的自然长度，不是视口缩放后的屏幕距离。 */
  linkLength: number
}
export const DEFAULT_FORCE_PARAMETERS: Readonly<ForceParameters> = Object.freeze({
  centerForce: 1,
  repelForce: 1,
  linkForce: 1,
  linkLength: 160
})
export interface ForceLayoutOptions {
  parameters?: Partial<ForceParameters>
  positions?: ReadonlyMap<string, ForcePosition>
  center?: { x: number; y: number }
  maxNodes?: number
  maxEdges?: number
}
export interface ForceLayoutResult {
  positions: Map<string, ForcePosition>
  stable: boolean
  iteration: number
  alpha: number
  truncated: boolean
  omittedNodes: number
  omittedEdges: number
}

interface Body extends ForcePosition {
  key: string
  radius: number
  vx: number
  vy: number
  ax: number
  ay: number
  pinned: boolean
}
interface Spring {
  source: Body
  target: Body
}
interface Quad {
  x0: number
  y0: number
  size: number
  mass: number
  x: number
  y: number
  radius: number
  children?: Quad[]
  bodies?: Body[]
  coincident?: boolean
}
const COORD_LIMIT = 1e7
const MAX_ITERATIONS = 300
const DAMPING = 0.78
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))
const coordinate = (n: number): number => clamp(n, -COORD_LIMIT, COORD_LIMIT)
function hash(key: string): number {
  let value = 2166136261
  for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619)
  value ^= value >>> 16
  value = Math.imul(value, 0x85ebca6b)
  value ^= value >>> 13
  value = Math.imul(value, 0xc2b2ae35)
  return (value ^ (value >>> 16)) >>> 0
}
function direction(key: string): { x: number; y: number } {
  const angle = (hash(key) / 4294967296) * Math.PI * 2
  return { x: Math.cos(angle), y: Math.sin(angle) }
}
function parameters(
  input: Partial<ForceParameters>,
  previous: Readonly<ForceParameters>
): ForceParameters {
  const next = { ...previous }
  for (const key of ['centerForce', 'repelForce', 'linkForce', 'linkLength'] as const)
    if (finite(input[key]))
      next[key] = clamp(input[key], key === 'linkLength' ? 20 : 0, key === 'linkLength' ? 2000 : 10)
  return next
}
function bounds(bodies: readonly Body[]): { x0: number; y0: number; size: number } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const body of bodies) {
    x0 = Math.min(x0, body.x)
    x1 = Math.max(x1, body.x)
    y0 = Math.min(y0, body.y)
    y1 = Math.max(y1, body.y)
  }
  return { x0: x0 - 1e-4, y0: y0 - 1e-4, size: Math.max(2, x1 - x0 + 2e-4, y1 - y0 + 2e-4) }
}
function quadTree(bodies: Body[], x0: number, y0: number, size: number, depth = 0): Quad {
  const node: Quad = { x0, y0, size, mass: bodies.length, x: 0, y: 0, radius: 0 }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const body of bodies) {
    node.x += body.x
    node.y += body.y
    node.radius = Math.max(node.radius, body.radius)
    minX = Math.min(minX, body.x)
    maxX = Math.max(maxX, body.x)
    minY = Math.min(minY, body.y)
    maxY = Math.max(maxY, body.y)
  }
  node.x /= bodies.length
  node.y /= bodies.length
  if (
    bodies.length <= 4 ||
    depth >= 20 ||
    size < 1e-6 ||
    (maxX - minX < 1e-6 && maxY - minY < 1e-6)
  ) {
    node.bodies = bodies
    node.coincident = maxX - minX < 1e-6 && maxY - minY < 1e-6
    return node
  }
  const half = size / 2,
    groups: Body[][] = [[], [], [], []]
  for (const body of bodies)
    groups[(body.x >= x0 + half ? 1 : 0) + (body.y >= y0 + half ? 2 : 0)].push(body)
  node.children = groups.flatMap((group, index) =>
    group.length
      ? [quadTree(group, x0 + (index & 1 ? half : 0), y0 + (index & 2 ? half : 0), half, depth + 1)]
      : []
  )
  return node
}
const contains = (q: Quad, body: Body): boolean =>
  body.x >= q.x0 && body.x < q.x0 + q.size && body.y >= q.y0 && body.y < q.y0 + q.size

export class ForceLayout {
  private bodies = new Map<string, Body>()
  private springs: Spring[] = []
  private parametersValue: ForceParameters
  private center: { x: number; y: number }
  private seed: ReadonlyMap<string, ForcePosition>
  private nodeBudget: number
  private edgeBudget: number
  private iteration = 0
  private alpha = 1
  private quiet = 0
  private stopped = false
  private omittedNodes = 0
  private omittedEdges = 0

  constructor(
    nodes: readonly ForceNode[],
    edges: readonly ForceEdge[],
    options: ForceLayoutOptions = {}
  ) {
    this.parametersValue = parameters(options.parameters ?? {}, DEFAULT_FORCE_PARAMETERS)
    this.center = {
      x: finite(options.center?.x) ? coordinate(options.center.x) : 0,
      y: finite(options.center?.y) ? coordinate(options.center.y) : 0
    }
    this.seed = new Map(options.positions ?? [])
    this.nodeBudget = finite(options.maxNodes)
      ? clamp(Math.floor(options.maxNodes), 1, 10000)
      : 1500
    this.edgeBudget = finite(options.maxEdges)
      ? clamp(Math.floor(options.maxEdges), 0, 50000)
      : 6000
    this.updateTopology(nodes, edges)
  }

  getParameters(): ForceParameters {
    return { ...this.parametersValue }
  }
  getPositions(): Map<string, ForcePosition> {
    return new Map(
      [...this.bodies].map(([key, body]) => [key, { x: body.x, y: body.y, pinned: body.pinned }])
    )
  }
  private result(): ForceLayoutResult {
    return {
      positions: this.getPositions(),
      stable: this.stopped,
      iteration: this.iteration,
      alpha: this.alpha,
      truncated: !!(this.omittedNodes || this.omittedEdges),
      omittedNodes: this.omittedNodes,
      omittedEdges: this.omittedEdges
    }
  }

  /** 同一 key 继续用现有位置、速度和固定状态；只给新节点播种。 */
  updateTopology(nodes: readonly ForceNode[], edges: readonly ForceEdge[]): ForceLayoutResult {
    const oldBodies = this.bodies,
      oldEdges = new Set(
        this.springs.map((spring) => JSON.stringify([spring.source.key, spring.target.key]))
      )
    const unique = new Map<string, ForceNode>()
    for (const node of nodes)
      if (typeof node.key === 'string' && node.key && !unique.has(node.key))
        unique.set(node.key, node)
    this.omittedNodes = Math.max(0, unique.size - this.nodeBudget)
    const next = new Map<string, Body>(),
      unresolved: Body[] = []
    for (const [key, node] of [...unique].slice(0, this.nodeBudget)) {
      const radius = finite(node.radius) ? clamp(node.radius, 0, 500) : 32,
        old = this.bodies.get(key),
        seed = this.seed.get(key)
      if (old) {
        next.set(key, { ...old, radius })
        continue
      }
      const source =
        seed && finite(seed.x) && finite(seed.y)
          ? seed
          : finite(node.x) && finite(node.y)
            ? { x: node.x, y: node.y, pinned: node.pinned }
            : null
      const body: Body = {
        key,
        radius,
        x: source ? coordinate(source.x) : NaN,
        y: source ? coordinate(source.y) : NaN,
        pinned: source?.pinned === true || node.pinned === true,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0
      }
      if (!source) unresolved.push(body)
      next.set(key, body)
    }
    const neighbours = new Map<string, string[]>(),
      springs: Spring[] = [],
      seen = new Set<string>()
    this.omittedEdges = 0
    for (const edge of edges) {
      if (
        typeof edge.source !== 'string' ||
        typeof edge.target !== 'string' ||
        edge.source === edge.target
      )
        continue
      const key = JSON.stringify(
        edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source]
      )
      if (seen.has(key)) continue
      seen.add(key)
      const source = next.get(edge.source),
        target = next.get(edge.target)
      if (!source || !target) {
        if (unique.has(edge.source) && unique.has(edge.target)) this.omittedEdges++
        continue
      }
      if (springs.length >= this.edgeBudget) {
        this.omittedEdges++
        continue
      }
      springs.push(
        source.key < target.key ? { source, target } : { source: target, target: source }
      )
      neighbours.set(source.key, [...(neighbours.get(source.key) ?? []), target.key])
      neighbours.set(target.key, [...(neighbours.get(target.key) ?? []), source.key])
    }
    for (const body of unresolved.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
      const known = (neighbours.get(body.key) ?? [])
        .map((key) => next.get(key)!)
        .filter((node) => finite(node.x) && finite(node.y))
      const unit = direction(body.key),
        distance = known.length
          ? Math.max(30, this.parametersValue.linkLength * 0.55)
          : Math.sqrt(20 + (hash(body.key) % 1000)) * this.parametersValue.linkLength * 0.13
      body.x =
        (known.length
          ? known.reduce((sum, node) => sum + node.x, 0) / known.length
          : this.center.x) +
        unit.x * distance
      body.y =
        (known.length
          ? known.reduce((sum, node) => sum + node.y, 0) / known.length
          : this.center.y) +
        unit.y * distance
    }
    const changed =
      oldBodies.size !== next.size ||
      [...next].some(([key, body]) => oldBodies.get(key)?.radius !== body.radius) ||
      springs.length !== oldEdges.size ||
      springs.some(
        (spring) => !oldEdges.has(JSON.stringify([spring.source.key, spring.target.key]))
      )
    this.bodies = next
    this.springs = springs
    this.seed = new Map()
    if (changed) this.reheat()
    else if (!next.size) this.stop()
    return this.result()
  }

  setParameters(patch: Partial<ForceParameters>): ForceLayoutResult {
    const next = parameters(patch, this.parametersValue)
    if (
      Object.keys(next).some(
        (key) =>
          next[key as keyof ForceParameters] !== this.parametersValue[key as keyof ForceParameters]
      )
    ) {
      this.parametersValue = next
      this.reheat()
    }
    return this.result()
  }
  setCenter(x: number, y: number): ForceLayoutResult {
    if (finite(x) && finite(y) && (this.center.x !== x || this.center.y !== y)) {
      this.center = { x: coordinate(x), y: coordinate(y) }
      this.reheat()
    }
    return this.result()
  }
  pin(key: string, x: number, y: number): boolean {
    const body = this.bodies.get(key)
    if (!body || !finite(x) || !finite(y)) return false
    if (body.pinned && body.x === coordinate(x) && body.y === coordinate(y)) return true
    body.x = coordinate(x)
    body.y = coordinate(y)
    body.vx = body.vy = 0
    body.pinned = true
    this.reheat()
    return true
  }
  unpin(key: string): boolean {
    const body = this.bodies.get(key)
    if (!body || !body.pinned) return false
    body.pinned = false
    body.vx = body.vy = 0
    this.reheat()
    return true
  }
  unpinAll(): void {
    let changed = false
    for (const body of this.bodies.values())
      if (body.pinned) {
        body.pinned = false
        body.vx = body.vy = 0
        changed = true
      }
    if (changed) this.reheat()
  }
  reheat(): void {
    this.iteration = 0
    this.alpha = 1
    this.quiet = 0
    this.stopped = this.bodies.size === 0 || [...this.bodies.values()].every((body) => body.pinned)
    if (this.stopped) this.alpha = 0
  }
  stop(): void {
    this.stopped = true
    this.alpha = 0
    for (const body of this.bodies.values()) body.vx = body.vy = 0
  }

  private repel(body: Body, q: Quad): void {
    if (!q.mass) return
    let dx = body.x - q.x,
      dy = body.y - q.y,
      distance = Math.hypot(dx, dy)
    const self = contains(q, body),
      clear = distance - q.size * 0.71 > body.radius + q.radius + 12
    if (q.coincident && q.mass > 4) {
      const mass = q.mass - (self ? 1 : 0)
      if (!mass) return
      if (distance < 1e-6) {
        const unit = direction(body.key)
        dx = unit.x
        dy = unit.y
        distance = 1
      }
      this.pushAway(body, dx, dy, distance, q.radius, mass)
      return
    }
    if (q.children) {
      if (!self && clear && q.size * q.size < distance * distance * 0.64)
        this.pushAway(body, dx, dy, distance, q.radius, q.mass)
      else for (const child of q.children) this.repel(body, child)
      return
    }
    for (const other of q.bodies ?? []) {
      if (other === body) continue
      dx = body.x - other.x
      dy = body.y - other.y
      distance = Math.hypot(dx, dy)
      if (distance < 1e-6) {
        const ordered = body.key < other.key,
          unit = direction(JSON.stringify(ordered ? [body.key, other.key] : [other.key, body.key]))
        dx = unit.x * (ordered ? 1 : -1)
        dy = unit.y * (ordered ? 1 : -1)
        distance = 1
      }
      this.pushAway(body, dx, dy, distance, other.radius, 1)
    }
  }
  private pushAway(
    body: Body,
    dx: number,
    dy: number,
    distance: number,
    radius: number,
    mass: number
  ): void {
    const minimum = body.radius + radius + 12
    const strength = this.parametersValue.repelForce * mass
    const force =
      (500 * strength) / Math.max(distance * distance, minimum * minimum * 0.25, 1) +
      (Math.max(0, minimum - distance) * 0.12 * strength) / Math.max(distance, 1)
    body.ax += dx * force
    body.ay += dy * force
  }

  /** 每次最多 32 步；达到稳定窗口或 300 步预算后自动停止，不留后台任务。 */
  step(count = 1): ForceLayoutResult {
    const n = finite(count) ? clamp(Math.floor(count), 0, 32) : 1
    for (let k = 0; k < n && !this.stopped; k++) {
      const bodies = [...this.bodies.values()],
        p = this.parametersValue
      for (const body of bodies) {
        body.ax = body.ay = 0
        if (!body.pinned) {
          body.ax = (this.center.x - body.x) * p.centerForce * 0.004
          body.ay = (this.center.y - body.y) * p.centerForce * 0.004
        }
      }
      if (p.repelForce > 0) {
        const box = bounds(bodies),
          tree = quadTree(bodies, box.x0, box.y0, box.size)
        for (const body of bodies) if (!body.pinned) this.repel(body, tree)
      }
      if (p.linkForce > 0)
        for (const spring of this.springs) {
          const a = spring.source,
            b = spring.target
          if (a.pinned && b.pinned) continue
          let dx = b.x - a.x,
            dy = b.y - a.y,
            distance = Math.hypot(dx, dy)
          if (distance < 1e-6) {
            const unit = direction(JSON.stringify([a.key, b.key]))
            dx = unit.x
            dy = unit.y
            distance = 1
          }
          const force = ((distance - p.linkLength) * p.linkForce * 0.06) / distance
          if (!a.pinned) {
            const share = b.pinned ? 1 : 0.5
            a.ax += dx * force * share
            a.ay += dy * force * share
          }
          if (!b.pinned) {
            const share = a.pinned ? 1 : 0.5
            b.ax -= dx * force * share
            b.ay -= dy * force * share
          }
        }
      let speed = 0
      for (const body of bodies) {
        if (body.pinned) {
          body.vx = body.vy = 0
          continue
        }
        body.vx = (body.vx + body.ax * this.alpha) * DAMPING
        body.vy = (body.vy + body.ay * this.alpha) * DAMPING
        const magnitude = Math.hypot(body.vx, body.vy),
          maximum = 32
        if (magnitude > maximum) {
          body.vx *= maximum / magnitude
          body.vy *= maximum / magnitude
        }
        body.x = coordinate(body.x + body.vx)
        body.y = coordinate(body.y + body.vy)
        speed = Math.max(speed, Math.hypot(body.vx, body.vy))
      }
      this.iteration++
      this.alpha *= 0.97
      this.quiet = speed < 0.12 ? this.quiet + 1 : 0
      if (
        this.iteration >= MAX_ITERATIONS ||
        (this.quiet >= 10 && this.alpha < 0.03) ||
        (p.centerForce === 0 && p.repelForce === 0 && p.linkForce === 0 && speed < 0.001)
      )
        this.stop()
    }
    return this.result()
  }
}

export function createForceLayout(
  nodes: readonly ForceNode[],
  edges: readonly ForceEdge[],
  options: ForceLayoutOptions = {}
): ForceLayout {
  return new ForceLayout(nodes, edges, options)
}
