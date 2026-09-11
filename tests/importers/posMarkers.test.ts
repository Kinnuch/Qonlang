/**
 * CSV 导入里的词类标记（n. v. adj. v因.）：认得出、拿得掉、按用户选的方式落到义项与词条的词类上，
 * 义项分属几个词类时词条是复合词类，导出再导入不走样。例词都是随手编的，不对应任何一门语言。
 */
import { describe, it, expect } from 'vitest'
import { createProject } from '$lib/core/factory'
import { parseCsv } from '$lib/core/csv'
import { findPos, posParts } from '$lib/core/pos'
import {
  applyCsvImport,
  defaultMapping,
  defaultPosRule,
  findPosMarkers,
  lexemesToRows,
  posCellTokens,
  scanPos,
  takePos,
  type CsvMapping,
  type FieldSpec,
  type PosRule
} from '$lib/importers/csvImport'

const pos = (value = ''): PosRule => ({ action: 'pos', value })
const labels = (s: string): string[] => scanPos(s).map((x) => x.label)
function blank(): ReturnType<typeof createProject> {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  p.posList = []
  return p
}
const mapping = (columns: FieldSpec[], extra: Partial<CsvMapping> = {}): CsvMapping => ({
  ...defaultMapping('L', columns.length),
  columns,
  ...extra
})

describe('part-of-speech labels', () => {
  it('recognises a Latin letter, a few characters and a dot at the start of a sense', () => {
    expect(labels('n.石头，卵石')).toEqual(['n'])
    expect(labels('v因.来临')).toEqual(['v因'])
    expect(labels('adj. big')).toEqual(['adj'])
    // 序号、方括号标记后面的也算；n./v. 隔开的算两个，n.f. 连着的算一个
    expect(labels('1、n.石头')).toEqual(['n'])
    expect(labels('【古】adj.大的')).toEqual(['adj'])
    expect(labels('n./v. 跑')).toEqual(['n', 'v'])
    expect(labels('n.f. maison')).toEqual(['n.f'])
    // 后面没有正文的（带句点的一整段）、不是拉丁字母开头的、字母后面先有空白的都不算
    expect(labels('house.')).toEqual([])
    expect(labels('石头。')).toEqual([])
    expect(labels('big house. yes')).toEqual([])
  })

  it('reads a whole POS column cell', () => {
    expect(posCellTokens('n.').map((x) => x.label)).toEqual(['n'])
    expect(posCellTokens('n./v.').map((x) => x.label)).toEqual(['n', 'v'])
    expect(posCellTokens('名词')).toEqual([])
  })

  it('takes only labels that are not kept, leaving numbers and brackets in place', () => {
    expect(takePos('n.石头', { n: pos() })).toEqual({ text: '石头', labels: ['n'] })
    expect(takePos('1、【古】n. 石头', { n: pos() })).toEqual({
      text: '1、【古】石头',
      labels: ['n']
    })
    const keep: PosRule = { action: 'keep', value: '' }
    expect(takePos('e.g. 例如', { 'e.g': keep })).toEqual({ text: 'e.g. 例如', labels: [] })
    expect(takePos('n.石头', {})).toEqual({ text: 'n.石头', labels: [] })
  })

  it('suggests common abbreviations and parts of speech the project already has', () => {
    expect(defaultPosRule('n', [], 'zh')).toEqual(pos('名词'))
    expect(defaultPosRule('adj', [], 'en')).toEqual(pos('adjective'))
    expect(defaultPosRule('v因', [], 'zh')).toEqual(pos())
    // 长的、中间有点的多半是正文
    expect(defaultPosRule('house', [], 'zh').action).toBe('keep')
    expect(defaultPosRule('e.g', [], 'zh').action).toBe('keep')
    const own = [{ id: 'x', name: { zh: '实词' }, abbr: 'sh.', paradigmId: null }]
    expect(defaultPosRule('sh', own, 'zh')).toEqual(pos('实词'))
    const noun = [{ id: 'y', name: { en: 'noun' }, abbr: '', paradigmId: null }]
    expect(defaultPosRule('n', noun, 'zh')).toEqual(pos('noun'))
  })

  it('lists labels found in definition and POS columns', () => {
    const rows = [
      ['word', 'pos', 'meaning'],
      ['kala', '', 'n.石头；n.[口]硬的东西'],
      ['tiru', 'v.', '跑；v因.赶来'],
      ['mo', '', 'house. big']
    ]
    const m = mapping([{ kind: 'lemma' }, { kind: 'pos' }, { kind: 'definition', lang: 'zh' }])
    expect(findPosMarkers(rows, m).map((x) => [x.label, x.count])).toEqual([
      ['n', 2],
      ['v', 1],
      ['v因', 1],
      ['house', 1]
    ])
  })

  it('gives senses and entries their parts of speech', () => {
    const p = blank()
    const rows = parseCsv(
      '字形,含义\nka,n.石，翠石，[魔法]一种石头；n.[口]硬脾气\nhu,v因.来临；v因.（少见）显现\nmo,n.星；v.支持；帮助'
    ).rows
    const report = applyCsvImport(
      p,
      rows,
      mapping([{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }], {
        senseMarkers: {
          魔法: { action: 'register', value: '' },
          口: { action: 'register', value: '口语' }
        },
        posMarkers: { n: pos('名词'), v: pos('动词'), v因: pos() }
      })
    )
    const [ka, hu, mo] = p.lexemes
    const name = (id?: string | null): string | undefined => findPos(p, id)?.name.zh
    // 词类标记不会自己变成一个义项，也不留在释义里
    expect(ka.senses.map((s) => s.definition.zh)).toEqual(['石，翠石', '一种石头', '硬脾气'])
    expect(name(ka.posId)).toBe('名词')
    expect(findPos(p, ka.posId)?.abbr).toBe('n.')
    expect(ka.senses.every((s) => !s.posId)).toBe(true)
    expect(ka.senses.map((s) => s.registers)).toEqual([[], ['魔法'], ['口语']])
    expect(name(hu.posId)).toBe('v因')
    expect(findPos(p, hu.posId)?.abbr).toBe('v因.')
    expect(hu.senses.map((s) => s.definition.zh)).toEqual(['来临', '（少见）显现'])
    // 义项分属名词、动词：词条是复合词类，义项各记各的；没写词类的义项跟着前一个
    expect(posParts(p, mo.posId).map((x) => x.name.zh)).toEqual(['名词', '动词'])
    expect(name(mo.posId)).toBe('名词/动词')
    expect(mo.senses.map((s) => name(s.posId))).toEqual(['名词', '动词', '动词'])
    expect(report.posMarked).toBe(8)
    expect(report.newPos).toEqual(['名词', 'v因', '动词', '名词/动词'])
  })

  it('can turn labels into sense tags or just drop them', () => {
    const p = blank()
    applyCsvImport(
      p,
      [
        ['w', 'm'],
        ['ka', 'vt.打；x.敲']
      ],
      mapping([{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }], {
        posMarkers: { vt: { action: 'tag', value: '及物' }, x: { action: 'drop', value: '' } }
      })
    )
    const [ka] = p.lexemes
    expect(ka.posId).toBeNull()
    expect(ka.senses.map((s) => [s.definition.zh, s.tags])).toEqual([
      ['打', ['及物']],
      ['敲', []]
    ])
  })

  it('writes sense parts of speech back as labels that import again', () => {
    const p = blank()
    const rules = { n: pos('名词'), v: pos('动词') }
    applyCsvImport(
      p,
      parseCsv('word,meaning\nmo,n.星；v.支持').rows,
      mapping([{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }], { posMarkers: rules })
    )
    const out = lexemesToRows(p, p.lexemes, ['zh'])
    expect(out[1].slice(0, 3)).toEqual(['mo', '名词/动词', 'n. 星；v. 支持'])
    const q = blank()
    const cols: FieldSpec[] = [
      { kind: 'lemma' },
      { kind: 'pos' },
      { kind: 'definition', lang: 'zh' },
      { kind: 'ignore' },
      { kind: 'ignore' },
      { kind: 'ignore' }
    ]
    applyCsvImport(q, out, mapping(cols, { posMarkers: rules }))
    const [mo] = q.lexemes
    expect(posParts(q, mo.posId).map((x) => x.name.zh)).toEqual(['名词', '动词'])
    expect(mo.senses.map((s) => findPos(q, s.posId)?.name.zh)).toEqual(['名词', '动词'])
    expect(q.posList).toHaveLength(3)
  })
})
