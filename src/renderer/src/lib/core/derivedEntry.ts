/**
 * 构形推出来的形式（动名词、分词……）生成一个新词条：词源记成「派生」、来源是原来的词条，
 * 关系里也挂上原来的词条，备注写明是哪个构形的哪一格推出来的。
 * 自由输入的形式没有原来的词条，词源里只记构形和槽位。
 */
import { createLexeme, createSense } from './factory'
import type { Id, Lexeme } from './model'

export interface DerivedEntryInput {
  languageId: Id
  lemma: string
  /** 原来的词条；测试台自由输入时没有 */
  base: Lexeme | null
  paradigmName: string
  slotLabel: string
  posId?: Id | null
  paradigmId?: Id | null
  /** 释义语言 → 释义；全空就不写义项（词库里会标红提醒缺释义） */
  definitions?: Record<string, string>
  tags?: string[]
}

export function createDerivedLexeme(input: DerivedEntryInput): Lexeme {
  const l = createLexeme(input.languageId, input.lemma.trim())
  l.posId = input.posId ?? null
  if (input.paradigmId) l.paradigmId = input.paradigmId
  const defs = Object.fromEntries(
    Object.entries(input.definitions ?? {})
      .map(([k, v]) => [k, v.trim()] as const)
      .filter(([, v]) => v)
  )
  if (Object.keys(defs).length) {
    const s = createSense()
    s.definition = defs
    l.senses = [s]
  } else l.senses = []
  l.tags = [...new Set((input.tags ?? []).map((x) => x.trim()).filter(Boolean))]
  l.etymology = {
    type: 'derivation',
    sources: input.base ? [{ kind: 'lexeme', id: input.base.id }] : [],
    stages: [],
    notes: [input.paradigmName, input.slotLabel].filter(Boolean).join(' · ')
  }
  l.relations = input.base ? [{ kind: 'derivation', lexemeId: input.base.id }] : []
  return l
}
