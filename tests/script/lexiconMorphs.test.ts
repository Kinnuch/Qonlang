/**
 * 转写来源是检视器模块的文字，语料里的词切成了几段时：每段各自查词库、各自写，
 * 一段认不出也不连累旁边几段；分析给的那个词条常常只是词干，不能当成整个词。
 */
import { describe, it, expect } from 'vitest'
import {
  createCustomField,
  createLexeme,
  createMorpheme,
  createProject,
  createScript,
  createSentence,
  newId
} from '$lib/core/factory'
import type { Analysis, Glyph, Id, Language, Project, Script, Token } from '$lib/core/model'
import { sentenceScriptText } from '$lib/script/lexiconScript'

const glyph = (char: string, value: string): Glyph => ({
  id: newId(),
  char,
  name: '',
  value,
  category: 'glyph',
  notes: ''
})

interface Fix {
  p: Project
  L: Language
  sc: Script
  /** 直接转句子的那种文字（不查词库） */
  plain: Script
  /** 「字号」那一栏的 id */
  field: Id
  id: (lemma: string) => Id
}

/** 随手编的一门语言：词条把字号填在「字号」那一栏，文字按字号写 */
function setup(): Fix {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
  const L = p.languages[0]
  const f = createCustomField({ zh: '字号' })
  p.customFields.push(f)
  const sc = createScript('字号文字')
  sc.glyphs = [
    glyph('舟', 'aa01'),
    glyph('尾', 'aa02'),
    glyph('之', 'aa03'),
    glyph('众', 'aa04'),
    glyph('吾', 'aa05'),
    glyph('舟尾', 'aa06')
  ]
  sc.from = `custom:${f.id}`
  L.scripts.push(sc)
  const plain = createScript('拼音文字')
  plain.glyphs = [glyph('N', 'nu'), glyph('M', 'mo')]
  L.scripts.push(plain)
  const add = (lemma: string, codes: string, def: string): void => {
    const l = createLexeme(L.id, lemma)
    l.custom = { [f.id]: codes }
    l.senses[0].definition = { zh: def }
    p.lexemes.push(l)
  }
  add('nusu', 'aa01', '船') // 舟
  add('mota', 'aa03', '属格缀') // 之（词库里把词缀也收成词条）
  add('le', 'aa04', '复数') // 众
  add('tja', 'aa05', '第一人称') // 吾
  add('nususa', 'aa06', '小船') // 整个词本身也是词条
  const id = (lemma: string): Id => p.lexemes.find((l) => l.lemma === lemma)!.id
  return { p, L, sc, plain, field: f.id, id }
}

/** 一句只有一个词的例句，分析直接给定 */
function oneWord(fix: Fix, surface: string, a: Analysis): ReturnType<typeof createSentence> {
  const s = createSentence(fix.L.id)
  s.text = surface
  const tk: Token = { surface, analyses: [a], chosen: 0, confirmed: true }
  s.tokens = [tk]
  return s
}

describe('切成几段的词逐段写文字', () => {
  it('带连字符的词：两段都是词条时两段都写出来', () => {
    const fix = setup()
    // 分析给的 lexemeId 只是词干（`nusu`），旧代码照它写就把 `-mota` 丢了
    const s = oneWord(fix, 'nusu-mota', {
      lexemeId: fix.id('nusu'),
      slot: null,
      morphs: [
        { form: 'nusu', gloss: '船', morphemeId: null },
        { form: 'mota', gloss: '属格缀', morphemeId: null }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, s)).toBe('舟之')
  })

  it('一段是词条、一段不是：认得出的照写，认不出的照它自己的写法转，旁边几段不受影响', () => {
    const fix = setup()
    const s = oneWord(fix, 'nusu-kehi', {
      lexemeId: null,
      slot: null,
      morphs: [
        { form: 'nusu', gloss: '船', morphemeId: null },
        { form: 'kehi', gloss: '?', morphemeId: null }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, s)).toBe('舟kehi')
  })

  it('改过分析的词：整条分析没给词条、只有每段各自的词条时照样写得出来', () => {
    const fix = setup()
    const s = oneWord(fix, 'letja', {
      lexemeId: null,
      slot: null,
      morphs: [
        { form: 'le', gloss: '复数', morphemeId: null, lexemeId: fix.id('le') },
        { form: 'tja', gloss: '第一人称', morphemeId: null, lexemeId: fix.id('tja') }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, s)).toBe('众吾')
  })

  it('改过分析的词：整条分析给的是其中一段的词条时，另外几段照样写出来', () => {
    const fix = setup()
    const s = oneWord(fix, 'letja', {
      lexemeId: fix.id('tja'),
      slot: null,
      morphs: [
        { form: 'le', gloss: '复数', morphemeId: null },
        { form: 'tja', gloss: '第一人称', morphemeId: null }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, s)).toBe('众吾')
  })

  it('一段连写法都转不出来：空着就空着，不把旁边几段一起弄没', () => {
    const fix = setup()
    const s = oneWord(fix, 'nusu-tja', {
      lexemeId: null,
      slot: null,
      morphs: [
        { form: 'nusu', gloss: '船', morphemeId: null },
        { form: '', gloss: '零形式', morphemeId: null },
        { form: 'tja', gloss: '第一人称', morphemeId: null }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, s)).toBe('舟吾')
  })

  it('一段挂着语素：按语素的写法（两头的连字符不算）去词库里找词条', () => {
    const fix = setup()
    // 语素在这个数据模型里挂不上词条，只能拿它的写法再查一遍词库
    const mo = createMorpheme(fix.L.id, 'suffix')
    mo.form = '-mota'
    mo.gloss = 'GEN'
    fix.p.morphemes.push(mo)
    // 这一段的写法（同位素 `mta`）词库里查不到，只有语素的写法查得到
    const s = oneWord(fix, 'nusumta', {
      lexemeId: null,
      slot: null,
      morphs: [
        { form: 'nusu', gloss: '船', morphemeId: null },
        { form: 'mta', gloss: 'GEN', morphemeId: mo.id }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, s)).toBe('舟之')
  })

  it('同一个写法有几个词条：释义跟这一段的 gloss 对得上的那个优先', () => {
    const fix = setup()
    // 另一个写法一样的 le：意思不同，字号也不同
    const other = createLexeme(fix.L.id, 'le')
    other.custom = { [fix.field]: 'aa02' }
    other.senses[0].definition = { zh: '尾巴' }
    fix.p.lexemes.push(other)
    const s = oneWord(fix, 'letja', {
      lexemeId: null,
      slot: null,
      morphs: [
        { form: 'le', gloss: '尾巴', morphemeId: null },
        { form: 'tja', gloss: '第一人称', morphemeId: null }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, s)).toBe('尾吾')
  })

  it('整个词本身就是词条：照词条那一栏写，不拆成几段', () => {
    const fix = setup()
    const s = oneWord(fix, 'nususa', {
      lexemeId: fix.id('nusu'),
      slot: null,
      morphs: [
        { form: 'nusu', gloss: '船', morphemeId: null },
        { form: 'sa', gloss: '小', morphemeId: null }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, s)).toBe('舟尾')
  })

  it('只有一段的分析照旧：给了词条就写它，没有就照原文转', () => {
    const fix = setup()
    const one = oneWord(fix, 'nusu', {
      lexemeId: fix.id('nusu'),
      slot: null,
      morphs: [{ form: 'nusu', gloss: '船', morphemeId: null }]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, one)).toBe('舟')
    const unknown = oneWord(fix, 'kehi', {
      lexemeId: null,
      slot: null,
      morphs: [{ form: 'kehi', gloss: '?', morphemeId: null }]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.sc, unknown)).toBe('kehi')
  })

  it('直接转句子的文字不受影响：还是照句子的拼写转', () => {
    const fix = setup()
    const s = oneWord(fix, 'nusu-mota', {
      lexemeId: fix.id('nusu'),
      slot: null,
      morphs: [
        { form: 'nusu', gloss: '船', morphemeId: null },
        { form: 'mota', gloss: '属格缀', morphemeId: null }
      ]
    })
    expect(sentenceScriptText(fix.p, fix.L, fix.plain, s)).toBe('Nsu-Mta')
  })
})
