/** 选项可能已随语言、词形或筛选结果更新；旧值不能参与「是否全选」计数。 */
export function pickFilterOption(
  values: readonly string[],
  selected: ReadonlySet<string> | null | undefined,
  value: string,
  enabled: boolean
): Set<string> | null {
  const all = new Set(values)
  const next = new Set([...(selected ?? all)].filter((value) => all.has(value)))
  if (enabled && all.has(value)) next.add(value)
  else next.delete(value)
  return next.size === all.size ? null : next
}
