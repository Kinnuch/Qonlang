/**
 * 从零写一个 TrueType 字体（glyf 轮廓）：cmap（格式 4 + 12）、glyf、head、hhea、hmtx、loca、maxp、name、OS/2、post。
 * 轮廓只能是二次曲线，三次曲线按容差递归切开换成二次的；坐标取整。0 号字形是空的 .notdef。
 * 不带字距、连字、hinting——那些要原字体软件去做。另附 toWoff：把写好的 TTF 包成 WOFF 1.0。
 */
import type { GlyphContour, Pt } from './glyphGeometry'
import { cmdEnd, cubicAt, reverseContour } from './glyphGeometry'

export interface WriterGlyph {
  /** 映射到这个字形的码位（可以多个） */
  codepoints: number[]
  advance: number
  /** 字体单位、y 向上；外轮廓逆时针（写的时候统一翻成 TrueType 习惯的顺时针） */
  contours: GlyphContour[]
}
export interface WriterFont {
  familyName: string
  styleName?: string
  unitsPerEm?: number
  ascender: number
  descender: number
  glyphs: WriterGlyph[]
  /** 版本号，写进 name 表和 head.fontRevision */
  version?: number
  /** head 里的创建 / 修改时间（毫秒）；测试里固定住 */
  timestamp?: number
  /** 三次曲线换二次曲线的容差（字体单位） */
  tolerance?: number
}

// ───── 三次曲线 → 二次曲线 ─────

/**
 * 一段三次曲线换成若干段二次曲线，返回每段的 [控制点, 终点]。
 * 单段二次近似（控制点取 (3(c1+c2) − p0 − p1) / 4）的最大误差不超过 √3/36·|p1 − 3c2 + 3c1 − p0|，
 * 超过容差就在中点切成两半再各自换。
 */
export function cubicToQuads(p0: Pt, c1: Pt, c2: Pt, p1: Pt, tolerance = 1, depth = 0): [Pt, Pt][] {
  const ex = p1[0] - 3 * c2[0] + 3 * c1[0] - p0[0]
  const ey = p1[1] - 3 * c2[1] + 3 * c1[1] - p0[1]
  const err = (Math.sqrt(3) / 36) * Math.hypot(ex, ey)
  if (err <= tolerance || depth >= 10) {
    const q: Pt = [
      (3 * (c1[0] + c2[0]) - p0[0] - p1[0]) / 4,
      (3 * (c1[1] + c2[1]) - p0[1] - p1[1]) / 4
    ]
    return [[q, p1]]
  }
  // de Casteljau 中点切开
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const a1 = mid(p0, c1)
  const b = mid(c1, c2)
  const a3 = mid(c2, p1)
  const a2 = mid(a1, b)
  const b2 = mid(b, a3)
  const m = cubicAt(p0, c1, c2, p1, 0.5)
  return [
    ...cubicToQuads(p0, a1, a2, m, tolerance, depth + 1),
    ...cubicToQuads(m, b2, a3, p1, tolerance, depth + 1)
  ]
}

// ───── 轮廓 → TrueType 点 ─────

interface TtPoint {
  x: number
  y: number
  on: boolean
}

/** 一条轮廓 → TrueType 点列（曲线控制点是 off-curve 点）；退化的（不到 3 个点）返回空 */
export function contourToTt(c: GlyphContour, tolerance = 1, clockwise = true): TtPoint[] {
  const src = clockwise ? reverseContour(c) : c
  const pts: TtPoint[] = []
  const push = (p: Pt, on: boolean): void => {
    const x = Math.round(p[0])
    const y = Math.round(p[1])
    const last = pts[pts.length - 1]
    // 连着两个重合的 on-curve 点只留一个
    if (last && on && last.on && last.x === x && last.y === y) return
    pts.push({ x, y, on })
  }
  let cur: Pt = [0, 0]
  let started = false
  for (const cmd of src.cmds) {
    if (cmd[0] === 'M') {
      if (started) break
      started = true
      cur = [cmd[1], cmd[2]]
      push(cur, true)
    } else if (!started || cmd[0] === 'Z') continue
    else if (cmd[0] === 'L') {
      cur = [cmd[1], cmd[2]]
      push(cur, true)
    } else if (cmd[0] === 'Q') {
      push([cmd[1], cmd[2]], false)
      cur = [cmd[3], cmd[4]]
      push(cur, true)
    } else if (cmd[0] === 'C') {
      for (const [q, end] of cubicToQuads(
        cur,
        [cmd[1], cmd[2]],
        [cmd[3], cmd[4]],
        cmdEnd(cmd)!,
        tolerance
      )) {
        push(q, false)
        push(end, true)
      }
      cur = cmdEnd(cmd)!
    }
  }
  // 末点回到首点：闭合是隐含的，去掉
  while (pts.length > 1) {
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (b.on && a.x === b.x && a.y === b.y) pts.pop()
    else break
  }
  return pts.length >= 3 ? pts : []
}

// ───── 字节 ─────

class Bytes {
  private buf = new Uint8Array(1024)
  length = 0
  private grow(n: number): void {
    if (this.length + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.length + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.length))
    this.buf = next
  }
  u8(v: number): this {
    this.grow(1)
    this.buf[this.length++] = v & 0xff
    return this
  }
  u16(v: number): this {
    return this.u8(v >> 8).u8(v)
  }
  i16(v: number): this {
    return this.u16(v < 0 ? v + 0x10000 : v)
  }
  u32(v: number): this {
    return this.u16(Math.floor(v / 0x10000) & 0xffff).u16(v & 0xffff)
  }
  tag(s: string): this {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i) || 32)
    return this
  }
  bytes(b: Uint8Array): this {
    this.grow(b.length)
    this.buf.set(b, this.length)
    this.length += b.length
    return this
  }
  pad4(): this {
    while (this.length % 4) this.u8(0)
    return this
  }
  out(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.length)
  }
}

/** 表的校验和：按 4 字节大端相加（不足 4 字节补 0） */
function checksum(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const v =
      ((data[i] << 24) >>> 0) +
      ((data[i + 1] ?? 0) << 16) +
      ((data[i + 2] ?? 0) << 8) +
      (data[i + 3] ?? 0)
    sum = (sum + v) >>> 0
  }
  return sum
}
/** 大数组取最小 / 最大（几万个字形时展开参数会爆栈） */
const minOf = (xs: number[], empty = 0): number =>
  xs.length ? xs.reduce((a, b) => Math.min(a, b)) : empty
const maxOf = (xs: number[], empty = 0): number =>
  xs.length ? xs.reduce((a, b) => Math.max(a, b)) : empty
const clampI16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)))
const clampU16 = (v: number): number => Math.max(0, Math.min(65535, Math.round(v)))

// ───── 各表 ─────

interface BuiltGlyph {
  data: Uint8Array
  advance: number
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  points: number
  contours: number
  empty: boolean
}

function buildGlyph(g: WriterGlyph, tolerance: number): BuiltGlyph {
  const contours = g.contours.map((c) => contourToTt(c, tolerance)).filter((c) => c.length)
  const advance = clampU16(g.advance)
  if (!contours.length)
    return {
      data: new Uint8Array(0),
      advance,
      xMin: 0,
      yMin: 0,
      xMax: 0,
      yMax: 0,
      points: 0,
      contours: 0,
      empty: true
    }
  const all = contours.flat()
  const xMin = clampI16(minOf(all.map((p) => p.x)))
  const yMin = clampI16(minOf(all.map((p) => p.y)))
  const xMax = clampI16(maxOf(all.map((p) => p.x)))
  const yMax = clampI16(maxOf(all.map((p) => p.y)))
  const b = new Bytes()
  b.i16(contours.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax)
  let end = -1
  for (const c of contours) {
    end += c.length
    b.u16(end)
  }
  b.u16(0) // 没有指令
  const flags: number[] = []
  const xs = new Bytes()
  const ys = new Bytes()
  let px = 0
  let py = 0
  for (const p of all) {
    const x = clampI16(p.x)
    const y = clampI16(p.y)
    const dx = x - px
    const dy = y - py
    px = x
    py = y
    let f = p.on ? 0x01 : 0
    if (dx === 0) f |= 0x10
    else if (Math.abs(dx) <= 255) {
      f |= 0x02 | (dx > 0 ? 0x10 : 0)
      xs.u8(Math.abs(dx))
    } else xs.i16(dx)
    if (dy === 0) f |= 0x20
    else if (Math.abs(dy) <= 255) {
      f |= 0x04 | (dy > 0 ? 0x20 : 0)
      ys.u8(Math.abs(dy))
    } else ys.i16(dy)
    flags.push(f)
  }
  // 连着相同的标志用重复位压一下
  for (let i = 0; i < flags.length;) {
    let n = 1
    while (i + n < flags.length && flags[i + n] === flags[i] && n < 256) n++
    if (n > 2) {
      b.u8(flags[i] | 0x08).u8(n - 1)
      i += n
    } else {
      b.u8(flags[i])
      i++
    }
  }
  b.bytes(xs.out()).bytes(ys.out())
  // 4 字节对齐（loca 用长格式，本来不强制，对齐了省事）
  b.pad4()
  return {
    data: b.out(),
    advance,
    xMin,
    yMin,
    xMax,
    yMax,
    points: all.length,
    contours: contours.length,
    empty: false
  }
}

function buildCmap(map: [number, number][]): Uint8Array {
  // 格式 4：只收 BMP；连续码位、字形号差值不变的归一段
  const bmp = map.filter(([cp]) => cp < 0xffff)
  const segs: { start: number; end: number; delta: number }[] = []
  for (const [cp, gid] of bmp) {
    const last = segs[segs.length - 1]
    if (last && cp === last.end + 1 && gid - cp === last.delta) last.end = cp
    else segs.push({ start: cp, end: cp, delta: gid - cp })
  }
  // 表长不能超过 65535：段太多就截断，剩下的交给格式 12
  while (segs.length > 8000) segs.pop()
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 })
  const n = segs.length
  const f4 = new Bytes()
  const entrySel = Math.floor(Math.log2(n))
  const search = 2 * 2 ** entrySel
  f4.u16(4)
    .u16(16 + n * 8)
    .u16(0)
    .u16(n * 2)
    .u16(search)
    .u16(entrySel)
    .u16(n * 2 - search)
  for (const s of segs) f4.u16(s.end)
  f4.u16(0)
  for (const s of segs) f4.u16(s.start)
  for (const s of segs) f4.u16((s.delta + 0x10000) & 0xffff)
  for (let i = 0; i < n; i++) f4.u16(0)
  // 格式 12：全部码位
  const groups: { start: number; end: number; gid: number }[] = []
  for (const [cp, gid] of map) {
    const last = groups[groups.length - 1]
    if (last && cp === last.end + 1 && gid === last.gid + (cp - last.start)) last.end = cp
    else groups.push({ start: cp, end: cp, gid })
  }
  const f12 = new Bytes()
  f12
    .u16(12)
    .u16(0)
    .u32(16 + groups.length * 12)
    .u32(0)
    .u32(groups.length)
  for (const g of groups) f12.u32(g.start).u32(g.end).u32(g.gid)
  const a = f4.out()
  const c = f12.out()
  // 编码记录按平台、编码排：(0,3) (0,4) (3,1) (3,10)
  const head = 4 + 4 * 8
  const t = new Bytes()
  t.u16(0).u16(4)
  t.u16(0).u16(3).u32(head)
  t.u16(0)
    .u16(4)
    .u32(head + a.length)
  t.u16(3).u16(1).u32(head)
  t.u16(3)
    .u16(10)
    .u32(head + a.length)
  t.bytes(a).bytes(c)
  return t.out()
}

function buildName(family: string, style: string, version: number): Uint8Array {
  const ps =
    (family.replace(/[^!-~]|[[\](){}<>/%]/g, '').slice(0, 40) || 'QonlangFont') +
    '-' +
    (style.replace(/[^!-~]|[[\](){}<>/%]/g, '') || 'Regular')
  const ver = `Version ${version.toFixed(3)}`
  const records: [number, string][] = [
    [1, family],
    [2, style],
    [3, `${ps};${ver}`],
    [4, style === 'Regular' ? family : `${family} ${style}`],
    [5, ver],
    [6, ps.slice(0, 63)]
  ]
  const strs = new Bytes()
  const t = new Bytes()
  t.u16(0)
    .u16(records.length)
    .u16(6 + records.length * 12)
  for (const [id, s] of records) {
    const off = strs.length
    for (let i = 0; i < s.length; i++) strs.u16(s.charCodeAt(i))
    t.u16(3)
      .u16(1)
      .u16(0x409)
      .u16(id)
      .u16(strs.length - off)
      .u16(off)
  }
  t.bytes(strs.out())
  return t.out()
}

/** 写 TTF；返回整个字体文件 */
export function writeTtf(font: WriterFont): ArrayBuffer {
  const upem = font.unitsPerEm ?? 1000
  const tolerance = font.tolerance ?? 1
  const style = font.styleName || 'Regular'
  const version = font.version ?? 1
  const family = font.familyName.trim() || 'Qonlang Font'
  const glyphs = [
    buildGlyph({ codepoints: [], advance: Math.round(upem / 2), contours: [] }, tolerance),
    ...font.glyphs.map((g) => buildGlyph(g, tolerance))
  ]
  const numGlyphs = glyphs.length
  const map: [number, number][] = []
  const seen = new Set<number>()
  font.glyphs.forEach((g, i) => {
    for (const cp of g.codepoints) {
      if (seen.has(cp) || cp < 0 || cp > 0x10ffff) continue
      seen.add(cp)
      map.push([cp, i + 1])
    }
  })
  map.sort((a, b) => a[0] - b[0])

  const drawn = glyphs.filter((g) => !g.empty)
  const xMin = minOf(drawn.map((g) => g.xMin))
  const yMin = minOf(drawn.map((g) => g.yMin))
  const xMax = maxOf(drawn.map((g) => g.xMax))
  const yMax = maxOf(drawn.map((g) => g.yMax))
  const ascender = clampI16(font.ascender)
  const descender = clampI16(font.descender)

  // glyf + loca
  const glyf = new Bytes()
  const loca = new Bytes()
  for (const g of glyphs) {
    loca.u32(glyf.length)
    glyf.bytes(g.data)
  }
  loca.u32(glyf.length)

  // head：checkSumAdjustment 先写 0，整个文件拼好再回填
  const secs = Math.floor((font.timestamp ?? Date.now()) / 1000) + 2082844800
  const head = new Bytes()
  head
    .u32(0x00010000)
    .u32(Math.round(version * 0x10000))
    .u32(0)
    .u32(0x5f0f3cf5)
    .u16(0x000b)
    .u16(upem)
    .u32(Math.floor(secs / 0x100000000))
    .u32(secs % 0x100000000)
    .u32(Math.floor(secs / 0x100000000))
    .u32(secs % 0x100000000)
    .i16(xMin)
    .i16(yMin)
    .i16(xMax)
    .i16(yMax)
    .u16(0)
    .u16(8)
    .i16(2)
    .i16(1)
    .i16(0)

  const advMax = maxOf(glyphs.map((g) => g.advance))
  const minLsb = minOf(drawn.map((g) => g.xMin))
  const minRsb = minOf(drawn.map((g) => g.advance - g.xMax))
  const maxExtent = maxOf(drawn.map((g) => g.xMax))
  const hhea = new Bytes()
  hhea
    .u32(0x00010000)
    .i16(ascender)
    .i16(descender)
    .i16(0)
    .u16(advMax)
    .i16(minLsb)
    .i16(clampI16(minRsb))
    .i16(maxExtent)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(numGlyphs)

  const hmtx = new Bytes()
  for (const g of glyphs) hmtx.u16(g.advance).i16(g.empty ? 0 : g.xMin)

  const maxp = new Bytes()
  maxp
    .u32(0x00010000)
    .u16(numGlyphs)
    .u16(maxOf(glyphs.map((g) => g.points)))
    .u16(maxOf(glyphs.map((g) => g.contours)))
    .u16(0)
    .u16(0)
    .u16(2)
  for (let i = 0; i < 8; i++) maxp.u16(0)

  // OS/2 第 4 版
  const cps = map.map(([cp]) => cp)
  const bmpCps = cps.filter((cp) => cp <= 0xffff)
  const nonEmptyAdv = glyphs.slice(1).filter((g) => g.advance > 0)
  const avg = nonEmptyAdv.length
    ? Math.round(nonEmptyAdv.reduce((s, g) => s + g.advance, 0) / nonEmptyAdv.length)
    : Math.round(upem / 2)
  let range1 = 0
  let range2 = 0
  if (cps.some((cp) => cp < 0x80)) range1 |= 1 // 基本拉丁
  if (cps.some((cp) => cp > 0xffff)) range2 |= 1 << 25 // 第 57 位：非 BMP
  if (cps.some((cp) => cp >= 0xe000 && cp <= 0xf8ff)) range2 |= 1 << 28 // 第 60 位：私用区
  const os2 = new Bytes()
  os2
    .u16(4)
    .i16(avg)
    .u16(400)
    .u16(5)
    .u16(0)
    .i16(Math.round(upem * 0.65))
    .i16(Math.round(upem * 0.6))
    .i16(0)
    .i16(Math.round(upem * 0.075))
    .i16(Math.round(upem * 0.65))
    .i16(Math.round(upem * 0.6))
    .i16(0)
    .i16(Math.round(upem * 0.35))
    .i16(Math.round(upem * 0.05))
    .i16(Math.round(upem * 0.26))
    .i16(0)
  for (let i = 0; i < 10; i++) os2.u8(0)
  os2
    .u32(range1 >>> 0)
    .u32(range2 >>> 0)
    .u32(0)
    .u32(0)
    .tag('QONL')
    .u16(0x40 | 0x80) // REGULAR、USE_TYPO_METRICS
    .u16(minOf(bmpCps))
    .u16(Math.min(0xffff, maxOf(cps)))
    .i16(ascender)
    .i16(descender)
    .i16(0)
    .u16(clampU16(Math.max(ascender, yMax)))
    .u16(clampU16(Math.max(-descender, -yMin)))
    .u32(1)
    .u32(0)
    .i16(Math.round(upem * 0.5))
    .i16(Math.round(upem * 0.7))
    .u16(0)
    .u16(32)
    .u16(0)

  const post = new Bytes()
  post
    .u32(0x00030000)
    .u32(0)
    .i16(-Math.round(upem * 0.1))
    .i16(Math.round(upem * 0.05))
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)

  const tables: [string, Uint8Array][] = (
    [
      ['OS/2', os2.out()],
      ['cmap', buildCmap(map)],
      ['glyf', glyf.out()],
      ['head', head.out()],
      ['hhea', hhea.out()],
      ['hmtx', hmtx.out()],
      ['loca', loca.out()],
      ['maxp', maxp.out()],
      ['name', buildName(family, style, version)],
      ['post', post.out()]
    ] as [string, Uint8Array][]
  ).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const n = tables.length
  const entrySel = Math.floor(Math.log2(n))
  const search = 2 ** entrySel * 16
  const file = new Bytes()
  file
    .u32(0x00010000)
    .u16(n)
    .u16(search)
    .u16(entrySel)
    .u16(n * 16 - search)
  let offset = 12 + n * 16
  let headAt = 0
  for (const [tag, data] of tables) {
    if (tag === 'head') headAt = offset
    file.tag(tag).u32(checksum(data)).u32(offset).u32(data.length)
    offset += Math.ceil(data.length / 4) * 4
  }
  for (const [, data] of tables) file.bytes(data).pad4()
  const out = file.out()
  const adj = (0xb1b0afba - checksum(out) + 0x100000000) % 0x100000000
  const view = new DataView(out.buffer)
  view.setUint32(headAt + 8, adj)
  return out.buffer
}

// ───── WOFF ─────

async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** sfnt（TTF / OTF）包成 WOFF 1.0：每张表单独 zlib 压缩，压了不变小就原样放 */
export async function toWoff(sfnt: ArrayBuffer): Promise<ArrayBuffer> {
  const dv = new DataView(sfnt)
  const flavor = dv.getUint32(0)
  const n = dv.getUint16(4)
  const entries: {
    tag: number
    checksum: number
    data: Uint8Array<ArrayBuffer>
    stored: Uint8Array
  }[] = []
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16
    const off = dv.getUint32(rec + 8)
    const len = dv.getUint32(rec + 12)
    const data = new Uint8Array(sfnt.slice(off, off + len))
    const packed = await deflate(data)
    entries.push({
      tag: dv.getUint32(rec),
      checksum: dv.getUint32(rec + 4),
      data,
      stored: packed.length < data.length ? packed : data
    })
  }
  entries.sort((a, b) => a.tag - b.tag)
  const sfntSize = 12 + 16 * n + entries.reduce((s, e) => s + Math.ceil(e.data.length / 4) * 4, 0)
  const b = new Bytes()
  let offset = 44 + 20 * n
  const total = offset + entries.reduce((s, e) => s + Math.ceil(e.stored.length / 4) * 4, 0)
  b.tag('wOFF').u32(flavor).u32(total).u16(n).u16(0).u32(sfntSize).u16(1).u16(0)
  b.u32(0).u32(0).u32(0).u32(0).u32(0)
  for (const e of entries) {
    b.u32(e.tag).u32(offset).u32(e.stored.length).u32(e.data.length).u32(e.checksum)
    offset += Math.ceil(e.stored.length / 4) * 4
  }
  for (const e of entries) b.bytes(e.stored).pad4()
  return b.out().buffer
}
