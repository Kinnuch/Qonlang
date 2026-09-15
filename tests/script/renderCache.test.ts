/**
 * 文字转写的缓存：没接到软件里时每次都比指纹，改了字形马上生效；
 * 接到软件里（trustScriptCache）后，改项目时 clearScriptCache 一下也马上生效，没改的内容照旧对。
 */
import { describe, it, expect } from 'vitest'
import { createProject, createScript, newId } from '$lib/core/factory'
import type { Glyph } from '$lib/core/model'
import { clearScriptCache, renderScript, trustScriptCache } from '$lib/script/render'

const glyph = (char: string, value: string): Glyph => ({
  id: newId(),
  char,
  name: '',
  value,
  category: 'letter',
  notes: ''
})

describe('文字转写的缓存', () => {
  it('改了字形、规则、括号设置，结果跟着变', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
    const L = p.languages[0]
    const sc = createScript('s')
    sc.glyphs = [glyph('A', 'a'), glyph('B', 'b')]
    expect(renderScript(L, sc, 'ab ba')).toBe('AB BA')
    sc.glyphs[0].char = 'X'
    expect(renderScript(L, sc, 'ab ba')).toBe('XB BX')
    trustScriptCache()
    clearScriptCache()
    expect(renderScript(L, sc, 'ab')).toBe('XB')
    sc.glyphs[1].value = 'c'
    clearScriptCache()
    expect(renderScript(L, sc, 'ab cb')).toBe('Xb Bb')
    sc.rules = 'b > B\n@glyphs'
    clearScriptCache()
    expect(renderScript(L, sc, 'ab')).toBe('XB')
    sc.parens = 'omit'
    clearScriptCache()
    expect(renderScript(L, sc, 'a(b)')).toBe('X')
  })
})
