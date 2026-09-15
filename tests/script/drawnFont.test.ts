import { describe, expect, it } from 'vitest'
import { parse } from 'opentype.js'
import { buildDrawnFont, freePrivateChar, simplify } from '$lib/script/drawnFont'
import { parseFont } from '$lib/script/fontParse'
import type { Script } from '$lib/core/model'

function script(): Script {
  return {
    id: 's1',
    name: '手写',
    type: 'alphabet',
    direction: 'ltr',
    font: { family: '', dataUrl: null, fileName: '' },
    rules: '@glyphs',
    notes: '',
    glyphs: [
      {
        id: 'g1',
        char: '',
        name: 'ka',
        value: 'ka',
        category: '音节',
        notes: '',
        drawing: {
          advance: 900,
          strokes: [
            {
              width: 60,
              points: [
                [100, 0],
                [450, 700],
                [800, 0]
              ]
            },
            {
              width: 40,
              points: [
                [250, 300],
                [650, 300]
              ]
            }
          ]
        }
      },
      // 没画的、字符不止一个码位的都不进字体
      { id: 'g2', char: 'b', name: '', value: 'b', category: '', notes: '' },
      {
        id: 'g3',
        char: 'é',
        name: '',
        value: 'é',
        category: '',
        notes: '',
        drawing: { advance: 600, strokes: [{ width: 50, points: [[100, 100]] }] }
      }
    ]
  } as Script
}

describe('手写字形做成字体', () => {
  it('只含画过的、单个码位的字，字宽照画板上的', () => {
    const buf = buildDrawnFont(script(), 'qy-drawn-s1')
    expect(buf).not.toBeNull()
    const parsed = parseFont(buf!)
    expect(parsed.glyphs.map((g) => g.codepoint)).toEqual([0xf8fe])
    const font = parse(buf!)
    const glyphs = Array.from({ length: font.glyphs.length }, (_, i) => font.glyphs.get(i))
    expect(glyphs.find((g) => g.unicode === 0xf8fe)?.advanceWidth).toBe(900)
  })

  it('没有画过的字就不生成字体', () => {
    const s = script()
    s.glyphs = s.glyphs.filter((g) => !g.drawing)
    expect(buildDrawnFont(s, 'x')).toBeNull()
  })

  it('找私用区码位时跳过已经用了的字符和字体里有的码位', () => {
    expect(freePrivateChar([''], [0xf8fd])).toBe('')
  })

  it('点列抽稀：共线的中间点去掉，拐点留着', () => {
    expect(
      simplify([
        [0, 0],
        [50, 1],
        [100, 0],
        [100, 100]
      ])
    ).toEqual([
      [0, 0],
      [100, 0],
      [100, 100]
    ])
  })
})
