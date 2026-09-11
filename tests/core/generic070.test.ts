/**
 * 0.7.0 做成通用选项的几件事：模糊匹配、括号转写、CSV 义项前缀映射。
 */
import { describe, it, expect } from 'vitest'
import { createLanguage, createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import { looseKey, resolveFormInLanguage } from '$lib/core/etymology'
import { applyParens } from '$lib/script/render'
import { extractSensePrefix, parsePrefixMap } from '$lib/importers/csvImport'

describe('looseKey / fuzzy matching', () => {
  it('drops diacritics, case and the language’s ignored characters', () => {
    expect(looseKey('H1A.NG', '. 1 2 3')).toBe('hang')
    expect(looseKey('GĒS')).toBe('ges')
    expect(looseKey('KL̩T')).toBe('klt')
    expect(looseKey('h₂euk̂', '1 2 3')).toBe('heuk')
    // 没设忽略字符时数字要留着：声调数字不能被当成一样
    expect(looseKey('tsa55')).not.toBe(looseKey('tsa21'))
  })

  it('lets the relation graph find H1/H2 roots written without digits or dots', () => {
    const project = createProject({ name: 'p', template: 'blank', appVersion: '0', uiLocale: 'zh' })
    const proto = createLanguage({ name: 'Proto', abbr: 'P', matchIgnore: '. 1 2 3' })
    const daughter = createLanguage({ name: 'D', abbr: 'D' })
    project.languages.push(proto, daughter)
    const root = createMorpheme(proto.id, 'root')
    root.form = 'H1A.NG'
    project.morphemes.push(root)
    expect(resolveFormInLanguage(project, 'Proto', 'hang')).toEqual({
      kind: 'morpheme',
      id: root.id
    })
    // 另一门没设忽略字符的语言照旧严格
    const w = createLexeme(daughter.id, 'tsa55')
    project.lexemes.push(w)
    expect(resolveFormInLanguage(project, 'D', 'tsa21')).toBeNull()
  })
})

describe('applyParens', () => {
  const mark = (s: string): string => `[${s.trim()}]`
  it('keeps brackets and transliterates inside and outside separately by default', () => {
    expect(applyParens('kala（mira kala）', 'keep', mark)).toBe('[kala]（[mira kala]）')
    expect(applyParens('tal(a)n', 'keep', mark)).toBe('[tal]([a])[n]')
  })
  it('merges optional letters into the word, or separates whole phrases, in include mode', () => {
    expect(applyParens('tal(a)n', 'include', mark)).toBe('[talan]')
    expect(applyParens('sa ken（sa chen）', 'include', mark)).toBe('[sa ken sa chen]')
  })
  it('drops the bracketed content in omit mode', () => {
    expect(applyParens('mira kala（mir kala）', 'omit', mark)).toBe('[mira kala]')
    expect(applyParens('plain text', 'omit', mark)).toBe('[plain text]')
    // 贴着词的括号：省略时直接去掉、并入时并进词里，不把词切开
    expect(applyParens('tal(a)n', 'omit', mark)).toBe('[taln]')
    expect(applyParens('(s)tal ka', 'include', mark)).toBe('[stal ka]')
    expect(applyParens('x galan(n) y', 'include', mark)).toBe('[x galann y]')
  })
})

describe('CSV sense prefix map', () => {
  const map = parsePrefixMap('0=零价\n1=一价\n2=二价\n3=三价')
  it('parses code=tag lines', () => {
    expect([...map.entries()]).toEqual([
      ['0', '零价'],
      ['1', '一价'],
      ['2', '二价'],
      ['3', '三价']
    ])
    expect(parsePrefixMap('x\n\ny=')).toEqual(
      new Map([
        ['x', 'x'],
        ['y', 'y']
      ])
    )
  })
  it('strips leading codes, including run-together ones, into tags', () => {
    expect(extractSensePrefix('1离开，离去', map)).toEqual({ text: '离开，离去', tags: ['一价'] })
    expect(extractSensePrefix('01繁荣，昌盛', map)).toEqual({
      text: '繁荣，昌盛',
      tags: ['零价', '一价']
    })
    expect(extractSensePrefix('2、制造', map)).toEqual({ text: '制造', tags: ['二价'] })
    // 没有编码、或者整条都是编码时不动
    expect(extractSensePrefix('系词', map)).toEqual({ text: '系词', tags: [] })
    // 字母编码后面还是字母时不算编码；数字编码后面还是数字时不算
    const pos = parsePrefixMap('n=名词\nv=动词\nvt=及物')
    expect(extractSensePrefix('night', pos)).toEqual({ text: 'night', tags: [] })
    expect(extractSensePrefix('vivid', pos)).toEqual({ text: 'vivid', tags: [] })
    expect(extractSensePrefix('vt. 带走', pos)).toEqual({ text: '带走', tags: ['及物'] })
    expect(extractSensePrefix('12', map)).toEqual({ text: '12', tags: [] })
    expect(extractSensePrefix('1走', new Map())).toEqual({ text: '1走', tags: [] })
  })
})
