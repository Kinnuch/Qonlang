import { ui } from './ui.svelte'
import { normalizeGraphSettings, type GraphSettings } from '$lib/ui/graphSettings'

/** 本机、按项目记忆；不向工程文件写入图谱外观或分组。 */
export function readGraphSettings(projectId: string): GraphSettings {
  return normalizeGraphSettings(ui.prefs.lexemeGraphSettingsByProject?.[projectId])
}
export function saveGraphSettings(projectId: string, value: GraphSettings): void {
  ui.prefs.lexemeGraphSettingsByProject = {
    ...ui.prefs.lexemeGraphSettingsByProject,
    [projectId]: normalizeGraphSettings(value)
  }
  ui.savePrefsSoon()
}
export function readGraphPanelCollapsed(projectId: string): boolean {
  return ui.prefs.lexemeGraphPanelCollapsedByProject?.[projectId] === true
}
export function saveGraphPanelCollapsed(projectId: string, collapsed: boolean): void {
  ui.prefs.lexemeGraphPanelCollapsedByProject = {
    ...ui.prefs.lexemeGraphPanelCollapsedByProject,
    [projectId]: collapsed === true
  }
  ui.savePrefsSoon()
}
