/**
 * 在原字体上「动手术」，而不是从零写一份新的：
 * 除了非改不可的表（glyf、loca、hmtx、hhea、maxp、head，必要时 cmap、post、vmtx/vhea），
 * 其余整块字节原样搬过去——字距（kern / GPOS）、连字（GSUB）、字形分类（GDEF）、
 * hinting 的公共部分（prep / fpgm / cvt / gasp）、名字表都留着。
 *
 * 只认带 glyf / loca 的 TrueType；CFF（OTF）、TTC、缺表的字体一律返回 null，交给 fontWriter 从零写。
 * 原有字形的字形号一个都不动（改过的原地换轮廓，新字形一律加在最后），
 * 所以那些按字形号索引的表不会错位。
 * 换过轮廓的字形，它自己的 hinting 指令跟新轮廓对不上，只能丢掉——只丢这些字形的。
 */
import { type GlyphContour, mapContour } from './glyphGeometry'
import { Bytes, assembleSfnt, buildCmap, buildGlyph, type BuiltGlyph } from './fontWriter'

export interface PatchGlyph {
  /** 这个字形对应的码位；原字体里没有就新加一个字形 */
  codepoint: number
  /** 字宽（sourceUnitsPerEm 的单位） */
  advance: number
  /** 轮廓（sourceUnitsPerEm 的单位、y 向上、外轮廓逆时针） */
  contours: GlyphContour[]
}

export interface PatchOptions {
  /** 传进来的轮廓用的是多大的 em（画板是 1000）；会按原字体的 unitsPerEm 缩放 */
  sourceUnitsPerEm?: number
  /** 三次曲线换二次曲线的容差（原字体单位） */
  tolerance?: number
}

export interface PatchResult {
  data: ArrayBuffer
  unitsPerEm: number
  /** 原地换掉轮廓的字形数（这些字形自己的 hinting 丢了） */
  replaced: number
  /** 加在字体末尾的新字形数 */
  added: number
  /** 因为改了字形而不得不丢掉的表 */
  dropped: string[]
}

/** 改过字形以后一定失效的表：数字签名 */
const DROP_ALWAYS = ['DSIG']
/** 字形数一变就失效的表（都是可选的加速 / 提示表，丢了不影响排版） */
const DROP_ON_APPEND = ['hdmx', 'LTSH']

/** 读 sfnt 的表目录：标签 → 这张表的字节。读不了（TTC、CFF 以外的怪东西）返回 null */
export function sfntTables(data: ArrayBuffer): Map<string, Uint8Array> | null {
  const dv = new DataView(data)
  if (data.byteLength < 12) return null
  const sfnt = dv.getUint32(0)
  // ttcf（字体集）不碰：重新打包要动到所有子字体
  if (![0x00010000, 0x74727565].includes(sfnt)) return null
  const numTables = dv.getUint16(4)
  if (12 + numTables * 16 > data.byteLength) return null
  const src = new Uint8Array(data)
  const out = new Map<string, Uint8Array>()
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    const tag = String.fromCharCode(
      dv.getUint8(rec),
      dv.getUint8(rec + 1),
      dv.getUint8(rec + 2),
      dv.getUint8(rec + 3)
    )
    const off = dv.getUint32(rec + 8)
    const len = dv.getUint32(rec + 12)
    if (off + len > data.byteLength) return null
    out.set(tag, src.subarray(off, off + len))
  }
  return out
}

/** 一张表的读法（大端；越界返回兜底值，坏字体不至于炸） */
class Reader {
  private dv: DataView
  constructor(private data: Uint8Array) {
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }
  get length(): number {
    return this.data.length
  }
  u8(at: number, fallback = 0): number {
    return at + 1 <= this.length ? this.dv.getUint8(at) : fallback
  }
  u16(at: number, fallback = 0): number {
    return at + 2 <= this.length ? this.dv.getUint16(at) : fallback
  }
  i16(at: number, fallback = 0): number {
    return at + 2 <= this.length ? this.dv.getInt16(at) : fallback
  }
  u32(at: number, fallback = 0): number {
    return at + 4 <= this.length ? this.dv.getUint32(at) : fallback
  }
}

// ───── cmap ─────

/** 读遍所有 Unicode 子表，合成一张「码位 → 字形号」（分数高的子表说了算） */
function readCmap(t: Uint8Array): Map<number, number> {
  const r = new Reader(t)
  const out = new Map<number, number>()
  const n = r.u16(2)
  const subs: { off: number; score: number }[] = []
  for (let i = 0; i < n; i++) {
    const rec = 4 + i * 8
    const pid = r.u16(rec)
    const eid = r.u16(rec + 2)
    const off = r.u32(rec + 4)
    if (off + 2 > t.length) continue
    let score = 0
    if (pid === 3 && eid === 10) score = 40
    else if (pid === 0 && eid >= 4) score = 36
    else if (pid === 0) score = 30
    else if (pid === 3 && eid === 1) score = 24
    else if (pid === 3 && eid === 0)
      score = 10 // 符号字体：码位在 F0xx
    else if (pid === 1 && eid === 0) score = 5
    else continue
    subs.push({ off, score })
  }
  // 分数低的先写，高的后写盖掉
  subs.sort((a, b) => a.score - b.score)
  for (const s of subs) readCmapSub(r, s.off, out)
  return out
}

function readCmapSub(r: Reader, off: number, out: Map<number, number>): void {
  const fmt = r.u16(off)
  const put = (cp: number, gid: number): void => {
    if (gid && cp >= 0 && cp <= 0x10ffff) out.set(cp, gid)
  }
  if (fmt === 0) {
    for (let c = 0; c < 256; c++) put(c, r.u8(off + 6 + c))
  } else if (fmt === 4) {
    const segX2 = r.u16(off + 6)
    const ends = off + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const rangeOffs = deltas + segX2
    for (let s = 0; s < segX2 / 2; s++) {
      const end = r.u16(ends + s * 2)
      const start = r.u16(starts + s * 2)
      const delta = r.i16(deltas + s * 2)
      const ro = r.u16(rangeOffs + s * 2)
      if (start === 0xffff) continue
      for (let c = start; c <= end && c !== 0xffff; c++) {
        if (ro === 0) put(c, (c + delta) & 0xffff)
        else {
          const gid = r.u16(rangeOffs + s * 2 + ro + (c - start) * 2)
          if (gid) put(c, (gid + delta) & 0xffff)
        }
      }
    }
  } else if (fmt === 6) {
    const first = r.u16(off + 6)
    const count = r.u16(off + 8)
    for (let i = 0; i < count; i++) put(first + i, r.u16(off + 10 + i * 2))
  } else if (fmt === 12) {
    const groups = r.u32(off + 12)
    for (let g = 0; g < Math.min(groups, 0x100000); g++) {
      const rec = off + 16 + g * 12
      const start = r.u32(rec)
      const end = r.u32(rec + 4)
      const gid0 = r.u32(rec + 8)
      for (let c = start; c <= end && c - start < 0x10000; c++) put(c, gid0 + (c - start))
    }
  }
}

// ───── post：字形数变了要跟着补名字 ─────

/** post 2.0 末尾补上新字形的名字；1.0 补不了就降成 3.0（没有字形名） */
function extendPost(t: Uint8Array, names: string[]): Uint8Array {
  const r = new Reader(t)
  const version = r.u32(0)
  if (version === 0x00030000 || t.length < 32) return t
  if (version !== 0x00020000) {
    // 1.0（标准 Mac 字形序，字形数必须正好 258）、2.5（字形号偏移表）都跟不上新字形，降成 3.0
    const out = new Uint8Array(32)
    out.set(t.subarray(0, 32))
    new DataView(out.buffer).setUint32(0, 0x00030000)
    return out
  }
  const num = r.u16(32)
  const idxEnd = 34 + num * 2
  // 已有多少条自定义名字（索引 ≥ 258 指的就是第几条）
  let strings = 0
  for (let p = idxEnd; p < t.length; p += 1 + r.u8(p)) strings++
  const b = new Bytes()
  b.bytes(t.subarray(0, 32))
  b.u16(num + names.length)
  b.bytes(t.subarray(34, idxEnd))
  for (let i = 0; i < names.length; i++) b.u16(258 + strings + i)
  b.bytes(t.subarray(idxEnd))
  for (const name of names) {
    const s = (name.replace(/[^\x21-\x7e]/g, '') || 'glyph').slice(0, 63)
    b.u8(s.length)
    for (let i = 0; i < s.length; i++) b.u8(s.charCodeAt(i))
  }
  return b.out()
}

// ───── gvar：可变字体的字形变化数据 ─────

/**
 * 换过轮廓的字形，它那份变化数据里的点号跟新轮廓对不上，就地清空：
 * 把这段数据开头的 tupleVariationCount 写成 0（长度一个字节都不变，别的字形不受影响）。
 * 表看不懂就返回 null，调用方把 gvar、cvar 一起丢掉（字体退化成默认实例，字距、连字还在）。
 */
function patchGvar(t: Uint8Array, numGlyphs: number, blank: Iterable<number>): Uint8Array | null {
  const r = new Reader(t)
  if (r.u32(0) !== 0x00010000) return null
  if (r.u16(12) !== numGlyphs) return null
  const longOffsets = (r.u16(14) & 1) === 1
  const size = longOffsets ? 4 : 2
  if (20 + (numGlyphs + 1) * size > t.length) return null
  const dataAt = r.u32(16)
  const off = (i: number): number => (longOffsets ? r.u32(20 + i * 4) : r.u16(20 + i * 2) * 2)
  const out = new Uint8Array(t)
  const dv = new DataView(out.buffer)
  for (const g of blank) {
    if (g >= numGlyphs) continue
    const a = dataAt + off(g)
    if (off(g + 1) > off(g) && a + 2 <= out.length) dv.setUint16(a, 0)
  }
  return out
}

// ───── 主流程 ─────

/**
 * 在原字体上换掉 / 补上几个字形。返回 null 表示这份字体不能这么改（该走从零写的路子）。
 */
export function patchTtf(
  sfnt: ArrayBuffer,
  glyphs: PatchGlyph[],
  options: PatchOptions = {}
): PatchResult | null {
  const tables = sfntTables(sfnt)
  if (!tables) return null
  const glyf = tables.get('glyf')
  const loca = tables.get('loca')
  const head = tables.get('head')
  const maxp = tables.get('maxp')
  const hhea = tables.get('hhea')
  const hmtx = tables.get('hmtx')
  if (!glyf || !loca || !head || !maxp || !hhea || !hmtx) return null
  const headR = new Reader(head)
  const maxpR = new Reader(maxp)
  const hheaR = new Reader(hhea)
  if (head.length < 54 || hhea.length < 36 || maxp.length < 32) return null
  if (maxpR.u32(0) !== 0x00010000) return null
  const unitsPerEm = headR.u16(18)
  if (!unitsPerEm) return null
  const numGlyphs = maxpR.u16(4)
  const longLoca = headR.i16(50) === 1
  if (!numGlyphs) return null
  if (loca.length < (numGlyphs + 1) * (longLoca ? 4 : 2)) return null

  // 原来每个字形在 glyf 里的字节
  const locaR = new Reader(loca)
  const at = (i: number): number => (longLoca ? locaR.u32(i * 4) : locaR.u16(i * 2) * 2)
  const old: Uint8Array[] = []
  for (let g = 0; g < numGlyphs; g++) {
    const a = at(g)
    const z = at(g + 1)
    old.push(z > a && z <= glyf.length ? glyf.subarray(a, z) : glyf.subarray(0, 0))
  }

  // 画板是 1000 的 em，原字体不一定；写回去要缩放
  const k = unitsPerEm / (options.sourceUnitsPerEm || unitsPerEm)
  const tolerance = options.tolerance ?? Math.max(0.5, unitsPerEm / 1000)
  const cmap = tables.get('cmap') ? readCmap(tables.get('cmap')!) : new Map<number, number>()

  const replace = new Map<number, BuiltGlyph>()
  const appended: [number, number][] = []
  let total = numGlyphs
  for (const g of glyphs) {
    const contours =
      k === 1 ? g.contours : g.contours.map((c) => mapContour(c, (p) => [p[0] * k, p[1] * k]))
    const built = buildGlyph(
      { codepoints: [g.codepoint], advance: Math.max(1, Math.round(g.advance * k)), contours },
      tolerance
    )
    const hit = cmap.get(g.codepoint)
    if (hit && hit < numGlyphs) replace.set(hit, built)
    else {
      appended.push([g.codepoint, total])
      replace.set(total, built)
      total++
    }
  }

  // glyf + loca（一律长格式，省得判断偏移放不放得下）
  const glyfOut = new Bytes()
  const locaOut = new Bytes()
  for (let g = 0; g < total; g++) {
    locaOut.u32(glyfOut.length)
    const r = replace.get(g)
    if (r) glyfOut.bytes(r.data)
    else if (g < numGlyphs) glyfOut.bytes(old[g]).pad4()
  }
  locaOut.u32(glyfOut.length)

  // 每个字形的外框：换过的用新算的，没动的从 glyf 记录头上读
  const box = (g: number): { xMin: number; yMin: number; xMax: number; yMax: number } | null => {
    const r = replace.get(g)
    if (r) return r.empty ? null : r
    const d = old[g]
    if (!d || d.length < 10) return null
    const v = new Reader(d)
    return { xMin: v.i16(2), yMin: v.i16(4), xMax: v.i16(6), yMax: v.i16(8) }
  }

  // hmtx：字宽、左边距
  const numHM = Math.max(1, hheaR.u16(34))
  const hmtxR = new Reader(hmtx)
  const advances: number[] = []
  const lsbs: number[] = []
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numHM) {
      advances.push(hmtxR.u16(g * 4))
      lsbs.push(hmtxR.i16(g * 4 + 2))
    } else {
      advances.push(advances[numHM - 1] ?? 0)
      lsbs.push(hmtxR.i16(numHM * 4 + (g - numHM) * 2))
    }
  }
  for (const [g, r] of replace) {
    advances[g] = Math.max(0, Math.min(0xffff, r.advance))
    lsbs[g] = r.empty ? 0 : r.xMin
  }
  const out = new Map<string, Uint8Array>()
  // 改的字形都在长度量区里、又没加新字形，就只在原表上点几个数，其余字节不动
  const inPlace = total === numGlyphs && [...replace.keys()].every((g) => g < numHM)
  let newNumHM = numHM
  if (inPlace) {
    const copy = new Uint8Array(hmtx)
    const dv = new DataView(copy.buffer)
    for (const g of replace.keys()) {
      if (g * 4 + 4 > copy.length) continue
      dv.setUint16(g * 4, advances[g])
      dv.setInt16(g * 4 + 2, lsbs[g])
    }
    out.set('hmtx', copy)
  } else {
    newNumHM = total
    const b = new Bytes()
    for (let g = 0; g < total; g++) b.u16(advances[g] ?? 0).i16(lsbs[g] ?? 0)
    out.set('hmtx', b.out())
  }

  // hhea：字宽最大值、左右边距、横向最大延伸、长度量条数
  const hheaOut = new Uint8Array(hhea)
  {
    const dv = new DataView(hheaOut.buffer)
    let advMax = 0
    let minLsb = Infinity
    let minRsb = Infinity
    let maxExtent = -Infinity
    for (let g = 0; g < total; g++) {
      advMax = Math.max(advMax, advances[g] ?? 0)
      const bb = box(g)
      if (!bb) continue
      const lsb = lsbs[g] ?? 0
      const w = bb.xMax - bb.xMin
      minLsb = Math.min(minLsb, lsb)
      minRsb = Math.min(minRsb, (advances[g] ?? 0) - (lsb + w))
      maxExtent = Math.max(maxExtent, lsb + w)
    }
    const i16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)))
    dv.setUint16(10, Math.min(0xffff, advMax))
    if (Number.isFinite(minLsb)) dv.setInt16(12, i16(minLsb))
    if (Number.isFinite(minRsb)) dv.setInt16(14, i16(minRsb))
    if (Number.isFinite(maxExtent)) dv.setInt16(16, i16(maxExtent))
    dv.setUint16(34, newNumHM)
    out.set('hhea', hheaOut)
  }

  // maxp：字形数、简单字形的点数 / 轮廓数上限（复合字形那几项原样留着）
  const maxpOut = new Uint8Array(maxp)
  {
    const dv = new DataView(maxpOut.buffer)
    let maxPoints = 0
    let maxContours = 0
    for (let g = 0; g < total; g++) {
      const r = replace.get(g)
      if (r) {
        maxPoints = Math.max(maxPoints, r.points)
        maxContours = Math.max(maxContours, r.contours)
        continue
      }
      const d = old[g]
      if (!d || d.length < 10) continue
      const v = new Reader(d)
      const nc = v.i16(0)
      if (nc <= 0) continue // 复合字形
      maxPoints = Math.max(maxPoints, v.u16(10 + (nc - 1) * 2) + 1)
      maxContours = Math.max(maxContours, nc)
    }
    dv.setUint16(4, total)
    dv.setUint16(6, Math.min(0xffff, maxPoints))
    dv.setUint16(8, Math.min(0xffff, maxContours))
    out.set('maxp', maxpOut)
  }

  // head：整套字的外框、loca 格式（checkSumAdjustment 交给 assembleSfnt）
  const headOut = new Uint8Array(head)
  {
    const dv = new DataView(headOut.buffer)
    let xMin = Infinity
    let yMin = Infinity
    let xMax = -Infinity
    let yMax = -Infinity
    for (let g = 0; g < total; g++) {
      const bb = box(g)
      if (!bb) continue
      xMin = Math.min(xMin, bb.xMin)
      yMin = Math.min(yMin, bb.yMin)
      xMax = Math.max(xMax, bb.xMax)
      yMax = Math.max(yMax, bb.yMax)
    }
    const i16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)))
    if (Number.isFinite(xMin)) {
      dv.setInt16(36, i16(xMin))
      dv.setInt16(38, i16(yMin))
      dv.setInt16(40, i16(xMax))
      dv.setInt16(42, i16(yMax))
    }
    dv.setInt16(50, 1)
    out.set('head', headOut)
  }

  out.set('glyf', glyfOut.out())
  out.set('loca', locaOut.out())

  const dropped: string[] = []
  // cmap：只在添了新码位时重写（原来的映射 + 新的，格式 4 + 12）
  if (appended.length) {
    const all = new Map(cmap)
    for (const [cp, gid] of appended) all.set(cp, gid)
    const list = [...all.entries()]
      .filter(([cp, gid]) => gid > 0 && gid < total && cp >= 0 && cp <= 0x10ffff)
      .sort((a, b) => a[0] - b[0]) as [number, number][]
    out.set('cmap', buildCmap(list))
    const post = tables.get('post')
    if (post)
      out.set(
        'post',
        extendPost(
          post,
          appended.map(([cp]) => 'uni' + cp.toString(16).toUpperCase().padStart(4, '0'))
        )
      )
    const vhea = tables.get('vhea')
    const vmtx = tables.get('vmtx')
    if (vhea && vmtx && vhea.length >= 36) {
      const vheaR = new Reader(vhea)
      const numVM = Math.max(1, vheaR.u16(34))
      const vmtxR = new Reader(vmtx)
      const b = new Bytes()
      const lastAdv = vmtxR.u16(Math.min(numVM, numGlyphs) * 4 - 4)
      for (let g = 0; g < total; g++) {
        const adv = g < numVM ? vmtxR.u16(g * 4) : lastAdv
        const tsb = g < numVM ? vmtxR.i16(g * 4 + 2) : vmtxR.i16(numVM * 4 + (g - numVM) * 2)
        b.u16(g < numGlyphs ? adv : lastAdv).i16(g < numGlyphs ? tsb : 0)
      }
      out.set('vmtx', b.out())
      const vheaOut = new Uint8Array(vhea)
      new DataView(vheaOut.buffer).setUint16(34, total)
      out.set('vhea', vheaOut)
    } else if (vmtx) dropped.push('vmtx')
    for (const tag of DROP_ON_APPEND) if (tables.has(tag)) dropped.push(tag)
  }

  // 可变字体：换过的字形就地清掉变化数据；加了新字形（偏移表长度要变）或表看不懂就整张丢掉
  const gvar = tables.get('gvar')
  if (gvar) {
    const patched = appended.length ? null : patchGvar(gvar, numGlyphs, replace.keys())
    if (patched) out.set('gvar', patched)
    else for (const tag of ['gvar', 'cvar']) if (tables.has(tag)) dropped.push(tag)
  }
  for (const tag of DROP_ALWAYS) if (tables.has(tag)) dropped.push(tag)

  const final: [string, Uint8Array][] = []
  for (const [tag, data] of tables) {
    if (dropped.includes(tag)) continue
    final.push([tag, out.get(tag) ?? data])
  }
  return {
    data: assembleSfnt(0x00010000, final),
    unitsPerEm,
    replaced: replace.size - appended.length,
    added: appended.length,
    dropped
  }
}
