/** 有界、可解释的释义近似；不推断语义、不改译文，不匹配带槽框架。 */
import type { GlossSpan } from './composeMatch'
export interface ComposeApproximation {
  kind: 'normalized' | 'partial' | 'typo'
  source: string
  distance?: number
}
interface Term {
  item: string
  key: string
  spaceless: boolean
  words: number
}
export interface ComposeApproxIndex {
  terms: Term[]
  normalized: Map<string, number[]>
  bigrams: Map<string, number[]>
}
export interface ApproxGlossMatch extends GlossSpan {
  approximate: ComposeApproximation
}
const EAST = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const EAST_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{M}]+/gu
const fold = (value: string): string =>
  value
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, ' ')
const grams = (key: string): Set<string> => {
  const chars = Array.from(key),
    out = new Set<string>()
  for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1])
  return out
}
const add = (map: Map<string, number[]>, key: string, index: number): void => {
  const old = map.get(key)
  if (old) old.push(index)
  else map.set(key, [index])
}
export function prepareComposeApprox(items: Iterable<string>): ComposeApproxIndex {
  const terms: Term[] = [],
    normalized = new Map<string, number[]>(),
    bigrams = new Map<string, number[]>()
  for (const item of new Set(items)) {
    if (/…|\.{3}/u.test(item)) continue
    const key = fold(item),
      spaceless = EAST.test(key),
      words = key.split(' ').length
    if (
      Array.from(key).length < 2 ||
      key.length > 32 ||
      words > 4 ||
      !/[\p{L}]/u.test(key) ||
      /[^\p{L}\p{N} '\-’]/u.test(key)
    )
      continue
    const index = terms.length
    terms.push({ item, key, spaceless, words })
    add(normalized, key, index)
    for (const gram of grams(key)) add(bigrams, gram, index)
  }
  return { terms, normalized, bigrams }
}
/** 一处插入／删除／替换或相邻换位；短词不交给它，避免 see/seed 这种假阳性。 */
function oneEdit(a: string, b: string): boolean {
  const x = Array.from(a),
    y = Array.from(b)
  if (Math.abs(x.length - y.length) > 1) return false
  let i = 0
  while (i < Math.min(x.length, y.length) && x[i] === y[i]) i++
  if (i === Math.min(x.length, y.length)) return Math.abs(x.length - y.length) === 1
  if (x.length === y.length) {
    if (x.slice(i + 1).join('') === y.slice(i + 1).join('')) return true
    return (
      x[i] === y[i + 1] && x[i + 1] === y[i] && x.slice(i + 2).join('') === y.slice(i + 2).join('')
    )
  }
  return x.length > y.length
    ? x.slice(i + 1).join('') === y.slice(i).join('')
    : x.slice(i).join('') === y.slice(i + 1).join('')
}
interface Source {
  key: string
  spaceless: boolean
  words: number
  spans: GlossSpan[]
}
export function matchComposeApprox(
  index: ComposeApproxIndex,
  text: string
): { matches: Map<string, ApproxGlossMatch[]>; truncated: boolean } {
  const source = text.slice(0, 4096),
    sources = new Map<string, Source>()
  let truncated = source.length !== text.length
  const push = (at: number, end: number, spaceless: boolean): void => {
    const key = fold(source.slice(at, end))
    if (!key) return
    let item = sources.get(key)
    if (!item) {
      if (sources.size >= 256) {
        truncated = true
        return
      }
      item = { key, spaceless, words: key.split(' ').length, spans: [] }
      sources.set(key, item)
    }
    if (item.spans.length < 64 && !item.spans.some((span) => span.at === at && span.end === end))
      item.spans.push({ at, end })
    else if (item.spans.length >= 64) truncated = true
  }
  const words = [...source.matchAll(/[\p{L}\p{M}\p{N}'’-]+/gu)]
    .filter((match) => !EAST.test(match[0]))
    .slice(0, 96)
  for (let i = 0; i < words.length; i++)
    for (let count = 1; count <= 4 && i + count <= words.length; count++) {
      const first = words[i],
        last = words[i + count - 1],
        end = last.index + last[0].length
      if (
        count > 1 &&
        /[^\s]/u.test(
          source.slice(words[i + count - 2].index + words[i + count - 2][0].length, last.index)
        )
      )
        break
      push(first.index, end, false)
    }
  for (const match of source.matchAll(EAST_RUN)) {
    const chars = [...match[0].matchAll(/./gu)]
    for (let start = 0; start < chars.length; start++)
      for (let count = 2; count <= Math.min(8, chars.length - start); count++) {
        push(
          match.index + chars[start].index,
          match.index + chars[start + count - 1].index + chars[start + count - 1][0].length,
          true
        )
      }
  }
  const matches = new Map<string, ApproxGlossMatch[]>()
  let probes = 0
  for (const value of sources.values()) {
    const normalized = index.normalized.get(value.key) ?? []
    if (normalized.length > 2000) truncated = true
    const candidates = new Set(normalized.slice(0, 2000))
    for (const gram of grams(value.key))
      for (const id of index.bigrams.get(gram) ?? []) {
        if (candidates.size >= 2000) {
          truncated = true
          break
        }
        candidates.add(id)
      }
    for (const id of candidates) {
      if (probes++ >= 40000) {
        truncated = true
        break
      }
      const term = index.terms[id]
      if (term.spaceless !== value.spaceless) continue
      let kind: ComposeApproximation['kind'] | null = null
      if (term.key === value.key) kind = 'normalized'
      else if (
        value.spaceless &&
        value.key.length >= 2 &&
        term.key.length > value.key.length &&
        term.key.length <= 8 &&
        term.key.includes(value.key)
      )
        kind = 'partial'
      else if (
        !value.spaceless &&
        term.words > value.words &&
        value.key.replace(/\s/gu, '').length >= 4 &&
        (' ' + term.key + ' ').includes(' ' + value.key + ' ')
      )
        kind = 'partial'
      else if (
        !/\p{N}/u.test(value.key + term.key) &&
        term.words === value.words &&
        Math.min(Array.from(value.key).length, Array.from(term.key).length) >=
          (value.spaceless ? 4 : 5) &&
        oneEdit(value.key, term.key)
      )
        kind = 'typo'
      if (!kind) continue
      let found = matches.get(term.item)
      if (!found) matches.set(term.item, (found = []))
      for (const span of value.spans) {
        const raw = text.slice(span.at, span.end)
        // 原文已能精确匹配的归原匹配器；这里只补规范化确有差异的结果。
        if (kind === 'normalized' && raw.toLowerCase() === term.item.toLowerCase()) continue
        const hit = {
          ...span,
          approximate: { kind, source: raw, ...(kind === 'typo' ? { distance: 1 } : {}) }
        }
        const previous = found.findIndex((old) => old.at === span.at && old.end === span.end)
        if (previous < 0 && found.length < 64) found.push(hit)
      }
    }
    if (probes >= 40000) break
  }
  // 同一释义若有更完整的片段，不展示它内部被包含的弱片段。
  for (const [item, hits] of matches) {
    const ordered = hits.sort((a, b) => a.at - b.at || b.end - a.end),
      kept: ApproxGlossMatch[] = []
    for (const hit of ordered)
      if (!kept.some((old) => old.at <= hit.at && old.end >= hit.end)) kept.push(hit)
    matches.set(item, kept)
  }
  return { matches, truncated }
}
