import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deletable,
  deleteKeyAllowed,
  deleteTargetFor
} from '../../src/renderer/src/lib/ui/deletable'

const event = {
  key: 'Delete',
  defaultPrevented: false,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false
}
const selection = {
  editable: false,
  textSelection: false,
  readOnly: false,
  modal: false,
  selected: true
}
afterEach(() => vi.unstubAllGlobals())

describe('object deletion safety', () => {
  it('accepts an unmodified Delete only for a selected writable object', () => {
    expect(deleteKeyAllowed(event, selection)).toBe(true)
    expect(deleteKeyAllowed(event, { ...selection, selected: false })).toBe(false)
    for (const key of ['Backspace', 'Enter', 'Escape', 'Del', 'd'])
      expect(deleteKeyAllowed({ ...event, key }, selection)).toBe(false)
  })
  it.each(['editable', 'textSelection', 'readOnly', 'modal'] as const)(
    'never deletes an object while %s is active',
    (flag) => {
      expect(deleteKeyAllowed(event, { ...selection, [flag]: true })).toBe(false)
    }
  )
  it.each(['defaultPrevented', 'repeat', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const)(
    'does not intercept an existing handler or key modifier: %s',
    (flag) => {
      expect(deleteKeyAllowed({ ...event, [flag]: true }, selection)).toBe(false)
    }
  )
  it('resolves the innermost registered object, tracks updates and removes stale registrations', () => {
    class FakeElement {
      attrs = new Map<string, string>()
      constructor(public parentElement: FakeElement | null = null) {}
      setAttribute(key: string, value: string): void {
        this.attrs.set(key, value)
      }
      removeAttribute(key: string): void {
        this.attrs.delete(key)
      }
    }
    vi.stubGlobal('Element', FakeElement)
    vi.stubGlobal('Node', FakeElement)
    const outer = new FakeElement(),
      inner = new FakeElement(outer),
      child = new FakeElement(inner)
    const removeParent = vi.fn(),
      removeChild = vi.fn()
    const parent = deletable(outer as unknown as Element, { remove: removeParent })
    const nested = deletable(inner as unknown as Element, { remove: removeChild, selected: false })
    expect(deleteTargetFor(child as unknown as Element)?.options.remove).toBe(removeChild)
    nested.update({ remove: removeChild, selected: true, identity: 'child' })
    expect(deleteTargetFor(child as unknown as Element)?.options.selected).toBe(true)
    expect(deleteTargetFor(child as unknown as Element)?.options.identity).toBe('child')
    nested.destroy()
    expect(deleteTargetFor(child as unknown as Element)?.options.remove).toBe(removeParent)
    parent.destroy()
    expect(deleteTargetFor(child as unknown as Element)).toBeNull()
    expect(removeParent).not.toHaveBeenCalled()
    expect(removeChild).not.toHaveBeenCalled()
  })
})
