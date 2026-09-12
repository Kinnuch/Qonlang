/**
 * 词条卡里可以调顺序的几块：皮肤页拖着排，顺序存进 `prefs.cardOrder`。
 * 检视器模块（自定义的那些）按各自的「位置」跟着义项、词源走，不在这张表里。
 */
export const CARD_BLOCKS = [
  'senses',
  'tags',
  'etymology',
  'forms',
  'relations',
  'derived',
  'notes'
] as const

export type CardBlock = (typeof CARD_BLOCKS)[number]

/** 用户存的顺序在前，没列到的按默认顺序补在后面 */
export function cardBlocks(order: readonly string[] | undefined): CardBlock[] {
  const known = (order ?? []).filter((k): k is CardBlock =>
    (CARD_BLOCKS as readonly string[]).includes(k)
  )
  return [...new Set([...known, ...CARD_BLOCKS])]
}
