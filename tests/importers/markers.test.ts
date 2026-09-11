/**
 * CSV 导入里的方括号标记（【古】〔方〕[arch.]，以及序号后紧跟的第一组括号）：
 * 认得出、切得开、按用户选的方式落到语域或标签上。例词都是随手编的，不对应任何一门语言。
 */
import { describe, it, expect } from 'vitest'
import { createProject } from '$lib/core/factory'
import {
  applyCsvImport,
  cleanMarkerRules,
  defaultMapping,
  findMarkers,
  markerLabels,
  removeMarkers,
  splitByMarkers,
  type MarkerRule
} from '$lib/importers/csvImport'

const reg = (value: string): MarkerRule => ({ action: 'register', value })
const blank = (): ReturnType<typeof createProject> =>
  createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })

describe('bracket markers', () => {
  it('recognises markers that label the text after them', () => {
    expect(markerLabels('【古】宅第；房屋')).toEqual(['古'])
    expect(markerLabels('[arch.] dwelling; house')).toEqual(['arch.'])
    expect(markerLabels('〔方〕玉米，〈口〉棒子')).toEqual(['方', '口'])
    // 紧挨字母的方括号、行尾的音标、脚注编号、分号前没跟文字的都不算
    expect(markerLabels('colo[u]r')).toEqual([])
    expect(markerLabels('cat [kat]')).toEqual([])
    expect(markerLabels('[1] see below')).toEqual([])
    expect(markerLabels('房屋【古】；宅第')).toEqual([])
  })

  it('counts the first bracket right after a sense number, parentheses included', () => {
    expect(markerLabels('1、（古）宅第；2.(n.) house；3）〔方〕玉米')).toEqual(['古', 'n.', '方'])
    expect(markerLabels('宅第 2、（方）玉米')).toEqual(['方'])
    // 没有序号的圆括号、紧挨着字的数字都不算
    expect(markerLabels('价格（约）十元')).toEqual([])
    expect(markerLabels('第2、（约）十元')).toEqual([])
  })

  it('splits text at markers; unknown and kept markers stay in the text', () => {
    const rules: Record<string, MarkerRule> = {
      古: reg('古语'),
      引: reg('引申'),
      方: reg('方言'),
      注: { action: 'keep', value: '' }
    }
    expect(splitByMarkers('经常的【引】流动的', rules)).toEqual([
      { text: '经常的', markers: [] },
      { text: '流动的', markers: ['引'] }
    ])
    expect(splitByMarkers('房屋，【古】【引】宅第', rules)).toEqual([
      { text: '房屋', markers: [] },
      { text: '宅第', markers: ['古', '引'] }
    ])
    expect(splitByMarkers('【注】【俗】宅第', rules)).toEqual([
      { text: '【注】【俗】宅第', markers: [] }
    ])
    // 序号留给新的一段，括号拿掉
    expect(splitByMarkers('1、（古）宅第 2、（方）玉米', rules)).toEqual([
      { text: '1、宅第', markers: ['古'] },
      { text: '2、玉米', markers: ['方'] }
    ])
    expect(removeMarkers('房屋，【古】宅第', rules)).toEqual({
      text: '房屋，宅第',
      markers: ['古']
    })
  })

  it('lists markers found in word, definition and notes columns', () => {
    const p = blank()
    const m = defaultMapping(p.languages[0].id, 4)
    m.columns = [
      { kind: 'lemma' },
      { kind: 'definition', lang: 'zh' },
      { kind: 'notes' },
      { kind: 'tags' }
    ]
    const rows = [
      ['word', 'meaning', 'notes', 'tags'],
      ['kalo', '房屋；【古】宅第', '【人】卡洛', '【古】不算'],
      ['【专】Tavi', '河名', '', ''],
      ['sen', '1、（古）星；2、夜晚', '', '']
    ]
    const stats = findMarkers(rows, m)
    expect(stats.map((s) => [s.label, s.count, s.columns])).toEqual([
      ['古', 2, [1]],
      ['人', 1, [2]],
      ['专', 1, [0]]
    ])
    expect(stats[0].raw).toBe('【古】')
    expect(stats[0].sample).toBe('【古】宅第')
  })

  it('maps markers to registers or tags, or just drops them, on import', () => {
    const p = blank()
    const m = defaultMapping(p.languages[0].id, 3)
    m.hasHeader = false
    m.columns = [{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }, { kind: 'notes' }]
    m.senseMarkers = {
      古: reg('古语'),
      人: reg('人名'),
      引: { action: 'tag', value: '引申' },
      俗: { action: 'drop', value: '' },
      专: reg('')
    }
    const r = applyCsvImport(
      p,
      [
        ['kalo', '房屋；【古】宅第', '【人】卡洛；常用词'],
        ['【专】Tavi', '河；【俗】小溪', ''],
        ['sen', '星，【引】夜晚', '']
      ],
      m
    )
    expect(r.created).toBe(3)
    const [kalo, tavi, sen] = p.lexemes
    expect(kalo.senses.map((s) => [s.definition.zh, s.registers, s.tags])).toEqual([
      ['房屋', [], []],
      ['宅第', ['古语'], []],
      ['卡洛', ['人名'], []]
    ])
    expect(kalo.notes).toBe('常用词')
    // 单词前的标记管整个词条；值留空就用括号里的字
    expect(tavi.lemma).toBe('Tavi')
    expect(tavi.senses.map((s) => [s.definition.zh, s.registers])).toEqual([
      ['河', ['专']],
      ['小溪', ['专']]
    ])
    expect(sen.senses.map((s) => [s.definition.zh, s.tags])).toEqual([
      ['星', []],
      ['夜晚', ['引申']]
    ])
    expect(r.marked).toBe(5)
  })

  it('treats the first bracket right after a sense number like a marker on import', () => {
    const p = blank()
    const m = defaultMapping(p.languages[0].id, 2)
    m.hasHeader = false
    m.columns = [{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }]
    m.senseMarkers = { 古: reg('古语'), 方: reg('方言') }
    applyCsvImport(p, [['kalo', '1、（古）宅第；2、（方）玉米；3、（大的）房子']], m)
    expect(p.lexemes[0].senses.map((s) => [s.definition.zh, s.registers])).toEqual([
      ['宅第', ['古语']],
      ['玉米', ['方言']],
      ['（大的）房子', []]
    ])
  })

  it('leaves definitions alone without rules; a register column and markers all become registers', () => {
    const p = blank()
    const m = defaultMapping(p.languages[0].id, 3)
    m.hasHeader = false
    m.columns = [{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }, { kind: 'register' }]
    applyCsvImport(p, [['kalo', '1、【古】宅第', '书面']], m)
    expect(p.lexemes[0].senses[0].definition.zh).toBe('【古】宅第')
    m.senseMarkers = { 古: reg('古语') }
    applyCsvImport(p, [['kalo2', '【古】宅第', '书面']], m)
    expect(p.lexemes[1].senses[0]).toMatchObject({
      definition: { zh: '宅第' },
      registers: ['书面', '古语'],
      tags: []
    })
    // 连着几个标记就是几个语域
    m.columns = [{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }, { kind: 'ignore' }]
    m.senseMarkers = { 古: reg('古语'), 文: reg('文学') }
    applyCsvImport(p, [['kalo3', '【古】【文】宅第', '']], m)
    expect(p.lexemes[2].senses[0].registers).toEqual(['古语', '文学'])
  })

  it('works together with the sense prefix map; presets are cleaned on load', () => {
    const p = blank()
    const m = defaultMapping(p.languages[0].id, 2)
    m.hasHeader = false
    m.columns = [{ kind: 'lemma' }, { kind: 'definition', lang: 'zh' }]
    m.sensePrefixMap = '1=一价\n2=二价'
    m.senseMarkers = { 古: reg('古语') }
    applyCsvImport(p, [['tal', '1【古】离开；2前往']], m)
    applyCsvImport(p, [['tal2', '1、（古）离开；2前往']], m)
    for (const lx of p.lexemes)
      expect(lx.senses.map((s) => [s.definition.zh, s.tags, s.registers])).toEqual([
        ['离开', ['一价'], ['古语']],
        ['前往', ['二价'], []]
      ])
    expect(
      cleanMarkerRules({ 古: { action: 'register', value: '古语' }, 坏: { action: 'x' }, 空: null })
    ).toEqual({ 古: { action: 'register', value: '古语' } })
  })
})
