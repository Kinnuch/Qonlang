export interface ContextMenuItem {
  id: string
  label: string
  enabled?: boolean
  shortcut?: string
  type?: 'separator' | 'checkbox'
  checked?: boolean
}
export interface ContextMenuRequest {
  id: string
  x: number
  y: number
  items: ContextMenuItem[]
}
const shortcuts = new Set([
  'CmdOrCtrl+C',
  'CmdOrCtrl+X',
  'CmdOrCtrl+V',
  'CmdOrCtrl+Z',
  'CmdOrCtrl+Y',
  'CmdOrCtrl+K',
  'CmdOrCtrl+I',
  'CmdOrCtrl+S',
  'CmdOrCtrl+Shift+S',
  'CmdOrCtrl+Enter',
  'Alt+Left',
  'Delete',
  'F2',
  'Enter'
])
/** 渲染层只提交菜单文字和返回标识，不提交可执行代码、原生role或外部路径。 */
export function validContextMenu(value: unknown): value is ContextMenuRequest {
  if (!value || typeof value !== 'object') return false
  const r = value as ContextMenuRequest
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    r.id.length <= 100 &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Array.isArray(r.items) &&
    r.items.length <= 80 &&
    r.items.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        item.id.length <= 100 &&
        typeof item.label === 'string' &&
        item.label.length <= 240 &&
        (item.enabled === undefined || typeof item.enabled === 'boolean') &&
        (item.type === undefined || item.type === 'separator' || item.type === 'checkbox') &&
        (item.shortcut === undefined || shortcuts.has(item.shortcut)) &&
        (item.checked === undefined || typeof item.checked === 'boolean')
    )
  )
}
