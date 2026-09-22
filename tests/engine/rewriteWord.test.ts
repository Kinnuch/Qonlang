/**
 * 语料里「改」成别的词条时同时改原文：只换那一处，标点、空白、大小写都按原样。
 */
import { describe, it, expect } from 'vitest'
import { matchCase, replaceWordAt, wordAt, wordRangeOfToken } from '$lib/engine/gloss/rewrite'

describe('改原文里的一个词', () => {
  it('同一个词出现好几次，只换指定的那一处', () => {
    const text = 'nira kes nira sol nira'
    expect(replaceWordAt(text, 0, 'mira')).toBe('mira kes nira sol nira')
    expect(replaceWordAt(text, 2, 'mira')).toBe('nira kes mira sol nira')
    expect(replaceWordAt(text, 4, 'mira')).toBe('nira kes nira sol mira')
  })
  it('两头的标点、句中的空白原样留着', () => {
    expect(replaceWordAt('«nira», kes!', 0, 'mira')).toBe('«mira», kes!')
    expect(replaceWordAt('«nira», kes!', 1, 'sol')).toBe('«nira», sol!')
    expect(replaceWordAt('nira\n  kes', 1, 'sol')).toBe('nira\n  sol')
  })
  it('原来的词大写开头，换上去的也大写开头', () => {
    expect(replaceWordAt('Nira kes.', 0, 'mira')).toBe('Mira kes.')
    expect(replaceWordAt('nira kes.', 0, 'Mira')).toBe('Mira kes.')
    expect(matchCase('nira', 'mira')).toBe('mira')
    expect(matchCase('Nira', 'mira')).toBe('Mira')
    // 没有大小写之分的文字照原样
    expect(matchCase('雨', '云')).toBe('云')
  })
  it('句首、句末的词都换得动', () => {
    expect(replaceWordAt('nira', 0, 'mira')).toBe('mira')
    expect(replaceWordAt('“nira kes”', 1, 'sol')).toBe('“nira sol”')
  })
  it('换的跟原来一样、位置不对、没给写法时原样不动', () => {
    expect(replaceWordAt('nira kes', 0, 'nira')).toBe('nira kes')
    expect(replaceWordAt('Nira kes', 0, 'nira')).toBe('Nira kes')
    expect(replaceWordAt('nira kes', 5, 'mira')).toBe('nira kes')
    expect(replaceWordAt('nira kes', -1, 'mira')).toBe('nira kes')
    expect(replaceWordAt('nira kes', 0, '')).toBe('nira kes')
  })
  it('词典里带空格的形式：连着两段一起换掉', () => {
    expect(replaceWordAt('ar mae kes.', 0, 'maen', {}, 2)).toBe('maen kes.')
    expect(wordAt('ar mae kes.', 0, {}, 2)).toBe('ar mae')
    expect(wordRangeOfToken(['ar mae', 'kes'], 1)).toEqual({ index: 2, count: 1 })
    expect(wordRangeOfToken(['ar mae', 'kes'], 0)).toEqual({ index: 0, count: 2 })
    expect(wordRangeOfToken(['kes'], 3)).toBe(null)
  })
  it('按写法核对：对不上就不动原文', () => {
    expect(wordAt('«nira», kes!', 0)).toBe('nira')
    expect(wordAt('«nira», kes!', 1)).toBe('kes')
    expect(wordAt('nira kes', 9)).toBe(null)
  })
  it('逐字分词也按位置换', () => {
    expect(replaceWordAt('红学红', 2, '雨', { mode: 'character' })).toBe('红学雨')
  })
})
