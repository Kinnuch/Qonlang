/**
 * 音系引擎：音段切分、音节划分、重音、配列检查、随机造词。
 * 全部由语言自己的数据驱动（音位表、音类、模板、配列表），不预设任何语言。
 */
import type { Language, Phoneme, Phonotactics, Project, StressPosition } from '$lib/core/model'
import type { ParseOptions, SyllableScheme } from '../sca/parse'
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

/** 重音记号：ˈ 主重音、ˌ 次重音 */
export const STRESS_MARKS = new Set(['ˈ', 'ˌ'])

/** 把一个词隔成几块的符号：音节不跨过它们（复合词的中点、连字符、连音符、韵律边界） */
export const WORD_SEPARATORS = new Set(['·', '‧', '-', '‿', '=', '|', '‖'])

/** 不算音、也不隔开音节的记号：音节点、声调字母、升降调箭头 */
const SKIPPED = new Set(['.', '˥', '˦', '˧', '˨', '˩', '↗', '↘'])

export interface WordToken {
  text: string
  /** seg 音段；mark 重音记号；sep 分隔符；space 空白；skip 不算音也不隔开的记号（音节点、标点、声调字母） */
  kind: 'seg' | 'mark' | 'sep' | 'space' | 'skip'
}

/**
 * 按单位表最长匹配切词：重音记号、分隔符、空白、标点各自成块；
 * 组合附标与 ː ʰ ʲ 这类修饰字母附着在前一个音段上（表里没有 aː 也认成一个音段）。
 */
export function tokenizeWord(text: string, units: ReadonlySet<string>): WordToken[] {
  let maxLen = 1
  for (const u of units) maxLen = Math.max(maxLen, Array.from(u).length)
  const chars = Array.from(text)
  const out: WordToken[] = []
  let i = 0
  while (i < chars.length) {
    const c = chars[i]
    const prev = out[out.length - 1]
    if (STRESS_MARKS.has(c)) out.push({ text: c, kind: 'mark' })
    else if (WORD_SEPARATORS.has(c)) out.push({ text: c, kind: 'sep' })
    else if (/\s/u.test(c)) out.push({ text: c, kind: 'space' })
    else if (SKIPPED.has(c) || /\p{P}/u.test(c)) out.push({ text: c, kind: 'skip' })
    else {
      let len = Math.min(maxLen, chars.length - i)
      for (; len > 1; len--) if (units.has(chars.slice(i, i + len).join(''))) break
      const piece = chars.slice(i, i + len).join('')
      if (len === 1 && !units.has(piece) && prev?.kind === 'seg' && /[\p{M}\p{Lm}]/u.test(piece))
        prev.text += piece
      else out.push({ text: piece, kind: 'seg' })
      i += len
      continue
    }
    i++
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

/** 一个音节在音段序列里的范围：[start, end)，音节核是 [nucleusStart, nucleusEnd) */
export interface SyllableSpan {
  start: number
  nucleusStart: number
  nucleusEnd: number
  end: number
}

/**
 * 最大起首原则：每个核之前尽可能多地把辅音划给起首，受 onsets 表（若给）和 maxOnset 限制，
 * 其余留给上一个音节的尾音。相邻的核合并成一个（双元音）；一个核都没有时整串算一个音节。
 */
export function syllableSpans(
  segs: string[],
  isNucleus: (s: string) => boolean,
  opts: Pick<SyllableOptions, 'onsets' | 'maxOnset' | 'maxCoda'> = {}
): SyllableSpan[] {
  const nucleusIdx: number[] = []
  segs.forEach((s, i) => {
    if (isNucleus(s)) nucleusIdx.push(i)
  })
  if (!nucleusIdx.length)
    return [{ start: 0, nucleusStart: segs.length, nucleusEnd: segs.length, end: segs.length }]
  const groups: [number, number][] = []
  for (const i of nucleusIdx) {
    const last = groups[groups.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else groups.push([i, i])
  }
  const spans: SyllableSpan[] = []
  let prevEnd = -1
  groups.forEach(([start, end], gi) => {
    const clusterLen = start - prevEnd - 1
    let onsetLen = clusterLen
    if (gi > 0) {
      onsetLen = Math.min(clusterLen, opts.maxOnset ?? Infinity)
      // 受允许起首表限制：从最长往下找一个合法的
      if (opts.onsets && opts.onsets.size) {
        while (onsetLen > 0 && !opts.onsets.has(segs.slice(start - onsetLen, start).join('')))
          onsetLen--
      }
      // 尾音上限
      const maxCoda = opts.maxCoda ?? Infinity
      if (clusterLen - onsetLen > maxCoda) onsetLen = Math.max(0, clusterLen - maxCoda)
    }
    const onsetStart = start - onsetLen
    if (spans.length) spans[spans.length - 1].end = onsetStart
    spans.push({
      start: gi === 0 ? 0 : onsetStart,
      nucleusStart: start,
      nucleusEnd: end + 1,
      end: end + 1
    })
    prevEnd = end
  })
  spans[spans.length - 1].end = segs.length
  return spans
}

export function syllabify(segments: string[], opts: SyllableOptions): Syllable[] {
  const isN = (s: string): boolean => opts.nuclei.has(s) || opts.nuclei.has(stripMarks(s))
  const segs = segments.filter((s) => !opts.ignore?.has(s))
  return syllableSpans(segs, isN, opts).map((sp) => ({
    onset: segs.slice(sp.start, sp.nucleusStart),
    nucleus: segs.slice(sp.nucleusStart, sp.nucleusEnd),
    coda: segs.slice(sp.nucleusEnd, sp.end)
  }))
}

export function stripMarks(s: string): string {
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

/** 返回主重音所在音节的下标；manual、custom（按重音规则另外标）或无音节返回 -1 */
export function stressIndex(sylls: Syllable[], position: StressPosition): number {
  const n = sylls.length
  if (n === 0 || position === 'manual' || position === 'custom') return -1
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

/** 把音节拼回带音节点和重音符的 IPA；secondary 是带次重音的音节 */
export function renderSyllables(
  sylls: Syllable[],
  stressAt = -1,
  secondary: ReadonlySet<number> = new Set()
): string {
  return sylls
    .map((s, i) => (i === stressAt ? 'ˈ' : secondary.has(i) ? 'ˌ' : '') + syllableText(s))
    .join('.')
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
export function languageParseOptions(
  lang: Language | null | undefined,
  project?: Project | null
): ParseOptions {
  if (!lang) return {}
  const classes: Record<string, string[]> = {}
  for (const c of lang.classes) if (c.name && c.members.length) classes[c.name] = c.members
  const morphemes: Record<string, string[]> = {}
  if (project) {
    const stripH = (s: string): string => s.replace(/^[-=]+|[-=]+$/g, '')
    for (const m of project.morphemes) {
      if (m.languageId !== lang.id) continue
      const forms = [
        ...new Set([m.form, ...m.allomorphs.map((a) => a.form)].map(stripH).filter(Boolean))
      ]
      if (!forms.length) continue
      for (const key of [m.gloss, stripH(m.form)])
        if (key && !morphemes[key]) morphemes[key] = forms
    }
  }
  const replacements = lang.digraphs
    .filter((d) => d.from && d.to)
    .map((d) => [d.from, d.to] as [string, string])
  return { classes, replacements, morphemes, syllables: syllableScheme(lang, replacements) }
}

/** 规则里切音节（σ、重音规则）用的设置：音位表、音节核、确定是辅音的音、起首表与模板 */
function syllableScheme(lang: Language, replacements: [string, string][]): SyllableScheme {
  const nuclei = nucleusSet(lang)
  const consonants = new Set<string>()
  for (const p of lang.phonemes) if (phonemeKind(lang, p) === 'consonant') consonants.add(p.symbol)
  for (const c of lang.classes)
    if (CONSONANT_CLASS.test(c.name)) for (const m of c.members) consonants.add(m)
  const units = new Set<string>(lang.phonemes.map((p) => p.symbol))
  for (const [, to] of replacements) units.add(to)
  for (const c of lang.classes)
    for (const m of c.members) if (Array.from(m).length > 1) units.add(m)
  const tpl =
    lang.syllable.strategy === 'template' && lang.syllable.template
      ? parseTemplate(lang.syllable.template)
      : null
  return {
    units: [...units].filter(Boolean),
    nuclei: [...nuclei],
    consonants: [...consonants].filter((c) => !nuclei.has(c)),
    onsets: [...lang.phonotactics.onsets],
    maxOnset: tpl ? tpl.maxOnset : null,
    maxCoda: tpl ? tpl.maxCoda : null
  }
}

/**
 * 拼写切分用的单位：音位符号、主正字法里各音位的写法（th、eu）、多合字母的写法；
 * isVowel 认音节核：本身是音节核，或是某个元音音位的写法。构形里按音段数的地方（中缀位置、模板、重叠）用它，
 * 拼写里的 th 就是一个音，不会被拆成 t、h。
 */
export function spellingUnits(lang: Language): {
  units: string[]
  isVowel: (s: string) => boolean
} {
  const ortho = lang.orthographies.find((o) => o.isPrimary) ?? lang.orthographies[0]
  const nuclei = nucleusSet(lang)
  const units = new Set<string>(lang.phonemes.map((p) => p.symbol))
  const vowels = new Set<string>()
  for (const p of lang.phonemes) {
    const written = ortho ? (p.graphemes[ortho.id] ?? '') : ''
    const vowel = nuclei.has(p.symbol) || phonemeKind(lang, p) === 'vowel'
    for (const g of written.split(/[\s,，、/]+/).filter(Boolean)) {
      units.add(g)
      if (vowel) vowels.add(g)
    }
  }
  for (const d of lang.digraphs) {
    if (!d.from) continue
    units.add(d.from)
    if (nuclei.has(d.to)) vowels.add(d.from)
  }
  return {
    units: [...units].filter(Boolean),
    isVowel: (s) => nuclei.has(s) || vowels.has(s)
  }
}

const VOWEL_CLASS = /^(V|Vowel|Vowels|元音|N|Nucleus)$/i
const CONSONANT_CLASS = /^(C|Consonant|Consonants|辅音)$/i

/** 音位表里可作音节核的音段：syllabic 特征为 yes，或属于名为 V / Vowel / 元音 的音类 */
export function nucleusSet(lang: Language): Set<string> {
  const s = new Set<string>()
  for (const p of lang.phonemes) {
    const f = phonemeFeatures(p)
    if (f.syllabic === 'yes' || f.type === 'vowel') s.add(p.symbol)
  }
  for (const c of lang.classes) if (VOWEL_CLASS.test(c.name)) for (const m of c.members) s.add(m)
  for (const n of lang.phonotactics.nuclei) s.add(n)
  return s
}

const kindOf = (f: Record<string, string>): 'vowel' | 'consonant' | null =>
  f.syllabic === 'yes' || f.type === 'vowel' ? 'vowel' : f.type === 'consonant' ? 'consonant' : null

/**
 * 一个音位算元音（能作音节核）还是辅音：手填的特征 > 名为 V / C 的音类 > 按 IPA 表推断 >
 * 表里没有的多字母写法（ng、aa）逐个字母推断，全是辅音算辅音、全是元音算元音。都看不出时返回 null。
 */
export function phonemeKind(lang: Language, p: Phoneme): 'vowel' | 'consonant' | null {
  const own = kindOf(p.features)
  if (own) return own
  for (const c of lang.classes) {
    if (!c.members.includes(p.symbol)) continue
    if (VOWEL_CLASS.test(c.name)) return 'vowel'
    if (CONSONANT_CLASS.test(c.name)) return 'consonant'
  }
  const inferred = kindOf(inferFeatures(p.symbol))
  if (inferred) return inferred
  const letters = Array.from(p.symbol.normalize('NFD')).filter((ch) => !/[\p{M}\p{Lm}]/u.test(ch))
  if (letters.length < 2) return null
  const kinds = new Set(letters.map((ch) => kindOf(inferFeatures(ch))))
  return kinds.size === 1 ? [...kinds][0] : null
}

/** 按音位表推出的配列表：辅音作起首与尾音，元音作音节核；分不出的列在 unknown */
export function phonotacticsFromInventory(lang: Language): {
  onsets: string[]
  nuclei: string[]
  codas: string[]
  unknown: string[]
} {
  const consonants: string[] = []
  const vowels: string[] = []
  const unknown: string[] = []
  for (const p of lang.phonemes) {
    if (!p.symbol) continue
    const kind = phonemeKind(lang, p)
    if (kind === 'vowel') vowels.push(p.symbol)
    else if (kind === 'consonant') consonants.push(p.symbol)
    else unknown.push(p.symbol)
  }
  return { onsets: consonants, nuclei: vowels, codas: [...consonants], unknown }
}

/**
 * 用语言设置给一个 IPA 串划音节并标重音。串里已经有 ˈ ˌ 的按记号来（正字法里的重音规则、手填的读音）；
 * 分隔符（· - ‿ 这些）隔开的几块各自划音节，音节不跨过它们，显示时照原样留着。
 */
export function analyzeWord(
  lang: Language,
  ipa: string
): { segments: string[]; syllables: Syllable[]; stress: number; text: string } {
  const inventory = new Set(lang.phonemes.map((p) => p.symbol))
  const nuclei = nucleusSet(lang)
  const isN = (s: string): boolean => nuclei.has(s) || nuclei.has(stripMarks(s))
  const tpl =
    lang.syllable.strategy === 'template' && lang.syllable.template
      ? parseTemplate(lang.syllable.template)
      : { maxOnset: Infinity, maxCoda: Infinity }
  const opts = {
    onsets: lang.phonotactics.onsets.length ? new Set(lang.phonotactics.onsets) : undefined,
    maxOnset: tpl.maxOnset,
    maxCoda: tpl.maxCoda
  }
  const segments: string[] = []
  const syllables: Syllable[] = []
  const chunks: { from: number; to: number; sep: string }[] = []
  let primary = -1
  const secondary = new Set<number>()
  let segs: string[] = []
  let marks: [number, string][] = []
  const flush = (sep: string): void => {
    const from = syllables.length
    if (segs.length) {
      const spans = lang.syllable.enabled
        ? syllableSpans(segs, isN, opts)
        : [{ start: 0, nucleusStart: 0, nucleusEnd: segs.length, end: segs.length }]
      for (const sp of spans)
        syllables.push({
          onset: segs.slice(sp.start, sp.nucleusStart),
          nucleus: segs.slice(sp.nucleusStart, sp.nucleusEnd),
          coda: segs.slice(sp.nucleusEnd, sp.end)
        })
      for (const [at, mark] of marks) {
        const k = spans.findIndex((sp) => at < sp.end)
        const idx = from + (k < 0 ? spans.length - 1 : k)
        if (mark === 'ˈ') {
          if (primary < 0) primary = idx
        } else secondary.add(idx)
      }
      segments.push(...segs)
    }
    chunks.push({ from, to: syllables.length, sep })
    segs = []
    marks = []
  }
  for (const tk of tokenizeWord(ipa, inventory)) {
    if (tk.kind === 'seg') segs.push(tk.text)
    else if (tk.kind === 'mark') marks.push([segs.length, tk.text])
    else if (tk.kind === 'sep' || tk.kind === 'space') flush(tk.text)
  }
  flush('')
  if (
    primary < 0 &&
    !secondary.size &&
    (lang.prosody.type === 'stress' || lang.prosody.type === 'pitch')
  )
    primary = syllables.some((s) => s.nucleus.length)
      ? stressIndex(syllables, lang.prosody.stressPosition)
      : -1
  if (!lang.syllable.enabled) return { segments, syllables, stress: primary, text: ipa }
  const text = chunks
    .map((c) => {
      const second = new Set(
        [...secondary].filter((i) => i >= c.from && i < c.to).map((i) => i - c.from)
      )
      return renderSyllables(syllables.slice(c.from, c.to), primary - c.from, second) + c.sep
    })
    .join('')
  return { segments, syllables, stress: primary, text }
}

export const SYLLABLE_MARKS = 'OsKU2WC8G'
