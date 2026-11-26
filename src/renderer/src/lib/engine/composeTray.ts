/** 候选收纳只认同一译文位置的完整固定锚点，不把范围重叠误当成同义。 */
import type { ComposeCandidate, ComposeOccurrence } from './compose'

export interface ComposeTrayCandidate extends ComposeCandidate {
  /** 词条／语素身份与具体位置的稳定标识，字形、评分和排序变化不影响它。 */
  id: string
  group: string | null
  translation: string
}
export interface ComposeTrayClaim {
  /** 界面提供的实际承载对象，例如 w:<id> 或 piece:<host>:<marker>。 */
  owner: string
  candidateId: string
  group: string | null
}
export interface ComposeTrayOwner {
  owner: string
  lexemeId?: string
  morphemeId?: string
  sourceAt?: number
  sourceEnd?: number
  sourceTranslation?: string
}
export interface ComposeTrayState {
  version: 1
  translation: string
  claims: ComposeTrayClaim[]
  restored: string[]
}
export interface ComposeTrayView {
  candidates: ComposeTrayCandidate[]
  truncated: boolean
}
export const COMPOSE_TRAY_LIMIT = 240

const empty = (translation: string): ComposeTrayState => ({
  version: 1,
  translation,
  claims: [],
  restored: []
})
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** 旧 BenchSaved 没有这一字段时自然得到空状态，不根据同形词猜用户选了哪个位置。 */
export function loadComposeTray(saved: unknown, translation: string): ComposeTrayState {
  if (!record(saved) || saved.version !== 1 || saved.translation !== translation)
    return empty(translation)
  const owners = new Set<string>(),
    claims: ComposeTrayClaim[] = []
  if (Array.isArray(saved.claims))
    for (const claim of saved.claims)
      if (
        record(claim) &&
        typeof claim.owner === 'string' &&
        claim.owner &&
        !owners.has(claim.owner) &&
        typeof claim.candidateId === 'string' &&
        claim.candidateId &&
        (claim.group === null || typeof claim.group === 'string')
      ) {
        owners.add(claim.owner)
        claims.push({ owner: claim.owner, candidateId: claim.candidateId, group: claim.group })
      }
  return {
    version: 1,
    translation,
    claims,
    restored: Array.isArray(saved.restored)
      ? [...new Set(saved.restored.filter((id): id is string => typeof id === 'string' && !!id))]
      : []
  }
}

function footprint(occurrence: ComposeOccurrence, translation: string): string | null {
  if (
    !Number.isInteger(occurrence.at) ||
    !Number.isInteger(occurrence.end) ||
    occurrence.at < 0 ||
    occurrence.end <= occurrence.at ||
    occurrence.end > translation.length ||
    !occurrence.anchors?.length
  )
    return null
  let previousEnd = occurrence.at
  for (const anchor of occurrence.anchors) {
    if (
      !Number.isInteger(anchor.at) ||
      !Number.isInteger(anchor.end) ||
      anchor.at < previousEnd ||
      anchor.end <= anchor.at ||
      anchor.end > occurrence.end
    )
      return null
    previousEnd = anchor.end
  }
  if (
    occurrence.anchors[0].at !== occurrence.at ||
    previousEnd !== occurrence.end ||
    (!occurrence.template && occurrence.anchors.length !== 1)
  )
    return null
  return JSON.stringify([
    occurrence.template,
    occurrence.anchors.map((anchor) => [anchor.at, anchor.end])
  ])
}

/** 同一词在不同位置可以各选一次；旧候选缺少锚点元数据时保留，但不自动收起它的同义项。 */
export function expandComposeCandidates(
  candidates: readonly ComposeCandidate[],
  translation: string,
  limit = COMPOSE_TRAY_LIMIT
): ComposeTrayCandidate[] {
  return expandComposeCandidateView(candidates, translation, limit).candidates
}

/** 候选视图有界；先让每个最终词条保留最佳位置，再补上其余重复位置。 */
export function expandComposeCandidateView(
  candidates: readonly ComposeCandidate[],
  translation: string,
  limit = COMPOSE_TRAY_LIMIT
): ComposeTrayView {
  const found = new Map<string, { candidate: ComposeTrayCandidate; priority: number }>()
  for (const candidate of candidates) {
    const occurrences: (ComposeOccurrence | undefined)[] = candidate.occurrences?.length
      ? candidate.occurrences
      : [undefined]
    for (const occurrence of occurrences) {
      const approximation = occurrence ? occurrence.approximate : candidate.approximate
      const group = occurrence && !approximation ? footprint(occurrence, translation) : null,
        at = occurrence?.at ?? candidate.at,
        end = occurrence?.end ?? candidate.end,
        id = JSON.stringify([candidate.key, at, end ?? null, group])
      if (found.has(id)) continue
      found.set(id, {
        candidate: {
          ...candidate,
          at,
          end,
          matched: occurrence?.matched ?? candidate.matched,
          score: occurrence?.score ?? candidate.score,
          approximate: approximation,
          id,
          group,
          translation
        },
        priority: occurrence?.priority ?? 0
      })
    }
  }
  const sorted = [...found.values()]
    .sort(
      (a, b) =>
        Number(!!a.candidate.approximate) - Number(!!b.candidate.approximate) ||
        a.candidate.at - b.candidate.at ||
        b.priority - a.priority ||
        b.candidate.score - a.candidate.score ||
        a.candidate.surface.localeCompare(b.candidate.surface) ||
        a.candidate.key.localeCompare(b.candidate.key) ||
        a.candidate.id.localeCompare(b.candidate.id)
    )
    .map((entry) => entry.candidate)
  const budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : COMPOSE_TRAY_LIMIT,
    retained = new Set<string>()
  for (const candidate of candidates) {
    if (retained.size >= budget) break
    const best = sorted.find(
      (entry) =>
        entry.key === candidate.key && entry.at === candidate.at && entry.end === candidate.end
    )
    if (best) retained.add(best.id)
  }
  for (const candidate of sorted) {
    if (retained.size >= budget) break
    retained.add(candidate.id)
  }
  return {
    candidates: sorted.filter((candidate) => retained.has(candidate.id)),
    truncated:
      sorted.length > budget || candidates.some((candidate) => candidate.occurrencesTruncated)
  }
}

/** 只保留仍然存在的承载对象；新译文清空收纳，不改界面已经排好的词块。 */
export function reconcileComposeTray(
  state: ComposeTrayState,
  translation: string,
  activeOwners: readonly string[]
): ComposeTrayState {
  if (state.translation !== translation) return empty(translation)
  const owners = new Set(activeOwners),
    claims = state.claims.filter((claim) => owners.has(claim.owner))
  return claims.length === state.claims.length ? state : { ...state, claims }
}

/**
 * 已有原文／手打命中记录只消耗已知身份，不按同形字猜。
 * 多位置而没有可靠来源时仅记数量；不会据此收起任何位置的其他同义项。
 */
export function seedComposeTrayOwners(
  state: ComposeTrayState,
  candidates: readonly ComposeTrayCandidate[],
  owners: readonly ComposeTrayOwner[]
): ComposeTrayState {
  const claimedOwners = new Set(state.claims.map((claim) => claim.owner)),
    used = new Set(state.claims.map((claim) => claim.candidateId)),
    additions: ComposeTrayClaim[] = []
  for (const owner of owners) {
    if (
      !owner.owner ||
      claimedOwners.has(owner.owner) ||
      (!owner.lexemeId && !owner.morphemeId) ||
      (owner.sourceTranslation !== undefined && owner.sourceTranslation !== state.translation)
    )
      continue
    const matches = candidates.filter(
      (candidate) =>
        candidate.translation === state.translation &&
        (owner.lexemeId
          ? candidate.lexemeId === owner.lexemeId
          : candidate.morphemeId === owner.morphemeId)
    )
    const located =
      owner.sourceTranslation === state.translation &&
      Number.isInteger(owner.sourceAt) &&
      Number.isInteger(owner.sourceEnd)
    const positions = located
      ? matches.filter(
          (candidate) => candidate.at === owner.sourceAt && candidate.end === owner.sourceEnd
        )
      : matches.filter((candidate) => !used.has(candidate.id))
    const candidate = positions[0]
    if (!candidate) continue
    const group = located
      ? positions.length === 1
        ? candidate.group
        : null
      : matches.length === 1
        ? candidate.group
        : null
    additions.push({ owner: owner.owner, candidateId: candidate.id, group })
    claimedOwners.add(owner.owner)
    used.add(candidate.id)
  }
  // 补录来源不等于用户重新选择，保留已明确恢复的候选。
  return additions.length ? { ...state, claims: [...state.claims, ...additions] } : state
}

/** 一次明确选择才收起同组项；同组手动恢复的候选在下一次选择后重新归拢。 */
export function claimComposeCandidate(
  state: ComposeTrayState,
  candidate: ComposeTrayCandidate,
  owner: string
): ComposeTrayState {
  if (!owner || state.translation !== candidate.translation) return state
  const peers = (id: string): boolean => {
    try {
      const parsed: unknown = JSON.parse(id)
      return Array.isArray(parsed) && parsed[3] === candidate.group
    } catch {
      return false
    }
  }
  return {
    ...state,
    claims: [
      ...state.claims.filter((claim) => claim.owner !== owner),
      { owner, candidateId: candidate.id, group: candidate.group }
    ],
    restored: state.restored.filter(
      (id) => id !== candidate.id && (candidate.group === null || !peers(id))
    )
  }
}

/** 显式恢复优先于自动收纳；也可恢复已选项来明确重复使用同一词。 */
export function restoreComposeCandidate(state: ComposeTrayState, id: string): ComposeTrayState {
  return state.restored.includes(id) ? state : { ...state, restored: [...state.restored, id] }
}

export function partitionComposeTray(
  candidates: readonly ComposeTrayCandidate[],
  state: ComposeTrayState
): { floating: ComposeTrayCandidate[]; stashed: ComposeTrayCandidate[] } {
  const claimed = new Set(state.claims.map((claim) => claim.candidateId)),
    groups = new Set(state.claims.map((claim) => claim.group).filter((group) => group !== null)),
    restored = new Set(state.restored),
    floating: ComposeTrayCandidate[] = [],
    stashed: ComposeTrayCandidate[] = []
  for (const candidate of candidates) {
    // 防抖旧结果不能借新译文的收纳状态消失；也不能据此建立新 claim。
    if (candidate.translation !== state.translation || restored.has(candidate.id)) {
      floating.push(candidate)
    } else if (claimed.has(candidate.id)) {
      continue
    } else if (candidate.group !== null && groups.has(candidate.group)) {
      stashed.push(candidate)
    } else floating.push(candidate)
  }
  return { floating, stashed }
}

/** 使用当前可见快照按序规划，避免「加全部」把刚刚收起的同义候选也逐一加上。 */
export function planComposeAddAll(
  candidates: readonly ComposeTrayCandidate[],
  state: ComposeTrayState
): ComposeTrayCandidate[] {
  const result: ComposeTrayCandidate[] = [],
    groups = new Set<string>()
  for (const candidate of partitionComposeTray(candidates, state).floating) {
    if (candidate.translation !== state.translation || candidate.approximate) continue
    if (candidate.group !== null) {
      if (groups.has(candidate.group)) continue
      groups.add(candidate.group)
    }
    result.push(candidate)
  }
  return result
}
