import { describe, it, expect } from 'vitest'
import type { GrammaticalCategory } from '$lib/core/model'
import {
  activeValues,
  conditionVariants,
  hasConditions,
  resolveConditions
} from '$lib/engine/morph/conditions'

const cats: GrammaticalCategory[] = [
  {
    id: 'g',
    name: { zh: '性', en: 'gender' },
    values: [
      { id: 'm', name: { zh: '阳', en: 'masculine' }, abbr: 'M' },
      { id: 'f', name: { zh: '阴', en: 'feminine' }, abbr: 'F' }
    ]
  },
  {
    id: 'n',
    name: { zh: '数' },
    values: [
      { id: 'sg', name: { zh: '单' }, abbr: 'SG' },
      { id: 'pl', name: { zh: '复' }, abbr: 'PL' }
    ]
  }
]
const fem = activeValues([], { features: { g: 'f' } })
const masc = activeValues([], { features: { g: 'm' } })

describe('conditional letters in affixes', () => {
  it('picks the branch that matches the entry’s own feature', () => {
    expect(resolveConditions('-{阴:g|k}a', cats, fem)).toBe('-ga')
    expect(resolveConditions('-{阴:g|k}a', cats, masc)).toBe('-ka')
    expect(resolveConditions('-{阴:g|k}a', cats, activeValues([], { features: {} }))).toBe('-ka')
    expect(resolveConditions('-{阴：g|k}a', cats, fem)).toBe('-ga')
  })
  it('uses slot values too, with abbreviations, dimension=value, any-of and all-of', () => {
    const act = activeValues([{ categoryId: 'n', valueId: 'pl' }], { features: { g: 'f' } })
    expect(resolveConditions('{F+PL:ae|阴:a|复:i|o}', cats, act)).toBe('ae')
    expect(resolveConditions('{性=阳:o|数=复:i}', cats, act)).toBe('i')
    expect(resolveConditions('{阳,复:x|y}', cats, act)).toBe('x')
    // 槽位的取值盖过词条上同一个维度的特征
    const slotWins = activeValues([{ categoryId: 'g', valueId: 'm' }], { features: { g: 'f' } })
    expect(resolveConditions('{阴:a|o}', cats, slotWins)).toBe('o')
  })
  it('a group without a default branch can come out empty', () => {
    expect(resolveConditions('-{阳:s}', cats, fem)).toBe('-')
    expect(resolveConditions('-{阳:s}', cats, masc)).toBe('-s')
  })
  it('leaves braces without a colon alone and reports unknown words', () => {
    expect(hasConditions('{Vlong}')).toBe(false)
    expect(resolveConditions('@{定指}', cats, fem)).toBe('@{定指}')
    const unknown = new Set<string>()
    expect(resolveConditions('{中:e|o}', cats, fem, unknown)).toBe('o')
    expect([...unknown]).toEqual(['中'])
  })
  it('lists every way of picking for previews and affix stripping', () => {
    expect(conditionVariants('-{阴:g|k}a')).toEqual([
      { when: '阴', text: '-ga' },
      { when: '', text: '-ka' }
    ])
    expect(conditionVariants('-{阴:g|k}{复:lar|}').map((v) => v.text)).toEqual([
      '-glar',
      '-g',
      '-klar',
      '-k'
    ])
    expect(conditionVariants('-s')).toEqual([{ when: '', text: '-s' }])
  })
})
