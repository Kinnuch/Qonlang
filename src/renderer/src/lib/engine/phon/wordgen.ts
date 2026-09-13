/**
 * 造词：先照着词库里这门语言已有的词，学它「长什么样」，再按配列设置造新词。
 *
 * - 配列（起首、核、尾音、禁止的组合、音节数）是硬规定：造出来的词只用允许的成分；
 * - 词库决定「常见」：词首和词中的起首、词中和词尾的尾音各自多常见，几个音节的词多，
 *   音段三个一组怎么搭配（给候选打分，越像这门语言分越高）；
 * - 先按学到的频率撒一大把候选，按分数排好，再挑出彼此不太像、也不跟已有词只差一个音的一批。
 * 词库里这门语言的词少于 MIN_LEXICON 个时，只按配列设置和权重造，另外避开生硬的重复和太长的辅音丛。
 */
import type { Language } from '$lib/core/model'
import {
  SUPRASEGMENTAL_IGNORE,
  checkWord,
  nucleusSet,
  segment,
  syllabify,
  type Syllable
} from './index'

/** 词库里至少有这么多词才照着学 */
export const MIN_LEXICON = 8

export interface LexiconWord {
  /** 读音（能按音位表切开的 IPA） */
  ipa: string
  /** 给人看的写法（词头） */
  label: string
}

export interface WordGenOptions {
  count: number
  minSyllables: number
  maxSyllables: number
  /** 这门语言已有的词：够多时照着学，也用来避开撞车；不想参考就给空数组 */
  lexicon: LexiconWord[]
  /** 不要造出来的（已有词的写法、读音） */
  exclude?: ReadonlySet<string>
  seed?: number
}

export interface GeneratedWord {
  ipa: string
  /** 平均每个音段的对数概率（以 2 为底，越接近 0 越像这门语言）；只用来排序 */
  score: number
  /** 词库里最像它的几个词（照着词库学的时候才有） */
  like: string[]
}

type Probs = Map<string, number>

interface Parsed {
  segs: string[]
  sylls: Syllable[]
}

interface Candidate extends Parsed {
  ipa: string
  score: number
  /** 排序用的分：score 加一点随机 */
  rank: number
  /** 跟已经挑中的词只差一个音的有几个 */
  near: number
  /** 跟词库里哪个词只差一个音 */
  lexNear: boolean
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1_000_000) / 1_000_000
  }
}

function inc<K>(m: Map<K, number>, k: K, by = 1): void {
  m.set(k, (m.get(k) ?? 0) + by)
}

function draw(probs: Probs, rand: () => number): string {
  let r = rand()
  let last = ''
  for (const [k, p] of probs) {
    last = k
    r -= p
    if (r <= 0) return k
  }
  return last
}

/**
 * 成分的先验：按配列里的权重分；empty 是「没有这一段」（没有起首 / 尾音）占的份额，
 * 核不能空时传 null。
 */
function priorOf(items: string[], weights: Record<string, number>, empty: number | null): Probs {
  const out: Probs = new Map()
  const ws = items.map((i) => Math.max(0, weights[i] ?? 1))
  const sum = ws.reduce((a, b) => a + b, 0)
  if (empty !== null) out.set('', items.length && sum > 0 ? empty : 1)
  const share = empty === null ? 1 : 1 - empty
  if (sum > 0) items.forEach((it, i) => out.set(it, (out.get(it) ?? 0) + (share * ws[i]) / sum))
  return out
}

/** 词库里数出来的次数和先验混在一起（先验占 alpha 个词的分量）；配列不允许的成分不要 */
function blend(counts: Map<string, number>, prior: Probs, alpha: number): Probs {
  let total = 0
  for (const [k, c] of counts) if (prior.has(k)) total += c
  const out: Probs = new Map()
  for (const [k, p] of prior) out.set(k, ((counts.get(k) ?? 0) + alpha * p) / (total + alpha))
  return out
}

const sylText = (s: Syllable): string => [...s.onset, ...s.nucleus, ...s.coda].join('')

/** 两串音段差几处（增、删、换各算一处） */
function distance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** 两串音段是不是最多差一处（比算完整的差几处快得多，挑候选时要跟整本词库比） */
function withinOne(a: string[], b: string[]): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** 音段三个一组的搭配：给候选打分，看它像不像词库里的词 */
class Trigram {
  private c3 = new Map<string, number>()
  private c2 = new Map<string, number>()
  private c1 = new Map<string, number>()
  private h2 = new Map<string, number>()
  private h1 = new Map<string, number>()
  private n = 0
  private vocab: number

  constructor(vocab: number) {
    this.vocab = Math.max(2, vocab)
  }

  add(segs: string[]): void {
    const s = ['^', '^', ...segs, '$']
    for (let i = 2; i < s.length; i++) {
      inc(this.c3, `${s[i - 2]} ${s[i - 1]} ${s[i]}`)
      inc(this.h2, `${s[i - 2]} ${s[i - 1]}`)
      inc(this.c2, `${s[i - 1]} ${s[i]}`)
      inc(this.h1, s[i - 1])
      inc(this.c1, s[i])
      this.n++
    }
  }

  /** 整个词（连词尾）的对数概率，以 2 为底；没见过的搭配往短的退，最后退到均匀分布 */
  logp(segs: string[]): number {
    const s = ['^', '^', ...segs, '$']
    let sum = 0
    for (let i = 2; i < s.length; i++) {
      const h2 = this.h2.get(`${s[i - 2]} ${s[i - 1]}`) ?? 0
      const h1 = this.h1.get(s[i - 1]) ?? 0
      let p = 0
      let w = 0
      if (h2) {
        p += (0.55 * (this.c3.get(`${s[i - 2]} ${s[i - 1]} ${s[i]}`) ?? 0)) / h2
        w += 0.55
      }
      if (h1) {
        p += (0.3 * (this.c2.get(`${s[i - 1]} ${s[i]}`) ?? 0)) / h1
        w += 0.3
      }
      if (this.n) {
        p += (0.12 * (this.c1.get(s[i]) ?? 0)) / this.n
        w += 0.12
      }
      p += 0.03 / this.vocab
      w += 0.03
      sum += Math.log2(p / w)
    }
    return sum
  }
}

export function generateNaturalWords(lang: Language, opts: WordGenOptions): GeneratedWord[] {
  const pt = lang.phonotactics
  const rand = rng(opts.seed ?? Date.now())
  const inventory = lang.phonemes.map((p) => p.symbol)
  const nuclei = nucleusSet(lang)
  const onsetSet = pt.onsets.length ? new Set(pt.onsets) : undefined
  const min = Math.max(1, Math.floor(opts.minSyllables) || 1)
  const max = Math.max(min, Math.floor(opts.maxSyllables) || min)
  const want = Math.max(1, Math.floor(opts.count) || 1)
  const split = (x: string): string[] => (x ? segment(x, inventory) : [])

  // ── 词库：切音段、划音节 ──
  const parsed: { label: string; p: Parsed }[] = []
  for (const w of opts.lexicon) {
    const segs = segment(w.ipa.normalize('NFC'), inventory).filter(
      (s) => !SUPRASEGMENTAL_IGNORE.has(s) && /[\p{L}\p{M}]/u.test(s)
    )
    if (!segs.length) continue
    const sylls = syllabify(segs, { nuclei, onsets: onsetSet, ignore: SUPRASEGMENTAL_IGNORE })
    if (sylls.length && sylls[0].nucleus.length) parsed.push({ label: w.label, p: { segs, sylls } })
  }
  const learn = parsed.length >= MIN_LEXICON

  // ── 各位置能用的成分：配列里写了就只用写了的；没写时学的话用词库里见过的 ──
  const seen = { onset: new Set<string>(), nucleus: new Set<string>(), coda: new Set<string>() }
  const counts = {
    first: new Map<string, number>(),
    rest: new Map<string, number>(),
    nucleus: new Map<string, number>(),
    inner: new Map<string, number>(),
    last: new Map<string, number>(),
    len: new Map<string, number>()
  }
  let redup = 0
  for (const { p } of parsed) {
    const n = p.sylls.length
    inc(counts.len, String(n))
    p.sylls.forEach((s, i) => {
      const on = s.onset.join('')
      const nu = s.nucleus.join('')
      const co = s.coda.join('')
      if (on) seen.onset.add(on)
      if (nu) seen.nucleus.add(nu)
      if (co) seen.coda.add(co)
      inc(i === 0 ? counts.first : counts.rest, on)
      inc(counts.nucleus, nu)
      inc(i === n - 1 ? counts.last : counts.inner, co)
    })
    if (p.sylls.some((s, i) => i > 0 && sylText(s) === sylText(p.sylls[i - 1]))) redup++
  }
  const items = (list: string[], learned: Set<string>): string[] => {
    const own = list.filter(Boolean)
    return own.length ? own : learn ? [...learned] : []
  }
  const onsetItems = items(pt.onsets, seen.onset)
  const nucleusItems = items(pt.nuclei, seen.nucleus)
  const codaItems = items(pt.codas, seen.coda)
  if (!nucleusItems.length) return []

  const weights = pt.weights ?? {}
  const onsetPrior = priorOf(onsetItems, weights, 0.15)
  const nucleusPrior = priorOf(nucleusItems, weights, null)
  const codaPrior = priorOf(codaItems, weights, 0.65)
  const ALPHA = 4
  const dist = (c: Map<string, number>, prior: Probs): Probs =>
    learn ? blend(c, prior, ALPHA) : prior
  const onsetFirst = dist(counts.first, onsetPrior)
  const onsetRest = dist(counts.rest, onsetPrior)
  const nucleusD = dist(counts.nucleus, nucleusPrior)
  const codaInner = dist(counts.inner, codaPrior)
  const codaLast = dist(counts.last, codaPrior)

  // 几个音节：没数据时略偏向两个音节
  const lenPrior: Probs = new Map()
  let lsum = 0
  for (let n = min; n <= max; n++) {
    const w = n === 2 ? 3 : n === 1 || n === 3 ? 2 : 1
    lenPrior.set(String(n), w)
    lsum += w
  }
  for (const [k, v] of lenPrior) lenPrior.set(k, v / lsum)
  const lenD = learn ? blend(counts.len, lenPrior, 2) : lenPrior

  let tri: Trigram | null = null
  if (learn) {
    tri = new Trigram(inventory.length + 1)
    for (const { p } of parsed) tri.add(p.segs)
  }
  const redupRate = parsed.length ? redup / parsed.length : 0

  const taken = new Set<string>(opts.exclude ?? [])
  for (const w of opts.lexicon) taken.add(w.ipa)
  for (const { p } of parsed) taken.add(p.segs.join(''))

  const scoreOf = (segs: string[], sylls: Syllable[]): number => {
    const lenP = Math.log2(lenD.get(String(sylls.length)) ?? 1e-6)
    let s: number
    if (tri) s = (tri.logp(segs) + lenP) / (segs.length + 1)
    else {
      // 没有词库可学：按成分的概率打分，再嫌弃长辅音丛
      let lp = lenP
      sylls.forEach((sy, i) => {
        lp += Math.log2((i === 0 ? onsetFirst : onsetRest).get(sy.onset.join('')) ?? 1e-6)
        lp += Math.log2(nucleusD.get(sy.nucleus.join('')) ?? 1e-6)
        lp += Math.log2(
          (i === sylls.length - 1 ? codaLast : codaInner).get(sy.coda.join('')) ?? 1e-6
        )
      })
      s = lp / (segs.length + 1)
      for (const sy of sylls)
        s -= Math.max(0, sy.onset.length - 1) * 0.4 + Math.max(0, sy.coda.length - 1) * 0.5
    }
    // 两个一样的音节挨着（tata）：词库里本来就常见才不嫌弃
    if (redupRate < 0.05 && sylls.some((sy, i) => i > 0 && sylText(sy) === sylText(sylls[i - 1])))
      s -= 1
    return s
  }

  // ── 撒候选 ──
  const cands = new Map<string, Candidate>()
  const tries = Math.min(8000, want * 40)
  for (let t = 0; t < tries; t++) {
    const n = Number(draw(lenD, rand))
    const sylls: Syllable[] = []
    for (let i = 0; i < n; i++)
      sylls.push({
        onset: split(draw(i === 0 ? onsetFirst : onsetRest, rand)),
        nucleus: split(draw(nucleusD, rand)),
        coda: split(draw(i === n - 1 ? codaLast : codaInner, rand))
      })
    const segs = sylls.flatMap((s) => [...s.onset, ...s.nucleus, ...s.coda])
    const ipa = segs.join('')
    if (!ipa || taken.has(ipa) || cands.has(ipa)) continue
    if (!sylls.every((s) => s.nucleus.length)) continue
    if (pt.illegal.some((ill) => ill && ipa.includes(ill))) continue
    // 同一个音段连着三次
    if (segs.some((s, i) => i >= 2 && s === segs[i - 1] && s === segs[i - 2])) continue
    // 拼起来重新划音节再查一遍配列（ka + a 会并成 kaa，核就不合规了）——跟「配列检查」同一套标准
    const again = syllabify(segs, { nuclei, onsets: onsetSet, ignore: SUPRASEGMENTAL_IGNORE })
    if (checkWord(segs, again, pt).length) continue
    const score = scoreOf(segs, sylls)
    // 一点点随机：每次点「造词」不至于总是同一批
    cands.set(ipa, {
      ipa,
      segs,
      sylls,
      score,
      rank: score + (rand() - 0.5) * 0.3,
      near: 0,
      lexNear: false
    })
  }

  // ── 挑：分高的在前；彼此不太像、开头的音节别扎堆 ──
  const lex = parsed.map((x) => ({ label: x.label, segs: x.p.segs }))
  const pool = [...cands.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, Math.max(want * 10, 200))
  if (learn)
    for (const c of pool)
      c.lexNear = c.segs.length >= 4 && lex.some((w) => withinOne(w.segs, c.segs))
  // 一个一个挑：只在「比剩下最好的差不到 BAND」的那几个里挑最不撞车的（跟已挑的、跟词库只差一个音，
  // 开头音节用过几次），分数一样再看分高。明显生硬的词只有像样的挑完了才会轮到。
  const BAND = 0.5
  const left = new Set(pool)
  const picked: Candidate[] = []
  const starts = new Map<string, number>()
  const clash = (c: Candidate): number =>
    c.near * 2 + (c.lexNear ? 1 : 0) + (starts.get(sylText(c.sylls[0])) ?? 0)
  while (picked.length < want && left.size) {
    let top = -Infinity
    for (const c of left) if (c.rank > top) top = c.rank
    let best: Candidate | null = null
    for (const c of left) {
      if (c.rank < top - BAND) continue
      if (!best || clash(c) < clash(best) || (clash(c) === clash(best) && c.rank > best.rank))
        best = c
    }
    if (!best) break
    left.delete(best)
    picked.push(best)
    inc(starts, sylText(best.sylls[0]))
    for (const c of left)
      if (Math.min(c.segs.length, best.segs.length) >= 3 && withinOne(c.segs, best.segs)) c.near++
  }

  const nearest = (segs: string[]): string[] =>
    lex
      .filter((w) => Math.abs(w.segs.length - segs.length) <= 2)
      .map((w) => ({ label: w.label, d: distance(w.segs, segs) }))
      .filter((x) => x.d <= Math.max(2, Math.ceil(segs.length / 2)))
      .sort((a, b) => a.d - b.d || a.label.localeCompare(b.label))
      .slice(0, 2)
      .map((x) => x.label)
  return picked.map((c) => ({ ipa: c.ipa, score: c.score, like: learn ? nearest(c.segs) : [] }))
}
