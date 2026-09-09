/**
 * 词源链的纯函数：编辑器、词条卡片、图谱、导出共用。
 * 链条读作「来源 > 中间态… > 词条本身」。
 */
import type { Etymology, EtymologySource, Project } from './model'

/** 词根来源按惯例前面加星号 */
export function etymologyStar(ety: Etymology): string {
  return ety.type === 'root' ? '*' : ''
}

export function sourceForm(project: Project, s: EtymologySource): string {
  if (s.kind === 'morpheme') return project.morphemes.find((m) => m.id === s.id)?.form ?? ''
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
