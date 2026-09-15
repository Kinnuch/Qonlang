/**
 * 规则里的音节：σ（音节边界）与重音规则都要先把词切成音节。
 * 切音段、认音节核用语言的音系设置（ParseOptions.syllables）加上规则文本里的音类：先看音节核与名为 V 的音类，
 * 再看确定是辅音的音，都没有的按 IPA 表推断——拼写里的 a、é 这类也认得出元音，th 这类多合字母换成内部符号后是一个音。
 */
import { inferFeatures } from '$lib/ipa/features'
import { stripMarks, syllableSpans, tokenizeWord } from '../phon'
import {
  BOUNDARY,
  type ClauseMatcher,
  type RuleProgram,
  type StressClause,
  type StressLine
} from './parse'

interface Syllabifier {
  units: Set<string>
  isNucleus: (s: string) => boolean
  onsets: Set<string> | undefined
  maxOnset: number
  maxCoda: number
}

const cache = new WeakMap<RuleProgram, Syllabifier>()

function syllabifierOf(program: RuleProgram): Syllabifier {
  const hit = cache.get(program)
  if (hit) return hit
  const sc = program.syllables
  const nuclei = new Set(sc.nuclei)
  const consonants = new Set(sc.consonants)
  const known = new Map<string, boolean>()
  const isNucleus = (s: string): boolean => {
    let v = known.get(s)
    if (v === undefined) {
      const bare = stripMarks(s)
      if (nuclei.has(s) || nuclei.has(bare)) v = true
      else if (consonants.has(s) || consonants.has(bare)) v = false
      else {
        // 表里没有的多字母单位（aa、ai）逐个字母看，全是元音才算
        const letters = Array.from(bare).filter((ch) => !/\p{Lm}/u.test(ch))
        v =
          letters.length > 0 &&
          letters.every((ch) => {
            const f = inferFeatures(ch)
            return f.type === 'vowel' || f.syllabic === 'yes'
          })
      }
      known.set(s, v)
    }
    return v
  }
  const sy: Syllabifier = {
    units: new Set(sc.units),
    isNucleus,
    onsets: sc.onsets.length ? new Set(sc.onsets) : undefined,
    maxOnset: sc.maxOnset ?? Infinity,
    maxCoda: sc.maxCoda ?? Infinity
  }
  cache.set(program, sy)
  return sy
}

/** 一个音节在注解串里的位置 */
export interface AnnotatedSyllable {
  /** 第一个音开始的地方（重音记号标在这儿前面） */
  start: number
  nucleusStart: number
  nucleusEnd: number
}

export interface Annotated {
  /** 词里各音节之间、分隔符两边插了音节边界的串 */
  text: string
  /** 注解串里的位置 → 原词里的位置 */
  source: (at: number) => number
  /** 空白隔开的各个词：每个词按分隔符分成几块，块后面跟着哪个分隔符（最后一块是空串） */
  words: { chunks: { syllables: AnnotatedSyllable[]; sep: string }[] }[]
}

/** 不插音节边界、原样对应的注解（规则里没用 σ 时） */
export function plainAnnotated(word: string): Annotated {
  return { text: word, source: (at) => at, words: [] }
}

/**
 * 给词划音节：音节之间插入 BOUNDARY（放在前一个音节最后一个音的后面，
 * 下一个音节前面的重音记号跟着下一个音节），分隔符、空白两边也插。
 */
export function annotate(word: string, program: RuleProgram): Annotated {
  const sy = syllabifierOf(program)
  const tokens = tokenizeWord(word, sy.units)
  const boundaryBefore = new Set<number>()
  interface TokSyllable {
    first: number
    nucleusFirst: number
    nucleusLast: number
  }
  const words: { chunks: { syllables: TokSyllable[]; sep: string }[] }[] = [{ chunks: [] }]
  let segTokens: number[] = []
  const flush = (sep: string): void => {
    const segs = segTokens.map((t) => tokens[t].text)
    const syllables: TokSyllable[] = []
    if (segs.length) {
      const spans = syllableSpans(segs, sy.isNucleus, sy)
      spans.forEach((sp, k) => {
        if (k > 0) boundaryBefore.add(segTokens[sp.start - 1] + 1)
        const empty = sp.nucleusStart >= sp.nucleusEnd
        syllables.push({
          first: segTokens[Math.min(sp.start, segs.length - 1)],
          nucleusFirst: empty ? -1 : segTokens[sp.nucleusStart],
          nucleusLast: empty ? -1 : segTokens[sp.nucleusEnd - 1]
        })
      })
    }
    words[words.length - 1].chunks.push({ syllables, sep })
    segTokens = []
  }
  tokens.forEach((tk, i) => {
    if (tk.kind === 'seg') segTokens.push(i)
    else if (tk.kind === 'sep' || tk.kind === 'space') {
      flush(tk.kind === 'sep' ? tk.text : '')
      if (tk.kind === 'space') words.push({ chunks: [] })
      if (i > 0) boundaryBefore.add(i)
      if (i + 1 < tokens.length) boundaryBefore.add(i + 1)
    }
  })
  flush('')

  let text = ''
  const starts: number[] = []
  const sourceAt: number[] = []
  let src = 0
  tokens.forEach((tk, i) => {
    if (boundaryBefore.has(i)) {
      sourceAt.push(src)
      text += BOUNDARY
    }
    starts.push(text.length)
    for (let k = 0; k < tk.text.length; k++) sourceAt.push(src + k)
    text += tk.text
    src += tk.text.length
  })
  sourceAt.push(src)
  const endOf = (t: number): number => starts[t] + tokens[t].text.length
  return {
    text,
    source: (at) => sourceAt[Math.max(0, Math.min(sourceAt.length - 1, at))],
    words: words
      .map((w) => ({
        chunks: w.chunks.map((c) => ({
          sep: c.sep,
          syllables: c.syllables.map((s) => ({
            start: starts[s.first],
            nucleusStart: s.nucleusFirst < 0 ? endOf(s.first) : starts[s.nucleusFirst],
            nucleusEnd: s.nucleusLast < 0 ? endOf(s.first) : endOf(s.nucleusLast)
          }))
        }))
      }))
      .filter((w) => w.chunks.some((c) => c.syllables.length))
  }
}

/** 这个音节合不合这一条：音节核里有目标，左环境在核前、右环境在核后，又不在排除里 */
function clauseHolds(c: StressClause, text: string, s: AnnotatedSyllable): boolean {
  const sticky = (re: RegExp, at: number): boolean => {
    re.lastIndex = at
    return re.test(text)
  }
  const holds = (m: ClauseMatcher, withTarget: boolean): boolean => {
    if (withTarget && m.target && !m.target.test(text.slice(s.nucleusStart, s.nucleusEnd)))
      return false
    if (m.left && !sticky(m.left, s.nucleusStart)) return false
    if (m.right && !sticky(m.right, s.nucleusEnd)) return false
    return true
  }
  return holds(c.match, true) && !(c.except && holds(c.except, false))
}

/** 按重音规则挑一个音节：从前往后试每一条，第一条对上的算；都不合返回 -1 */
function chooseSyllable(clauses: StressClause[], text: string, sylls: AnnotatedSyllable[]): number {
  const n = sylls.length
  // 一个元音都没有的词（ng、hm）不标重音
  if (!n || sylls.every((s) => s.nucleusStart >= s.nucleusEnd)) return -1
  for (const c of clauses) {
    if (c.count !== null && (c.orMore ? n < c.count : n !== c.count)) continue
    const ok = (i: number): boolean => clauseHolds(c, text, sylls[i])
    if (c.position === 'first') {
      for (let i = 0; i < n; i++) if (ok(i)) return i
      continue
    }
    if (c.position === 'last') {
      for (let i = n - 1; i >= 0; i--) if (ok(i)) return i
      continue
    }
    let i = c.position > 0 ? c.position - 1 : n + c.position
    // 没有这个音节：有条件的这一条不算；没条件的落到最近的一头（单音节词的「倒数第三」就是它自己）
    if (i < 0 || i >= n) {
      if (c.match.target || c.match.left || c.match.right || c.except) continue
      i = Math.max(0, Math.min(n - 1, i))
    }
    if (ok(i)) return i
  }
  return -1
}

/**
 * 重音规则：先去掉词里原有的重音记号（次重音规则只去次重音），再按各条挑音节标上。
 * 规则写了分段符号时每段各算一个，主重音落在指定的那段，其余段是次重音。
 */
export function assignStress(step: StressLine, word: string, program: RuleProgram): string {
  const clean = step.level === 'primary' ? word.replace(/[ˈˌ]/g, '') : word.replace(/ˌ/g, '')
  if (!step.clauses.length) return clean
  const ann = annotate(clean, program)
  const inserts: [number, string][] = []
  for (const w of ann.words) {
    const parts: AnnotatedSyllable[][] = [[]]
    w.chunks.forEach((ch, i) => {
      parts[parts.length - 1].push(...ch.syllables)
      if (i < w.chunks.length - 1 && ch.sep && step.split.includes(ch.sep)) parts.push([])
    })
    const chosen = parts.map((p) => chooseSyllable(step.clauses, ann.text, p))
    const at = (pi: number): number => ann.source(parts[pi][chosen[pi]].start)
    if (step.level === 'secondary') {
      chosen.forEach((k, pi) => {
        if (k >= 0 && clean[at(pi) - 1] !== 'ˈ') inserts.push([at(pi), 'ˌ'])
      })
      continue
    }
    const n = parts.length
    let head = Math.max(0, Math.min(n - 1, step.head > 0 ? step.head - 1 : n + step.head))
    if (chosen[head] < 0) {
      const withStress = chosen.map((k, i) => (k >= 0 ? i : -1)).filter((i) => i >= 0)
      if (withStress.length)
        head = step.head > 0 ? withStress[0] : withStress[withStress.length - 1]
    }
    chosen.forEach((k, pi) => {
      if (k >= 0) inserts.push([at(pi), pi === head ? 'ˈ' : 'ˌ'])
    })
  }
  inserts.sort((a, b) => b[0] - a[0])
  let out = clean
  for (const [pos, mark] of inserts) out = out.slice(0, pos) + mark + out.slice(pos)
  return out
}
