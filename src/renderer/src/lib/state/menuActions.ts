/** 原生菜单和页面内右键菜单共用同一套命令，避免保存、返回等行为分叉。 */
import { platform, type MenuAction } from '$lib/platform'
import { projectState } from './project.svelte'
import { ui } from './ui.svelte'
import { chars } from './chars.svelte'
import { reportIssue } from './diagnostics'
import { guideBase } from '$lib/core/guide'

export function runMenuAction(action: MenuAction): void {
  if (action === 'save' && projectState.project) void projectState.save()
  else if (action === 'saveAs' && projectState.project) void projectState.save(true)
  else if (action === 'open') void projectState.open()
  else if (action === 'undo') projectState.undo()
  else if (action === 'redo') projectState.redo()
  else if (action === 'back') {
    if (ui.supportOpen) ui.supportOpen = false
    else ui.back()
  } else if (action === 'palette' && projectState.project) ui.paletteOpen = !ui.paletteOpen
  else if (action === 'chars') chars.toggle()
  else if (action === 'reportIssue') void reportIssue()
  else if (action === 'guide') void platform.openExternal(guideBase())
}
