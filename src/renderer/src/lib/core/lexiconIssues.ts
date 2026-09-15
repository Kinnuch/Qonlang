/**
 * 词库里要提醒的问题：缺释义（红）、同一门语言里词头重复（黄）。
 * 词库列表按它标行，底部右侧的状态栏按它计数、悬浮列出是哪些词条。
 */
import type { Id, Lexeme } from './model'

export type LexemeIssueKind = 'noDefinition' | 'duplicate'

export interface LexemeIssue {
  lexemeId: Id
  lemma: string
  kind: LexemeIssueKind
  severity: 'error' | 'warning'
}

/** 至少一个义项在任一释义语言里写了东西 */
export function lexemeHasDefinition(l: Lexeme): boolean {
  return l.senses.some((s) => Object.values(s.definition).some((v) => !!v && !!v.trim()))
}

export function lexiconIssues(lexemes: Lexeme[]): LexemeIssue[] {
  const count = new Map<string, number>()
  for (const l of lexemes) {
    const k = l.languageId + ' ' + l.lemma
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  const out: LexemeIssue[] = []
  for (const l of lexemes) {
    if (!lexemeHasDefinition(l))
      out.push({ lexemeId: l.id, lemma: l.lemma, kind: 'noDefinition', severity: 'error' })
    if (l.lemma && (count.get(l.languageId + ' ' + l.lemma) ?? 0) > 1)
      out.push({ lexemeId: l.id, lemma: l.lemma, kind: 'duplicate', severity: 'warning' })
  }
  return out
}
