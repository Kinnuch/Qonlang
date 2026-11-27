import { afterEach, describe, expect, it, vi } from 'vitest'
import { anchoredFloating } from '$lib/ui/anchoredFloating'

function environment() {
  let rect = { left: 400, right: 414, top: 300, bottom: 314, width: 14 }
  const anchor = { isConnected: true, getBoundingClientRect: () => rect } as HTMLElement
  const node = {
    style: {},
    scrollHeight: 88,
    offsetHeight: 90,
    clientHeight: 88,
    offsetWidth: 280,
    contains: () => false,
    remove: vi.fn()
  } as unknown as HTMLElement
  const appendChild = vi.fn(),
    frames = new Map<number, FrameRequestCallback>()
  const events = new Map<string, EventListener>(),
    viewportEvents = new Map<string, EventListener>()
  let serial = 0
  const viewport = {
    offsetLeft: 0,
    offsetTop: 0,
    width: 1000,
    height: 700,
    addEventListener: (name: string, fn: EventListener) => viewportEvents.set(name, fn),
    removeEventListener: (name: string) => viewportEvents.delete(name)
  }
  vi.stubGlobal('document', {
    body: { appendChild },
    documentElement: { clientWidth: 1000, clientHeight: 700 }
  })
  vi.stubGlobal('window', {
    visualViewport: viewport,
    addEventListener: (name: string, fn: EventListener) => events.set(name, fn),
    removeEventListener: (name: string) => events.delete(name)
  })
  vi.stubGlobal('getComputedStyle', () => ({ direction: 'ltr' }))
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++serial, fn)
    return serial
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const observers: {
    observe: ReturnType<typeof vi.fn>
    unobserve: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }[] = []
  class Observer {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    constructor() {
      observers.push(this)
    }
  }
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('IntersectionObserver', Observer)
  const frame = () => {
    const entry = frames.entries().next().value
    if (entry) {
      frames.delete(entry[0])
      entry[1](0)
    }
  }
  return {
    anchor,
    node,
    appendChild,
    frames,
    events,
    viewportEvents,
    viewport,
    observers,
    frame,
    move: (left: number) => {
      rect = { ...rect, left, right: left + 14 }
    }
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('锚点浮层生命周期', () => {
  it('浮层移到body，按视口坐标定位并在销毁时清理', () => {
    const e = environment(),
      action = anchoredFloating(e.node, {
        anchor: e.anchor,
        width: 280,
        align: 'center',
        placement: 'above',
        gap: 6
      })
    expect(e.appendChild).toHaveBeenCalledWith(e.node)
    expect(e.node.style.left).toBe('267px')
    expect(e.node.style.top).toBe('204px')
    action.destroy()
    expect(e.events.size).toBe(0)
    expect(e.viewportEvents.size).toBe(0)
    expect(e.observers.every((o) => o.disconnect.mock.calls.length === 1)).toBe(true)
    expect(e.node.remove).toHaveBeenCalledOnce()
  })
  it('可选逐帧跟随只移动不变尺寸的动画，关闭后不再排帧', () => {
    const e = environment(),
      action = anchoredFloating(e.node, {
        anchor: e.anchor,
        width: 280,
        align: 'center',
        track: true
      })
    expect(e.frames.size).toBe(1)
    e.move(500)
    e.frame()
    expect(e.node.style.left).toBe('367px')
    expect(e.frames.size).toBe(1)
    action.destroy()
    expect(e.frames.size).toBe(0)
  })
  it('普通菜单不常驻排帧，视口缩放事件才更新', () => {
    const e = environment(),
      action = anchoredFloating(e.node, { anchor: e.anchor, width: 280 })
    expect(e.frames.size).toBe(0)
    e.viewport.width = 240
    e.viewportEvents.get('resize')?.({} as Event)
    e.frame()
    expect(e.node.style.width).toBe('224px')
    expect(e.node.style.left).toBe('8px')
    action.destroy()
  })
  it('锚点失效通知调用方关闭，不留下悬空提示', () => {
    const e = environment(),
      hidden = vi.fn()
    const action = anchoredFloating(e.node, { anchor: e.anchor, onAnchorHidden: hidden })
    action.update({ anchor: null, onAnchorHidden: hidden })
    e.frame()
    expect(hidden).toHaveBeenCalledOnce()
    expect(e.observers.every((o) => o.unobserve.mock.calls.length === 1)).toBe(true)
    action.destroy()
  })
})
