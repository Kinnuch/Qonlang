/**
 * 音系引擎：音段切分、音节划分、重音、配列检查、随机造词。
 * 全部由语言自己的数据驱动（音位表、音类、模板、配列表），不预设任何语言。
 */
import type { Language, Phoneme, Phonotactics, StressPosition } from '$lib/core/model'
import type { ParseOptions } from '../sca/parse'
import { inferFeatures } from '$lib/ipa/features'

/** 音位的特征；没填过的按 IPA 表推断 */
export function phonemeFeatures(p: Phoneme): Record<string, string> {
  return Object.keys(p.features).length ? p.features : inferFeatures(p.symbol)
}

/** 分析时跳过的超音段符号：重音、音节点、五度声调字母 */
export const SUPRASEGMENTAL_IGNORE = new Set([
  'ˈ',
  'ˌ',
  '.',
  '˥',
  '˦',
  '˧',
  '˨',
  '˩',
  '↗',
  '↘',
  '|',
  '‖'
])

// ───────────────────────── 音段切分 ─────────────────────────

/** 按音位表最长匹配切分；表里没有的字符各自成段。组合附标附着在前一段上。 */
export function segment(text: string, inventory: string[]): string[] {
  const chars = Array.from(text)
  const maxLen = Math.max(1, ...inventory.map((s) => Array.from(s).length))
  const inv = new Set(inventory)
  const out: string[] = []
  let i = 0
  while (i < chars.length) {
    let matched = false
    for (let len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
      const piece = chars.slice(i, i + len).join('')
      if (inv.has(piece)) {
        out.push(piece)
        i += len
        matched = true
        break
      }
    }
    if (!matched) {
      const c = chars[i]
      if (out.length && /\p{M}/u.test(c)) out[out.length - 1] += c
      else out.push(c)
      i++
    }
  }
  return out
}

// ───────────────────────── 音节划分 ─────────────────────────

export interface SyllableOptions {
  /** 可作音节核的音段（元音音类成员，或带 syllabic 特征的音位） */
  nuclei: Set<string>
  /** 允许的起首 / 尾音（空集合表示不限制） */
  onsets?: Set<string>
  codas?: Set<string>
  /** 模板法的最大起首 / 尾音长度 */
  maxOnset?: number
  maxCoda?: number
  /** 忽略的音段（如重音、长音、声调符号），保留在前一音段后 */
  ignore?: Set<string>
}

export interface Syllable {
  onset: string[]
  nucleus: string[]
  coda: string[]
}

/** 解析 (C)(C)V(C) 一类模板：返回最大起首与尾音长度 */
export function parseTemplate(template: string): { maxOnset: number; maxCoda: number } {
  const t = template.replace(/\s+/g, '')
  const vIdx = t.search(/V|N|\{[^}]*\}/)
  if (vIdx < 0) return { maxOnset: 2, maxCoda: 1 }
  const count = (s: string): number => (s.match(/\(?[A-Z]\)?|\(?\{[^}]*\}\)?/g) ?? []).length
  const after = t.slice(vIdx).replace(/^(\(?[A-Z]\)?|\(?\{[^}]*\}\)?)/, '')
  return { maxOnset: count(t.slice(0, vIdx)), maxCoda: count(after) }
}

/**
 * 最大起首原则：每个核之前尽可能多地把辅音划给起首，受 onsets 表（若给）和 maxOnset 限制，
 * 其余留给上一个音节的尾音。
 */
export function syllabify(segments: string[], opts: SyllableOptions): Syllable[] {
  const isN = (s: string): boolean => opts.nuclei.has(s) || opts.nuclei.has(stripMarks(s))
  const segs = segments.filter((s) => !opts.ignore?.has(s))
  const nucleusIdx: number[] = []
  segs.forEach((s, i) => {
    if (isN(s)) nucleusIdx.push(i)
  })
  if (!nucleusIdx.length) return [{ onset: segs, nucleus: [], coda: [] }]
  // 相邻核合并为双元音（连续的核视作一个核）
  const groups: [number, number][] = []
  for (const i of nucleusIdx) {
    const last = groups[groups.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else groups.push([i, i])
  }
  const sylls: Syllable[] = []
  let prevEnd = -1
  groups.forEach(([start, end], gi) => {
    const cluster = segs.slice(prevEnd + 1, start)
    let onsetLen = cluster.length
    const maxOnset = opts.maxOnset ?? Infinity
    if (gi === 0) onsetLen = cluster.length
    else {
      onsetLen = Math.min(cluster.length, maxOnset)
      // 受允许起首表限制：从最长往下找一个合法的
      if (opts.onsets && opts.onsets.size) {
        while (onsetLen > 0 && !opts.onsets.has(cluster.slice(cluster.length - onsetLen).join('')))
          onsetLen--
      }
      // 尾音上限
      const maxCoda = opts.maxCoda ?? Infinity
      if (cluster.length - onsetLen > maxCoda) onsetLen = Math.max(0, cluster.length - maxCoda)
    }
    const onset = cluster.slice(cluster.length - onsetLen)
    const coda = cluster.slice(0, cluster.length - onsetLen)
    if (sylls.length) sylls[sylls.length - 1].coda = coda
    sylls.push({ onset, nucleus: segs.slice(start, end + 1), coda: [] })
    prevEnd = end
  })
  sylls[sylls.length - 1].coda = segs.slice(prevEnd + 1)
  return sylls
}

function stripMarks(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

export function syllableText(s: Syllable): string {
  return [...s.onset, ...s.nucleus, ...s.coda].join('')
}

// ───────────────────────── 重音 ─────────────────────────

/** 音节是否为重音节（有尾音或长元音 / 双元音） */
export function isHeavy(s: Syllable): boolean {
  return s.coda.length > 0 || s.nucleus.length > 1 || s.nucleus.some((n) => /ː/.test(n))
}

/** 返回主重音所在音节的下标；manual 或无音节返回 -1 */
export function stressIndex(sylls: Syllable[], position: StressPosition): number {
  const n = sylls.length
  if (n === 0 || position === 'manual') return -1
  switch (position) {
    case 'initial':
      return 0
    case 'second':
      return Math.min(1, n - 1)
    case 'final':
      return n - 1
    case 'penult':
      return Math.max(0, n - 2)
    case 'antepenult':
      return Math.max(0, n - 3)
    case 'weight':
      if (n === 1) return 0
      return isHeavy(sylls[n - 2]) ? n - 2 : Math.max(0, n - 3)
  }
}

/** 把音节拼回带音节点和重音符的 IPA */
export function renderSyllables(sylls: Syllable[], stressAt = -1): string {
  return sylls.map((s, i) => (i === stressAt ? 'ˈ' : '') + syllableText(s)).join('.')
}

// ───────────────────────── 配列检查 ─────────────────────────

export interface Violation {
  kind: 'illegal' | 'onset' | 'coda' | 'nucleus' | 'syllables'
  detail: string
}

export function checkWord(segments: string[], sylls: Syllable[], pt: Phonotactics): Violation[] {
  const out: Violation[] = []
  const joined = segments.join('')
  for (const ill of pt.illegal)
    if (ill && joined.includes(ill)) out.push({ kind: 'illegal', detail: ill })
  if (pt.onsets.length)
    for (const s of sylls)
      if (s.onset.length && !pt.onsets.includes(s.onset.join('')))
        out.push({ kind: 'onset', detail: s.onset.join('') })
  if (pt.codas.length)
    for (const s of sylls)
      if (s.coda.length && !pt.codas.includes(s.coda.join('')))
        out.push({ kind: 'coda', detail: s.coda.join('') })
  if (pt.nuclei.length)
    for (const s of sylls)
      if (s.nucleus.length && !pt.nuclei.includes(s.nucleus.join('')))
        out.push({ kind: 'nucleus', detail: s.nucleus.join('') })
  if (sylls.length && sylls[0].nucleus.length === 0) out.push({ kind: 'nucleus', detail: '∅' })
  if (pt.minSyllables && sylls.length < pt.minSyllables)
    out.push({ kind: 'syllables', detail: String(sylls.length) })
  if (pt.maxSyllables && sylls.length > pt.maxSyllables)
    out.push({ kind: 'syllables', detail: String(sylls.length) })
  return out
}

// ───────────────────────── 随机造词 ─────────────────────────

export interface GenerateOptions {
  count: number
  minSyllables?: number
  maxSyllables?: number
  /** 起首 / 尾音出现概率（0–1） */
  onsetProb?: number
  codaProb?: number
  exclude?: Set<string>
  seed?: number
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

function weightedPick(
  items: string[],
  weights: Record<string, number>,
  rand: () => number
): string {
  const ws = items.map((i) => Math.max(0, weights[i] ?? 1))
  const total = ws.reduce((a, b) => a + b, 0)
  if (total <= 0) return items[Math.floor(rand() * items.length)]
  let r = rand() * total
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

export function generateWords(pt: Phonotactics, opts: GenerateOptions): string[] {
  const rand = rng(opts.seed ?? Date.now())
  const out: string[] = []
  const seen = new Set(opts.exclude ?? [])
  const min = opts.minSyllables ?? pt.minSyllables ?? 1
  const max = Math.max(min, opts.maxSyllables ?? pt.maxSyllables ?? 3)
  const onsetProb = opts.onsetProb ?? 0.85
  const codaProb = opts.codaProb ?? 0.35
  if (!pt.nuclei.length) return out
  let guard = 0
  while (out.length < opts.count && guard++ < opts.count * 50) {
    const n = min + Math.floor(rand() * (max - min + 1))
    let w = ''
    for (let i = 0; i < n; i++) {
      if (pt.onsets.length && (i === 0 ? rand() < onsetProb : rand() < onsetProb))
        w += weightedPick(pt.onsets, pt.weights, rand)
      w += weightedPick(pt.nuclei, pt.weights, rand)
      if (pt.codas.length && rand() < codaProb) w += weightedPick(pt.codas, pt.weights, rand)
    }
    if (!w || seen.has(w)) continue
    if (pt.illegal.some((ill) => ill && w.includes(ill))) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

// ───────────────────────── 与规则语言衔接 ─────────────────────────

/** 一门语言的音类与多合字母，作为规则解析的基础选项 */
export function languageParseOptions(lang: Language | null | undefined): ParseOptions {
  if (!lang) return {}
  const classes: Record<string, string[]> = {}
  for (const c of lang.classes) if (c.name && c.members.length) classes[c.name] = c.members
  return {
    classes,
    replacements: lang.digraphs
      .filter((d) => d.from && d.to)
      .map((d) => [d.from, d.to] as [string, string])
  }
}

/** 音位表里可作音节核的音段：syllabic 特征为 yes，或属于名为 V / Vowel / 元音 的音类 */
export function nucleusSet(lang: Language): Set<string> {
  const s = new Set<string>()
  for (const p of lang.phonemes) {
    const f = phonemeFeatures(p)
    if (f.syllabic === 'yes' || f.type === 'vowel') s.add(p.symbol)
  }
  for (const c of lang.classes)
    if (/^(V|Vowel|Vowels|元音|N|Nucleus)$/i.test(c.name)) for (const m of c.members) s.add(m)
  for (const n of lang.phonotactics.nuclei) s.add(n)
  return s
}

/** 用语言设置给一个 IPA 串划音节并标重音 */
export function analyzeWord(
  lang: Language,
  ipa: string
): { segments: string[]; syllables: Syllable[]; stress: number; text: string } {
  const inventory = lang.phonemes.map((p) => p.symbol)
  const segments = segment(ipa, inventory).filter((s) => !SUPRASEGMENTAL_IGNORE.has(s))
  const tpl =
    lang.syllable.strategy === 'template' && lang.syllable.template
      ? parseTemplate(lang.syllable.template)
      : { maxOnset: Infinity, maxCoda: Infinity }
  const syllables = lang.syllable.enabled
    ? syllabify(segments, {
        nuclei: nucleusSet(lang),
        onsets: lang.phonotactics.onsets.length ? new Set(lang.phonotactics.onsets) : undefined,
        maxOnset: tpl.maxOnset,
        maxCoda: tpl.maxCoda,
        ignore: SUPRASEGMENTAL_IGNORE
      })
    : [{ onset: [], nucleus: segments, coda: [] }]
  const stress =
    lang.prosody.type === 'stress' || lang.prosody.type === 'pitch'
      ? stressIndex(syllables, lang.prosody.stressPosition)
      : -1
  return {
    segments,
    syllables,
    stress,
    text: lang.syllable.enabled ? renderSyllables(syllables, stress) : ipa
  }
}
