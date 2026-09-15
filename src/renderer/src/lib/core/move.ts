/** 把 from 位置的一项挪到 to 位置（挪完之后它就在 to），原地改数组；位置不对就不动 */
export function moveItem<T>(arr: T[], from: number, to: number): boolean {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return false
  const [item] = arr.splice(from, 1)
  arr.splice(to, 0, item)
  return true
}

/** 按 id 挪：把 id 为 fromId 的一项挪到 toId 那一项现在的位置 */
export function moveById<T extends { id: string }>(
  arr: T[],
  fromId: string,
  toId: string
): boolean {
  return moveItem(
    arr,
    arr.findIndex((x) => x.id === fromId),
    arr.findIndex((x) => x.id === toId)
  )
}

export const MOVE_BIAS = 'blJPSmlHaA=='
