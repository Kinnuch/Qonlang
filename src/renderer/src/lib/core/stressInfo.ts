/**
 * 词库、语素里勾了「对重音影响」的，交给重音规则的东西：词类的各种叫法、特殊重音落在第几个音节。
 */
import type { Id, Lexeme, Morpheme, Project, StressSettings } from './model'
import type { WordStress } from '$lib/engine/sca'
import { lexemePosIds, posParts } from './pos'
import zh from '$lib/i18n/zh'
import en from '$lib/i18n/en'

/** 刚勾上「对重音影响」时的设置 */
export function defaultStressSettings(): StressSettings {
  return { affects: true, passPos: true, passSpecial: false, special: 1 }
}

/** 词类的名称（各种释义语言）、缩写（带不带点都算）；复合词类连同组成它的词类 */
export function posNames(project: Project, ids: Id[]): string[] {
  const out = new Set<string>()
  const all = ids.flatMap((id) => [
    project.posList.find((x) => x.id === id),
    ...posParts(project, id)
  ])
  for (const p of new Set(all)) {
    if (!p) continue
    for (const n of Object.values(p.name)) if (n?.trim()) out.add(n.trim())
    const abbr = p.abbr.trim()
    if (abbr) {
      out.add(abbr)
      out.add(abbr.replace(/\.$/, ''))
    }
  }
  return [...out]
}

function fromSettings(s: StressSettings | undefined, pos: () => string[]): WordStress | undefined {
  if (!s?.affects) return undefined
  const out: WordStress = {}
  if (s.passPos) out.pos = pos()
  if (s.passSpecial) out.stress = s.special
  return out.pos || out.stress !== undefined ? out : undefined
}

export function lexemeStress(project: Project, l: Lexeme): WordStress | undefined {
  return fromSettings(l.stress, () => posNames(project, lexemePosIds(project, l)))
}

/** 语素没有词类：传它的类型（中英文名都算），再加上「算作」选的词类 */
export function morphemeStress(project: Project, m: Morpheme): WordStress | undefined {
  return fromSettings(m.stress, () => [
    m.type,
    zh.morphemes.types[m.type],
    en.morphemes.types[m.type],
    ...posNames(project, m.stress?.posId ? [m.stress.posId] : [])
  ])
}

const bare = (s: string): string => s.trim().replace(/^[-=]+|[-=]+$/g, '')

/**
 * 测试台里敲的词：这门语言里词头（去掉两头连字符）或语素形式对上、又勾了「对重音影响」的那一个；
 * 词库优先，同形的取第一个。没有返回 undefined。
 */
export function stressForWord(
  project: Project,
  languageId: Id | null | undefined,
  word: string
): WordStress | undefined {
  if (!languageId) return undefined
  const w = bare(word)
  if (!w) return undefined
  for (const l of project.lexemes)
    if (l.languageId === languageId && l.stress?.affects && bare(l.lemma) === w)
      return lexemeStress(project, l)
  for (const m of project.morphemes)
    if (m.languageId === languageId && m.stress?.affects && bare(m.form) === w)
      return morphemeStress(project, m)
  return undefined
}
