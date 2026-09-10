/**
 * 语料查重：导入之后或用户手动触发，找出相同 / 相近的例句并合并。
 * 纯函数，不碰界面；「问不问用户」由 DupPair.auto 决定：
 *   - 原文（忽略大小写与空白）相同、译文相同或一方为空，只有出处不同 → 自动合并，出处写成「A & B」
 *   - 相似度 ≥ 阈值但不完全一样 → 交给用户决定
 */
import type { Id, Project, Sentence } from './model'

export interface DupPair {
  /** 留下的那条（较早录入 / 确认更多的） */
  keep: Sentence
  /** 并进去之后删掉的那条 */
  drop: Sentence
  /** 0~1 */
  similarity: number
  /** 只差出处（或什么都不差）：不用问 */
  auto: boolean
}

export function normalizeSentence(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  const chars = Array.from(s)
  if (chars.length < 2) {
    if (chars.length) m.set(chars[0], 1)
    return m
  }
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i] + chars[i + 1]
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** 字符二元组的 Dice 系数：完全相同 = 1，毫无重叠 = 0 */
export function sentenceSimilarity(a: string, b: string): number {
  const na = normalizeSentence(a)
  const nb = normalizeSentence(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ga = bigrams(na)
  const gb = bigrams(nb)
  let inter = 0
  let total = 0
  for (const [g, n] of ga) {
    total += n
    inter += Math.min(n, gb.get(g) ?? 0)
  }
  for (const n of gb.values()) total += n
  return total ? (2 * inter) / total : 0
}

function translationsAgree(a: Sentence, b: Sentence): boolean {
  const ta = Object.entries(a.translation).filter(([, v]) => v.trim())
  const tb = Object.entries(b.translation).filter(([, v]) => v.trim())
  if (!ta.length || !tb.length) return true
  for (const [k, v] of ta) {
    const w = b.translation[k]
    if (w?.trim() && normalizeSentence(w) !== normalizeSentence(v)) return false
  }
  return true
}

function confirmedCount(s: Sentence): number {
  return s.tokens.filter((t) => t.confirmed).length
}

/** 哪条留下：确认过的词多的；一样多就留数组里靠前的（先录入的） */
function pickKeep(a: Sentence, b: Sentence, order: Map<Id, number>): [Sentence, Sentence] {
  const ca = confirmedCount(a)
  const cb = confirmedCount(b)
  if (ca !== cb) return ca > cb ? [a, b] : [b, a]
  return (order.get(a.id) ?? 0) <= (order.get(b.id) ?? 0) ? [a, b] : [b, a]
}

export interface FindDupOptions {
  /** 只看这门语言 */
  languageId?: Id | null
  /** 只报涉及这些句子（刚导入的）的配对 */
  among?: Set<Id>
  /** 相似度阈值，默认 0.8 */
  threshold?: number
}

/**
 * 找重复。每条句子只出现在一对里（贪心：先配最像的），避免同一条被合并两次。
 */
export function findDuplicateSentences(project: Project, opts: FindDupOptions = {}): DupPair[] {
  const threshold = opts.threshold ?? 0.8
  const order = new Map<Id, number>()
  project.sentences.forEach((s, i) => order.set(s.id, i))
  const pool = project.sentences.filter(
    (s) => (!opts.languageId || s.languageId === opts.languageId) && s.text.trim()
  )
  const norm = new Map<Id, string>()
  for (const s of pool) norm.set(s.id, normalizeSentence(s.text))
  const cands: { a: Sentence; b: Sentence; sim: number }[] = []
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i]
    const la = Array.from(norm.get(a.id)!).length
    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j]
      if (a.languageId !== b.languageId) continue
      if (opts.among && !opts.among.has(a.id) && !opts.among.has(b.id)) continue
      // 长度差太多不可能过线，省掉二元组计算
      const lb = Array.from(norm.get(b.id)!).length
      if (Math.min(la, lb) / Math.max(la, lb) < threshold - 0.05) continue
      const sim = sentenceSimilarity(a.text, b.text)
      if (sim >= threshold) cands.push({ a, b, sim })
    }
  }
  cands.sort((x, y) => y.sim - x.sim)
  const taken = new Set<Id>()
  const out: DupPair[] = []
  for (const c of cands) {
    if (taken.has(c.a.id) || taken.has(c.b.id)) continue
    taken.add(c.a.id)
    taken.add(c.b.id)
    const [keep, drop] = pickKeep(c.a, c.b, order)
    const sameText = norm.get(keep.id) === norm.get(drop.id)
    out.push({
      keep,
      drop,
      similarity: c.sim,
      auto: sameText && translationsAgree(keep, drop)
    })
  }
  return out
}

/** 「A & B」：两边都有且不同才拼；已经含有对方的不重复 */
export function mergeSource(a: string, b: string): string {
  const parts = [...a.split(/\s*&\s*/), ...b.split(/\s*&\s*/)].map((x) => x.trim()).filter(Boolean)
  return [...new Set(parts)].join(' & ')
}

/**
 * 把 drop 并进 keep 并从项目里删掉 drop：出处拼接，译文 / 正字法 / 文字写法 / 自由行补缺，
 * 标签并集，备注拼接；token 分析保留 keep 的（它确认得更多）。
 */
export function mergeSentences(project: Project, keep: Sentence, drop: Sentence): void {
  keep.source = mergeSource(keep.source, drop.source)
  for (const [k, v] of Object.entries(drop.translation))
    if (v.trim() && !keep.translation[k]?.trim()) keep.translation[k] = v
  for (const [k, v] of Object.entries(drop.orthoTexts))
    if (v.trim() && !keep.orthoTexts[k]?.trim()) keep.orthoTexts[k] = v
  for (const [k, v] of Object.entries(drop.scriptForms))
    if (v.trim() && !keep.scriptForms[k]?.trim()) keep.scriptForms[k] = v
  for (const line of drop.extraLines)
    if (!keep.extraLines.some((x) => x.label === line.label && x.text === line.text))
      keep.extraLines.push({ ...line })
  keep.tags = [...new Set([...keep.tags, ...drop.tags])]
  if (drop.notes.trim() && !keep.notes.includes(drop.notes.trim()))
    keep.notes = keep.notes.trim() ? `${keep.notes.trim()}\n${drop.notes.trim()}` : drop.notes
  if (!keep.tokens.length && drop.tokens.length) keep.tokens = drop.tokens
  const idx = project.sentences.findIndex((s) => s.id === drop.id)
  if (idx >= 0) project.sentences.splice(idx, 1)
}
