import { describe, it, expect } from 'vitest'
import { validContextMenu } from '../../src/shared/context-menu'
describe('native context menu bridge input', () => {
  it('accepts labels, application actions, accelerators and native checkbox state', () => {
    expect(
      validContextMenu({
        id: 'menu',
        x: 10,
        y: 20,
        items: [
          { id: 'copy', label: 'Copy', shortcut: 'CmdOrCtrl+C' },
          { id: 'sep', label: '', type: 'separator' },
          { id: 'subtree', label: 'Include children', type: 'checkbox', checked: true }
        ]
      })
    ).toBe(true)
  })
  it('rejects unsupported shortcuts, unbounded labels and malformed data', () => {
    for (const value of [
      null,
      { id: 'x', x: NaN, y: 1, items: [] },
      { id: 'x', x: 1, y: 1, items: [{ id: 'x', label: 'x', shortcut: 'Alt+F4' }] },
      { id: 'x', x: 1, y: 1, items: [{ id: 'x', label: 'x'.repeat(241) }] },
      { id: 'x', x: 1, y: 1, items: [{ id: 'x', label: 'x', type: 'submenu' }] }
    ])
      expect(validContextMenu(value)).toBe(false)
  })
})
