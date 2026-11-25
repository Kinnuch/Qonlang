import type { Id, Sentence } from './model'

/** 范围始终从当前可见列表按稳定 ID 计算，不沿用筛选前的行号。 */
export function selectCorpusSentence(
  visible: readonly Id[],
  selected: readonly Id[],
  anchor: Id | null,
  id: Id,
  modifiers: { shift: boolean; toggle: boolean }
): { ids: Id[]; anchor: Id | null } {
  const at = visible.indexOf(id),
    visibleSet = new Set(visible)
  if (at < 0)
    return {
      ids: selected.filter((key) => visibleSet.has(key)),
      anchor: visibleSet.has(anchor ?? '') ? anchor : null
    }
  if (modifiers.shift && anchor && visibleSet.has(anchor)) {
    const from = visible.indexOf(anchor),
      range = visible.slice(Math.min(from, at), Math.max(from, at) + 1)
    return {
      ids: modifiers.toggle
        ? [...new Set([...selected.filter((key) => visibleSet.has(key)), ...range])]
        : range,
      anchor
    }
  }
  if (modifiers.toggle) {
    const current = selected.filter((key) => visibleSet.has(key))
    return {
      ids: current.includes(id) ? current.filter((key) => key !== id) : [...current, id],
      anchor: id
    }
  }
  return { ids: [id], anchor: id }
}

export interface RemovedCorpusSentence {
  index: number
  sentence: Sentence
  beforeId: Id | null
  afterId: Id | null
}

/** 与单删语义一致：仅移除例句，工程内链接保留原字面，撤销后可再次解析。 */
export function removeCorpusSentences(
  sentences: readonly Sentence[],
  ids: readonly Id[],
  visible: readonly Id[]
): { removed: RemovedCorpusSentence[]; remaining: Sentence[] } {
  const allowed = new Set(visible),
    wanted = new Set(ids.filter((id) => allowed.has(id))),
    removed: RemovedCorpusSentence[] = [],
    remaining: Sentence[] = []
  let previous: Id | null = null,
    pending: RemovedCorpusSentence[] = []
  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index]
    if (wanted.has(sentence.id)) {
      const row = { index, sentence, beforeId: previous, afterId: null }
      removed.push(row)
      pending.push(row)
    } else {
      for (const row of pending) row.afterId = sentence.id
      pending = []
      remaining.push(sentence)
      previous = sentence.id
    }
  }
  return { removed, remaining }
}

/** 顺序还原时不覆盖之后新加的例句，也不重复恢复同一个 ID。 */
export function restoreCorpusSentences(
  sentences: readonly Sentence[],
  removed: readonly RemovedCorpusSentence[]
): Sentence[] {
  const existing = new Set(sentences.map((sentence) => sentence.id)),
    present = new Set(existing),
    before = new Map<Id, Sentence[]>(),
    after = new Map<Id, Sentence[]>(),
    tail: Sentence[] = []
  for (const row of removed)
    if (!present.has(row.sentence.id)) {
      present.add(row.sentence.id)
      if (row.afterId && existing.has(row.afterId)) {
        if (!before.has(row.afterId)) before.set(row.afterId, [])
        before.get(row.afterId)!.push(row.sentence)
      } else if (row.beforeId && existing.has(row.beforeId)) {
        if (!after.has(row.beforeId)) after.set(row.beforeId, [])
        after.get(row.beforeId)!.push(row.sentence)
      } else tail.push(row.sentence)
    }
  const result: Sentence[] = []
  for (const sentence of sentences) {
    for (const item of before.get(sentence.id) ?? []) result.push(item)
    result.push(sentence)
    for (const item of after.get(sentence.id) ?? []) result.push(item)
  }
  for (const sentence of tail) result.push(sentence)
  return result
}
