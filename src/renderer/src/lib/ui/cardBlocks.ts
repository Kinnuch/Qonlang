/**
 * 词条卡里可以调顺序的几块：皮肤页拖着排，顺序存进 `prefs.cardOrder`。
 * 检视器模块（自定义的那些）按各自的「位置」跟着义项、词源走，不在这张表里。
 */
export const CARD_BLOCKS = [
  'senses',
  'tags',
  'etymology',
  'history',
  'stems',
  'forms',
  'relations',
  'derived',
  'notes'
] as const

export type CardBlock = (typeof CARD_BLOCKS)[number]

/** 可以单独调字号的块：词头那一段，加上上面这七块 */
export const CARD_SCALABLE = ['header', ...CARD_BLOCKS] as const
export type CardScalable = (typeof CARD_SCALABLE)[number]

/** 词条卡正文的默认字号（px，跟 LexemeCard 里 .entry 的一样）；块里的字号都按 em 跟着它走 */
export const CARD_BASE_PX = 15
export const CARD_SIZE_MIN = 10
export const CARD_SIZE_MAX = 30

/** 某一块的字号（px）：没单独调过就是默认字号 */
export function blockSize(sizes: Record<string, number> | undefined, key: string): number {
  const v = Math.round(Number(sizes?.[key]))
  return v >= CARD_SIZE_MIN && v <= CARD_SIZE_MAX ? v : CARD_BASE_PX
}

/**
 * 0.8.0 存的是「整张卡的倍数 × 每块的倍数」，换算成每块的字号（px）；
 * 算出来就是默认字号的块不记。
 */
export function sizesFromScales(cardScale: unknown, blockScales: unknown): Record<string, number> {
  const whole = Number(cardScale)
  const w = whole >= 0.5 && whole <= 3 ? whole : 1
  const scales = (blockScales && typeof blockScales === 'object' ? blockScales : {}) as Record<
    string,
    unknown
  >
  const out: Record<string, number> = {}
  for (const key of CARD_SCALABLE) {
    const b = Number(scales[key])
    const px = Math.round(CARD_BASE_PX * w * (b >= 0.5 && b <= 3 ? b : 1))
    const clamped = Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, px))
    if (clamped !== CARD_BASE_PX) out[key] = clamped
  }
  return out
}

/** 用户存的顺序在前，没列到的按默认顺序补在后面 */
export function cardBlocks(order: readonly string[] | undefined): CardBlock[] {
  const known = (order ?? []).filter((k): k is CardBlock =>
    (CARD_BLOCKS as readonly string[]).includes(k)
  )
  return [...new Set([...known, ...CARD_BLOCKS])]
}
