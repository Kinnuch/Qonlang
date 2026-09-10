/**
 * 顶栏搜索的通用兜底：按行上的可见文字过滤一段区域。
 * 「设置」这类由一堆表单行组成、没有列表数据可筛的页面用它，
 * 省得给每一行都写一遍匹配条件；有数据的模块请直接筛数据。
 */
export interface FilterRowsOptions {
  /** 搜索词；空表示全部显示 */
  q: string
  /** 行的选择器，相对于挂载节点 */
  sel: string
}

export function filterRows(
  node: HTMLElement,
  opts: FilterRowsOptions
): { update(o: FilterRowsOptions): void } {
  const apply = (o: FilterRowsOptions): void => {
    const needle = (o.q ?? '').trim().toLowerCase()
    const rows = [...node.querySelectorAll<HTMLElement>(o.sel)]
    if (!rows.length) {
      // 没有可筛的行：整块按自己的文字判断
      const hit = !needle || (node.textContent ?? '').toLowerCase().includes(needle)
      node.style.display = hit ? '' : 'none'
      return
    }
    let any = false
    for (const r of rows) {
      const hit = !needle || (r.textContent ?? '').toLowerCase().includes(needle)
      r.style.display = hit ? '' : 'none'
      if (hit) any = true
    }
    node.style.display = needle && !any ? 'none' : ''
  }
  apply(opts)
  return { update: apply }
}
