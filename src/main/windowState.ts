/**
 * 窗口大小与位置的记录（window.json）：默认值、旧记录放大一次、放进屏幕的工作区。纯函数，不碰 Electron，好测。
 */

/**
 * 默认窗口大小（外框，含标题栏与边框，大约比网页区宽 15、高 38）。
 * 宽：开始页 左栏 320 + 主栏最宽 1000 + 右侧面板 360——打开面板时英文界面底部那排按钮（约 860）也排得下一行；
 * 高：开始页有「恢复未保存的工作」提示条、又展开了新建项目的表单时（网页区约 740）不用滚动。
 * 屏幕放不下就占满工作区。
 */
export const DEFAULT_WIDTH = 1700
export const DEFAULT_HEIGHT = 900
/** window.json 的格式版本：2 起默认宽度加宽过一次，3 起默认宽高又放大了；旧记录比新默认值小的放大一次 */
export const WINDOW_STATE_VERSION = 3

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
 * 旧版记下的窗口比新的默认值小就放大一次（宽、高各自比）；比工作区大的缩进去；放大后出了工作区就往左、往上挪回来。
 * 新格式的记录（当前版本号）是用户自己拖出来的大小，只在放不下时缩。
 */
export function fitWindowState(ws: WindowState, area: WorkArea): WindowState {
  const out = { ...ws }
  const old = (out.v ?? 1) < WINDOW_STATE_VERSION
  const widened = old && out.width < DEFAULT_WIDTH
  const heightened = old && out.height < DEFAULT_HEIGHT
  if (widened) out.width = DEFAULT_WIDTH
  if (heightened) out.height = DEFAULT_HEIGHT
  out.width = Math.min(out.width, area.width)
  out.height = Math.min(out.height, area.height)
  if (widened && out.x !== undefined && out.x + out.width > area.x + area.width)
    out.x = Math.max(area.x, area.x + area.width - out.width)
  if (heightened && out.y !== undefined && out.y + out.height > area.y + area.height)
    out.y = Math.max(area.y, area.y + area.height - out.height)
  return out
}
