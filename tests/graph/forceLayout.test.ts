import { describe, expect, it } from 'vitest'
import {
  createForceLayout,
  DEFAULT_FORCE_PARAMETERS,
  type ForceLayout,
  type ForceParameters,
  type ForcePosition
} from '$lib/graph/forceLayout'

const OFF: ForceParameters = { centerForce: 0, repelForce: 0, linkForce: 0, linkLength: 160 }
const pair = [
  { key: 'a', radius: 0, x: -150, y: 0 },
  { key: 'b', radius: 0, x: 150, y: 0 }
]
const distance = (positions: ReadonlyMap<string, ForcePosition>): number => {
  const a = positions.get('a')!,
    b = positions.get('b')!
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function settle(layout: ForceLayout) {
  let result = layout.step(0)
  for (let i = 0; i < 12 && !result.stable; i++) result = layout.step(32)
  return result
}

describe('pure world-space force layout', () => {
  it('does nothing when all forces are disabled and stops without a background loop', () => {
    const layout = createForceLayout(pair, [{ source: 'a', target: 'b' }], { parameters: OFF })
    expect(layout.step(1)).toMatchObject({ stable: true, iteration: 1, alpha: 0 })
    expect(distance(layout.getPositions())).toBe(300)
    expect(layout.step(32).iteration).toBe(1)
  })
  it('center strength independently attracts to the configured world center', () => {
    const node = [{ key: 'a', x: 300, y: 100, radius: 0 }]
    const weak = createForceLayout(node, [], { parameters: { ...OFF, centerForce: 1 } }),
      strong = createForceLayout(node, [], { parameters: { ...OFF, centerForce: 3 } })
    expect(strong.step(5).positions.get('a')!.x).toBeLessThan(weak.step(5).positions.get('a')!.x)
    weak.setCenter(1000, 2000)
    const before = weak.getPositions().get('a')!
    const after = weak.step(10).positions.get('a')!
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)
  })
  it('repulsion independently separates unlinked nodes and increases with its own strength', () => {
    const node = [
      { key: 'a', x: -50, y: 0, radius: 0 },
      { key: 'b', x: 50, y: 0, radius: 0 }
    ]
    const weak = createForceLayout(node, [], { parameters: { ...OFF, repelForce: 1 } }),
      strong = createForceLayout(node, [], { parameters: { ...OFF, repelForce: 3 } })
    expect(distance(weak.step(5).positions)).toBeGreaterThan(100)
    expect(distance(strong.step(5).positions)).toBeGreaterThan(distance(weak.getPositions()))
  })
  it('link attraction independently pulls long edges and pushes compressed edges', () => {
    const long = createForceLayout(pair, [{ source: 'a', target: 'b' }], {
      parameters: { ...OFF, linkForce: 1 }
    })
    expect(distance(long.step(12).positions)).toBeLessThan(300)
    const short = createForceLayout(
      [
        { key: 'a', x: 0, y: 0, radius: 0 },
        { key: 'b', x: 40, y: 0, radius: 0 }
      ],
      [{ source: 'a', target: 'b' }],
      { parameters: { ...OFF, linkForce: 1 } }
    )
    expect(distance(short.step(12).positions)).toBeGreaterThan(40)
  })
  it('link strength changes movement without borrowing center or repulsion strength', () => {
    const weak = createForceLayout(pair, [{ source: 'a', target: 'b' }], {
        parameters: { ...OFF, linkForce: 1 }
      }),
      strong = createForceLayout(pair, [{ source: 'a', target: 'b' }], {
        parameters: { ...OFF, linkForce: 2 }
      })
    expect(distance(strong.step(1).positions)).toBeLessThan(distance(weak.step(1).positions))
  })
  it('natural length independently selects a different resting length', () => {
    const edge = [{ source: 'a', target: 'b' }]
    const short = createForceLayout(pair, edge, {
        parameters: { ...OFF, linkForce: 1, linkLength: 80 }
      }),
      long = createForceLayout(pair, edge, {
        parameters: { ...OFF, linkForce: 1, linkLength: 240 }
      })
    expect(distance(settle(short).positions)).toBeCloseTo(80, 0)
    expect(distance(settle(long).positions)).toBeCloseTo(240, 0)
  })
  it('natural length does not secretly scale other forces or the velocity cap', () => {
    const a = createForceLayout(pair, [], {
        parameters: { ...OFF, repelForce: 3, centerForce: 2, linkLength: 40 }
      }),
      b = createForceLayout(pair, [], {
        parameters: { ...OFF, repelForce: 3, centerForce: 2, linkLength: 600 }
      })
    expect(a.step(10).positions).toEqual(b.step(10).positions)
  })
  it('pins dragged nodes exactly while their neighbours still move, and unlock resumes physics', () => {
    const layout = createForceLayout(pair, [{ source: 'a', target: 'b' }], {
      parameters: { ...OFF, linkForce: 1, centerForce: 1 }
    })
    expect(layout.pin('a', 500, 200)).toBe(true)
    const neighbour = layout.getPositions().get('b')!
    layout.step(32)
    expect(layout.getPositions().get('a')).toEqual({ x: 500, y: 200, pinned: true })
    expect(layout.getPositions().get('b')).not.toEqual(neighbour)
    expect(layout.unpin('a')).toBe(true)
    layout.step(3)
    expect(layout.getPositions().get('a')!.x).not.toBe(500)
    expect(layout.pin('missing', 0, 0)).toBe(false)
    expect(layout.unpin('missing')).toBe(false)
  })
  it('can restore several pinned positions and unlock them together', () => {
    const positions = new Map([
      ['a', { x: 321, y: 98, pinned: true }],
      ['b', { x: -234, y: 57, pinned: true }]
    ])
    const layout = createForceLayout(pair, [], { positions })
    expect(layout.step(20).stable).toBe(true)
    expect(layout.getPositions()).toEqual(positions)
    layout.unpinAll()
    expect(layout.step(3).positions.get('a')!.pinned).toBe(false)
    expect(layout.getPositions().get('a')!.x).not.toBe(321)
  })
  it('repeatedly restoring the same pin does not wake a settled layout', () => {
    const layout = createForceLayout(pair, [])
    layout.pin('a', 50, 70)
    settle(layout)
    expect(layout.pin('a', 50, 70)).toBe(true)
    expect(layout.step(0).stable).toBe(true)
  })
  it('topology changes reuse all surviving coordinates and pins, remove old nodes, and seed new neighbours locally', () => {
    const layout = createForceLayout(pair, [{ source: 'a', target: 'b' }])
    layout.step(12)
    layout.pin('a', 400, 200)
    const previous = layout.getPositions(),
      result = layout.updateTopology(
        [
          { key: 'b', radius: 0, x: 0, y: 0 },
          { key: 'a', radius: 0, x: 0, y: 0, pinned: false },
          { key: 'c', radius: 0 }
        ],
        [
          { source: 'a', target: 'b' },
          { source: 'a', target: 'c' }
        ]
      )
    expect(result.positions.get('a')).toEqual(previous.get('a'))
    expect(result.positions.get('b')).toEqual(previous.get('b'))
    const c = result.positions.get('c')!
    expect(Math.hypot(c.x - 400, c.y - 200)).toBeLessThan(100)
    layout.updateTopology([{ key: 'a' }], [])
    expect(layout.getPositions().has('b')).toBe(false)
    expect(layout.getPositions().has('c')).toBe(false)
  })
  it('unchanged topology and node reorder do not restart a stopped simulation', () => {
    const layout = createForceLayout(pair, [{ source: 'a', target: 'b' }]),
      finished = settle(layout)
    const repeated = layout.updateTopology([...pair].reverse(), [{ source: 'b', target: 'a' }])
    expect(repeated.stable).toBe(true)
    expect(repeated.iteration).toBe(finished.iteration)
    expect(repeated.positions).toEqual(finished.positions)
  })
  it('radius changes reheat collision geometry while preserving current coordinates', () => {
    const layout = createForceLayout(pair, [])
    settle(layout)
    const previous = layout.getPositions()
    expect(
      layout.updateTopology(
        [
          { key: 'a', radius: 150 },
          { key: 'b', radius: 150 }
        ],
        []
      )
    ).toMatchObject({ stable: false, iteration: 0, alpha: 1 })
    expect(layout.getPositions()).toEqual(previous)
  })
  it('deduplicates parallel semantic springs and ignores self/absent edges without changing physical results', () => {
    const one = createForceLayout(pair, [{ source: 'a', target: 'b' }]),
      many = createForceLayout(pair, [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
        { source: 'a', target: 'a' },
        { source: 'a', target: 'absent' }
      ])
    expect(one.step(20).positions).toEqual(many.step(20).positions)
  })
  it('deterministically separates coincident nodes without NaN or random global state', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
        key: 'same-' + i,
        x: 0,
        y: 0,
        radius: 10
      })),
      a = createForceLayout(nodes, []),
      b = createForceLayout(nodes, [])
    const first = a.step(20).positions
    expect(first).toEqual(b.step(20).positions)
    expect([...first.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
      true
    )
    expect(new Set([...first.values()].map((p) => p.x + ',' + p.y)).size).toBe(100)
  })
  it('obeys visible-node/edge budgets and reports truncation', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((key) => ({ key })),
      edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'd' },
        { source: 'a', target: 'absent' }
      ]
    const result = createForceLayout(nodes, edges, { maxNodes: 3, maxEdges: 1 }).step(1)
    expect(result.positions.size).toBe(3)
    expect(result).toMatchObject({ truncated: true, omittedNodes: 1, omittedEdges: 3 })
  })
  it('stops at stability or the finite iteration budget and stays stopped until changed', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => ({ key: String(i) })),
      edges = nodes.slice(1).map((node, i) => ({ source: nodes[i].key, target: node.key }))
    const layout = createForceLayout(nodes, edges),
      result = settle(layout)
    expect(result.stable).toBe(true)
    expect(result.iteration).toBeLessThanOrEqual(300)
    expect(layout.step(32).positions).toEqual(result.positions)
    layout.setParameters({ repelForce: 2 })
    expect(layout.step(0)).toMatchObject({ stable: false, iteration: 0, alpha: 1 })
    layout.stop()
    const paused = layout.getPositions()
    expect(layout.step(20).positions).toEqual(paused)
    layout.reheat()
    expect(layout.step(0).stable).toBe(false)
  })
  it('does not alias caller node/edge/position/parameter data or returned snapshots', () => {
    const nodes = pair.map((node) => Object.freeze({ ...node })),
      edges = [Object.freeze({ source: 'a', target: 'b' })],
      positions = new Map([['a', Object.freeze({ x: -200, y: 0 })]])
    const layout = createForceLayout(nodes, edges, { positions }),
      copy = layout.getPositions(),
      params = layout.getParameters()
    copy.get('a')!.x = 999
    params.centerForce = 9
    expect(layout.getPositions().get('a')!.x).toBe(-200)
    expect(layout.getParameters().centerForce).toBe(DEFAULT_FORCE_PARAMETERS.centerForce)
    expect(nodes[0].x).toBe(-150)
    expect(positions.get('a')!.x).toBe(-200)
  })
  it('handles empty, singleton and malformed numeric inputs without nonfinite output', () => {
    expect(createForceLayout([], []).step()).toMatchObject({ stable: true, iteration: 0 })
    const layout = createForceLayout(
      [{ key: 'a', x: NaN, y: Infinity, radius: -1 }, { key: 'a' }, { key: '' }],
      [],
      {
        parameters: { centerForce: NaN, repelForce: Infinity, linkForce: -5, linkLength: 2 },
        center: { x: NaN, y: Infinity }
      }
    )
    expect(layout.getPositions().size).toBe(1)
    expect(layout.getParameters()).toEqual({
      centerForce: 1,
      repelForce: 1,
      linkForce: 0,
      linkLength: 20
    })
    expect(layout.pin('a', NaN, 0)).toBe(false)
    expect(
      [...settle(layout).positions.values()].every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y)
      )
    ).toBe(true)
  })
  it('bounds work per explicit step call and does not reheat for unchanged parameters', () => {
    const layout = createForceLayout(pair, [{ source: 'a', target: 'b' }])
    expect(layout.step(0).iteration).toBe(0)
    expect(layout.step(1000).iteration).toBe(32)
    const previous = layout.step(0)
    expect(layout.setParameters(layout.getParameters()).iteration).toBe(previous.iteration)
    expect(layout.setParameters({ centerForce: NaN }).iteration).toBe(previous.iteration)
  })
})
