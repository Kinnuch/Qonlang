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
