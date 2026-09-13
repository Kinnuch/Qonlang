/**
 * 词类标记后面紧跟的圆括号（n. (archaic) …）也算标记：列进标记表，像语域的设成语域（逗号隔开的算几个），
 * 像一句说明的默认原样留在释义里；词类标记管着的后面几个义项开头的括号也算。
 */
import { describe, it, expect } from 'vitest'
import { createProject } from '$lib/core/factory'
import type { Project } from '$lib/core/model'
import {
  applyCsvImport,
  defaultMapping,
  defaultMarkerAction,
  defaultPosRule,
  findMarkers,
  findPosMarkers,
  type CsvMapping,
  type MarkerRule
} from '$lib/importers/csvImport'

const rows = [
  ['word', 'en'],
  ['kalo', 'n. (placed before the noun) old, former ; (placed after the noun) very old'],
  ['sema', 'n. (slang, vulgar) nose ; (archaic) snout'],
  ['tiru', 'prep. (+ abs.) across ; adv. very'],
  ['vena', 'n. lizard (a small one)']
]

const blank = (): Project =>
  createProject({ name: 't', template: 'blank', appVersion: '', uiLocale: 'en' })

function mappingFor(p: Project): CsvMapping {
  const m = defaultMapping(p.languages[0].id, 2)
  m.columns = [{ kind: 'lemma' }, { kind: 'definition', lang: 'en' }]
  return m
}

describe('parentheses right after a part-of-speech marker', () => {
  it('are listed as markers; phrase-like ones are kept by default', () => {
    const p = blank()
    const labels = findMarkers(rows, mappingFor(p)).map((s) => s.label)
    expect(labels.sort()).toEqual([
      '+ abs.',
      'archaic',
      'placed after the noun',
      'placed before the noun',
      'slang, vulgar'
    ])
    expect(defaultMarkerAction('archaic')).toBe('register')
    expect(defaultMarkerAction('slang, vulgar')).toBe('register')
    expect(defaultMarkerAction('placed before the noun')).toBe('keep')
    expect(defaultMarkerAction('+ abs.')).toBe('keep')
  })

  it('become registers on import, or stay in the definition', () => {
    const p = blank()
    const m = mappingFor(p)
    m.posMarkers = Object.fromEntries(
      findPosMarkers(rows, m).map((s) => [s.label, defaultPosRule(s.label, p.posList, 'en')])
    )
    m.senseMarkers = Object.fromEntries(
      findMarkers(rows, m).map((s): [string, MarkerRule] => [
        s.label,
        { action: defaultMarkerAction(s.label), value: s.label }
      ])
    )
    applyCsvImport(p, rows, m)
    const [kalo, sema, tiru, vena] = p.lexemes
    expect(kalo.senses.map((s) => [s.definition.en, s.registers])).toEqual([
      ['(placed before the noun) old, former', []],
      ['(placed after the noun) very old', []]
    ])
    expect(sema.senses.map((s) => [s.definition.en, s.registers])).toEqual([
      ['nose', ['slang', 'vulgar']],
      ['snout', ['archaic']]
    ])
    expect(tiru.senses.map((s) => s.definition.en)).toEqual(['(+ abs.) across', 'very'])
    expect(vena.senses[0].definition.en).toBe('lizard (a small one)')
  })

  it('can be switched off: parentheses then stay in the text and are not listed', () => {
    const p = blank()
    const m = mappingFor(p)
    m.parenMarkers = false
    expect(findMarkers(rows, m)).toEqual([])
    m.posMarkers = Object.fromEntries(
      findPosMarkers(rows, m).map((s) => [s.label, defaultPosRule(s.label, p.posList, 'en')])
    )
    // 老预设里留着的同名标记也不再从小括号里认
    m.senseMarkers = { archaic: { action: 'register', value: 'archaic' } }
    applyCsvImport(p, rows, m)
    const sema = p.lexemes[1]
    expect(sema.senses.map((s) => [s.definition.en, s.registers])).toEqual([
      ['(slang, vulgar) nose', []],
      ['(archaic) snout', []]
    ])
  })
})
