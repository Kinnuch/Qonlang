/**
 * 表格列宽按容器铺满：每列有一个基准宽（用户拖过的宽，或按列的种类给的默认宽）和最小宽。
 * - 各列基准宽加起来比容器窄：按比例放大，铺满，右边不留空；
 * - 比容器宽（加了列）：按比例缩小，先匀出已有各列的宽，但不低于最小宽；
 * - 各列缩到最小宽都放不下：就按最小宽排，表格比容器宽，横向滚动。
 * 返回每列取整后的宽度，加起来正好等于容器宽（放得下时）。
 */
export interface FitColumn {
  base: number
  min: number
}

export function fitColumns(cols: FitColumn[], available: number): number[] {
  const n = cols.length
  if (!n) return []
  const bases = cols.map((c) => Math.max(c.min, c.base > 0 ? c.base : c.min))
  const mins = cols.map((c) => c.min)
  const avail = Math.max(0, Math.floor(available))
  const minSum = mins.reduce((a, b) => a + b, 0)
  if (avail <= minSum) return mins.map((m) => Math.round(m))
  // 按比例分，低于最小宽的钉在最小宽，剩下的再在其余列里按比例分，直到没有列被钉住
  const fixed = new Array<boolean>(n).fill(false)
  let widths = bases.slice()
  for (let round = 0; round <= n; round++) {
    const fixedSum = widths.reduce((a, w, i) => a + (fixed[i] ? w : 0), 0)
    const freeBase = bases.reduce((a, b, i) => a + (fixed[i] ? 0 : b), 0)
    const scale = freeBase > 0 ? (avail - fixedSum) / freeBase : 0
    let pinned = false
    widths = bases.map((b, i) => {
      if (fixed[i]) return mins[i]
      const w = b * scale
      if (w < mins[i]) {
        fixed[i] = true
        pinned = true
        return mins[i]
      }
      return w
    })
    if (!pinned) break
  }
  const out = widths.map((w) => Math.floor(w))
  // 取整丢掉的零头补给最后一列能伸缩的列，合起来正好铺满
  const rest = avail - out.reduce((a, b) => a + b, 0)
  let last = n - 1
  while (last > 0 && fixed[last]) last--
  out[last] += rest
  return out
}

/**
 * 拖第 k 列的右边：这一列变宽 / 变窄多少，右边紧挨的那列就反过来让出 / 收回多少，总宽不变（最后一列没有邻居，自己变）。
 * 两列都不低于最小宽。返回拖完之后每列的宽（拿去当新的基准宽）。
 */
export function dragColumn(widths: number[], mins: number[], k: number, delta: number): number[] {
  const out = widths.slice()
  if (k < 0 || k >= out.length) return out
  if (k === out.length - 1) {
    out[k] = Math.max(mins[k], Math.round(widths[k] + delta))
    return out
  }
  let d = Math.round(delta)
  d = Math.max(d, mins[k] - widths[k])
  d = Math.min(d, widths[k + 1] - mins[k + 1])
  out[k] = widths[k] + d
  out[k + 1] = widths[k + 1] - d
  return out
}
