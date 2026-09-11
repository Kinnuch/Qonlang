/**
 * 复合词类与义项自己的词类：拆组成、找已有的复合词类、构形与词干槽沿用组成词类、存盘读回不丢。
 */
import { describe, it, expect } from 'vitest'
import { createLexeme, createProject, createSense } from '$lib/core/factory'
import type { Paradigm, PartOfSpeech } from '$lib/core/model'
import {
  ensureCompoundPos,
  lexemePosIds,
  posParadigmId,
  posParts,
  posStemSlotList,
  posText,
  sensePos
} from '$lib/core/pos'
import { paradigmFor } from '$lib/engine/morph'
import { parseProject, serializeProject } from '$lib/core/serialize'

const mk = (
  id: string,
  zh: string,
  abbr: string,
  extra: Partial<PartOfSpeech> = {}
): PartOfSpeech => ({ id, name: { zh }, abbr, paradigmId: null, ...extra })

function project(): ReturnType<typeof createProject> {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  p.posList = [
    mk('n', '名词', 'n.', { paradigmId: 'decl', stemSlots: [{ name: '强形', notes: '' }] }),
    mk('v', '动词', 'v.')
  ]
  return p
}

describe('compound parts of speech', () => {
  it('finds or creates the compound, whatever the order', () => {
    const p = project()
    const a = ensureCompoundPos(p, ['n', 'v'])!
    expect(a.created).toBe(true)
    expect(a.pos.name).toEqual({ zh: '名词/动词' })
    expect(a.pos.abbr).toBe('n./v.')
    expect(ensureCompoundPos(p, ['v', 'n'])).toEqual({ pos: a.pos, created: false })
    // 只有一个、或者组成里套着复合词类时拆开再算
    expect(ensureCompoundPos(p, ['n'])?.pos.id).toBe('n')
    expect(ensureCompoundPos(p, [a.pos.id, 'v'])?.pos.id).toBe(a.pos.id)
    expect(posParts(p, a.pos.id).map((x) => x.id)).toEqual(['n', 'v'])
    expect(p.posList).toHaveLength(3)
  })

  it('falls back to its parts for paradigm and stem slots', () => {
    const p = project()
    const nv = ensureCompoundPos(p, ['v', 'n'])!.pos
    expect(posParadigmId(p, nv.id)).toBe('decl')
    expect(posStemSlotList(p, nv.id).map((s) => s.name)).toEqual(['强形'])
    p.paradigms.push({ id: 'decl', appliesToAll: false } as unknown as Paradigm)
    const l = createLexeme('L', 'kala')
    l.posId = nv.id
    expect(paradigmFor(p, l)?.id).toBe('decl')
  })

  it('shows a sense part of speech only when it differs from the entry', () => {
    const p = project()
    const nv = ensureCompoundPos(p, ['n', 'v'])!.pos
    const l = createLexeme('L', 'kala')
    l.posId = nv.id
    const s1 = createSense()
    s1.posId = 'n'
    const s2 = createSense()
    l.senses = [s1, s2]
    expect(sensePos(p, l, s1)?.id).toBe('n')
    expect(sensePos(p, l, s2)).toBeUndefined()
    expect(posText(sensePos(p, l, s1))).toBe('n.')
    expect(lexemePosIds(p, l).sort()).toEqual([nv.id, 'n', 'v'].sort())
  })

  it('survives saving and loading', () => {
    const p = project()
    const nv = ensureCompoundPos(p, ['n', 'v'])!.pos
    const l = createLexeme('L', 'kala')
    l.posId = nv.id
    l.senses[0].posId = 'v'
    p.lexemes.push(l)
    const q = parseProject(serializeProject(p))
    expect(q.posList.find((x) => x.id === nv.id)?.components).toEqual(['n', 'v'])
    expect(q.lexemes[0].senses[0].posId).toBe('v')
  })
})
