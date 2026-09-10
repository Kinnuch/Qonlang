import { describe, it, expect } from 'vitest'
import { createLanguage, createProject, createSentence } from '$lib/core/factory'
import {
  findDuplicateSentences,
  mergeSentences,
  mergeSource,
  sentenceSimilarity
} from '$lib/core/sentenceDedup'

function build() {
  const project = createProject({ name: 'p', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const lang = createLanguage({ name: 'L' })
  project.languages.push(lang)
  const mk = (text: string, source: string, tr = ''): ReturnType<typeof createSentence> => {
    const s = createSentence(lang.id)
    s.text = text
    s.source = source
    if (tr) s.translation = { zh: tr }
    project.sentences.push(s)
    return s
  }
  return { project, lang, mk }
}

describe('sentenceSimilarity', () => {
  it('is 1 for same text ignoring case and spacing, lower for edits', () => {
    expect(sentenceSimilarity('Ilen  ler kaso', 'ilen ler   kaso')).toBe(1)
    expect(sentenceSimilarity('ilen ler kaso da', 'ilen ler kaso du')).toBeGreaterThan(0.8)
    expect(sentenceSimilarity('abc', 'xyz')).toBe(0)
  })
})

describe('findDuplicateSentences', () => {
  it('auto-merges when only the source differs, asks when text or translation differs', () => {
    const { project, mk } = build()
    const a = mk('ilen ler kaso da', 'A', '孩子在房子里')
    mk('Ilen ler kaso da', 'B')
    mk('ilen ler kaso du', 'C', '孩子在房子里')
    mk('completely different words here', 'D')
    const pairs = findDuplicateSentences(project)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].auto).toBe(true)
    expect(pairs[0].keep.id).toBe(a.id)
    // 把 B 合掉之后，C 和 A 差一个字母：要问
    mergeSentences(project, pairs[0].keep, pairs[0].drop)
    const again = findDuplicateSentences(project)
    expect(again).toHaveLength(1)
    expect(again[0].auto).toBe(false)
    expect(again[0].similarity).toBeGreaterThanOrEqual(0.8)
  })

  it('does not auto-merge same text with conflicting translations', () => {
    const { project, mk } = build()
    mk('ilen ler', 'A', '孩子们')
    mk('ilen ler', 'B', '房子们')
    const pairs = findDuplicateSentences(project)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].auto).toBe(false)
  })

  it('limits to pairs involving the given ids', () => {
    const { project, mk } = build()
    mk('ilen ler kaso', 'A')
    mk('ilen ler kaso', 'B')
    const c = mk('jat du', 'C')
    expect(findDuplicateSentences(project, { among: new Set([c.id]) })).toHaveLength(0)
  })
})

describe('mergeSentences', () => {
  it('joins sources with & and fills missing fields', () => {
    const { project, mk } = build()
    const a = mk('ilen ler', 'A', '孩子们')
    const b = mk('ilen ler', 'B')
    b.tags = ['x']
    b.translation = { en: 'children' }
    b.extraLines = [{ label: 'lit', text: 'child-PL' }]
    mergeSentences(project, a, b)
    expect(project.sentences).toHaveLength(1)
    expect(a.source).toBe('A & B')
    expect(a.translation).toEqual({ zh: '孩子们', en: 'children' })
    expect(a.tags).toEqual(['x'])
    expect(a.extraLines).toHaveLength(1)
  })
  it('mergeSource dedupes pieces', () => {
    expect(mergeSource('A & B', 'B')).toBe('A & B')
    expect(mergeSource('', 'B')).toBe('B')
    expect(mergeSource('A', 'A')).toBe('A')
  })
})
