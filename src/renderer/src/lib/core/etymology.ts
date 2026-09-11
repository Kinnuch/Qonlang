/**
 * 词源链的纯函数：编辑器、词条卡片、图谱、导出共用。
 * 链条读作「来源 > 中间态… > 词条本身」。
 */
import type { Etymology, EtymologySource, Morpheme, Project } from './model'

/** 语素的显示形式：环缀写成「前半…后半」，别的就是形式本身 */
export function morphemeLabel(m: Morpheme | undefined | null): string {
  if (!m) return ''
  return m.type === 'circumfix' && m.form2 ? `${m.form}…${m.form2}` : m.form
}

/** 词根来源按惯例前面加星号 */
export function etymologyStar(ety: Etymology): string {
  return ety.type === 'root' ? '*' : ''
}

export function sourceForm(project: Project, s: EtymologySource): string {
  if (s.kind === 'morpheme') return morphemeLabel(project.morphemes.find((m) => m.id === s.id))
  if (s.kind === 'lexeme') return project.lexemes.find((m) => m.id === s.id)?.lemma ?? ''
  return s.form
}

/** 每一步一组形式；第一步是来源（复合词有多个），最后一步是词条本身 */
export function etymologyChain(project: Project, ety: Etymology, ownerForm: string): string[][] {
  const star = etymologyStar(ety)
  const origin = ety.sources.map((s) => sourceForm(project, s)).filter(Boolean)
  return [
    origin.map((f) => star + f),
    ...ety.stages.map((s) => (s.form ? [s.form] : [])),
    ownerForm ? [ownerForm] : []
  ]
}

/** 「*kal + *tar > kaltar > kaldar」；空步骤省略 */
export function etymologyText(project: Project, ety: Etymology, ownerForm = ''): string {
  return etymologyChain(project, ety, ownerForm)
    .filter((step) => step.length)
    .map((step) => step.join(' + '))
    .join(' > ')
}

/** 链条起点：给词库的「来源」列用 */
export function etymologyOrigin(project: Project, ety: Etymology): string {
  const star = etymologyStar(ety)
  return ety.sources
    .map((s) => sourceForm(project, s))
    .filter(Boolean)
    .map((f) => star + f)
    .join(' + ')
}

/** 拆分符：项目里的语素边界，再加上复合常用的 + 与空格 */
function splitters(project: Project): string[] {
  const set = new Set([...project.settings.morphemeBoundaries, '+', ' ', '·', '-'])
  return [...set].filter(Boolean)
}

/**
 * 把「gēs-sal」「seuk-(é)-rēn」「a + b」这样拼接的来源形拆成成分，去掉括号与星号。
 * 拆不开就是它本身一项。
 */
export function splitSourceForm(project: Project, form: string): string[] {
  const seps = splitters(project)
  let pieces = [form]
  for (const sep of seps) pieces = pieces.flatMap((p) => p.split(sep))
  return pieces
    .map((p) =>
      p
        .replace(/^\*+/, '')
        .replace(/^\((.*)\)$/, '$1')
        .trim()
    )
    .filter(Boolean)
}

/** 上下标数字换成普通数字（h₁ → h1）；kʷ、tʰ 这类修饰字母不动，它们是不同的音 */
const plainDigits = (s: string): string =>
  s
    .replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080))
    .replace(/[⁰¹²³⁴-⁹]/g, (d) => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(d)))

/**
 * 模糊匹配用的键：上下标数字换成普通数字、去掉所有变音符、转小写，
 * 再去掉这门语言设置里要忽略的字符。
 */
export function looseKey(s: string, ignore = ''): string {
  let x = plainDigits(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (ignore) {
    const drop = new Set(
      Array.from(plainDigits(ignore).normalize('NFD').toLowerCase()).filter(
        (c) => !/\s/.test(c) && !/\p{M}/u.test(c)
      )
    )
    x = Array.from(x)
      .filter((c) => !drop.has(c))
      .join('')
  }
  return x.trim()
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/** 按语言名或缩写找项目里的语言；找不到返回 null */
export function findLanguageByName(
  project: Project,
  name: string
): Project['languages'][number] | null {
  const q = name.trim().toLowerCase()
  if (!q) return null
  return (
    project.languages.find((l) => l.name.trim().toLowerCase() === q) ??
    project.languages.find((l) => l.abbr.trim().toLowerCase() === q) ??
    null
  )
}

export type ResolvedForm = { kind: 'lexeme'; id: string } | { kind: 'morpheme'; id: string } | null

/**
 * 在某门语言里找这个形式对应的词条或语素（先精确，再忽略大小写，再忽略变音符）。
 * languageName 为空或不在项目里时，在所有语言里找。
 */
export function resolveFormInLanguage(
  project: Project,
  languageName: string,
  form: string
): ResolvedForm {
  const lang = findLanguageByName(project, languageName)
  const inLang = <T extends { languageId: string }>(xs: T[]): T[] =>
    lang ? xs.filter((x) => x.languageId === lang.id) : xs
  const clean = form.replace(/^\*+/, '').trim()
  if (!clean) return null
  const strip = (s: string): string => s.replace(/^[-=*·]+|[-=·]+$/g, '')
  const lexemes = inLang(project.lexemes)
  const morphemes = inLang(project.morphemes)
  const tryMatch = (eq: (a: string, b: string, languageId: string) => boolean): ResolvedForm => {
    const l = lexemes.find((x) => eq(strip(x.lemma), clean, x.languageId))
    if (l) return { kind: 'lexeme', id: l.id }
    const m = morphemes.find((x) => eq(strip(x.form), clean, x.languageId))
    if (m) return { kind: 'morpheme', id: m.id }
    return null
  }
  // 最宽松的一档按候选自己那门语言的忽略字符比（没指定语言时各算各的）；查询这边的键按语言缓存
  const ignoreOf = new Map(project.languages.map((l) => [l.id, l.matchIgnore ?? '']))
  const queryKeys = new Map<string, string>()
  const queryKey = (languageId: string): string => {
    let k = queryKeys.get(languageId)
    if (k === undefined) {
      k = looseKey(clean, ignoreOf.get(languageId) ?? '')
      queryKeys.set(languageId, k)
    }
    return k
  }
  return (
    tryMatch((a, b) => a === b) ??
    tryMatch((a, b) => a.toLowerCase() === b.toLowerCase()) ??
    tryMatch((a, b) => fold(a) === fold(b)) ??
    // 最宽松：按语言设置去掉 H1 / H2 的数字、词根里的点这类符号再比
    tryMatch((a, _b, languageId) => {
      const kb = queryKey(languageId)
      return kb.length > 0 && looseKey(a, ignoreOf.get(languageId) ?? '') === kb
    })
  )
}
