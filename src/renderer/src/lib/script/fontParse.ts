/**
 * 极简 sfnt（TTF / OTF / TTC 首字体）解析：只读 cmap（格式 4 / 12）、name（家族名）、post（字形名）。
 * 用于把 FontCreator 等软件导出的字体里的字符列成字形表。不做渲染，不解析轮廓。
 */

export interface ParsedGlyph {
  codepoint: number
  char: string
  /** post 表里的字形名；没有时为空 */
  name: string
}

export interface ParsedFont {
  family: string
  glyphs: ParsedGlyph[]
  /** 字形总数（含未映射到码位的） */
  numGlyphs: number
}

const MAC_GLYPH_NAMES_COUNT = 258

export function parseFont(data: ArrayBuffer): ParsedFont {
  const dv = new DataView(data)
  let base = 0
  const tag = dv.getUint32(0)
  if (tag === 0x74746366) base = dv.getUint32(12) // 'ttcf' → 首字体偏移
  const sfnt = dv.getUint32(base)
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(sfnt))
    throw new Error('unsupported font format')
  const numTables = dv.getUint16(base + 4)
  const tables = new Map<string, { off: number; len: number }>()
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16
    const name = String.fromCharCode(
      dv.getUint8(rec),
      dv.getUint8(rec + 1),
      dv.getUint8(rec + 2),
      dv.getUint8(rec + 3)
    )
    tables.set(name, { off: dv.getUint32(rec + 8), len: dv.getUint32(rec + 12) })
  }
  const cmap = tables.get('cmap')
  if (!cmap) throw new Error('no cmap table')
  const maxp = tables.get('maxp')
  const numGlyphs = maxp ? dv.getUint16(maxp.off + 4) : 0
  const map = readCmap(dv, cmap.off)
  const names = tables.get('post')
    ? readPostNames(dv, tables.get('post')!.off, tables.get('post')!.len)
    : []
  const family = tables.get('name') ? readFamily(dv, tables.get('name')!.off) : ''
  const glyphs: ParsedGlyph[] = []
  for (const [cp, gid] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    if (gid === 0) continue
    glyphs.push({ codepoint: cp, char: String.fromCodePoint(cp), name: names[gid] ?? '' })
  }
  return { family, glyphs, numGlyphs }
}

function readCmap(dv: DataView, off: number): Map<number, number> {
  const n = dv.getUint16(off + 2)
  let best: { off: number; score: number } | null = null
  for (let i = 0; i < n; i++) {
    const rec = off + 4 + i * 8
    const pid = dv.getUint16(rec)
    const eid = dv.getUint16(rec + 2)
    const sub = off + dv.getUint32(rec + 4)
    const fmt = dv.getUint16(sub)
    let score = 0
    if (fmt === 12) score = 4
    else if (fmt === 4) score = 3
    else continue
    if (pid === 3 && eid === 10) score += 10
    else if (pid === 0) score += 8
    else if (pid === 3 && eid === 1) score += 6
    else if (pid === 3 && eid === 0) score += 2 // 符号字体：码位在 F0xx
    if (!best || score > best.score) best = { off: sub, score }
  }
  const out = new Map<number, number>()
  if (!best) return out
  const fmt = dv.getUint16(best.off)
  if (fmt === 4) {
    const segX2 = dv.getUint16(best.off + 6)
    const segs = segX2 / 2
    const ends = best.off + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const rangeOffs = deltas + segX2
    for (let s = 0; s < segs; s++) {
      const end = dv.getUint16(ends + s * 2)
      const start = dv.getUint16(starts + s * 2)
      const delta = dv.getInt16(deltas + s * 2)
      const ro = dv.getUint16(rangeOffs + s * 2)
      if (start === 0xffff) continue
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid: number
        if (ro === 0) gid = (c + delta) & 0xffff
        else {
          const addr = rangeOffs + s * 2 + ro + (c - start) * 2
          if (addr + 2 > dv.byteLength) continue
          gid = dv.getUint16(addr)
          if (gid !== 0) gid = (gid + delta) & 0xffff
        }
        if (gid) out.set(c, gid)
      }
    }
  } else if (fmt === 12) {
    const nGroups = dv.getUint32(best.off + 12)
    for (let g = 0; g < nGroups; g++) {
      const rec = best.off + 16 + g * 12
      const start = dv.getUint32(rec)
      const end = dv.getUint32(rec + 4)
      const gid0 = dv.getUint32(rec + 8)
      for (let c = start; c <= end && c - start < 0x10000; c++) out.set(c, gid0 + (c - start))
    }
  }
  return out
}

function readPostNames(dv: DataView, off: number, len: number): string[] {
  const version = dv.getUint32(off)
  if (version !== 0x00020000) return []
  const num = dv.getUint16(off + 32)
  const idx: number[] = []
  for (let i = 0; i < num; i++) idx.push(dv.getUint16(off + 34 + i * 2))
  const strs: string[] = []
  let p = off + 34 + num * 2
  const end = off + len
  while (p < end) {
    const l = dv.getUint8(p)
    let s = ''
    for (let i = 0; i < l && p + 1 + i < end; i++) s += String.fromCharCode(dv.getUint8(p + 1 + i))
    strs.push(s)
    p += 1 + l
  }
  return idx.map((i) =>
    i >= MAC_GLYPH_NAMES_COUNT
      ? (strs[i - MAC_GLYPH_NAMES_COUNT] ?? '')
      : (MAC_GLYPH_NAMES[i] ?? '')
  )
}

function readFamily(dv: DataView, off: number): string {
  const count = dv.getUint16(off + 2)
  const strOff = off + dv.getUint16(off + 4)
  let best = ''
  let bestScore = -1
  for (let i = 0; i < count; i++) {
    const rec = off + 6 + i * 12
    const pid = dv.getUint16(rec)
    const nameId = dv.getUint16(rec + 6)
    const len = dv.getUint16(rec + 8)
    const so = dv.getUint16(rec + 10)
    if (nameId !== 1 && nameId !== 16) continue
    let s = ''
    if (pid === 3 || pid === 0) {
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(strOff + so + k))
    } else if (pid === 1) {
      for (let k = 0; k < len; k++) s += String.fromCharCode(dv.getUint8(strOff + so + k))
    } else continue
    const score = (nameId === 16 ? 2 : 0) + (pid === 3 ? 1 : 0)
    if (score > bestScore && s) {
      best = s
      bestScore = score
    }
  }
  return best
}

/** 按 Unicode 类别粗分：字母 / 附标 / 数字 / 标点 / 私用区 / 其他 */
export function guessCategory(char: string): string {
  const cp = char.codePointAt(0) ?? 0
  if ((cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0x10fffd)) return 'glyph'
  if (/\p{M}/u.test(char)) return 'mark'
  if (/\p{N}/u.test(char)) return 'number'
  if (/\p{P}|\p{S}/u.test(char)) return 'punct'
  if (/\p{L}/u.test(char)) return 'letter'
  if (/\s/u.test(char)) return 'space'
  return 'other'
}

// 标准 Macintosh 字形名（post 2.0 索引 < 258）
const MAC_GLYPH_NAMES =
  `.notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf onequarter threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat`.split(
    ' '
  )
