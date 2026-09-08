/**
 * 按用户自定义字母表排序。字母表是有序的字素列表，可含多字符（如 th、ng）。
 * 不在表里的字符排在最后，按 Unicode 顺序。
 */
export function makeCollator(alphabet: string[]): (a: string, b: string) => number {
  if (!alphabet.length)
    return (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b)
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

  return (a, b) => {
    const ta = tokenize(a)
    const tb = tokenize(b)
    const n = Math.min(ta.length, tb.length)
    for (let i = 0; i < n; i++) if (ta[i] !== tb[i]) return ta[i] - tb[i]
    return ta.length - tb.length || a.localeCompare(b)
  }
}
