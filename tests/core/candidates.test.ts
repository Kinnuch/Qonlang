/**
 * 语料悬浮挑候选：本句译文优先，其次别处确认过的与别的例句译文；分不出来并排给最多四条。
 */
import { describe, it, expect } from 'vitest'
import {
  collectEvidence,
  homographIds,
  meaningPieces,
  rankHomographs
} from '$lib/engine/gloss/candidates'
import type { Sentence, Token } from '$lib/core/model'

type Analysis = Token['analyses'][number]
const whole = (id: string, form: string): Analysis =>
  ({
    lexemeId: id,
    slot: null,
    morphs: [{ form, gloss: id, morphemeId: null }]
  }) as unknown as Analysis
const tok = (surface: string, ids: string[], confirmed = false): Token =>
  ({
    surface,
    analyses: ids.map((id) => whole(id, surface)),
    chosen: 0,
    confirmed
  }) as unknown as Token
const sent = (id: string, zh: string, tokens: Token[], languageId = 'L'): Sentence =>
  ({ id, languageId, text: '', translation: zh ? { zh } : {}, tokens }) as unknown as Sentence

const DEFS: Record<string, string> = {
  star: '星；【文】夜晚',
  support: '支持，支撑',
  swing: '摆动',
  a: '甲',
  b: '乙',
  c: '丙',
  d: '丁',
  e: '戊'
}
const defs = (id: string): string[] => meaningPieces(DEFS[id] ?? '')
const HOMO = ['star', 'support', 'swing']

describe('悬浮候选', () => {
  it('切片去掉【】〔〕标注与过短的拉丁词', () => {
    expect(meaningPieces('来，前来〔一价〕；【文】夜晚')).toEqual(['来', '前来', '夜晚'])
    expect(meaningPieces('to go; an apple')).toEqual(['apple'])
  })

  it('同形词条只取整词一段的分析，外加当前选中的', () => {
    const t = tok('sen', ['star', 'support'])
    t.analyses.push({
      lexemeId: 'swing',
      slot: null,
      morphs: [
        { form: 's', gloss: 'x', morphemeId: null },
        { form: 'en', gloss: 'y', morphemeId: null }
      ]
    } as unknown as Analysis)
    expect(homographIds(t)).toEqual(['star', 'support'])
    t.chosen = 2
    expect(homographIds(t)).toEqual(['swing', 'star', 'support'])
  })

  it('本句译文只对得上一条就是它', () => {
    const s = sent('s1', '天上的星', [tok('sen', HOMO)])
    expect(rankHomographs(HOMO, s, undefined, defs)).toEqual(['star'])
  })

  it('没有任何线索时并排给出，保持原顺序', () => {
    const s = sent('s1', '', [tok('sen', HOMO)])
    expect(rankHomographs(HOMO, s, undefined, defs)).toEqual(HOMO)
  })

  it('别处确认过的、别的例句译文提到的胜出；自己这句不算旁证', () => {
    const s1 = sent('s1', '', [tok('sen', HOMO)])
    const confirmed = sent('s2', '', [tok('sen', ['support'], true)])
    expect(
      rankHomographs(HOMO, s1, collectEvidence([s1, confirmed], 'L').get('sen'), defs)
    ).toEqual(['support'])
    const mentioned = sent('s3', '它在风里摆动', [tok('sen', HOMO)])
    expect(
      rankHomographs(HOMO, s1, collectEvidence([s1, mentioned], 'L').get('sen'), defs)
    ).toEqual(['swing'])
    const self = sent('s1', '摆动', [tok('sen', HOMO)])
    expect(rankHomographs(HOMO, s1, collectEvidence([self], 'L').get('sen'), defs)).toEqual(HOMO)
  })

  it('本句译文对得上几条时，只在这几条里按旁证挑', () => {
    const s1 = sent('s1', '星星摆动', [tok('sen', HOMO)])
    const confirmed = sent('s2', '', [tok('sen', ['support'], true)])
    expect(
      rankHomographs(HOMO, s1, collectEvidence([s1, confirmed], 'L').get('sen'), defs)
    ).toEqual(['star', 'swing'])
    const hint = sent('s3', '一直摆动', [tok('sen', HOMO)])
    expect(rankHomographs(HOMO, s1, collectEvidence([s1, hint], 'L').get('sen'), defs)).toEqual([
      'swing'
    ])
  })

  it('最多并排四条；别的语言的例句不算', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    expect(rankHomographs(ids, sent('s1', '', []), undefined, defs)).toEqual(['a', 'b', 'c', 'd'])
    expect(collectEvidence([sent('s2', '甲', [tok('x', ['e'], true)], 'M')], 'L').size).toBe(0)
  })
})
