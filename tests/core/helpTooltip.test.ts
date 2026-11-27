import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissOwnedHelpTooltip, helpTooltipDismiss, ownedHelpTooltip } from '$lib/ui/helpTooltip'

function fixture() {
  class TestNode extends EventTarget {
    parent: TestNode | null = null
    contains(node: TestNode): boolean {
      return node === this || node.parent === this
    }
    hasAttribute(name: string): boolean {
      return name === 'data-help-tooltip'
    }
  }
  vi.stubGlobal('Node', TestNode)
  const tooltip = new TestNode(),
    child = new TestNode(),
    outside = new TestNode()
  child.parent = tooltip
  const dot = { getAttribute: () => 'owned-tip' }
  const doc = { getElementById: (id: string) => (id === 'owned-tip' ? tooltip : null) }
  const owner = { querySelectorAll: () => [dot], ownerDocument: doc } as unknown as HTMLElement
  return { tooltip, child, outside, owner, doc }
}
afterEach(() => vi.unstubAllGlobals())

describe('只归属当前工具浮层的帮助提示', () => {
  it('仅把当前容器帮助点关联的气泡及其子内容视为内部', () => {
    const f = fixture()
    expect(ownedHelpTooltip(f.owner)).toBe(f.tooltip)
    expect(ownedHelpTooltip(f.owner, f.tooltip)).toBe(f.tooltip)
    expect(ownedHelpTooltip(f.owner, f.child)).toBe(f.tooltip)
    expect(ownedHelpTooltip(f.owner, f.outside)).toBeNull()
    expect(ownedHelpTooltip(null, f.tooltip)).toBeNull()
  })
  it('没有当前已打开提示时不吞掉父浮层的正常关闭', () => {
    const f = fixture()
    f.doc.getElementById = () => null
    expect(dismissOwnedHelpTooltip(f.owner)).toBe(false)
  })
  it('通过本提示的清理事件关闭，销毁后移除处理器', () => {
    const f = fixture(),
      dismiss = vi.fn()
    const action = helpTooltipDismiss(f.tooltip as unknown as HTMLElement, dismiss)
    expect(dismissOwnedHelpTooltip(f.owner)).toBe(true)
    expect(dismiss).toHaveBeenCalledOnce()
    action.destroy()
    dismissOwnedHelpTooltip(f.owner)
    expect(dismiss).toHaveBeenCalledOnce()
  })
})
