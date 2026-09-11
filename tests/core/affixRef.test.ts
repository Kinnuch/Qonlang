/**
 * 构形里 @语素 引用前后写的空格、中点原样保留。
 */
import { describe, it, expect } from 'vitest'
import { createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import { generateForm, makeContext, parseAffixRef } from '$lib/engine/morph'
import { paradigmAffixes } from '$lib/engine/morph/reverse'

function setup(): { lang: string; ms: ReturnType<typeof createMorpheme>[] } {
  const lang = 'L1'
  const def = createMorpheme(lang, 'prefix')
  def.form = 'sa-'
  def.gloss = '定指'
  const pl = createMorpheme(lang, 'suffix')
  pl.form = '-lar'
  pl.gloss = 'PL'
  const dotted = createMorpheme(lang, 'particle')
  dotted.form = 'é·'
  dotted.gloss = '单数.限定'
  return { lang, ms: [def, pl, dotted] }
}

describe('@语素 引用', () => {
  it('引用后面的中点、空格留在 tail', () => {
    const { lang, ms } = setup()
    expect(parseAffixRef('@定指·', ms, lang)).toMatchObject({ ref: '定指', tail: '·', lead: '' })
    expect(parseAffixRef('@定指 ', ms, lang)).toMatchObject({ ref: '定指', tail: ' ' })
    expect(parseAffixRef('@-lar', ms, lang)?.morpheme?.gloss).toBe('PL')
    expect(parseAffixRef(' @PL', ms, lang)).toMatchObject({ lead: ' ', ref: 'PL', tail: '' })
  })

  it('引用名本身带点时取最长的那段', () => {
    const { lang, ms } = setup()
    const r = parseAffixRef('@单数.限定.', ms, lang)
    expect(r?.morpheme?.form).toBe('é·')
    expect(r?.tail).toBe('.')
  })

  it('没有 @ 或 @ 前面有字母时按字面；找不到的语素原样留着', () => {
    const { lang, ms } = setup()
    expect(parseAffixRef('lar', ms, lang)).toBeNull()
    expect(parseAffixRef('a@b', ms, lang)).toBeNull()
    expect(parseAffixRef('@无此语素·', ms, lang)).toMatchObject({
      morpheme: null,
      ref: '无此语素',
      tail: '·'
    })
  })

  it('反推用的词缀表带上中点', () => {
    const { lang, ms } = setup()
    const p = createProject({ name: 't', template: 'blank', appVersion: '0', uiLocale: 'zh' })
    p.languages[0].id = lang
    p.morphemes.push(...ms)
    p.paradigms.push({
      id: 'P',
      name: { zh: 'P' },
      variants: [],
      dimensionIds: [],
      disabledSlots: [],
      inheritsFrom: null,
      generators: {
        s: {
          kind: 'pipeline',
          stem: '',
          steps: [{ kind: 'prefix', text: '@定指·' }]
        }
      }
    } as never)
    const aff = paradigmAffixes(p, lang)
    expect(aff.prefixes.map((x) => x.form)).toContain('sa·')
  })

  it('语素表里没有的引用：后面的空格照样留着，有同名词条就用词条', () => {
    const { lang, ms } = setup()
    const p = createProject({ name: 't', template: 'blank', appVersion: '0', uiLocale: 'zh' })
    p.languages[0].id = lang
    p.morphemes.push(...ms)
    const stem = createLexeme(lang, 'derg')
    p.lexemes.push(createLexeme(lang, 'mo'), stem)
    const para = {
      id: 'P',
      name: { zh: 'P' },
      variants: [],
      dimensionIds: [],
      disabledSlots: [],
      inheritsFrom: null,
      generators: {
        a: { kind: 'pipeline', stem: '', steps: [{ kind: 'prefix', text: '@mo ' }] },
        b: { kind: 'pipeline', stem: '', steps: [{ kind: 'prefix', text: '@无此词 ' }] }
      }
    } as never
    const ctx = makeContext(p, p.languages[0])
    const a = generateForm(ctx, stem, para, { key: 'a', label: 'a', abbr: 'a' } as never)
    expect(a?.surface).toBe('mo derg')
    expect(a?.trace.join('\n')).toContain('引用词条 mo')
    const b = generateForm(ctx, stem, para, { key: 'b', label: 'b', abbr: 'b' } as never)
    expect(b?.surface).toBe('无此词 derg')
    expect(b?.trace.join('\n')).toContain('未找到语素 无此词')
  })
})
