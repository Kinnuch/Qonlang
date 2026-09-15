import { describe, it, expect } from 'vitest'
import { createProject, createLexeme, newId } from '$lib/core/factory'
import type { GrammaticalCategory, MorphStep, Paradigm, SlotGenerator } from '$lib/core/model'
import {
  deriveLexemeForms,
  formKeyOf,
  generateForm,
  lexemeSlots,
  makeContext,
  paradigmSlots,
  paradigmsFor
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
  const form: GrammaticalCategory = {
    id: 'vform',
    name: { zh: '形式' },
    values: [
      { id: 'inf', name: { zh: '不定式' }, abbr: 'INF' },
      { id: 'ger', name: { zh: '动名词' }, abbr: 'GER' }
    ]
  }
  p.categories.push(kase, form)
  const pipe = (...steps: MorphStep[]): SlotGenerator => ({ kind: 'pipeline', stem: '', steps })
  const suf = (text: string): MorphStep => ({ id: newId(), kind: 'suffix', text })
  const mk = (name: string, dims: string[], generators: Paradigm['generators']): Paradigm => ({
    id: newId(),
    name: { zh: name },
    variants: [],
    dimensionIds: dims,
    disabledSlots: [],
    generators,
    inheritsFrom: null
  })
  const noun = mk('名词', ['case'], { nom: pipe(), gen: pipe(suf('-is')) })
  const verb = mk('动词', ['vform'], { inf: pipe(suf('-ar')), ger: pipe(suf('-ando')) })
  // 形容词也按格变，槽位名跟名词撞了
  const adj = mk('形容词', ['case'], { nom: pipe(suf('-e')), gen: pipe(suf('-es')) })
  p.paradigms.push(noun, verb, adj)
  return { p, L, noun, verb, adj, suf, pipe }
}

describe('一个词条用几个构形', () => {
  it('后加的构形也推导，形式都存进词条；槽位名撞了的键前面加构形名', () => {
    const { p, L, noun, verb, adj } = setup()
    const l = createLexeme(L.id, 'kant')
    l.paradigmId = noun.id
    l.extraParadigms = [{ paradigmId: verb.id }, { paradigmId: adj.id }]
    p.lexemes.push(l)
    expect(paradigmsFor(p, l).map((x) => x.paradigm.id)).toEqual([noun.id, verb.id, adj.id])
    deriveLexemeForms(makeContext(p, L), l)
    expect(l.forms['属格'].surface).toBe('kantis')
    expect(l.forms['动名词'].surface).toBe('kantando')
    expect(l.forms['形容词·属格'].surface).toBe('kantes')
    const genSlot = paradigmSlots(adj, p.categories, ['zh']).find((s) => s.key === 'gen')!
    expect(formKeyOf(p, l, adj.id, genSlot)).toBe('形容词·属格')
    expect(lexemeSlots(p, l).map((s) => s.key)).toContain('形容词·主格')
  })
})

describe('构形套构形', () => {
  it('流水线里的「构形」一步把到这一步的形式当词干，套另一个构形的槽位', () => {
    const { p, L, noun, verb, suf } = setup()
    // 动词的「动名词属格」：先加 -ando，再套名词的属格
    verb.generators.ger = {
      kind: 'pipeline',
      stem: '',
      steps: [suf('-ando'), { id: newId(), kind: 'paradigm', paradigmId: noun.id, slotKey: 'gen' }]
    }
    const l = createLexeme(L.id, 'kant')
    const slot = paradigmSlots(verb, p.categories, ['zh']).find((s) => s.key === 'ger')!
    const g = generateForm(makeContext(p, L), l, verb, slot)
    expect(g?.surface).toBe('kantandois')
    expect(g?.trace.some((x) => x.startsWith('构形 名词 · 属格'))).toBe(true)
  })

  it('套回自己也不会没完没了：超过几层就停下', () => {
    const { p, L, noun } = setup()
    noun.generators.gen = {
      kind: 'pipeline',
      stem: '',
      steps: [{ id: newId(), kind: 'paradigm', paradigmId: noun.id, slotKey: 'gen' }]
    }
    const l = createLexeme(L.id, 'kant')
    const slot = paradigmSlots(noun, p.categories, ['zh']).find((s) => s.key === 'gen')!
    const g = generateForm(makeContext(p, L), l, noun, slot)
    expect(g?.surface).toBe('kant')
    expect(g?.trace.join('\n')).toContain('套得太深')
  })
})
