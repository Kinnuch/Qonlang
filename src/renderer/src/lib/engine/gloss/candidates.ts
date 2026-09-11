/**
 * 语料悬浮挑候选：一个词整词对得上几个同形词条时，按意思线索排——
 * 先看本句译文，再看别处确认过的与别的例句译文。纯函数，界面只负责喂数据。
 */
import type { Id, Sentence, Token } from '$lib/core/model'

// 汉字、假名、谚文按字串比（与 glossMatch 一致）
const CJK = /[一-鿿぀-ヿ가-힯]/

/** 释义、译文切成片段：中文按标点切成串，拉丁按词；【文】〔一价〕这类标注与过短的词（a、in）不算 */
export function meaningPieces(text: string): string[] {
  return text
    .replace(/【[^】]*】|〔[^〕]*〕/g, ' ')
    .split(/[-=<>·.．,，、;；:：()（）[\]\s“”"'…/|!?！？。]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length >= (CJK.test(p) ? 1 : 3))
}

const memo = new Map<string, string[]>()
/** 同一段文字只切一次：译文与释义在每次重绘时都会被问到 */
export function piecesOf(text: string): string[] {
  let hit = memo.get(text)
  if (!hit) {
    if (memo.size > 50000) memo.clear()
    hit = meaningPieces(text)
    memo.set(text, hit)
  }
  return hit
}

/** 片段重合：中文按字串包含，拉丁按整词相等 */
export function piecesOverlap(def: string[], hint: string[]): boolean {
  return def.some((d) =>
    CJK.test(d) ? hint.some((h) => h.includes(d) || d.includes(h)) : hint.includes(d)
  )
}

/** 词形的比较键：NFC、小写 */
export function surfaceKey(surface: string): string {
  return surface.normalize('NFC').toLowerCase()
}

export interface SurfaceEvidence {
  /** 出现这个词形的例句，带切好的译文片段 */
  hints: { sentenceId: Id; pieces: string[] }[]
  /** 这个词形在各处确认成了哪个词条、确认了几处 */
  confirmed: Map<Id, number>
}

/** 一门语言里每个词形的旁证 */
export function collectEvidence(
  sentences: Sentence[],
  languageId: Id
): Map<string, SurfaceEvidence> {
  const map = new Map<string, SurfaceEvidence>()
  for (const s of sentences) {
    if (s.languageId !== languageId) continue
    const tr = Object.values(s.translation).join('；')
    const pieces = tr.trim() ? piecesOf(tr) : null
    const seen = new Set<string>()
    for (const tk of s.tokens) {
      const key = surfaceKey(tk.surface)
      let ev = map.get(key)
      if (!ev) {
        ev = { hints: [], confirmed: new Map() }
        map.set(key, ev)
      }
      const a = tk.analyses[tk.chosen]
      if (tk.confirmed && a?.lexemeId)
        ev.confirmed.set(a.lexemeId, (ev.confirmed.get(a.lexemeId) ?? 0) + 1)
      if (pieces && !seen.has(key)) {
        seen.add(key)
        ev.hints.push({ sentenceId: s.id, pieces })
      }
    }
  }
  return map
}

/** 分析里整词对得上的同形词条（只有一段、带词条；剥词缀猜出来的不算），外加当前选中的那条 */
export function homographIds(tk: Token): Id[] {
  const ids = new Set<Id>()
  const a = tk.analyses[tk.chosen]
  if (a?.lexemeId) ids.add(a.lexemeId)
  for (const x of tk.analyses) if (x.lexemeId && x.morphs.length === 1) ids.add(x.lexemeId)
  return [...ids]
}

/**
 * 几个同形词条按意思线索排：先看这句自己的译文，只有一条对得上就是它；
 * 否则看别的例句——同一个词在别处确认成了哪条（每处 2 分）、出现它的句子译文里提到了哪条（每句 1 分，最多看 20 句）。
 * 有一条明显胜出就只剩它；分不出来就按得分并排给最多四条，同分保持原顺序（当前选中的在前）。
 */
export function rankHomographs(
  ids: Id[],
  sentence: Sentence,
  evidence: SurfaceEvidence | undefined,
  definitionPieces: (id: Id) => string[]
): Id[] {
  if (ids.length <= 1) return ids
  const defs = new Map(ids.map((id) => [id, definitionPieces(id)]))
  let pool = ids
  const own = Object.values(sentence.translation).join('；')
  if (own.trim()) {
    const ownPieces = piecesOf(own)
    const hit = ids.filter((id) => piecesOverlap(defs.get(id) ?? [], ownPieces))
    if (hit.length === 1) return hit
    if (hit.length > 1) pool = hit
  }
  const score = new Map(pool.map((id) => [id, (evidence?.confirmed.get(id) ?? 0) * 2]))
  let n = 0
  for (const h of evidence?.hints ?? []) {
    if (h.sentenceId === sentence.id) continue
    for (const id of pool)
      if (piecesOverlap(defs.get(id) ?? [], h.pieces)) score.set(id, (score.get(id) ?? 0) + 1)
    if (++n >= 20) break
  }
  const ranked = [...pool].sort((x, y) => (score.get(y) ?? 0) - (score.get(x) ?? 0))
  const top = score.get(ranked[0]) ?? 0
  if (top > 0 && (score.get(ranked[1]) ?? 0) < top) return [ranked[0]]
  return ranked.slice(0, 4)
}
