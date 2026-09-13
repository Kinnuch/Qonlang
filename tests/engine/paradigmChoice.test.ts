import { describe, it, expect } from 'vitest'
import { createProject, createLexeme, newId } from '$lib/core/factory'
import type { GrammaticalCategory, Paradigm, PartOfSpeech, SlotGenerator } from '$lib/core/model'
import {
  bindPosParadigm,
  posParadigmId,
  posParadigmIds,
  setDefaultPosParadigm,
  unbindParadigm
} from '$lib/core/pos'
import { deriveForms, makeContext, paradigmFor } from '$lib/engine/morph'
import { parseProject, serializeProject } from '$lib/core/serialize'

function setup() {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const L = p.languages[0]
  const gender: GrammaticalCategory = {
    id: 'gen',
    name: { zh: '性' },
    values: [
      { id: 'm', name: { zh: '阳' }, abbr: 'M' },
      { id: 'f', name: { zh: '阴' }, abbr: 'F' }
    ]
  }
  const kase: GrammaticalCategory = {
    id: 'case',
    name: { zh: '格' },
    values: [
      { id: 'nom', name: { zh: '主格' }, abbr: 'NOM' },
      { id: 'dat', name: { zh: '与格' }, abbr: 'DAT' }
    ]
  }
  p.categories.push(gender, kase)
  const pipe = (...texts: string[]): SlotGenerator => ({
    kind: 'pipeline',
    stem: '',
    steps: texts.map((text) => ({ id: newId(), kind: 'suffix', text }))
  })
  const mk = (name: string, generators: Paradigm['generators']): Paradigm => ({
    id: newId(),
    name: { zh: name },
    variants: [],
    dimensionIds: ['case'],
    disabledSlots: [],
    generators,
    inheritsFrom: null
  })
  const decl = mk('名词', { nom: pipe(), dat: pipe('-{阴:g|k}a') })
  const conj1 = mk('变位法一', { nom: pipe('-ar'), dat: pipe('-ar') })
  const conj2 = mk('变位法二', { nom: pipe('-ir'), dat: pipe('-ir') })
  p.paradigms.push(decl, conj1, conj2)
  const N: PartOfSpeech = { id: newId(), name: { zh: '名词' }, abbr: 'n.', paradigmId: decl.id }
  const V: PartOfSpeech = { id: newId(), name: { zh: '动词' }, abbr: 'v.', paradigmId: null }
  p.posList.push(N, V)
  return { p, L, decl, conj1, conj2, N, V }
}

describe('a part of speech with several paradigms', () => {
  it('binds, reorders and unbinds paradigms, keeping one default', () => {
    const { p, conj1, conj2, V } = setup()
    bindPosParadigm(V, conj1.id, true)
    bindPosParadigm(V, conj2.id, true)
    expect(posParadigmIds(p, V.id)).toEqual([conj1.id, conj2.id])
    expect(posParadigmId(p, V.id)).toBe(conj1.id)
    setDefaultPosParadigm(V, conj2.id)
    expect([V.paradigmId, V.extraParadigmIds]).toEqual([conj2.id, [conj1.id]])
    bindPosParadigm(V, conj2.id, false)
    expect([V.paradigmId, V.extraParadigmIds]).toEqual([conj1.id, undefined])
    unbindParadigm(p, conj1.id)
    expect(V.paradigmId).toBeNull()
  })
  it('entries use the default unless they pick another one; the choice survives saving', () => {
    const { p, L, conj1, conj2, V } = setup()
    bindPosParadigm(V, conj1.id, true)
    bindPosParadigm(V, conj2.id, true)
    const a = createLexeme(L.id, 'kan')
    a.posId = V.id
    const b = createLexeme(L.id, 'sel')
    b.posId = V.id
    b.paradigmId = conj2.id
    p.lexemes.push(a, b)
    expect(paradigmFor(p, a)?.id).toBe(conj1.id)
    expect(paradigmFor(p, b)?.id).toBe(conj2.id)
    const ctx = makeContext(p, L)
    deriveForms(ctx, a, paradigmFor(p, a)!)
    deriveForms(ctx, b, paradigmFor(p, b)!)
    expect(a.forms['主格'].surface).toBe('kanar')
    expect(b.forms['主格'].surface).toBe('selir')
    const back = parseProject(serializeProject(p))
    expect(back.posList.find((x) => x.id === V.id)?.extraParadigmIds).toEqual([conj2.id])
  })
  it('changes one letter of an affix by the entry’s gender', () => {
    const { p, L, decl, N } = setup()
    const make = (lemma: string, g?: string) => {
      const l = createLexeme(L.id, lemma)
      l.posId = N.id
      if (g) l.features.gen = g
      p.lexemes.push(l)
      deriveForms(makeContext(p, L), l, decl)
      return l.forms['与格']
    }
    expect(make('tal', 'f').surface).toBe('talga')
    expect(make('kor', 'm').surface).toBe('korka')
    expect(make('mur').surface).toBe('murka')
    expect(make('tal', 'f').trace.some((x) => x.includes('-{阴:g|k}a → -ga'))).toBe(true)
  })
})
