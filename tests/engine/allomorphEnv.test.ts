/**
 * 语素异体形的环境：_CC 是任意两个辅音，_C1C1 是同一个辅音双写；后缀看词干末尾。
 */
import { describe, it, expect } from 'vitest'
import { createMorpheme, createProject } from '$lib/core/factory'
import { makeContext, selectAllomorph } from '$lib/engine/morph'
import type { Morpheme } from '$lib/core/model'

function setup(): { ctx: ReturnType<typeof makeContext>; langId: string } {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  const lang = p.languages[0]
  lang.classes = [
    { id: 'c', name: 'C', members: ['p', 't', 'k', 's', 'l', 'r', 'n', 'm'], featureQuery: null },
    { id: 'v', name: 'V', members: ['a', 'e', 'i', 'o', 'u'], featureQuery: null }
  ] as never
  return { ctx: makeContext(p, lang), langId: lang.id }
}
const withEnv = (base: Morpheme, form: string, allos: [string, string][]): Morpheme => ({
  ...base,
  form,
  allomorphs: allos.map(([f, environment], i) => ({ id: `a${i}`, form: f, environment }) as never)
})

describe('异体形环境', () => {
  it('前缀：_CC 是任意两个辅音，_C1C1 是同一个辅音双写', () => {
    const { ctx, langId } = setup()
    const cc = withEnv(createMorpheme(langId, 'prefix'), 'e-', [['ex-', '_CC']])
    const dbl = withEnv(createMorpheme(langId, 'prefix'), 'e-', [['ed-', '_C1C1']])
    const pick = (m: Morpheme, stems: string[]): string[] =>
      stems.map((s) => selectAllomorph(ctx, m, s, 'prefix').form)
    expect(pick(cc, ['stal', 'ttor', 'kl', 'tar', 'arn'])).toEqual([
      'ex-',
      'ex-',
      'ex-',
      'e-',
      'e-'
    ])
    expect(pick(dbl, ['stal', 'ttor', 'kl'])).toEqual(['e-', 'ed-', 'e-'])
  })
  it('后缀看词干末尾：CC_、C1C1_', () => {
    const { ctx, langId } = setup()
    const cc = withEnv(createMorpheme(langId, 'suffix'), '-a', [['-ta', 'CC_']])
    const dbl = withEnv(createMorpheme(langId, 'suffix'), '-a', [['-da', 'C1C1_']])
    const pick = (m: Morpheme, stems: string[]): string[] =>
      stems.map((s) => selectAllomorph(ctx, m, s, 'suffix').form)
    expect(pick(cc, ['kalt', 'kall', 'kala'])).toEqual(['-ta', '-ta', '-a'])
    expect(pick(dbl, ['kalt', 'kall', 'kala'])).toEqual(['-a', '-da', '-a'])
  })
  it('音类按 IPA 写、词干是拼写时，按主正字法转成读音再比一次', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
    const lang = p.languages[0]
    lang.classes = [
      { id: 'c', name: 'C', members: ['k', 'l', 'r', 't'], featureQuery: null },
      { id: 'v', name: 'V', members: ['a', 'e', 'i', 'o', 'u'], featureQuery: null }
    ] as never
    const ortho = lang.orthographies.find((o) => o.isPrimary) ?? lang.orthographies[0]
    if (ortho) ortho.rulesToIpa = 'c > k'
    else
      lang.orthographies.push({
        id: 'o1',
        name: 'o',
        font: '',
        direction: 'ltr',
        rulesToIpa: 'c > k',
        rulesFromIpa: '',
        isPrimary: true
      } as never)
    const ctx = makeContext(p, lang)
    const cc = withEnv(createMorpheme(lang.id, 'prefix'), 'e-', [['ex-', '_CC']])
    expect(['clam', 'cam', 'tram'].map((s) => selectAllomorph(ctx, cc, s, 'prefix').form)).toEqual([
      'ex-',
      'e-',
      'ex-'
    ])
  })
})
