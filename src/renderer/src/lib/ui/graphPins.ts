import type { ForcePosition } from '$lib/graph/forceLayout'

/** 按工程和中心词记下手动固定的节点，存图上的坐标，不受平移或缩放影响。 */
export function graphPinStorage(
  projectId: string,
  centerKey: string
): {
  read(): Map<string, ForcePosition>
  save(pins: ReadonlyMap<string, ForcePosition>): void
} {
  const key = 'qonlang.graph.pins.v1:' + JSON.stringify([projectId, centerKey])
  function read(): Map<string, ForcePosition> {
    const pins = new Map<string, ForcePosition>()
    try {
      const rows: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
      if (Array.isArray(rows))
        for (const row of rows) {
          if (!Array.isArray(row)) continue
          const [id, x, y] = row
          if (typeof id === 'string' && Number.isFinite(x) && Number.isFinite(y))
            pins.set(id, { x, y, pinned: true })
        }
    } catch {
      /* 浏览器禁用存储时仍能查看图谱。 */
    }
    return pins
  }
  function save(pins: ReadonlyMap<string, ForcePosition>): void {
    try {
      if (!pins.size) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify([...pins].map(([id, p]) => [id, p.x, p.y])))
    } catch {
      /* 存储不可用时，本次打开的画布仍保留位置。 */
    }
  }
  return { read, save }
}
