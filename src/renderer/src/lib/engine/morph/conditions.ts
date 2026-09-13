/**
 * 构形里「按条件换几个字母」：词缀、微调里写 `{阴:g|k}`，推导时按这个槽位的维度取值，
 * 以及词条自己的语法特征（性、名词类别这类不进构形维度、词条自己带着的）挑出一支。
 *
 * 写法：
 * - `{条件:形式|条件:形式|默认}`：从左往右第一支对上的算；都没对上用不带条件的那支，没有就是空
 * - 条件写维度取值的名字或缩写（`阴`、`F`）；两个维度有同名取值时写 `维度=取值`（`性=阴`）
 * - 一支里用 `,` 隔开是「任一」（`阳,中:o`），用 `+` 连着是「都要」（`阴+复:ae`）
 * - 冒号全角半角都行；大括号里没有冒号的（`{Vlong}` 音类、`{@名}` 引用）原样留着
 */
import type { GrammaticalCategory, Id, Lexeme } from '$lib/core/model'

export interface SlotValue {
  categoryId: Id
  valueId: Id
}

/** 一组 {…} 里的一支：any 是「任一」的几组，每组里的条件都要满足；any 为空就是默认那支 */
export interface Branch {
  any: string[][]
  form: string
  /** 原样的条件文字（界面预览用），默认那支是空串 */
  when: string
}

const GROUP = /[{]([^{}]*[:：][^{}]*)[}]/g

const norm = (s: string): string => s.normalize('NFC').trim().toLowerCase()

/** 这个词条在这个槽位上的取值：词条自己的语法特征打底，槽位的维度取值覆盖同一个维度 */
export function activeValues(
  slotValues: readonly SlotValue[] | undefined,
  lexeme: Pick<Lexeme, 'features'> | null | undefined
): Map<Id, Id> {
  const m = new Map<Id, Id>()
  for (const [cid, vid] of Object.entries(lexeme?.features ?? {})) if (vid) m.set(cid, vid)
  for (const v of slotValues ?? []) m.set(v.categoryId, v.valueId)
  return m
}

function labels(x: { name?: Record<string, string>; abbr?: string }): string[] {
  return [...Object.values(x.name ?? {}), x.abbr ?? ''].map(norm).filter(Boolean)
}

/** 一个条件词对上的维度取值；写了「维度=取值」就只在那个维度里找 */
export function conditionTargets(
  token: string,
  categories: readonly GrammaticalCategory[]
): SlotValue[] {
  const t = token.trim()
  const eq = t.search(/[=＝]/)
  const dim = eq > 0 ? norm(t.slice(0, eq)) : ''
  const val = norm(eq > 0 ? t.slice(eq + 1) : t)
  if (!val) return []
  const out: SlotValue[] = []
  for (const c of categories) {
    if (dim && !labels(c).includes(dim)) continue
    for (const v of c.values)
      if (labels(v).includes(val)) out.push({ categoryId: c.id, valueId: v.id })
  }
  return out
}

/** 拆开一组大括号里的内容 */
export function parseBranches(body: string): Branch[] {
  return body.split('|').map((part) => {
    const at = part.search(/[:：]/)
    if (at < 0) return { any: [], form: part, when: '' }
    const when = part.slice(0, at).trim()
    const any = when
      .split(/[,，、]/)
      .map((all) =>
        all
          .split('+')
          .map((x) => x.trim())
          .filter(Boolean)
      )
      .filter((all) => all.length > 0)
    return { any, form: part.slice(at + 1), when }
  })
}

/** 文本里有没有按条件换的写法 */
export function hasConditions(text: string | undefined): boolean {
  return !!text && /[{][^{}]*[:：][^{}]*[}]/.test(text)
}

/**
 * 按取值把每一组挑好，返回挑完的文本。
 * unknown：收集一个取值都没对上的条件词（多半是写错了），给推导轨迹提示用。
 */
export function resolveConditions(
  text: string,
  categories: readonly GrammaticalCategory[],
  active: ReadonlyMap<Id, Id>,
  unknown?: Set<string>
): string {
  if (!hasConditions(text)) return text
  const holds = (token: string): boolean => {
    const targets = conditionTargets(token, categories)
    if (!targets.length) unknown?.add(token)
    return targets.some((v) => active.get(v.categoryId) === v.valueId)
  }
  return text.replace(GROUP, (_all, body: string) => {
    const branches = parseBranches(body)
    const hit = branches.find((b) => b.any.length > 0 && b.any.some((all) => all.every(holds)))
    return (hit ?? branches.find((b) => b.any.length === 0))?.form ?? ''
  })
}

/**
 * 各种挑法拼出来的文本（界面预览、反推词缀、统计引用用）：每一组各取一支，最多 limit 种。
 * when 是这一种挑法用到的条件，几组的用「 · 」连起来；全是默认那支时是空串。
 */
export function conditionVariants(text: string, limit = 16): { when: string; text: string }[] {
  if (!hasConditions(text)) return [{ when: '', text }]
  let out: { when: string[]; text: string }[] = [{ when: [], text: '' }]
  let last = 0
  for (const m of text.matchAll(GROUP)) {
    const at = m.index ?? 0
    const lead = text.slice(last, at)
    const branches = parseBranches(m[1])
    const next: { when: string[]; text: string }[] = []
    for (const o of out)
      for (const b of branches) {
        if (next.length >= limit) break
        next.push({ when: b.when ? [...o.when, b.when] : o.when, text: o.text + lead + b.form })
      }
    out = next
    last = at + m[0].length
  }
  return out.map((o) => ({ when: o.when.join(' · '), text: o.text + text.slice(last) }))
}
