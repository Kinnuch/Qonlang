/**
 * 同一个构形的两个变体一起用在一个词条上：两套都推导、形式各存各的、名字带上变体名。
 */
import { describe, it, expect } from 'vitest'
import { createProject, createLexeme, newId } from '$lib/core/factory'
import type { GrammaticalCategory, MorphStep, Paradigm, SlotGenerator } from '$lib/core/model'
import {
  deriveLexemeForms,
  formKeyOf,
  lexemeParadigmLabel,
  lexemeSlots,
  makeContext,
  paradigmSlots,
  paradigmsFor,
  variantKey
} from '$lib/engine/morph'

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const L = p.languages[0]
  const kase: GrammaticalCategory = {
    id: 'case',
    name: { zh: '格' },
    values: [
      { id: 'nom', name: { zh: '主格' }, abbr: 'NOM' },
      { id: 'gen', name: { zh: '属格' }, abbr: 'GEN' }
    ]
  }
  p.categories.push(kase)
  const suf = (text: string): MorphStep => ({ id: newId(), kind: 'suffix', text })
  const pipe = (...steps: MorphStep[]): SlotGenerator => ({ kind: 'pipeline', stem: '', steps })
  const spoken = { id: 'v-spoken', name: '口语' }
  const noun: Paradigm = {
    id: newId(),
    name: { zh: '名词' },
    variants: [spoken],
    dimensionIds: ['case'],
    disabledSlots: [],
    generators: {
      nom: pipe(),
      gen: pipe(suf('-is')),
      [variantKey('gen', spoken.id)]: pipe(suf('-i'))
    },
    inheritsFrom: null
  }
  p.paradigms.push(noun)
  return { p, L, noun, spoken }
}

describe('一个词条用同一个构形的两个变体', () => {
  it('两套都在、形式分开存、名字带变体名', () => {
    const { p, L, noun, spoken } = setup()
    const l = createLexeme(L.id, 'kant')
    l.paradigmId = noun.id
    l.extraParadigms = [{ paradigmId: noun.id, variantId: spoken.id }]
    p.lexemes.push(l)
    const sets = paradigmsFor(p, l)
    expect(sets.map((x) => x.variantId)).toEqual([null, spoken.id])
    expect(lexemeParadigmLabel(sets[1], ['zh'])).toBe('名词·口语')
    deriveLexemeForms(makeContext(p, L), l)
    expect(l.forms['属格'].surface).toBe('kantis')
    expect(l.forms['名词·口语·属格'].surface).toBe('kanti')
    const gen = paradigmSlots(noun, p.categories, ['zh']).find((s) => s.key === 'gen')!
    expect(formKeyOf(p, l, noun.id, gen, spoken.id)).toBe('名词·口语·属格')
    expect(formKeyOf(p, l, noun.id, gen, null)).toBe('属格')
    // 完全一样的一套（同构形同变体）不会重复算
    l.extraParadigms.push({ paradigmId: noun.id, variantId: null })
    expect(paradigmsFor(p, l)).toHaveLength(2)
    expect(new Set(lexemeSlots(p, l).map((s) => s.key)).size).toBe(4)
  })
})
