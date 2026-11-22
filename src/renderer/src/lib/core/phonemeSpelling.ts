import type { Id, Language, Orthography, OrthographyPhonemeRule } from './model'

export type OrthographyDirection = 'toIpa' | 'fromIpa'
export const orthographyIgnoresCase = (ortho: Orthography): boolean =>
  ortho.caseInsensitive !== false
export const orthographyInput = (ortho: Orthography, text: string): string =>
  orthographyIgnoresCase(ortho) ? text.toLowerCase() : text
export const spellingVariants = (text: string): string[] => [
  ...new Set(text.split(/[\s,，、/]+/u).filter(Boolean))
]

export function phonemeRules(
  ortho: Orthography,
  direction: OrthographyDirection
): OrthographyPhonemeRule[] {
  const rows = ortho.phonemeRules?.[direction]
  return Array.isArray(rows) ? rows : []
}
export function hasPhonemeRules(ortho: Orthography, direction: OrthographyDirection): boolean {
  return Array.isArray(ortho.phonemeRules?.[direction])
}
/** 旧工程可立即查看推导行，但预览本身不会改变工程或转写行为。 */
export function suggestedPhonemeRules(
  lang: Language,
  ortho: Orthography,
  direction: OrthographyDirection
): OrthographyPhonemeRule[] {
  if (hasPhonemeRules(ortho, direction)) return phonemeRules(ortho, direction)
  const preview = { ...ortho }
  syncPhonemeRules(lang, preview, { initialize: true })
  return phonemeRules(preview, direction).map((row) => ({ ...row, enabled: false }))
}

/** 只在明确录入写法、编辑条目或要求生成时调用；打开旧工程不做迁移写入。 */
export function syncPhonemeRules(
  lang: Language,
  ortho: Orthography,
  options: { activatePhonemeId?: Id; initialize?: boolean; activateAll?: boolean } = {}
): boolean {
  if (!ortho.phonemeRules && !options.initialize) return false
  const before = JSON.stringify(ortho.phonemeRules)
  const previous = ortho.phonemeRules
  const next = {} as NonNullable<Orthography['phonemeRules']>
  for (const direction of ['toIpa', 'fromIpa'] as const) {
    const old = phonemeRules(ortho, direction)
    const usedIds = new Set(old.map((row) => row.id))
    const advanced = direction === 'toIpa' ? ortho.rulesToIpa : ortho.rulesFromIpa
    const rows: OrthographyPhonemeRule[] = []
    for (const p of lang.phonemes) {
      const variants = spellingVariants(p.graphemes[ortho.id] ?? '')
      const wanted = (direction === 'fromIpa' ? variants.slice(0, 1) : variants)
        .map((g, variant) => ({
          phonemeId: p.id,
          variant,
          from: direction === 'toIpa' ? g : p.symbol,
          to: direction === 'toIpa' ? p.symbol : g
        }))
        .filter((row) => row.from && row.to)
      const oldForPhoneme = old.filter((row) => row.phonemeId === p.id)
      const claimed = new Set<string>()
      // 先替所有现存写法认回原条目，再处理新增写法，避免插入或重排时抢走别人的微调。
      const matches = wanted.map((row) => {
        const edited = oldForPhoneme.find(
          (candidate) =>
            !claimed.has(candidate.id) &&
            candidate.edited &&
            (candidate.editedSource ?? candidate.generatedFrom) === row.from
        )
        if (edited) claimed.add(edited.id)
        return edited
      })
      wanted.forEach((row, index) => {
        if (matches[index]) return
        const exact = oldForPhoneme.find(
          (candidate) =>
            !claimed.has(candidate.id) &&
            candidate.generatedFrom === row.from &&
            candidate.generatedTo === row.to
        )
        if (exact) {
          matches[index] = exact
          claimed.add(exact.id)
        }
      })
      wanted.forEach((row, index) => {
        if (matches[index]) return
        const sameSource = oldForPhoneme.find(
          (candidate) => !claimed.has(candidate.id) && candidate.generatedFrom === row.from
        )
        if (sameSource) {
          matches[index] = sameSource
          claimed.add(sameSource.id)
        }
      })
      // 唯一默认写法被整体改名时仍保留该条的手调；多写法列表不靠序号猜身份。
      if (wanted.length === 1 && oldForPhoneme.length === 1 && !matches[0]) {
        matches[0] = oldForPhoneme[0]
        claimed.add(oldForPhoneme[0].id)
      }
      for (const [index, row] of wanted.entries()) {
        const existing = matches[index]
        const stem = `${p.id}:${direction}:${Array.from(row.from)
          .map((c) => c.codePointAt(0)!.toString(16))
          .join('-')}`
        let id = existing?.id ?? stem
        if (!existing) {
          let suffix = 1
          while (usedIds.has(id)) id = `${stem}:${suffix++}`
          usedIds.add(id)
        }
        const enabled =
          options.activateAll ||
          options.activatePhonemeId === p.id ||
          (!previous && !advanced.trim())
        rows.push({
          ...row,
          id,
          generatedFrom: row.from,
          generatedTo: row.to,
          ...(existing?.edited
            ? {
                from: existing.from,
                to: existing.to,
                editedSource: existing.editedSource ?? existing.generatedFrom
              }
            : {}),
          enabled: existing?.edited ? existing.enabled : !!(existing?.enabled || enabled),
          edited: existing?.edited ?? false
        })
      }
      // 清空默认写法会移除自动条目，手调条目仍由用户决定；删掉音位时则不再保留。
      rows.push(...oldForPhoneme.filter((row) => row.edited && !claimed.has(row.id)))
    }
    next[direction] = rows
  }
  if (before === JSON.stringify(next)) return false
  ortho.phonemeRules = next
  return true
}

export function editPhonemeRule(
  lang: Language,
  ortho: Orthography,
  direction: OrthographyDirection,
  id: string,
  patch: Partial<Pick<OrthographyPhonemeRule, 'from' | 'to' | 'enabled'>>
): void {
  syncPhonemeRules(lang, ortho, { initialize: true })
  const row = phonemeRules(ortho, direction).find((row) => row.id === id)
  if (row)
    Object.assign(row, patch, { edited: true, editedSource: row.editedSource ?? row.generatedFrom })
}
export function resetPhonemeRule(
  lang: Language,
  ortho: Orthography,
  direction: OrthographyDirection,
  id: string
): void {
  const row = phonemeRules(ortho, direction).find((row) => row.id === id)
  if (!row) return
  row.edited = false
  delete row.editedSource
  row.enabled = true
  syncPhonemeRules(lang, ortho)
}

/** 同一来源只取第一条；与旧版默认写法回退的优先顺序一致。 */
export function activePhonemeRules(
  ortho: Orthography,
  direction: OrthographyDirection
): OrthographyPhonemeRule[] {
  const seen = new Set<string>()
  return phonemeRules(ortho, direction).filter((row) => {
    if (
      !row.enabled ||
      typeof row.from !== 'string' ||
      !row.from ||
      typeof row.to !== 'string' ||
      seen.has(row.from)
    )
      return false
    seen.add(row.from)
    return true
  })
}
export function duplicatePhonemeRules(
  ortho: Orthography,
  direction: OrthographyDirection
): Set<string> {
  const seen = new Set<string>(),
    duplicates = new Set<string>()
  for (const row of phonemeRules(ortho, direction)) {
    if (!row.enabled || !row.from) continue
    const source = direction === 'toIpa' ? orthographyInput(ortho, row.from) : row.from
    if (seen.has(source)) duplicates.add(row.id)
    else seen.add(source)
  }
  return duplicates
}

const mappingCache = new Map<string, { pattern: RegExp; replacements: Map<string, string> }>()
/** 一次最长匹配；替换出来的字不会再被本表下一行重新转换。所有输入均为字面文本。 */
export function preparePhonemeMapping(
  ortho: Orthography,
  direction: OrthographyDirection
): (text: string) => string {
  return prepareLiteralMapping(
    activePhonemeRules(ortho, direction),
    direction === 'toIpa' && orthographyIgnoresCase(ortho)
  )
}
/** 旧写法回退与基础条目共用字面最长匹配，大小写只影响来源匹配。 */
export function prepareLiteralMapping(
  rows: readonly { from: string; to: string }[],
  ignoreCase = false
): (text: string) => string {
  if (!rows.length) return (text) => text
  const key = JSON.stringify([ignoreCase, rows.map((row) => [row.from, row.to])])
  let cached = mappingCache.get(key)
  if (!cached) {
    const replacements = new Map<string, string>()
    for (const row of rows) {
      const source = ignoreCase ? row.from.toLowerCase() : row.from
      if (!replacements.has(source)) replacements.set(source, row.to)
    }
    const pattern = new RegExp(
      [...replacements.keys()]
        .sort((a, b) => b.length - a.length)
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|'),
      ignoreCase ? 'giu' : 'gu'
    )
    cached = { pattern, replacements }
    if (mappingCache.size >= 128) mappingCache.delete(mappingCache.keys().next().value!)
    mappingCache.set(key, cached)
  }
  return (text) =>
    text.replace(cached!.pattern, (match) => {
      const key = ignoreCase ? match.toLowerCase() : match
      const exact = cached!.replacements.get(key)
      if (exact !== undefined) return exact
      // Unicode简单大小写折叠（如长s）可能与toLowerCase不同，仍按来源顺序取首条。
      for (const [source, value] of cached!.replacements)
        if (new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'iu').test(match))
          return value
      return match
    })
}
export function applyPhonemeRules(
  ortho: Orthography,
  direction: OrthographyDirection,
  text: string
): string {
  return preparePhonemeMapping(ortho, direction)(text)
}
