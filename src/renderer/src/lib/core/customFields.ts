/**
 * 检视器模块（用户给词条加的自定义内容块）的小工具：哪些模块用在哪门语言、列表怎么拆、按标题找模块。
 */
import type { CustomField, Id, Lexeme, Project, Script } from './model'

/** 列表型内容拆成几项：顿号、逗号、分号、换行都算分隔 */
export function customItems(text: string): string[] {
  return (text ?? '')
    .split(/[、，,；;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** 这门语言的词条用得上的模块（没限定语言的都算），按定义的顺序 */
export function customFieldsFor(
  project: Pick<Project, 'customFields'>,
  languageId: Id
): CustomField[] {
  return (project.customFields ?? []).filter(
    (f) => !f.languageIds.length || f.languageIds.includes(languageId)
  )
}

/** 模块的标题：按给的语言顺序挑第一个写了的，都没写就随便挑一个写了的 */
export function customFieldTitle(f: CustomField, langs: readonly string[]): string {
  for (const g of langs) if (f.name[g]?.trim()) return f.name[g].trim()
  return (
    Object.values(f.name)
      .find((x) => x?.trim())
      ?.trim() ?? ''
  )
}

const norm = (s: string): string => s.trim().toLowerCase()

/** 标题（任何一种语言）或别名跟 name 一样的模块，不分大小写 */
export function findCustomField(
  fields: readonly CustomField[],
  name: string
): CustomField | undefined {
  const k = norm(name)
  if (!k) return undefined
  return fields.find(
    (f) =>
      Object.values(f.name).some((n) => !!n && norm(n) === k) ||
      f.aliases.some((a) => norm(a) === k)
  )
}

/** 模块内容用的文字（取它的字体）：到各门语言的文字里找 */
export function customFieldScript(
  project: Pick<Project, 'languages'>,
  f: CustomField
): Script | undefined {
  if (!f.scriptId) return undefined
  for (const l of project.languages) {
    const sc = l.scripts.find((s) => s.id === f.scriptId)
    if (sc) return sc
  }
  return undefined
}

/** 写模块内容：写空了就删掉这一项，一项都不剩就去掉整个字段 */
export function setCustomValue(l: Lexeme, id: Id, value: string): void {
  if (value.trim()) {
    if (!l.custom) l.custom = {}
    l.custom[id] = value
  } else if (l.custom) {
    delete l.custom[id]
    if (!Object.keys(l.custom).length) delete l.custom
  }
}
