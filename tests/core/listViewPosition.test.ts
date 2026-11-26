import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureListViewPosition, restoreListViewPosition } from '$lib/ui/listViewPosition'
class Box extends EventTarget {
  scrollTop = 0
  scrollLeft = 0
  isConnected = true
  rendered = true
  items = [
    { id: 'first', y: 0, h: 25 },
    { id: 'anchor', y: 70, h: 40 },
    { id: 'below', y: 1000, h: 40 }
  ]
  getBoundingClientRect() {
    return { top: 100, bottom: 500, height: 400 } as DOMRect
  }
  querySelector() {
    return { getBoundingClientRect: () => ({ height: 30 }) }
  }
  querySelectorAll() {
    return this.rendered
      ? this.items.map((item) => ({
          dataset: { id: item.id },
          getBoundingClientRect: () => ({
            top: 100 + item.y - this.scrollTop,
            bottom: 100 + item.y - this.scrollTop + item.h
          })
        }))
      : []
  }
}
const element = (box: Box) => box as unknown as HTMLElement
let next = 0,
  queue: Map<number, FrameRequestCallback>
function frame() {
  const callbacks = [...queue.values()]
  queue.clear()
  for (const callback of callbacks) callback(0)
}
function settle() {
  let count = 0
  while (queue.size && count++ < 30) frame()
  return count
}
beforeEach(() => {
  queue = new Map()
  next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.set(++next, callback)
    return next
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id))
})
afterEach(() => vi.unstubAllGlobals())
describe('temporary graph view list position', () => {
  it('captures actual fractional pixels and a visible row below the sticky header, ignoring offscreen rows', () => {
    const box = new Box()
    box.scrollTop = 50.25
    box.scrollLeft = 15.5
    expect(captureListViewPosition(element(box))).toEqual({
      top: 50.25,
      left: 15.5,
      anchor: { id: 'anchor', offset: 19.75 }
    })
    box.items = [{ id: 'below', y: 1000, h: 40 }]
    expect(captureListViewPosition(element(box))).toEqual({ top: 50.25, left: 15.5 })
    expect(captureListViewPosition(null)).toBeNull()
  })
  it('restores exact raw pixels and horizontal offset when no anchor is available, then stops scheduling', () => {
    const box = new Box()
    restoreListViewPosition(element(box), { top: 375.25, left: -12.5 }, () => true)
    expect(settle()).toBe(12)
    expect(box.scrollTop).toBe(375.25)
    expect(box.scrollLeft).toBe(-12.5)
    expect(queue.size).toBe(0)
  })
  it('waits for virtual rows and follows measured anchor changes without centering the selected word', () => {
    const box = new Box()
    box.rendered = false
    box.items = [{ id: 'anchor', y: 260, h: 50 }]
    restoreListViewPosition(
      element(box),
      { top: 100, left: 0, anchor: { id: 'anchor', offset: 20 } },
      () => true
    )
    frame()
    expect(box.scrollTop).toBe(100)
    box.rendered = true
    frame()
    expect(box.scrollTop).toBe(240)
    box.items[0].y = 280
    frame()
    expect(box.scrollTop).toBe(260)
    settle()
    expect(box.scrollTop).toBe(260)
  })
  it('does not restore stale project/selection requests and stops if scope changes while settling', () => {
    const box = new Box()
    let current = false
    restoreListViewPosition(element(box), { top: 123, left: 0 }, () => current)
    settle()
    expect(box.scrollTop).toBe(0)
    current = true
    restoreListViewPosition(element(box), { top: 123, left: 0 }, () => current)
    frame()
    current = false
    box.scrollTop = 456
    settle()
    expect(box.scrollTop).toBe(456)
  })
  it.each(['wheel', 'pointerdown', 'touchstart'])(
    'gives control to a new %s interaction instead of fighting it',
    (type) => {
      const box = new Box()
      restoreListViewPosition(element(box), { top: 123, left: 0 }, () => true)
      box.dispatchEvent(new Event(type))
      box.scrollTop = 900
      settle()
      expect(box.scrollTop).toBe(900)
    }
  )
  it('cancels on navigation keys or explicit teardown, and ignores a disconnected list', () => {
    const box = new Box()
    restoreListViewPosition(element(box), { top: 123, left: 0 }, () => true)
    const event = new Event('keydown')
    Object.defineProperty(event, 'key', { value: 'PageDown' })
    box.dispatchEvent(event)
    settle()
    expect(box.scrollTop).toBe(0)
    const stop = restoreListViewPosition(element(box), { top: 234, left: 0 }, () => true)
    stop()
    settle()
    expect(box.scrollTop).toBe(0)
    box.isConnected = false
    restoreListViewPosition(element(box), { top: 345, left: 0 }, () => true)
    settle()
    expect(box.scrollTop).toBe(0)
  })
})
