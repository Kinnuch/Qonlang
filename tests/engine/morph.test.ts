import { describe, it, expect } from 'vitest'
import {
  createProject,
  createLexeme,
  createMorpheme,
  createRuleSet,
  newId
} from '$lib/core/factory'
import { inferFeatures } from '$lib/ipa/features'
import type { GrammaticalCategory, Paradigm } from '$lib/core/model'
import {
  paradigmSlots,
  resolveGenerator,
  generateForm,
  deriveForms,
  reconcile,
  makeContext,
  selectAllomorph
} from '$lib/engine/morph'

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const L = p.languages[0]
  L.phonemes = 'k s t m n l r a e i o u ö ü'
    .split(' ')
    .map((s) => ({ id: newId(), symbol: s, features: inferFeatures(s), graphemes: {}, notes: '' }))
  L.classes = [
    { id: newId(), name: 'V', members: 'a e i o u ö ü'.split(' '), featureQuery: null },
    { id: newId(), name: 'Back', members: ['a', 'o', 'u'], featureQuery: null },
    { id: newId(), name: 'Front', members: ['e', 'ö', 'ü'], featureQuery: null }
  ]
  const num: GrammaticalCategory = {
    id: 'num',
    name: { zh: '数' },
    values: [
      { id: 'sg', name: { zh: '单数' }, abbr: 'SG' },
      { id: 'pl', name: { zh: '复数' }, abbr: 'PL' }
    ]
  }
  const cas: GrammaticalCategory = {
    id: 'cas',
    name: { zh: '格' },
    values: [
      { id: 'nom', name: { zh: '主格' }, abbr: 'NOM' },
      { id: 'acc', name: { zh: '宾格' }, abbr: 'ACC' }
    ]
  }
  p.categories.push(num, cas)
  const rs = createRuleSet(
    'harmony',
    [
      '{Back}=a o u',
      '{Front}=e ö ü',
      '-* 底层',
      'A > e / {Front}[^aeouöü]*_',
      'A > a / _',
      'Ŭ > / V¢_',
      'Ŭ > u / _',
      '¢ > / _',
      '-* 表层'
    ].join('\n')
  )
  p.ruleSets.push(rs)
  const pl = createMorpheme(L.id, 'suffix')
  pl.form = '-lAr'
  pl.gloss = 'PL'
  pl.allomorphs = [
    { form: '-lar', environment: '{Back}[^aeouöü]*_' },
    { form: '-ler', environment: '{Front}[^aeouöü]*_' }
  ]
  p.morphemes.push(pl)
  const para: Paradigm = {
    id: 'para',
    name: { zh: '名词' },
    dimensionIds: ['num', 'cas'],
    disabledSlots: [],
    generators: {
      'sg|nom': { kind: 'affix', stem: '', prefix: '', suffix: '', infix: '', infixAt: '' },
      'pl|nom': { kind: 'affix', stem: '', prefix: '', suffix: '@-lAr', infix: '', infixAt: '' },
      'sg|acc': {
        kind: 'affix-sca',
        stem: '',
        prefix: '',
        suffix: '¢Ŭm',
        ruleSetId: rs.id,
        fromStage: '底层',
        toStage: '表层'
      },
      'pl|acc': {
        kind: 'affix-sca',
        stem: '',
        prefix: '',
        suffix: '¢lAr¢Ŭm',
        ruleSetId: rs.id,
        fromStage: '',
        toStage: ''
      }
    },
    inheritsFrom: null
  }
  p.paradigms.push(para)
  p.posList.push({ id: 'n', name: { zh: '名词' }, abbr: 'n', paradigmId: 'para' })
  const kaso = createLexeme(L.id, 'kaso')
  kaso.posId = 'n'
  const nöl = createLexeme(L.id, 'nöl')
  nöl.posId = 'n'
  p.lexemes.push(kaso, nöl)
  return { p, L, para, kaso, nöl, pl, ctx: makeContext(p, L) }
}

describe('paradigm slots', () => {
  it('builds the cartesian product with labels and abbreviations', () => {
    const { p, para } = setup()
    const slots = paradigmSlots(para, p.categories, ['zh'])
    expect(slots.map((s) => s.label)).toEqual(['单数.主格', '单数.宾格', '复数.主格', '复数.宾格'])
    expect(slots[3].abbr).toBe('PL.ACC')
    para.disabledSlots = ['pl|acc']
    expect(paradigmSlots(para, p.categories, ['zh'])).toHaveLength(3)
  })
  it('inherits generators from a parent paradigm', () => {
    const { p, para } = setup()
    const child: Paradigm = {
      id: 'child',
      name: {},
      dimensionIds: para.dimensionIds,
      disabledSlots: [],
      generators: {
        'sg|nom': { kind: 'affix', stem: '', prefix: 'x', suffix: '', infix: '', infixAt: '' }
      },
      inheritsFrom: 'para'
    }
    p.paradigms.push(child)
    expect(resolveGenerator(child, 'sg|nom', p.paradigms)).toMatchObject({ prefix: 'x' })
    expect(resolveGenerator(child, 'pl|nom', p.paradigms)).toMatchObject({ suffix: '@-lAr' })
  })
})

describe('generators', () => {
  it('affix with morpheme reference picks the allomorph by environment', () => {
    const { p, para, kaso, nöl, ctx, pl } = setup()
    const slots = paradigmSlots(para, p.categories, ['zh'])
    const plNom = slots.find((s) => s.key === 'pl|nom')!
    expect(generateForm(ctx, kaso, para, plNom)?.surface).toBe('kasolar')
    expect(generateForm(ctx, nöl, para, plNom)?.surface).toBe('nöller')
    expect(selectAllomorph(ctx, pl, 'kaso', 'suffix').form).toBe('-lar')
  })
  it('affix-sca runs the rule set between stages', () => {
    const { p, para, kaso, nöl, ctx } = setup()
    const slots = paradigmSlots(para, p.categories, ['zh'])
    expect(
      generateForm(
        ctx,
        kaso,
        para,
        slots.find((s) => s.key === 'sg|acc')!
      )?.surface
    ).toBe('kasom')
    expect(
      generateForm(
        ctx,
        nöl,
        para,
        slots.find((s) => s.key === 'sg|acc')!
      )?.surface
    ).toBe('nölum'.replace('nölum', 'nölum'))
    expect(
      generateForm(
        ctx,
        kaso,
        para,
        slots.find((s) => s.key === 'pl|acc')!
      )?.surface
    ).toBe('kasolarum')
    const g = generateForm(
      ctx,
      kaso,
      para,
      slots.find((s) => s.key === 'pl|acc')!
    )!
    expect(g.trace.length).toBeGreaterThan(2)
  })
  it('pattern, reduplication and infix generators', () => {
    const { p, L, ctx } = setup()
    const root = createLexeme(L.id, 'ktb')
    const para: Paradigm = {
      id: 'x',
      name: {},
      dimensionIds: ['num'],
      disabledSlots: [],
      generators: {
        sg: { kind: 'pattern', stem: '', pattern: 'C1aC2aC3' },
        pl: { kind: 'pattern', stem: '', pattern: 'maCCuC' }
      },
      inheritsFrom: null
    }
    p.paradigms.push(para)
    const slots = paradigmSlots(para, p.categories, ['zh'])
    expect(generateForm(ctx, root, para, slots[0])?.surface).toBe('katab')
    expect(generateForm(ctx, root, para, slots[1])?.surface).toBe('maktub')
    const red: Paradigm = {
      id: 'r',
      name: {},
      dimensionIds: ['num'],
      disabledSlots: [],
      generators: {
        sg: { kind: 'reduplication', stem: '', scope: 'initial', length: 2 },
        pl: { kind: 'affix', stem: '', prefix: '', suffix: '', infix: 'um', infixAt: 'C1' }
      },
      inheritsFrom: null
    }
    const w = createLexeme(L.id, 'kalo')
    expect(generateForm(ctx, w, red, paradigmSlots(red, p.categories, ['zh'])[0])?.surface).toBe(
      'kakalo'
    )
    expect(generateForm(ctx, w, red, paradigmSlots(red, p.categories, ['zh'])[1])?.surface).toBe(
      'kumalo'
    )
  })
  it('uses named stems and strips hyphens', () => {
    const { p, L, ctx } = setup()
    const w = createLexeme(L.id, 'kel-')
    w.stems = { strong: 'kēl-' }
    const para: Paradigm = {
      id: 's',
      name: {},
      dimensionIds: ['num'],
      disabledSlots: [],
      generators: {
        sg: { kind: 'affix', stem: 'strong', prefix: '', suffix: '-s', infix: '', infixAt: '' },
        pl: { kind: 'affix', stem: 'missing', prefix: '', suffix: 'i', infix: '', infixAt: '' }
      },
      inheritsFrom: null
    }
    const slots = paradigmSlots(para, p.categories, ['zh'])
    expect(generateForm(ctx, w, para, slots[0])?.surface).toBe('kēls')
    expect(generateForm(ctx, w, para, slots[1])?.surface).toBe('keli')
  })
})

describe('adjustments', () => {
  it('applies shorthand and rule lines before and after the generator', () => {
    const { p, L, ctx } = setup()
    const rs = p.ruleSets[0]
    const w = createLexeme(L.id, 'kaso')
    const para: Paradigm = {
      id: 'a',
      name: {},
      dimensionIds: ['num'],
      disabledSlots: [],
      generators: {
        sg: {
          kind: 'affix-sca',
          stem: '',
          prefix: '',
          suffix: '¢wat',
          ruleSetId: rs.id,
          fromStage: '',
          toStage: '',
          pre: '-at',
          post: '+i\nk > g / #_'
        },
        pl: {
          kind: 'affix',
          stem: '',
          prefix: '',
          suffix: 'lar',
          infix: '',
          infixAt: '',
          post: '^-k\n-r\nV > / _#'
        }
      },
      inheritsFrom: null
    }
    const slots = paradigmSlots(para, p.categories, ['zh'])
    const sg = generateForm(ctx, w, para, slots[0])!
    expect(sg.surface).toBe('gasowi')
    expect(sg.trace.some((l) => l.includes('微调(前) -at'))).toBe(true)
    expect(generateForm(ctx, w, para, slots[1])?.surface).toBe('asol')
  })
})

describe('derive and reconcile', () => {
  it('writes derived forms but keeps overrides, and reports agreement', () => {
    const { para, kaso, nöl, ctx } = setup()
    kaso.forms['复数.宾格'] = { surface: 'kasolarum', derived: false, override: true, trace: [] }
    nöl.forms['复数.宾格'] = { surface: 'nölleri', derived: false, override: true, trace: [] }
    nöl.forms['单数.宾格'] = { surface: 'nölüm, nölum', derived: false, override: true, trace: [] }
    expect(deriveForms(ctx, kaso, para)).toBe(3)
    expect(kaso.forms['复数.主格']).toMatchObject({ surface: 'kasolar', derived: true })
    expect(kaso.forms['复数.宾格'].surface).toBe('kasolarum')
    const rep = reconcile(ctx, [kaso, nöl], para)
    const plAcc = rep.find((r) => r.slot.key === 'pl|acc')!
    expect(plAcc.same).toBe(1)
    expect(plAcc.diff).toBe(1)
    expect(plAcc.examples[0]).toEqual({ lemma: 'nöl', stored: 'nölleri', generated: 'nöllerum' })
    const sgAcc = rep.find((r) => r.slot.key === 'sg|acc')!
    expect(sgAcc.same).toBe(1)
    expect(sgAcc.missing).toBe(1)
  })
})
