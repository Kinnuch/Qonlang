/**
 * 音节拼合：把转写按「辅音+元音 / 元音+辅音」的字形读音排成一串，
 * 供 CV/VC 音节文字（假名式、线形文字式）使用。
 *
 * 可拼的读音直接从字形表里推出来：读音切成两个音段、一辅一元的就是拼合用的格子，
 * 更长的读音（整词、词根块）优先整块取用。软件不预设任何一门语言的字母。
 */
import type { Glyph, Language, Script } from '$lib/core/model'
import { nucleusSet, segment } from '$lib/engine/phon'

export interface PackTables {
  /** 切分用的单位表 */
  inventory: string[]
  /** 元音单位 */
  nuclei: Set<string>
  /** 读音 → 是否存在（含长读音） */
  all: Set<string>
  /** 辅音+元音 的读音 */
  cv: Set<string>
  /** 元音+辅音 的读音 */
  vc: Set<string>
  /** 写法 → 字形字母 */
  letterMap: Map<string, string>
  /** 需要标出来的字母（按原写法） */
  marked: Set<string>
  /** 元音 → 书写份数（半长 2、全长 3） */
  lengths: Map<string, number>
  /** 长元音 → 基础元音 */
  base: Map<string, string>
  killer: string
  dummy: string
}

/** 「a=b」「a b c = 2」这类设置行 */
function parseLines(text: string): [string[], string][] {
  const out: [string[], string][] = []
  for (const line of (text ?? '').split('\n')) {
    const t = line.split(';')[0].trim()
    if (!t) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const left = t
      .slice(0, i)
      .split(/[\s,，]+/)
      .filter(Boolean)
    const right = t.slice(i + 1).trim()
    if (left.length && right) out.push([left, right])
  }
  return out
}

const words = (t: string): string[] => (t ?? '').split(/[\s,，]+/).filter(Boolean)

export function packTables(lang: Language, script: Script): PackTables {
  const p = script.packing
  const nuclei = p?.vowels?.trim() ? new Set(words(p.vowels)) : nucleusSet(lang)
  const inventory = p?.letters?.trim() ? words(p.letters) : lang.phonemes.map((x) => x.symbol)
  const all = new Set<string>()
  const cv = new Set<string>()
  const vc = new Set<string>()
  const add = (g: Glyph): void => {
    for (const raw of g.value.split(/[/、,，]/)) {
      const v = raw.trim().toLowerCase()
      if (!v) continue
      all.add(v)
      const segs = segment(v, inventory)
      if (segs.length !== 2) continue
      const [a, b] = segs
      if (!nuclei.has(a) && nuclei.has(b)) cv.add(v)
      else if (nuclei.has(a) && !nuclei.has(b)) vc.add(v)
    }
  }
  for (const g of script.glyphs) add(g)

  const letterMap = new Map<string, string>()
  for (const [left, right] of parseLines(p?.letterMap ?? ''))
    for (const l of left) letterMap.set(l, right)
  const marked = new Set(words(p?.marked ?? ''))
  const lengths = new Map<string, number>()
  const base = new Map<string, string>()
  for (const [left, right] of parseLines(p?.lengths ?? '')) {
    const n = Number(right.replace(/[^\d]/g, '')) || 1
    for (const l of left) lengths.set(l, n)
  }
  for (const [left, right] of parseLines(p?.baseVowels ?? ''))
    for (const l of left) base.set(l, right)
  return {
    inventory,
    nuclei,
    all,
    cv,
    vc,
    letterMap,
    marked,
    lengths,
    base,
    killer: p?.killer?.trim() || '',
    dummy: p?.dummyVowel?.trim() || 'a'
  }
}

interface Seg {
  /** 字形字母（浊音已换成对应的清音） */
  c: string
  /** 原样，匹配长读音时用 */
  raw: string
  vowel: boolean
  /** 元音写几份 */
  len: number
  /** 清音，要靠重复或消音符标出 */
  marked: boolean
}

function toSegs(word: string, t: PackTables): Seg[] {
  const { nuclei, inventory } = t
  return segment(word.normalize('NFC').toLowerCase(), inventory).map((raw): Seg => {
    const b = t.base.get(raw) ?? raw
    const isV = nuclei.has(raw) || nuclei.has(b)
    return {
      c: t.letterMap.get(raw) ?? b,
      raw,
      vowel: isV,
      len: t.lengths.get(raw) ?? 1,
      marked: !isV && t.marked.has(raw)
    }
  })
}

/**
 * 把一个词排成读音序列。`isHead` 表示这是中点前的词头，
 * 按不少文字的惯例，词头里的消音符与长元音标记可以省。
 */
export function packWord(lang: Language, script: Script, word: string, isHead = false): string[] {
  const t = packTables(lang, script)
  const segs = toSegs(word, t)
  const out: string[] = []
  let carried: Seg | null = null
  let written = false
  const carry = (v: Seg, already: boolean): void => {
    carried = v
    written = already
    const n = isHead && out.length === 0 && v.len === 2 ? 1 : v.len
    for (let k = 1; k < n; k++) out.push(v.c)
  }
  const flush = (): void => {
    if (carried && !written) out.push((carried as Seg).c)
    carried = null
    written = false
  }
  let i = 0
  while (i < segs.length) {
    // 长读音（整词或词根块）优先，按原拼写从长到短试
    let matched = ''
    let matchLen = 0
    for (let n = Math.min(8, segs.length - i); n >= 2; n--) {
      const chunk = segs
        .slice(i, i + n)
        .map((x) => x.raw)
        .join('')
      if (t.cv.has(chunk) || t.vc.has(chunk)) continue
      if (t.all.has(chunk)) {
        matched = chunk
        matchLen = n
        break
      }
    }
    if (matched) {
      flush()
      out.push(matched)
      i += matchLen
      continue
    }
    const s = segs[i]
    const next = segs[i + 1]
    if (s.vowel) {
      flush()
      carry(s, false)
      i += 1
      continue
    }
    const vcOk = carried ? t.vc.has((carried as Seg).c + s.c) : false
    if (carried && vcOk && !(written && next?.vowel && !s.marked)) {
      // 手上有元音：拼 VC，元音因此写第二次
      out.push((carried as Seg).c + s.c)
      carried = null
      written = false
      if (s.marked) {
        // 清音要跨两格出现；后面还有元音就顺势写 CV
        if (next?.vowel) {
          out.push(s.c + next.c)
          carry(next, true)
          i += 2
          continue
        }
        if ((!next || next.c === s.c) && t.killer) out.push(t.killer)
      }
      i += 1
      continue
    }
    flush()
    const lastKiller = out[out.length - 1] === t.killer
    if (s.marked && !lastKiller && t.killer && !(out.length === 0 && isHead)) out.push(t.killer)
    if (next?.vowel) {
      out.push(s.c + next.c)
      carry(next, true)
      i += 2
    } else {
      // 没有元音可拼：借一个元音再用消音符消掉
      out.push(s.c + t.dummy)
      if (t.killer) out.push(t.killer)
      i += 1
    }
  }
  flush()
  return out
}
