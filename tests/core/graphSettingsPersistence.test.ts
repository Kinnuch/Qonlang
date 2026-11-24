import { describe, expect, it, vi, beforeEach } from 'vitest'
const state = vi.hoisted(() => ({ prefs: {} as Record<string, unknown>, savePrefsSoon: vi.fn() }))
vi.mock('$lib/state/ui.svelte', () => ({ ui: state }))
import {
  readGraphSettings,
  saveGraphSettings,
  readGraphPanelCollapsed,
  saveGraphPanelCollapsed
} from '$lib/state/graphSettings.svelte'
describe('graph local preference persistence', () => {
  beforeEach(() => {
    state.prefs = {}
    state.savePrefsSoon.mockClear()
  })
  it('reads defaults from old preferences without writing or changing unrelated preferences', () => {
    state.prefs = { theme: 'dark' }
    expect(readGraphSettings('project-A').depth).toBe(1)
    expect(readGraphPanelCollapsed('project-A')).toBe(false)
    expect(state.prefs).toEqual({ theme: 'dark' })
    expect(state.savePrefsSoon).not.toHaveBeenCalled()
  })
  it('keeps projects separate and uses the existing debounced save path once', () => {
    const a = readGraphSettings('A')
    a.depth = 3
    saveGraphSettings('A', a)
    expect(readGraphSettings('A').depth).toBe(3)
    expect(readGraphSettings('B').depth).toBe(1)
    expect(state.savePrefsSoon).toHaveBeenCalledTimes(1)
  })
  it('validates settings after deserialization and remembers collapsed separately', () => {
    state.prefs.lexemeGraphSettingsByProject = { A: { depth: Infinity, forces: { center: 99 } } }
    expect(readGraphSettings('A').depth).toBe(1)
    expect(readGraphSettings('A').forces.center).toBe(3)
    saveGraphPanelCollapsed('A', true)
    const saved = JSON.parse(JSON.stringify(state.prefs))
    state.prefs = saved
    expect(readGraphPanelCollapsed('A')).toBe(true)
    expect(readGraphPanelCollapsed('B')).toBe(false)
    expect(readGraphSettings('A').forces.center).toBe(3)
  })
})
