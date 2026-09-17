/**
 * 一个词切成几块：前缀* 词干（词缀* 词干）* 后缀*。每一块从词典里找（词头、词干、屈折形、构形推出来的形式、
 * 词根与各类语素），逐块记代价，代价小的排前面——
 * 块少的优先、词缀比复合词优先、单字母的块和词缀对不上出现环境的扣分；
 * 同一段文字在别处确认成了同一个词条 / 语素、前后接得跟确认过的一样、词条释义对得上本句译文的加分。
 * 靠两个以上词干、或者靠没确认过的单字母语素才拼出来的，标成猜测等人确认。
 */
import type { Analysis, Id, Lexeme, Morpheme } from '$lib/core/model'
import { piecesOverlap } from './candidates'

/** 一块的词典来源 */
export interface Piece {
  form: string
  /** pre 前缀、suf 后缀、stem 词干（词条或词根）、whole 只能单独成词（小品词、中缀这些） */
  role: 'pre' | 'suf' | 'stem' | 'whole'
  gloss: string
  morphemeId: Id | null
  lexemeId: Id | null
  slot: string | null
  /** 这一块本身的代价（不含上下文加减分） */
  cost: number
  /** 去掉附加符才对上的 */
  fold?: boolean
  morpheme?: Morpheme
  lexeme?: Lexeme
  /** 学来的整块：这段文字在别处确认成了连着的几段，原样搬过来 */
  chunk?: ChunkMorph[]
  /** 整块里有几个词干 */
  chunkStems?: number
}

/** 学来的整块里的一段 */
export interface ChunkMorph {
  form: string
  gloss: string
  morphemeId: Id | null
  /** 确认时手动指定的词条（原样写回分析） */
  lexemeId?: Id | null
  /** 这一段对应的词条（算整词挂哪个词条用，不写进分析） */
  ref?: Id | null
  keys: string[]
}

/** 从确认过的分析里学到的：某段文字确认成了什么、哪个语素确认过、前后接什么 */
export interface LearnStats {
  formKey: Map<string, Map<string, number>>
  keyCount: Map<string, number>
  /** 前一段的键 → 后面接过的段的键 */
  next: Map<string, Set<string>>
  /** 连着两到四段合起来的文字 → 确认成的那几段（同样切法记几次） */
  chunks: Map<string, { morphs: ChunkMorph[]; count: number }[]>
}

export interface SegmentSource {
  /** 这段文字能当哪些块（whole 为 true 时整个词就是这一段） */
  pieces(sub: string, whole: boolean): Piece[]
  learn: LearnStats
  /** 词缀的出现环境：对上 1、对不上 -1、没写环境 0 */
  envFit(p: Piece, before: string, after: string): number
  /** 词条释义切好的片段（按译文挑用） */
  defPieces(l: Lexeme): string[]
}

export interface SegmentOptions {
  /** 整个词至少要有一个词干（按边界切开的段可以只有词缀：动词头 dáfes· 的词干在点后面） */
  requireStem: boolean
  /** 本句译文切好的片段 */
  hint?: string[]
  /** 最多给几种切法 */
  limit?: number
}

/**
 * 代价表：数字越小越优先。每块的基础代价都在 1 上下（词典那边给），这里只做小幅加减，
 * 而且每块加减完不低于 floor——块数说了算，多切一块总要付出代价，证据够多时细切才赢得过整词
 */
const COST = {
  oneChar: 0.4,
  extraStem: 0.8,
  learnedForm: -0.3,
  learnedFormOften: -0.45,
  learnedKey: -0.1,
  bigram: -0.15,
  hint: -0.4,
  envFit: -0.1,
  envMiss: 0.5,
  floor: 0.4
}
const BEAM = 16
const MAX_PIECES = 8
/** 太长的词不做切分（只查整词），免得一句长串卡住 */
const MAX_LEN = 48

/** 学习用的键：语素 id、词条 id，都没有时退到 gloss 文字 */
export function pieceKeys(p: {
  morphemeId: Id | null
  lexemeId?: Id | null
  gloss: string
}): string[] {
  const out: string[] = []
  if (p.morphemeId) out.push(`M:${p.morphemeId}`)
  if (p.lexemeId) out.push(`L:${p.lexemeId}`)
  if (p.gloss) out.push(`G:${p.gloss}`)
  return out
}

interface State {
  cost: number
  pieces: Piece[]
  stems: number
  last: 'start' | 'pre' | 'suf' | 'stem' | 'whole'
  /** 每一块的学习键（算前后接续用） */
  keys: string[][]
  /** 已切出的几块的签名（去重用，随块增量拼） */
  sig: string
}

export interface Segmentation {
  cost: number
  pieces: Piece[]
  stems: number
  guess?: 'fold' | 'split'
}

export function segmentWord(
  src: SegmentSource,
  word: string,
  opts: SegmentOptions
): Segmentation[] {
  const cps = Array.from(word)
  const n = cps.length
  if (!n) return []
  const limit = opts.limit ?? 12
  // 附加符前面不切
  const cuttable = (i: number): boolean => i === 0 || i === n || !/\p{M}/u.test(cps[i])
  const pieceCache = new Map<number, Piece[]>()
  const piecesAt = (i: number, j: number): Piece[] => {
    const k = i * (n + 1) + j
    let hit = pieceCache.get(k)
    if (!hit) {
      hit = src.pieces(cps.slice(i, j).join(''), i === 0 && j === n)
      pieceCache.set(k, hit)
    }
    return hit
  }
  const learn = src.learn
  const learnedBonus = (p: Piece, keys: string[]): number => {
    let best = 0
    const byForm = learn.formKey.get(p.form)
    for (const k of keys) {
      const c = byForm?.get(k) ?? 0
      if (c >= 3) best = Math.min(best, COST.learnedFormOften)
      else if (c >= 1) best = Math.min(best, COST.learnedForm)
      else if (learn.keyCount.has(k)) best = Math.min(best, COST.learnedKey)
    }
    return best
  }
  const trusted = (p: Piece, keys: string[]): boolean =>
    !!p.chunk ||
    keys.some((k) => (learn.formKey.get(p.form)?.get(k) ?? 0) > 0 || learn.keyCount.has(k))
  const addsStems = (p: Piece): number =>
    p.chunk ? (p.chunkStems ?? 0) : p.role === 'stem' ? 1 : 0

  if (n > MAX_LEN) {
    return piecesAt(0, n)
      .map((p) => ({ cost: p.cost, pieces: [p], stems: p.role === 'stem' ? 1 : 0 }))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, limit)
  }

  const states: State[][] = Array.from({ length: n + 1 }, () => [])
  states[0].push({ cost: 0, pieces: [], stems: 0, last: 'start', keys: [], sig: '' })
  const follows = (prev: string[] | undefined, keys: string[]): boolean =>
    !!prev &&
    prev.some((a) => {
      const set = learn.next.get(a)
      return !!set && keys.some((b) => set.has(b))
    })
  /** 一块在某个位置上跟前面切了什么无关的那部分代价（单字母、学来的、译文、出现环境），按位置缓存 */
  const staticCache = new Map<
    number,
    { p: Piece; cost: number; keys: string[]; last: string[] }[]
  >()
  const scored = (
    i: number,
    j: number
  ): { p: Piece; cost: number; keys: string[]; last: string[] }[] => {
    const k = i * (n + 1) + j
    let hit = staticCache.get(k)
    if (hit) return hit
    const before = cps.slice(0, i).join('')
    const after = cps.slice(j).join('')
    hit = piecesAt(i, j).map((p) => {
      // 整块：前面接的看第一段，后面接的看最后一段
      const keys = p.chunk ? p.chunk[0].keys : pieceKeys(p)
      const last = p.chunk ? p.chunk[p.chunk.length - 1].keys : keys
      let cost = p.cost
      if (Array.from(p.form).length === 1 && p.role !== 'whole') cost += COST.oneChar
      if (!p.chunk) cost += learnedBonus(p, keys)
      if (opts.hint?.length && p.lexeme && piecesOverlap(src.defPieces(p.lexeme), opts.hint))
        cost += COST.hint
      if (p.role === 'pre' || p.role === 'suf') {
        const fit = src.envFit(p, before, after)
        if (fit > 0) cost += COST.envFit
        else if (fit < 0) cost += COST.envMiss
      }
      return { p, cost, keys, last }
    })
    staticCache.set(k, hit)
    return hit
  }

  for (let i = 0; i < n; i++) {
    if (!cuttable(i)) continue
    const here = prune(states[i])
    states[i] = here
    for (const st of here) {
      if (st.pieces.length >= MAX_PIECES || st.last === 'whole') continue
      for (let j = i + 1; j <= n; j++) {
        if (!cuttable(j)) continue
        for (const { p, cost: base, keys, last: lastKeys } of scored(i, j)) {
          if (p.role === 'whole' && !(i === 0 && j === n)) continue
          if (p.role === 'suf' && st.last !== 'stem' && st.last !== 'suf') {
            // 只有词缀的段：后缀链可以打头
            if (opts.requireStem || st.last !== 'start') continue
          }
          // 只有词缀的段不能先后缀再前缀
          if (p.role === 'pre' && st.last === 'suf' && st.stems === 0) continue
          let cost = base
          if (addsStems(p) > 0 && st.stems >= 1) cost += COST.extraStem
          if (follows(st.keys[st.keys.length - 1], keys)) cost += COST.bigram
          // 攒多了先剪一次，免得排序的表太长
          if (states[j].length > BEAM * 4) states[j] = prune(states[j])
          states[j].push({
            cost: st.cost + Math.max(COST.floor, cost),
            pieces: [...st.pieces, p],
            stems: st.stems + addsStems(p),
            last: p.role,
            keys: [...st.keys, lastKeys],
            sig: `${st.sig}|${p.form}/${p.morphemeId ?? ''}/${p.lexemeId ?? ''}/${p.slot ?? ''}/${p.chunk ? 'c' : ''}`
          })
        }
      }
    }
  }

  function prune(list: State[]): State[] {
    const seen = new Set<string>()
    return [...list]
      .sort((a, b) => a.cost - b.cost || a.pieces.length - b.pieces.length)
      .filter((s) => {
        if (seen.has(s.sig)) return false
        seen.add(s.sig)
        return true
      })
      .slice(0, BEAM)
  }

  const done = prune(states[n]).filter((s) => {
    if (s.last === 'whole') return true
    if (opts.requireStem) return s.stems > 0 && (s.last === 'stem' || s.last === 'suf')
    // 只有词缀的段：结尾不限，但得真有东西
    return s.pieces.length > 0
  })
  return done.slice(0, limit).map((s) => {
    const out: Segmentation = { cost: s.cost, pieces: s.pieces, stems: s.stems }
    if (s.pieces.some((p) => p.fold)) out.guess = 'fold'
    else if (s.pieces.length > 1) {
      // 几个词干：每个词干都得跟前一块连着确认过（学到过接续，或者整块学来的），单个词各自认识不算
      let seenStem = false
      const compoundLearned = s.pieces.every((p, k) => {
        const stems = addsStems(p)
        if (!stems) return true
        if (p.chunk && stems >= 2) return true
        const ok = !seenStem || follows(s.keys[k - 1], p.chunk ? p.chunk[0].keys : pieceKeys(p))
        seenStem = true
        return ok
      })
      const oneChar = s.pieces.some(
        (p, k) => Array.from(p.form).length === 1 && !trusted(p, s.keys[k])
      )
      if ((s.stems >= 2 && !compoundLearned) || oneChar) out.guess = 'split'
    }
    return out
  })
}

/** 切法 → 分析：整词对应的词条取最长的那个词干，只有一个词干时带上它的槽位 */
export function toAnalysis(seg: Segmentation): Analysis {
  let main: Id | null = null
  let mainLen = 0
  let slot: string | null = null
  const consider = (id: Id | null | undefined, form: string, s: string | null): void => {
    if (!id) return
    const len = Array.from(form).length
    if (len > mainLen) {
      main = id
      mainLen = len
      slot = s
    }
  }
  const morphs: Analysis['morphs'] = []
  for (const p of seg.pieces) {
    if (p.chunk) {
      for (const m of p.chunk) {
        consider(m.ref ?? m.lexemeId, m.form, null)
        morphs.push(
          m.lexemeId
            ? { form: m.form, gloss: m.gloss, morphemeId: m.morphemeId, lexemeId: m.lexemeId }
            : { form: m.form, gloss: m.gloss, morphemeId: m.morphemeId }
        )
      }
      continue
    }
    consider(p.lexemeId, p.form, p.slot)
    morphs.push({ form: p.form, gloss: p.gloss, morphemeId: p.morphemeId })
  }
  const a: Analysis = { lexemeId: main, slot: seg.stems <= 1 ? slot : null, morphs }
  if (seg.guess) a.guess = seg.guess
  return a
}
