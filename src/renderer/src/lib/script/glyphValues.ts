/** 单独的分隔符也是可映射的标点；普通多读音字段仍沿用原分隔方式。 */
export function glyphValues(g: { value: string }): string[] {
  const value = g.value.trim()
  return /^[/、,，]$/u.test(value)
    ? [value]
    : value
        .split(/[/、,，]/u)
        .map((part) => part.trim())
        .filter(Boolean)
}
