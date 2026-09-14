/**
 * 窗口记录：旧版记下的窄窗口放宽一次到新的默认宽度，放不下就占满工作区；新格式的记录照原样。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  WINDOW_STATE_VERSION,
  fitWindowState
} from '../../src/main/windowState'

const wide = { x: 0, y: 0, width: 2560, height: 1400 }

describe('window state', () => {
  it('widens an old narrow window once and keeps it on the screen', () => {
    expect(fitWindowState({ width: 1156, height: 768, x: 1200, y: 100 }, wide)).toEqual({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      x: 2560 - DEFAULT_WIDTH,
      y: 100
    })
    // 0.8.x 记下的旧默认大小（1580 × 860，v2）：宽高都放大一次；放大后底边出了工作区就往上挪
    expect(fitWindowState({ width: 1580, height: 860, x: 100, y: 560, v: 2 }, wide)).toEqual({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      x: 100,
      y: 1400 - DEFAULT_HEIGHT,
      v: 2
    })
    // 新格式的记录是用户自己拖出来的大小，不再放宽
    const own = { width: 1156, height: 768, v: WINDOW_STATE_VERSION }
    expect(fitWindowState(own, wide).width).toBe(1156)
  })

  it('shrinks into a small work area', () => {
    const small = { x: -1536, y: 0, width: 1536, height: 816 }
    expect(fitWindowState({ width: 1156, height: 900, x: -1500, y: 0 }, small)).toEqual({
      width: 1536,
      height: 816,
      x: -1536,
      y: 0
    })
  })
})
