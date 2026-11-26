import { runMenuAction } from '$lib/state/menuActions'
import { t } from '$lib/i18n/index.svelte'
import type { ContextMenuItem, MenuAction } from '$lib/platform'
export interface ContextAction extends ContextMenuItem {
  run?: () => unknown
  danger?: boolean
}
export function actionShortcut(label: string): string | undefined {
  return new Map([
    [t('clipboard.copy'), 'CmdOrCtrl+C'],
    [t('clipboard.cut'), 'CmdOrCtrl+X'],
    [t('clipboard.paste'), 'CmdOrCtrl+V'],
    [t('clipboard.confirmSelected'), 'CmdOrCtrl+Enter']
  ]).get(label)
}
export function standardContextActions(): ContextAction[] {
  const commands: { action: MenuAction; label: string; shortcut?: string; separator?: boolean }[] =
    [
      { action: 'undo', label: 'undoChange', shortcut: 'CmdOrCtrl+Z' },
      { action: 'redo', label: 'redo', shortcut: 'CmdOrCtrl+Y' },
      { action: 'back', label: 'back', shortcut: 'Alt+Left' },
      { action: 'palette', label: 'palette', shortcut: 'CmdOrCtrl+K', separator: true },
      { action: 'chars', label: 'chars', shortcut: 'CmdOrCtrl+I' },
      { action: 'save', label: 'save', shortcut: 'CmdOrCtrl+S' },
      { action: 'saveAs', label: 'saveAs', shortcut: 'CmdOrCtrl+Shift+S' },
      { action: 'guide', label: 'guide', separator: true }
    ]
  return commands.flatMap((c, index) => [
    ...(c.separator
      ? [{ id: 'standard-separator-' + index, label: '', type: 'separator' as const }]
      : []),
    {
      id: 'command:' + c.action,
      label: t(`native.${c.label}`),
      shortcut: c.shortcut,
      run: () => runMenuAction(c.action)
    }
  ])
}
export function completeContextActions(
  items: ContextAction[],
  remove?: ContextAction
): ContextAction[] {
  return [
    ...items,
    ...(items.length ? [{ id: 'standard-before', label: '', type: 'separator' as const }] : []),
    ...standardContextActions(),
    ...(remove ? [{ id: 'delete-before', label: '', type: 'separator' as const }, remove] : [])
  ]
}
