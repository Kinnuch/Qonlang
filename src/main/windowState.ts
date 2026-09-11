/**
 * 窗口大小与位置的记录（window.json）：默认值、旧记录放宽一次、放进屏幕的工作区。纯函数，不碰 Electron，好测。
 */

/** 默认窗口大小：首页打开右侧面板时，底部那排按钮还能排成一行（放不下就占满工作区） */
export const DEFAULT_WIDTH = 1580
export const DEFAULT_HEIGHT = 860
/** window.json 的格式版本：2 起默认宽度加宽了，旧记录比它窄的放宽一次 */
export const WINDOW_STATE_VERSION = 2

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
  v?: number
}

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 旧版记下的窗口比新的默认宽度窄就放宽一次；比工作区大的缩进去；放宽后右边出了工作区就往左挪回来。
 * 新格式的记录（v2 起）是用户自己拖出来的大小，只在放不下时缩。
 */
export function fitWindowState(ws: WindowState, area: WorkArea): WindowState {
  const out = { ...ws }
  const widened = (out.v ?? 1) < WINDOW_STATE_VERSION && out.width < DEFAULT_WIDTH
  if (widened) out.width = DEFAULT_WIDTH
  out.width = Math.min(out.width, area.width)
  out.height = Math.min(out.height, area.height)
  if (widened && out.x !== undefined && out.x + out.width > area.x + area.width)
    out.x = Math.max(area.x, area.x + area.width - out.width)
  return out
}
