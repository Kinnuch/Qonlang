/**
 * 导入样例测试台用到的纯逻辑：结果按哪种显示、粘贴的字符表怎么拆、规则文件按格式怎么转。
 * 例词都是随手编的。
 */
import { describe, it, expect } from 'vitest'
import { previewKind } from '$lib/importers/preview'
import { parseGlyphLines } from '$lib/importers/glyphLines'
import { convertRuleFiles, yinbianjiPart } from '$lib/importers/ruleFiles'

describe('previewKind', () => {
  it('哪一类有内容就算哪一类', () => {
    expect(previewKind({ lexemes: [{ lemma: 'abc' }] as never })).toBe('lexemes')
    expect(previewKind({ morphemes: [{ form: '-de' }] as never })).toBe('morphemes')
    expect(previewKind({ records: [{ rec: { text: '一句话' } }] })).toBe('records')
    expect(previewKind({ glyphs: [{ char: 'x', value: 'k', name: '' }] })).toBe('glyphs')
    expect(previewKind({ lines: ['a > b'] })).toBe('lines')
  })
  it('空的、只有空白行、没有数据都算认不出来', () => {
    expect(previewKind(null)).toBe('empty')
    expect(previewKind({})).toBe('empty')
    expect(previewKind({ lexemes: [], records: [] })).toBe('empty')
    expect(previewKind({ lines: ['', '   '] })).toBe('empty')
  })
})

describe('parseGlyphLines', () => {
  it('一行一个：字符、转写、名称', () => {
    const items = parseGlyphLines('  x\tks  \ny  i  第二个字\n\nz')
    expect(items).toEqual([
      { char: 'x', value: 'ks', name: '' },
      { char: 'y', value: 'i', name: '第二个字' },
      { char: 'z', value: '', name: '' }
    ])
  })
  it('空文本给空表', () => {
    expect(parseGlyphLines('\n  \n')).toEqual([])
  })
})

describe('convertRuleFiles', () => {
  const file = (content: string, name = ''): { name: string; content: string } => ({
    name,
    content
  })
  it('原样格式不改动，没有文件给空文本', () => {
    expect(convertRuleFiles([file('a > b / _ c')], 'plain')).toBe('a > b / _ c')
    expect(convertRuleFiles([], 'plain')).toBe('')
  })
  it('Lexicanter 的写法换成千语集的', () => {
    expect(convertRuleFiles([file('^a > ∅')], 'lexicanter')).toBe('#a > ')
    expect(convertRuleFiles([file('{a,e} > i')], 'lexicanter')).toBe('[ae] > i')
  })
  it('音变姬按内容分成音类与规则两段', () => {
    const out = convertRuleFiles([file('C=ptk'), file('a > b')], 'yinbianji')
    expect(out).toContain('C=ptk')
    expect(out).toContain('a > b')
    expect(out.indexOf('C=ptk')).toBeLessThan(out.indexOf('a > b'))
  })
  it('测试台敲的一段没有文件名时也分得出来', () => {
    expect(yinbianjiPart(file('a > b'))).toBe('rule')
    expect(yinbianjiPart(file('C=ptk'))).toBe('category')
    expect(yinbianjiPart(file('', 'Lexicon.txt'))).toBe('lexicon')
  })
})
