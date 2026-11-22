/**
 * 语素异体形的语法条件：「宾格用这一形、与格用那一形」，构形推导时按正在生成的那一格自动挑。
 */
import { describe, it, expect } from 'vitest'
import { createLexeme, createMorpheme, createProject, newId } from '$lib/core/factory'
import {
  generateForm,
  makeContext,
  paradigmSlots,
  selectAllomorph,
  type SlotDef
} from '$lib/engine/morph'
import { activeValues } from '$lib/engine/morph/conditions'
import { valueMatch } from '$lib/engine/morph/allomorph'
import { parseProject, serializeProject } from '$lib/core/serialize'
import type { Allomorph, GrammaticalCategory, MorphStep, Paradigm } from '$lib/core/model'

const step = (s: Omit<MorphStep, 'id'>): MorphStep => ({ id: newId(), ...s }) as MorphStep

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  const L = p.languages[0]
  L.classes = [
    { id: newId(), name: 'V', members: ['a', 'e', 'i', 'o', 'u'], featureQuery: null },
    { id: newId(), name: 'C', members: ['k', 's', 't', 'm', 'n', 'l', 'r'], featureQuery: null }
  ]
  const cas: GrammaticalCategory = {
    id: 'cas',
    name: { zh: '格' },
    values: [
      { id: 'nom', name: { zh: '主格' }, abbr: 'NOM' },
      { id: 'acc', name: { zh: '宾格' }, abbr: 'ACC' },
      { id: 'dat', name: { zh: '与格' }, abbr: 'DAT' }
    ]
  }
  const num: GrammaticalCategory = {
    id: 'num',
    name: { zh: '数' },
    values: [
      { id: 'sg', name: { zh: '单数' }, abbr: 'SG' },
      { id: 'pl', name: { zh: '复数' }, abbr: 'PL' }
    ]
  }
  p.categories.push(cas, num)
  const suf = createMorpheme(L.id, 'suffix')
  suf.form = '-a'
  suf.gloss = 'CASE'
  const pre = createMorpheme(L.id, 'prefix')
  pre.form = 'e-'
  pre.gloss = 'DEF'
  p.morphemes.push(suf, pre)
  const para: Paradigm = {
    id: 'para',
    name: { zh: '名词' },
    variants: [],
    dimensionIds: ['cas', 'num'],
    disabledSlots: [],
    generators: {},
    inheritsFrom: null
  }
  p.paradigms.push(para)
  p.posList.push({ id: 'n', name: { zh: '名词' }, abbr: 'n', paradigmId: 'para' })
  const kaso = createLexeme(L.id, 'kaso')
  kaso.posId = 'n'
  const kator = createLexeme(L.id, 'kator')
  kator.posId = 'n'
  p.lexemes.push(kaso, kator)
  const slots = paradigmSlots(para, p.categories, ['zh'])
  const slotOf = (label: string): SlotDef => slots.find((s) => s.label === label)!
  /** 每一格都是「词干 + @CASE」 */
  const suffixEverywhere = (): void => {
    for (const s of slots) para.generators[s.key] = { kind: 'pipeline', stem: '', steps: [] }
    for (const s of slots)
      para.generators[s.key] = {
        kind: 'pipeline',
        stem: '',
        steps: [step({ kind: 'suffix', text: '@CASE' })]
      }
  }
  return {
    p,
    L,
    para,
    suf,
    pre,
    kaso,
    kator,
    slots,
    slotOf,
    suffixEverywhere,
    ctx: makeContext(p, L)
  }
}

/** 这一格的取值（推导时 generateForm 交给 selectAllomorph 的就是这一份） */
const valuesOf = (slot: SlotDef): ReadonlyMap<string, string> => activeValues(slot.values, null)

describe('异体形按维度取值挑', () => {
  it('旧条件缺省全满足；任一满足支持同一维度的备选取值', () => {
    const { para, suf, kaso, slotOf, suffixEverywhere, ctx } = setup()
    const row: Allomorph = { form: '-x', environment: '', values: ['acc', 'dat'] }
    suf.allomorphs = [row]
    suffixEverywhere()
    expect(generateForm(ctx, kaso, para, slotOf('宾格.单数'))?.surface).toBe('kasoa')
    row.valueMatch = 'any'
    expect(generateForm(ctx, kaso, para, slotOf('宾格.单数'))?.surface).toBe('kasox')
    expect(generateForm(ctx, kaso, para, slotOf('与格.复数'))?.surface).toBe('kasox')
    expect(generateForm(ctx, kaso, para, slotOf('主格.单数'))?.surface).toBe('kasoa')
  })

  it('任一取值也必须同时满足出现环境，轨迹仅列出实际对上的取值', () => {
    const { para, suf, kaso, kator, slotOf, suffixEverywhere, ctx } = setup()
    suf.allomorphs = [{ form: '-x', environment: 'V_', values: ['acc', 'dat'], valueMatch: 'any' }]
    suffixEverywhere()
    const result = generateForm(ctx, kaso, para, slotOf('宾格.单数'))
    expect(result?.surface).toBe('kasox')
    expect(result?.trace.some((line) => line.includes('(宾格 · V_)'))).toBe(true)
    expect(result?.trace.join('\n')).not.toContain('与格')
    expect(generateForm(ctx, kator, para, slotOf('宾格.单数'))?.surface).toBe('katora')
  })

  it('任一条件按实际对上的个数排序，未命中的备选项不增加优先级', () => {
    const { suf, slotOf, ctx } = setup()
    suf.allomorphs = [
      { form: '-any', environment: '', values: ['acc', 'dat', 'nom'], valueMatch: 'any' },
      { form: '-both', environment: '', values: ['acc', 'pl'] }
    ]
    expect(selectAllomorph(ctx, suf, 'kaso', 'suffix', valuesOf(slotOf('宾格.复数'))).form).toBe(
      '-both'
    )
    expect(
      valueMatch(
        { form: '', environment: '', values: ['acc', 'acc', '', 'pl'], valueMatch: 'any' },
        new Set(['acc'])
      )
    ).toBe(1)
  })

  it('任一条件留空不限，没有槽位信息时仍不选择带取值的行', () => {
    expect(valueMatch({ form: '', environment: '', valueMatch: 'any', values: [] }, null)).toBe(0)
    expect(
      valueMatch({ form: '', environment: '', valueMatch: 'any', values: ['acc'] }, null)
    ).toBeNull()
    expect(
      valueMatch({ form: '', environment: '', valueMatch: 'any', values: ['acc'] }, new Set())
    ).toBeNull()
  })

  it('任一条件存盘重开保留，旧异体形不补写匹配方式', () => {
    const { p, suf } = setup()
    suf.allomorphs = [
      { form: '-x', environment: 'V_', values: ['acc', 'dat'], valueMatch: 'any' },
      { form: '-old', environment: '', values: ['pl'] }
    ]
    expect(parseProject(serializeProject(p)).morphemes[0].allomorphs).toEqual(suf.allomorphs)
    expect(suf.allomorphs[1]).not.toHaveProperty('valueMatch')
  })

  it('同一个构形的两格各推各的形', () => {
    const { p, para, suf, kaso, slotOf, suffixEverywhere, ctx } = setup()
    suf.allomorphs = [
      { form: '-en', environment: '', values: ['acc'] },
      { form: '-im', environment: '', values: ['dat'] }
    ]
    suffixEverywhere()
    expect(generateForm(ctx, kaso, para, slotOf('宾格.单数'))?.surface).toBe('kasoen')
    expect(generateForm(ctx, kaso, para, slotOf('与格.单数'))?.surface).toBe('kasoim')
    // 没写取值的那些格用语素本身的形式
    expect(generateForm(ctx, kaso, para, slotOf('主格.单数'))?.surface).toBe('kasoa')
    expect(p.categories).toHaveLength(2)
  })

  it('前缀、中缀、环缀里的 @语素 引用也按取值挑', () => {
    const { para, pre, kaso, slots, slotOf, ctx } = setup()
    pre.allomorphs = [
      { form: 'ex-', environment: '', values: ['acc'] },
      { form: 'ed-', environment: '', values: ['dat'] }
    ]
    for (const s of slots)
      para.generators[s.key] = {
        kind: 'pipeline',
        stem: '',
        steps: [step({ kind: 'prefix', text: '@DEF' })]
      }
    expect(generateForm(ctx, kaso, para, slotOf('宾格.单数'))?.surface).toBe('exkaso')
    expect(generateForm(ctx, kaso, para, slotOf('与格.单数'))?.surface).toBe('edkaso')
    for (const s of slots)
      para.generators[s.key] = {
        kind: 'pipeline',
        stem: '',
        steps: [step({ kind: 'circumfix', text: '@DEF', text2: '@CASE' })]
      }
    expect(generateForm(ctx, kaso, para, slotOf('宾格.单数'))?.surface).toBe('exkasoa')
    for (const s of slots)
      para.generators[s.key] = {
        kind: 'pipeline',
        stem: '',
        steps: [step({ kind: 'infix', text: '@DEF', at: 'V1' })]
      }
    expect(generateForm(ctx, kaso, para, slotOf('与格.单数'))?.surface).toBe('kaedso')
  })

  it('继承别的槽位时，按正在生成的那一格的取值挑', () => {
    const { para, suf, kaso, slotOf, suffixEverywhere, ctx } = setup()
    suf.allomorphs = [
      { form: '-en', environment: '', values: ['acc'] },
      { form: '-im', environment: '', values: ['dat'] }
    ]
    suffixEverywhere()
    const nomSg = slotOf('主格.单数')
    const accSg = slotOf('宾格.单数')
    para.generators[accSg.key] = {
      kind: 'pipeline',
      stem: '',
      base: { paradigmId: null, slotKey: nomSg.key },
      steps: [step({ kind: 'suffix', text: '@CASE' })]
    }
    // 起点那一格是主格（用默认形 -a），接着加的这一步才是宾格
    expect(generateForm(ctx, kaso, para, accSg)?.surface).toBe('kasoaen')
  })

  it('取值与环境都写了时两边都要对上', () => {
    const { para, suf, kaso, kator, slotOf, suffixEverywhere, ctx } = setup()
    suf.allomorphs = [
      { form: '-nen', environment: 'V_', values: ['acc'] },
      { form: '-en', environment: '', values: ['acc'] }
    ]
    suffixEverywhere()
    const accSg = slotOf('宾格.单数')
    expect(generateForm(ctx, kaso, para, accSg)?.surface).toBe('kasonen')
    expect(generateForm(ctx, kator, para, accSg)?.surface).toBe('katoren')
    // 环境对上了但取值对不上：这一条不能用
    expect(generateForm(ctx, kaso, para, slotOf('主格.单数'))?.surface).toBe('kasoa')
  })

  it('越具体越优先：取值多的 > 有环境的 > 默认形；一样具体时按先后', () => {
    const { suf, slotOf, ctx } = setup()
    const accPl = valuesOf(slotOf('宾格.复数'))
    const pick = (allos: Allomorph[]): string => {
      suf.allomorphs = allos
      return selectAllomorph(ctx, suf, 'kaso', 'suffix', accPl).form
    }
    // 对上两个取值的赢了只对上一个的，跟写的先后无关
    expect(
      pick([
        { form: '-en', environment: '', values: ['acc'] },
        { form: '-ensa', environment: '', values: ['acc', 'pl'] }
      ])
    ).toBe('-ensa')
    expect(
      pick([
        { form: '-ensa', environment: '', values: ['acc', 'pl'] },
        { form: '-en', environment: '', values: ['acc'] }
      ])
    ).toBe('-ensa')
    // 取值一样多时，环境也对上的排在前面
    expect(
      pick([
        { form: '-en', environment: '', values: ['acc'] },
        { form: '-nen', environment: 'V_', values: ['acc'] }
      ])
    ).toBe('-nen')
    // 只写了取值的，仍然排在只写环境的前面
    expect(
      pick([
        { form: '-na', environment: 'V_' },
        { form: '-en', environment: '', values: ['acc'] }
      ])
    ).toBe('-en')
    // 全一样具体：留着先写的那条
    expect(
      pick([
        { form: '-en', environment: '', values: ['acc'] },
        { form: '-un', environment: '', values: ['acc'] }
      ])
    ).toBe('-en')
    // 一条都没对上就是默认形（没写取值也没写环境的那条）
    expect(
      pick([
        { form: '-ok', environment: '', values: ['dat'] },
        { form: '-aa', environment: '' }
      ])
    ).toBe('-aa')
  })

  it('没有这一格的取值时（语素页的预览、语料分词）只看环境，跟以前一样', () => {
    const { suf, ctx } = setup()
    suf.allomorphs = [
      { form: '-en', environment: '', values: ['acc'] },
      { form: '-na', environment: 'V_' },
      { form: '-aa', environment: '' }
    ]
    // 写了取值的挑不到；环境该对上还是对上
    expect(selectAllomorph(ctx, suf, 'kaso', 'suffix').form).toBe('-na')
    expect(selectAllomorph(ctx, suf, 'kator', 'suffix').form).toBe('-aa')
    suf.allomorphs = [{ form: '-en', environment: '', values: ['acc'] }]
    expect(selectAllomorph(ctx, suf, 'kaso', 'suffix').form).toBe('-a')
    // 老写法（只有环境）一个字都没变
    suf.allomorphs = [
      { form: '-na', environment: 'V_' },
      { form: '-ta', environment: 'C_' }
    ]
    expect(selectAllomorph(ctx, suf, 'kaso', 'suffix').form).toBe('-na')
    expect(selectAllomorph(ctx, suf, 'kator', 'suffix').form).toBe('-ta')
  })

  it('推导轨迹里写清楚是按哪个取值挑的', () => {
    const { para, suf, kaso, slotOf, suffixEverywhere, ctx } = setup()
    suf.allomorphs = [{ form: '-en', environment: 'V_', values: ['acc'] }]
    suffixEverywhere()
    const g = generateForm(ctx, kaso, para, slotOf('宾格.单数'))
    expect(g?.trace.some((x) => x.includes('-a → -en (宾格 · V_)'))).toBe(true)
  })
})
