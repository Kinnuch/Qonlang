/**
 * 窗口记录：默认大小按屏幕缩放；旧版记下的窄窗口放宽一次到这块屏幕的默认宽度，放不下就占满工作区；新格式的记录照原样。
 */
import { describe, it, expect } from 'vitest'
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  WINDOW_STATE_VERSION,
  defaultWindowSize,
  fitWindowState
} from '../../src/main/windowState'

const wide = { x: 0, y: 0, width: 2560, height: 1400 }
const def = defaultWindowSize({ width: 2560, height: 1440 })

describe('default window size', () => {
  it('is 1853 × 920 on a 2K screen', () => {
    expect(def).toEqual({ width: 1853, height: 920 })
  })

  it('scales with the screen', () => {
    // 1080p：宽高各按 1920/2560、1080/1440 缩
    expect(defaultWindowSize({ width: 1920, height: 1080 })).toEqual({ width: 1390, height: 690 })
    // 4K：同样的比例放大
    expect(defaultWindowSize({ width: 3840, height: 2160 })).toEqual({ width: 2780, height: 1380 })
    // 125% 缩放的 2K 屏（Electron 看到的是逻辑像素 2048 × 1152）：算出来的逻辑像素乘回 1.25 还是 1853 × 920
    const scaled = defaultWindowSize({ width: 2048, height: 1152 })
    expect(scaled).toEqual({ width: 1482, height: 736 })
    expect(Math.round(scaled.width * 1.25)).toBe(1853)
    expect(Math.round(scaled.height * 1.25)).toBe(920)
  })

  it('never goes below the minimum window size', () => {
    // 720p：宽按比例还够，高被最小值托住
    expect(defaultWindowSize({ width: 1280, height: 720 })).toEqual({ width: 927, height: 600 })
    // 再小的屏幕宽高都按最小值来（放不下由 fitWindowState 缩进工作区）
    expect(defaultWindowSize({ width: 1024, height: 768 })).toEqual({
      width: MIN_WIDTH,
      height: MIN_HEIGHT
    })
  })
})

describe('window state', () => {
  it('widens an old narrow window once and keeps it on the screen', () => {
    expect(fitWindowState({ width: 1156, height: 768, x: 1200, y: 100 }, wide, def)).toEqual({
      width: def.width,
      height: def.height,
      x: 2560 - def.width,
      y: 100
    })
    // 0.8.x 记下的旧默认大小（1580 × 860，v2）：宽高都放大一次；放大后底边出了工作区就往上挪
    expect(fitWindowState({ width: 1580, height: 860, x: 100, y: 560, v: 2 }, wide, def)).toEqual({
      width: def.width,
      height: def.height,
      x: 100,
      y: 1400 - def.height,
      v: 2
    })
    // 新格式的记录是用户自己拖出来的大小，不再放宽
    const own = { width: 1156, height: 768, v: WINDOW_STATE_VERSION }
    expect(fitWindowState(own, wide, def).width).toBe(1156)
  })

  it('shrinks into a small work area', () => {
    const small = { x: -1536, y: 0, width: 1536, height: 816 }
    expect(fitWindowState({ width: 1156, height: 900, x: -1500, y: 0 }, small, def)).toEqual({
      width: 1536,
      height: 816,
      x: -1536,
      y: 0
    })
  })
})
