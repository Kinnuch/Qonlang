/**
 * 按用户自定义字母表排序。字母表是有序的字素列表，可含多字符（如 th、ng）。
 * 不在表里的字符排在最后，按 Unicode 顺序。
 */
import { canonicalG } from '$lib/ipa/equivalence'

/** 排序器建一次反复用：localeCompare 带参数时每比一次都要新建一个，几千个词排一次要上百毫秒 */
const baseOrder = new Intl.Collator(undefined, { sensitivity: 'base' })
const fullOrder = new Intl.Collator()
const TOKEN_MEMO_MAX = 50000

export function makeCollator(alphabet: string[]): (a: string, b: string) => number {
  if (!alphabet.length)
    return (a, b) => {
      const left = canonicalG(a),
        right = canonicalG(b)
      return baseOrder.compare(left, right) || fullOrder.compare(left, right)
    }
  const order = new Map<string, number>()
  alphabet.forEach((g, i) => {
    const glyph = canonicalG(g)
    if (!order.has(glyph)) order.set(glyph, i)
    const lower = canonicalG(g.toLowerCase())
    if (!order.has(lower)) order.set(lower, i)
  })
  const maxLen = Math.max(...alphabet.map((g) => Array.from(g).length))

  const tokenize = (s: string): number[] => {
    const chars = Array.from(s)
    const out: number[] = []
    let i = 0
    while (i < chars.length) {
      let matched = false
      for (let len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
        const piece = chars.slice(i, i + len).join('')
        const idx = order.get(piece) ?? order.get(piece.toLowerCase())
        if (idx !== undefined) {
          out.push(idx)
          i += len
          matched = true
          break
        }
      }
      if (!matched) {
        out.push(alphabet.length + chars[i].codePointAt(0)!)
        i++
      }
    }
    return out
  }

  // 同一个词在一次排序里要比很多次：切出来的序号记下来
  const memo = new Map<string, number[]>()
  const keyOf = (s: string): number[] => {
    let k = memo.get(s)
    if (!k) {
      if (memo.size >= TOKEN_MEMO_MAX) memo.clear()
      k = tokenize(s)
      memo.set(s, k)
    }
    return k
  }
  return (a, b) => {
    a = canonicalG(a)
    b = canonicalG(b)
    const ta = keyOf(a)
    const tb = keyOf(b)
    const n = Math.min(ta.length, tb.length)
    for (let i = 0; i < n; i++) if (ta[i] !== tb[i]) return ta[i] - tb[i]
    return ta.length - tb.length || fullOrder.compare(a, b)
  }
}

export interface LexiconLetters {
  initial: (lemma: string) => string
  final: (lemma: string) => string
  compareFromEnd: (a: string, b: string) => number
}

interface LetterTrie {
  children: Map<string, LetterTrie>
  entry?: { label: string; index: number }
}
interface LexiconLetterToken {
  text: string
  label: string
  rank: number | null
  points: number[]
}
const letterSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const normalizedLetter = (text: string): string => canonicalG(text).normalize('NFC')
const lowerLetter = (text: string): string => canonicalG(text.toLowerCase()).normalize('NFC')
const graphemesOf = (text: string): string[] =>
  Array.from(letterSegments.segment(text), (part) => part.segment)

/**
 * 词首、词尾和反向词典共用同一份「从左到右最长匹配」分词。
 * 字母表项的原大小写用于分组显示；表外保留完整重音／组合字素并显示大写。
 * 仅此新 API 忽略两端空白和词缀边界 -=*·，不改变普通 makeCollator 的语义。
 */
export function makeLexiconLetters(alphabet: readonly string[]): LexiconLetters {
  const root: LetterTrie = { children: new Map() },
    order = new Map<string, number>(),
    declaredGroups = new Map<string, number>()
  let custom = false
  alphabet.forEach((letter, index) => {
    if (!letter) return
    custom = true
    const exact = normalizedLetter(letter),
      lower = lowerLetter(letter)
    // 保持普通自定义排序的精确项／小写别名优先规则。
    if (!order.has(exact)) order.set(exact, index)
    if (!order.has(lower)) order.set(lower, index)
    let node = root
    for (const part of graphemesOf(normalizedLetter(letter))) {
      const key = lowerLetter(part)
      if (!node.children.has(key)) node.children.set(key, { children: new Map() })
      node = node.children.get(key)!
    }
    // 同形、大小写或 g / ɡ 的重复项，分组沿用最早的原标签。
    node.entry ??= { label: letter, index }
    if (!declaredGroups.has(node.entry.label))
      declaredGroups.set(node.entry.label, node.entry.index)
  })
  const memo = new Map<string, LexiconLetterToken[]>(),
    initialMemo = new Map<string, string>()
  const clean = (lemma: string): string =>
    normalizedLetter(lemma.trim().replace(/^[-=*·]+|[-=*·]+$/gu, ''))
  const fallbackLabel = (text: string): string => normalizedLetter(text).toUpperCase()
  const tokensOf = (lemma: string): LexiconLetterToken[] => {
    const key = clean(lemma)
    const hit = memo.get(key)
    if (hit) return hit
    const parts = graphemesOf(key),
      tokens: LexiconLetterToken[] = []
    for (let at = 0; at < parts.length;) {
      let node = root,
        end = at,
        best: { label: string; index: number; end: number } | null = null
      while (end < parts.length) {
        const next = node.children.get(lowerLetter(parts[end]))
        if (!next) break
        node = next
        end++
        if (node.entry) best = { ...node.entry, end }
      }
      if (best) {
        const text = parts.slice(at, best.end).join('')
        tokens.push({
          text,
          label: best.label,
          rank: order.get(text) ?? order.get(lowerLetter(text)) ?? best.index,
          points: []
        })
        at = best.end
      } else {
        const text = parts[at++]
        tokens.push({
          text,
          label: fallbackLabel(text),
          rank: null,
          points: Array.from(text).map((c) => c.codePointAt(0)!)
        })
      }
    }
    if (memo.size >= TOKEN_MEMO_MAX) memo.clear()
    memo.set(key, tokens)
    return tokens
  }
  const initial = (lemma: string): string => {
    const key = clean(lemma),
      full = memo.get(key)
    if (full) return full[0]?.label ?? ''
    const cached = initialMemo.get(key)
    if (cached !== undefined) return cached
    let node = root,
      label = '',
      first = ''
    // 默认首字母面板只读开头到最长字母，不为每个词预建整个尾排数组。
    for (const part of letterSegments.segment(key)) {
      first ||= part.segment
      const next = node.children.get(lowerLetter(part.segment))
      if (!next) break
      node = next
      if (node.entry) label = node.entry.label
      if (!node.children.size) break
    }
    label ||= first ? fallbackLabel(first) : ''
    if (initialMemo.size >= TOKEN_MEMO_MAX) initialMemo.clear()
    initialMemo.set(key, label)
    return label
  }
  const codepointOrder = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
    return a.length - b.length
  }
  const groups = new Map<string, { rank: number | null; points: number[] }>()
  const groupOf = (label: string): { rank: number | null; points: number[] } => {
    let group = groups.get(label)
    if (!group) {
      if (groups.size >= TOKEN_MEMO_MAX) groups.clear()
      group = {
        rank: declaredGroups.get(label) ?? null,
        points: Array.from(label).map((c) => c.codePointAt(0)!)
      }
      groups.set(label, group)
    }
    return group
  }
  const groupOrder = (a: LexiconLetterToken, b: LexiconLetterToken): number => {
    if (a.label === b.label) return 0
    const left = groupOf(a.label),
      right = groupOf(b.label)
    if (!custom)
      return (
        baseOrder.compare(a.label, b.label) ||
        fullOrder.compare(a.label, b.label) ||
        codepointOrder(left.points, right.points)
      )
    if (left.rank !== null || right.rank !== null)
      return left.rank === null ? 1 : right.rank === null ? -1 : left.rank - right.rank
    return codepointOrder(left.points, right.points)
  }
  const primary = (a: LexiconLetterToken, b: LexiconLetterToken): number => {
    if (!custom) return baseOrder.compare(a.text, b.text)
    if (a.rank !== null || b.rank !== null)
      return a.rank === null ? 1 : b.rank === null ? -1 : a.rank - b.rank
    return codepointOrder(a.points, b.points)
  }
  return {
    initial,
    final: (lemma) => tokensOf(lemma).at(-1)?.label ?? '',
    compareFromEnd: (a, b) => {
      const left = tokensOf(a),
        right = tokensOf(b),
        n = Math.min(left.length, right.length)
      for (let i = 1; i <= n; i++) {
        const compared = groupOrder(left[left.length - i], right[right.length - i])
        if (compared) return compared
      }
      if (left.length !== right.length) return left.length - right.length
      for (let i = 1; i <= n; i++) {
        const compared = primary(left[left.length - i], right[right.length - i])
        if (compared) return compared
      }
      // 主序完全相同时，仍从词尾处理大小写次序；不把相邻 token 重新拼成新字母。
      for (let i = 1; i <= n; i++) {
        const compared = fullOrder.compare(left[left.length - i].text, right[right.length - i].text)
        if (compared) return compared
      }
      return 0
    }
  }
}

export const COLLATION_TAIL = 'l0F0VPkvV'
