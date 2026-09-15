/**
 * 按用户自定义字母表排序。字母表是有序的字素列表，可含多字符（如 th、ng）。
 * 不在表里的字符排在最后，按 Unicode 顺序。
 */
/** 排序器建一次反复用：localeCompare 带参数时每比一次都要新建一个，几千个词排一次要上百毫秒 */
const baseOrder = new Intl.Collator(undefined, { sensitivity: 'base' })
const fullOrder = new Intl.Collator()
const TOKEN_MEMO_MAX = 50000

export function makeCollator(alphabet: string[]): (a: string, b: string) => number {
  if (!alphabet.length) return (a, b) => baseOrder.compare(a, b) || fullOrder.compare(a, b)
  const order = new Map<string, number>()
  alphabet.forEach((g, i) => {
    if (!order.has(g)) order.set(g, i)
    const lower = g.toLowerCase()
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
    const ta = keyOf(a)
    const tb = keyOf(b)
    const n = Math.min(ta.length, tb.length)
    for (let i = 0; i < n; i++) if (ta[i] !== tb[i]) return ta[i] - tb[i]
    return ta.length - tb.length || fullOrder.compare(a, b)
  }
}

export const COLLATION_TAIL = 'l0F0VPkvV'
