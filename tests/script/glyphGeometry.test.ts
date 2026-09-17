import { describe, expect, it } from 'vitest'
import {
  contourArea,
  createStabilizer,
  ellipseContour,
  finishStroke,
  flattenContour,
  normalizeContours,
  pointInPolygon,
  polygonContour,
  rectContour,
  resample,
  reverseContour,
  signedArea,
  transformContour,
  scaleAbout,
  contourOutline,
  type GlyphContour,
  type Pt
} from '$lib/script/glyphGeometry'
import { cubicToQuads } from '$lib/script/fontWriter'

describe('轮廓绕向', () => {
  it('逆时针面积为正，反向后变负、面积大小不变', () => {
    const r = rectContour(0, 0, 100, 50)
    expect(contourArea(r)).toBeCloseTo(5000)
    const rev = reverseContour(r)
    expect(contourArea(rev)).toBeCloseTo(-5000)
    expect(contourArea(reverseContour(rev))).toBeCloseTo(5000)
  })

  it('曲线反向：终点变起点，三次曲线控制点对调', () => {
    const e = ellipseContour(0, 0, 100, 60)
    const a = contourArea(e)
    expect(a).toBeGreaterThan(0)
    const rev = reverseContour(e)
    expect(contourArea(rev)).toBeCloseTo(-a, 3)
    // 反向后展平的点和原来一样，只是顺序反了
    const p1 = flattenContour(e)
    const p2 = flattenContour(rev)
    expect(p2.length).toBe(p1.length)
    for (const p of p1)
      expect(p2.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6)).toBe(true)
  })

  it('二次曲线和隐含闭合线也能正确反向', () => {
    const c: GlyphContour = {
      cmds: [['M', 0, 0], ['Q', 50, -40, 100, 0], ['L', 100, 100], ['Z']]
    }
    const rev = reverseContour(c)
    expect(rev.cmds[0]).toEqual(['M', 0, 0])
    expect(rev.cmds[1]).toEqual(['L', 100, 100])
    expect(rev.cmds[2]).toEqual(['L', 100, 0])
    expect(rev.cmds[3]).toEqual(['Q', 50, -40, 0, 0])
    expect(contourArea(rev)).toBeCloseTo(-contourArea(c), 3)
  })

  it('外轮廓是顺时针就整组翻过来，内洞跟着保持相反', () => {
    const outer = reverseContour(rectContour(0, 0, 400, 400))
    const hole = rectContour(100, 100, 300, 300)
    const [o, h] = normalizeContours([outer, hole])
    expect(contourArea(o)).toBeGreaterThan(0)
    expect(contourArea(h)).toBeLessThan(0)
  })

  it('翻转后绕向保持不变', () => {
    const p = polygonContour(0, 0, 100, 100, 6)
    const flipped = transformContour(p, scaleAbout(0, 0, -1, 1), true)
    expect(signedArea(flattenContour(flipped))).toBeGreaterThan(0)
  })

  it('命中与勾线', () => {
    const poly = flattenContour(rectContour(0, 0, 100, 100))
    expect(pointInPolygon([50, 50], poly)).toBe(true)
    expect(pointInPolygon([150, 50], poly)).toBe(false)
    const outline = contourOutline(rectContour(0, 0, 100, 100))
    expect(outline[0]).toEqual(outline[outline.length - 1])
    expect(outline.length).toBe(5)
  })
})

describe('三次曲线换二次', () => {
  it('每一处离原曲线都不超过容差', () => {
    const p0: Pt = [0, 0]
    const c1: Pt = [0, 600]
    const c2: Pt = [900, -300]
    const p1: Pt = [800, 500]
    const quads = cubicToQuads(p0, c1, c2, p1, 1)
    expect(quads.length).toBeGreaterThan(1)
    const quadPts: Pt[] = []
    let start = p0
    for (const [q, end] of quads) {
      for (let i = 0; i <= 200; i++) {
        const t = i / 200
        const u = 1 - t
        quadPts.push([
          u * u * start[0] + 2 * u * t * q[0] + t * t * end[0],
          u * u * start[1] + 2 * u * t * q[1] + t * t * end[1]
        ])
      }
      start = end
    }
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      const u = 1 - t
      const x =
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0]
      const y =
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]
      const d = Math.min(...quadPts.map((p) => Math.hypot(p[0] - x, p[1] - y)))
      expect(d).toBeLessThan(1.5)
    }
  })
})

describe('防抖', () => {
  /** 一条斜线加上随机抖动 */
  function noisyLine(): Pt[] {
    let seed = 7
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647 - 0.5
    }
    const pts: Pt[] = []
    for (let i = 0; i <= 200; i++) pts.push([i * 4, i * 2 + rnd() * 30])
    return pts
  }
  /** 离真实直线 y = x / 2 的平均偏差（两头各去掉一成：起笔落笔本来就在抖动的点上） */
  const jitter = (pts: Pt[]): number => {
    // 折线按 x 均匀取样再比
    let sum = 0
    let n = 0
    for (let j = 0; j + 1 < pts.length; j++) {
      const [ax, ay] = pts[j]
      const [bx, by] = pts[j + 1]
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2))
      for (let k = 0; k < steps; k++) {
        const x = ax + ((bx - ax) * k) / steps
        const y = ay + ((by - ay) * k) / steps
        if (x < 80 || x > 720) continue
        sum += Math.abs(y - x / 2)
        n++
      }
    }
    return sum / n
  }

  it('拉绳防抖加收尾平滑明显压住抖动，笔画也不会停在半路', () => {
    const raw = noisyLine()
    const st = createStabilizer(8, raw[0])
    const ink: Pt[] = [raw[0]]
    for (const p of raw.slice(1)) {
      const q = st.push(p)
      if (q) ink.push([q[0], q[1]])
    }
    ink.push(...st.finish(raw[raw.length - 1]))
    const done = finishStroke(ink, 8)
    expect(jitter(done)).toBeLessThan(jitter(raw) * 0.4)
    const end = done[done.length - 1]
    const last = raw[raw.length - 1]
    expect(Math.hypot(end[0] - last[0], end[1] - last[1])).toBeLessThan(2)
  })

  it('等距取点：间距一致，两头保留', () => {
    const out = resample(
      [
        [0, 0],
        [100, 0],
        [100, 50]
      ],
      10
    )
    expect(out[0]).toEqual([0, 0])
    expect(out[out.length - 1]).toEqual([100, 50])
    for (let i = 0; i + 2 < out.length; i++)
      expect(Math.hypot(out[i + 1][0] - out[i][0], out[i + 1][1] - out[i][1])).toBeCloseTo(10, 5)
  })

  it('强度 0 时笔尖就在指针上', () => {
    const st = createStabilizer(0, [0, 0])
    expect(st.push([10, 5])).toEqual([10, 5])
  })
})
