/**
 * 隔开写的词：词头里用 `…`（或 `...`）分成几段的词条，比如 `ma…gò`「否定（对于句子）」，
 * 在语料里是 `ma 某某某 gò` 这样隔着几个词出现的。这里按顺序在一句里找出这些段，
 * 让每一段都挂上同一个词条（gloss 一样），文字那边也能一段一段写。纯函数。
 */
import type { Id, Lexeme, Project, Token } from '$lib/core/model'

/** 段与段之间最多隔多少个词 */
const MAX_GAP = 12

const norm = (s: string): string =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/^[-=·]+|[-=·]+$/gu, '')
    .trim()

/** 词头按 `…` / `...` 拆成几段；不足两段的（`hi…` 这种只标了位置的）不算 */
export function splitParts(lemma: string): string[] {
  if (!/…|\.{3,}/u.test(lemma)) return []
  const parts = lemma
    .split(/…+|\.{3,}/u)
    .map((x) => norm(x))
    .filter(Boolean)
  return parts.length >= 2 ? parts : []
}

export interface Discontinuous {
  lexeme: Lexeme
  parts: string[]
}

/** 项目一改就重算：短语页一屏要分析几十段，每段都把整个词库筛一遍太亏 */
let entryCache = new WeakMap<Project, { stamp: string; byLang: Map<Id, Discontinuous[]> }>()
export function clearDiscontinuousCache(): void {
  entryCache = new WeakMap()
}

/** 这门语言里隔开写的词条，段多的排前面（`nja…hi…kja` 比 `nja…kja` 先试） */
export function discontinuousEntries(project: Project, languageId: Id): Discontinuous[] {
  const stamp = `${project.meta.updatedAt}|${project.lexemes.length}`
  let c = entryCache.get(project)
  if (!c || c.stamp !== stamp) {
    c = { stamp, byLang: new Map() }
    entryCache.set(project, c)
  }
  const hit = c.byLang.get(languageId)
  if (hit) return hit
  const out: Discontinuous[] = []
  for (const l of project.lexemes) {
    if (l.languageId !== languageId) continue
    const parts = splitParts(l.lemma)
    if (parts.length) out.push({ lexeme: l, parts })
  }
  out.sort((a, b) => b.parts.length - a.parts.length)
  c.byLang.set(languageId, out)
  return out
}

export interface DiscontinuousHit {
  lexeme: Lexeme
  /** 每一段落在第几个词上 */
  positions: number[]
}

/**
 * 在一句的词里按顺序找这些段：第一段对上之后，往后最多隔 MAX_GAP 个词找下一段。
 * 一个词只归一处；已经确认过的词不占用（用户自己挑过的不动）
 */
export function matchDiscontinuous(
  entries: Discontinuous[],
  tokens: readonly Token[],
  isTaken: (i: number) => boolean = () => false
): DiscontinuousHit[] {
  const words = tokens.map((t) => norm(t.surface))
  const used = new Set<number>()
  const out: DiscontinuousHit[] = []
  for (const { lexeme, parts } of entries) {
    for (let start = 0; start < words.length; start++) {
      if (used.has(start) || isTaken(start) || words[start] !== parts[0]) continue
      const positions = [start]
      let at = start
      for (let p = 1; p < parts.length; p++) {
        let found = -1
        for (let k = at + 1; k < Math.min(words.length, at + 1 + MAX_GAP); k++) {
          if (used.has(k) || isTaken(k)) continue
          if (words[k] === parts[p]) {
            found = k
            break
          }
        }
        if (found < 0) {
          positions.length = 0
          break
        }
        positions.push(found)
        at = found
      }
      if (positions.length === parts.length) {
        for (const i of positions) used.add(i)
        out.push({ lexeme, positions })
        start = positions[positions.length - 1]
      }
    }
  }
  return out
}
