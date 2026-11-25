import { describe, it, expect } from 'vitest'
import { createProject, createSentence } from '$lib/core/factory'
import {
  selectCorpusSentence,
  removeCorpusSentences,
  restoreCorpusSentences
} from '$lib/core/corpusSelection'
describe('语料可见范围多选与批量删除', () => {
  it('Shift范围与Ctrl增减按可见ID排序，Ctrl+Shift追加范围', () => {
    const v = ['a', 'b', 'c', 'd']
    expect(selectCorpusSentence(v, ['b'], 'b', 'd', { shift: true, toggle: false }).ids).toEqual([
      'b',
      'c',
      'd'
    ])
    expect(
      selectCorpusSentence(v, ['a', 'c'], 'a', 'c', { shift: false, toggle: true }).ids
    ).toEqual(['a'])
    expect(selectCorpusSentence(v, ['a'], 'b', 'd', { shift: true, toggle: true }).ids).toEqual([
      'a',
      'b',
      'c',
      'd'
    ])
  })
  it('筛选外的旧锚点与选中ID不进入新范围', () => {
    expect(
      selectCorpusSentence(['b', 'd'], ['a', 'c'], 'a', 'd', { shift: true, toggle: false })
    ).toEqual({ ids: ['d'], anchor: 'd' })
  })
  it('删除仅限当前可见项；撤销保持原ID顺序并不覆盖新条目', () => {
    const p = createProject({ name: 'QA', template: 'blank', appVersion: '1.1.0', uiLocale: 'zh' }),
      l = p.languages[0]
    p.sentences = ['a', 'b', 'c', 'hidden'].map((id) => ({ ...createSentence(l.id), id, text: id }))
    const { removed, remaining } = removeCorpusSentences(
      p.sentences,
      ['a', 'b', 'hidden'],
      ['a', 'b', 'c']
    )
    p.sentences = remaining
    expect(p.sentences.map((s) => s.id)).toEqual(['c', 'hidden'])
    p.sentences.push({ ...createSentence(l.id), id: 'new' })
    p.sentences = restoreCorpusSentences(p.sentences, removed)
    expect(p.sentences.map((s) => s.id)).toEqual(['a', 'b', 'c', 'hidden', 'new'])
    p.sentences = restoreCorpusSentences(p.sentences, removed)
    expect(p.sentences).toHaveLength(5)
  })
  it('大范围删与撤销一次性准备新数组，原数组不被修改', () => {
    const p = createProject({ name: 'QA', template: 'blank', appVersion: '1.1.0', uiLocale: 'zh' }),
      l = p.languages[0],
      sample = createSentence(l.id),
      list = Array.from({ length: 10000 }, (_, i) => ({ ...sample, id: '' + i, text: '' + i })),
      ids = list.slice(1, 9999).map((s) => s.id),
      { removed, remaining } = removeCorpusSentences(
        list,
        ids,
        list.map((s) => s.id)
      )
    expect(list).toHaveLength(10000)
    expect(remaining.map((s) => s.id)).toEqual(['0', '9999'])
    expect(restoreCorpusSentences(remaining, removed).map((s) => s.id)).toEqual(
      list.map((s) => s.id)
    )
  })
})
