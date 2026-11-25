/** 多语言显示选择；与输入框、搜索、导出和原始记录内容分开。 */
import type { DisplayLanguageSelection, LocalizedText, Project } from './model'

export type DisplayLanguageKind = 'definition' | 'translation'
const unique = (values: readonly string[]): string[] => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean))
]

export function normalizeDisplayLanguages(value: unknown): DisplayLanguageSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as { mode?: unknown; languages?: unknown }
  if (v.mode === 'all') return { mode: 'all' }
  if (v.mode !== 'one' && v.mode !== 'two') return undefined
  const languages = unique(
    Array.isArray(v.languages) ? v.languages.filter((x): x is string => typeof x === 'string') : []
  ).slice(0, v.mode === 'one' ? 1 : 2)
  if (!languages.length) return undefined
  return { mode: languages.length === 1 ? 'one' : 'two', languages }
}

/** 选项来自项目语言设置及该类记录的已有键；移出语言设置的旧译文仍可选。 */
export function availableDisplayLanguages(project: Project, kind: DisplayLanguageKind): string[] {
  const choice =
    kind === 'definition' ? project.settings.definitionDisplay : project.settings.translationDisplay
  const keys =
    kind === 'definition'
      ? project.lexemes.flatMap((word) =>
          word.senses.flatMap((sense) => Object.keys(sense.definition))
        )
      : [...project.sentences, ...project.phrasebook].flatMap((sentence) =>
          Object.keys(sentence.translation)
        )
  return unique([
    ...project.settings.glossLanguages,
    ...(project.settings.glossInputs ?? []),
    ...keys,
    ...(choice && choice.mode !== 'all' ? choice.languages : [])
  ])
}

export interface DisplayTextRow {
  language: string
  text: string
}
/** 无选项的preferred保留词条卡原项目顺序；first保留调用方给出的界面／项目优先顺序。 */
export function displayTextRows(
  text: LocalizedText | undefined,
  selection: DisplayLanguageSelection | undefined,
  order: readonly string[],
  legacy: 'preferred' | 'first' = 'first'
): DisplayTextRow[] {
  if (!text) return []
  const choice = normalizeDisplayLanguages(selection)
  let languages =
    choice?.mode === 'all'
      ? unique([...order, ...Object.keys(text)])
      : choice
        ? choice.languages
        : unique(legacy === 'preferred' ? order : [...order, ...Object.keys(text)])
  languages = languages.filter((language) => typeof text[language] === 'string' && !!text[language])
  if (!choice && legacy === 'first') languages = languages.slice(0, 1)
  return languages.map((language) => ({ language, text: text[language] }))
}

/** 选择显示语言后只替换释义列，其余列及原配置不改；还原默认可恢复原列选择。 */
export function definitionColumnKeys(
  keys: readonly string[],
  selection: DisplayLanguageSelection | undefined,
  languages: readonly string[]
): string[] {
  const choice = normalizeDisplayLanguages(selection)
  if (!choice) return [...keys]
  const first = keys.findIndex((key) => key.startsWith('def:'))
  const result = keys.filter((key) => !key.startsWith('def:'))
  const at = first < 0 ? Math.min(1, result.length) : first
  result.splice(
    at,
    0,
    ...(choice.mode === 'all' ? languages : choice.languages).map((language) => 'def:' + language)
  )
  return result
}
