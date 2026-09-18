/**
 * 语素异体形的语法条件：「在这些维度取值下用这一形」（宾格用 -en、与格用 -im 这类）。
 *
 * `Allomorph.values` 写的是维度取值的 id，要全都在「正在生成的那一格」的取值里这一条才算数；
 * 那一格的取值 = 槽位的维度取值 + 词条自己的语法特征，跟 `{阴:g|k}` 看的是同一份（conditions.ts 的 activeValues）。
 * 拿不到这份取值的地方（语素页自己的预览、语料分词）按老样子只看环境，写了取值的异体形挑不到。
 */
import type { Allomorph, CategoryValue, GrammaticalCategory, Id } from '$lib/core/model'

/** 这一格的取值（维度 id → 取值 id）里出现的全部取值 id */
export function activeValueIds(active: ReadonlyMap<Id, Id> | undefined | null): Set<Id> {
  return new Set(active ? active.values() : [])
}

/** 这条异体形要求的取值：去掉空的、重复的 */
export function alloValues(a: Allomorph): Id[] {
  return [...new Set((a.values ?? []).filter(Boolean))]
}

/**
 * 语法条件对不对得上：没写取值是 0（不挑剔，也不算更具体）；
 * 写了且全都在这一格的取值里，就是对上了几个；有一个对不上、或者根本没有这一格的取值时是 null（这条不能用）。
 */
export function valueMatch(a: Allomorph, activeIds: ReadonlySet<Id> | null): number | null {
  const want = alloValues(a)
  if (!want.length) return 0
  if (!activeIds) return null
  return want.every((v) => activeIds.has(v)) ? want.length : null
}

/** 取值 id 是哪个维度的哪个取值 */
export function findValue(
  categories: readonly GrammaticalCategory[],
  valueId: Id
): { category: GrammaticalCategory; value: CategoryValue } | null {
  for (const c of categories) {
    const v = c.values.find((x) => x.id === valueId)
    if (v) return { category: c, value: v }
  }
  return null
}

function pick(text: Record<string, string> | undefined, langs: readonly string[]): string {
  for (const l of langs) if (text?.[l]) return text[l]
  return Object.values(text ?? {}).find(Boolean) ?? ''
}

/** 取值叫什么（界面小方块、推导轨迹都用它）：取值名，没名字用缩写，都没有就是 ? */
export function valueLabel(
  categories: readonly GrammaticalCategory[],
  valueId: Id,
  langs: readonly string[]
): string {
  const hit = findValue(categories, valueId)
  if (!hit) return '?'
  return pick(hit.value.name, langs) || hit.value.abbr || '?'
}
