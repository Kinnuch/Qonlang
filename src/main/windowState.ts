/**
 * 窗口大小与位置的记录（window.json）：默认值、旧记录放大一次、放进屏幕的工作区。纯函数，不碰 Electron，好测。
 */

/**
 * 默认窗口大小按屏幕大小缩放：2K 屏（2560 × 1440）上是 1853 × 920，别的屏幕宽高各按同样的比例。
 * 算的是与屏幕的比例，而 Electron 的窗口大小是逻辑像素，所以在 125% 缩放的 2K 屏上是 1482 × 736 个
 * 逻辑像素——看上去仍旧是 1853 × 920 个物理像素，屏幕上占的地方一样大。
 */
export const REF_SCREEN: Size = { width: 2560, height: 1440 }
export const REF_WINDOW: Size = { width: 1853, height: 920 }
/** 窗口的最小尺寸（BrowserWindow 的 minWidth / minHeight 用的也是这个），再小的屏幕就占满工作区 */
export const MIN_WIDTH = 900
export const MIN_HEIGHT = 600
/**
 * window.json 的格式版本：2 起默认宽度加宽过一次，3 起默认宽高又放大了；旧记录比新默认值小的放大一次。
 * 0.9.1 起默认值改成按屏幕缩放，那只给头一次启动用，记下来的大小照旧不动，所以版本号不动。
 */
export const WINDOW_STATE_VERSION = 3

export interface Size {
  width: number
  height: number
}

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

/** 这块屏幕上的默认窗口大小（屏幕大小是逻辑像素，Electron 的 display.size） */
export function defaultWindowSize(screen: Size): Size {
  return {
    width: Math.max(MIN_WIDTH, Math.round((REF_WINDOW.width * screen.width) / REF_SCREEN.width)),
    height: Math.max(
      MIN_HEIGHT,
      Math.round((REF_WINDOW.height * screen.height) / REF_SCREEN.height)
    )
  }
}

/**
 * 旧版记下的窗口比这块屏幕的默认值小就放大一次（宽、高各自比）；比工作区大的缩进去；放大后出了工作区就往左、往上挪回来。
 * 新格式的记录（当前版本号）是用户自己拖出来的大小，只在放不下时缩。
 */
export function fitWindowState(ws: WindowState, area: WorkArea, def: Size): WindowState {
  const out = { ...ws }
  const old = (out.v ?? 1) < WINDOW_STATE_VERSION
  const widened = old && out.width < def.width
  const heightened = old && out.height < def.height
  if (widened) out.width = def.width
  if (heightened) out.height = def.height
  out.width = Math.min(out.width, area.width)
  out.height = Math.min(out.height, area.height)
  if (widened && out.x !== undefined && out.x + out.width > area.x + area.width)
    out.x = Math.max(area.x, area.x + area.width - out.width)
  if (heightened && out.y !== undefined && out.y + out.height > area.y + area.height)
    out.y = Math.max(area.y, area.y + area.height - out.height)
  return out
}
