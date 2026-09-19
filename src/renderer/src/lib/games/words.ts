/**
 * 小游戏用的词：从某门语言的词库里挑出「有写法、有释义」的词。
 * 四种玩法都从这里取词，筛选条件（词类、标签、长度）也都一样。
 */
import type { Id, LocalizedText, Project } from '$lib/core/model'

/** 按 gloss 语言顺序挑一段文字；都没有就随便取一个（不依赖界面语言，方便测） */
function pick(text: LocalizedText, langs: readonly string[]): string {
  for (const l of langs) if (text[l]?.trim()) return text[l]
  return Object.values(text).find((v) => v?.trim()) ?? ''
}

export interface GameWord {
  lexemeId: Id
  /** 词头（几个异写时取第一个） */
  word: string
  /** 释义（第一个义项的第一小段） */
  gloss: string
  posId: Id | null
  tags: string[]
}

export interface WordFilter {
  /** 只要这些词类（空 = 不限） */
  posIds?: Id[]
  /** 只要带这些标签的（空 = 不限） */
  tags?: string[]
  /** 字母数上下限（按 splitLetters 数，不是字符数） */
  minLen?: number
  maxLen?: number
  /** 词里不许有空格、连字符这些（填字、猜词要用） */
  singleWord?: boolean
}

/** 写法里用 `/`、逗号分开写了几个异写时，取第一个 */
export function firstVariant(text: string): string {
  return text.split(/[,，;；/]/)[0].trim()
}

/** 释义取第一小段：逗号、分号、括号前 */
export function shortMeaning(text: string): string {
  const cut = text.split(/[,，;；、]/)[0].trim()
  return cut || text.trim()
}

export function gameWords(
  project: Project,
  languageId: Id,
  filter: WordFilter = {},
  splitter: (w: string) => string[] = (w) => [...w]
): GameWord[] {
  const glossLangs = project.settings.glossLanguages
  const out: GameWord[] = []
  for (const l of project.lexemes) {
    if (l.languageId !== languageId) continue
    const word = firstVariant(l.lemma)
    if (!word) continue
    if (filter.singleWord && /[\s·¢=]/.test(word)) continue
    const def = l.senses.map((s) => pick(s.definition, glossLangs)).find((d) => d && d.trim())
    if (!def) continue
    if (filter.posIds?.length && !(l.posId && filter.posIds.includes(l.posId))) continue
    if (filter.tags?.length && !l.tags.some((tg) => filter.tags!.includes(tg))) continue
    const n = splitter(word).length
    if (filter.minLen && n < filter.minLen) continue
    if (filter.maxLen && n > filter.maxLen) continue
    out.push({
      lexemeId: l.id,
      word,
      gloss: shortMeaning(def),
      posId: l.posId ?? null,
      tags: [...l.tags]
    })
  }
  return out
}

/** 可重现的随机：同一个种子出同一局（填字导出给别人玩时要的） */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

export function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 今天的种子：同一天进来是同一局 */
export function todaySeed(salt = ''): number {
  const d = new Date()
  const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}|${salt}`
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
