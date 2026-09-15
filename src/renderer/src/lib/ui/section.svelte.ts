/** 板块收起 / 展开的记忆：按板块 id 记在本机偏好里。 */
import { ui } from '$lib/state/ui.svelte'

export function sectionCollapsed(id: string): boolean {
  return ui.prefs.collapsedSections?.includes(id) ?? false
}

export function toggleSection(id: string): void {
  const cur = ui.prefs.collapsedSections ?? []
  ui.prefs.collapsedSections = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  void ui.savePrefs()
}

/** 一批条目一起收起或展开（ids 是这批条目各自的记忆 id） */
export function setSectionsCollapsed(ids: string[], collapsed: boolean): void {
  const cur = new Set(ui.prefs.collapsedSections ?? [])
  for (const id of ids) {
    if (collapsed) cur.add(id)
    else cur.delete(id)
  }
  ui.prefs.collapsedSections = [...cur]
  void ui.savePrefs()
}

/** 一批以 prefix 开头的记忆 id 都不用再记着（比如删掉的构形的各个槽位） */
export function forgetSectionsWithPrefix(prefix: string): void {
  const cur = ui.prefs.collapsedSections ?? []
  const next = cur.filter((x) => !x.startsWith(prefix))
  if (next.length === cur.length) return
  ui.prefs.collapsedSections = next
  void ui.savePrefs()
}

/** 条目删掉了，就不用再记着它收没收起 */
export function forgetSection(id: string): void {
  const cur = ui.prefs.collapsedSections ?? []
  if (!cur.includes(id)) return
  ui.prefs.collapsedSections = cur.filter((x) => x !== id)
  void ui.savePrefs()
}
