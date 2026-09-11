/**
 * 分词的泛用性：作用于所有词的构形（词首音变）反推、撇号缩略（撇号写进边界符号时）、
 * 去附加符与拆成两个词（记为猜测）、词典里带空格的形式合并成一个词。
 */
import { describe, it, expect } from 'vitest'
import { createLanguage, createLexeme, createMorpheme, createProject } from '$lib/core/factory'
import { analyzeSentence, analyzeToken, buildIndex, coverage } from '$lib/engine/gloss'
import { edgeChange, mutationTables } from '$lib/engine/morph/mutation'
import { createSentence } from '$lib/core/factory'
import type { Paradigm, Project } from '$lib/core/model'

function setup(): { p: Project; lang: string } {
  const p = createProject({ name: 'p', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const lang = p.languages[0].id
  for (const lemma of ['menallan', 'sethi', 'lhes', 'ta', 'am', 'kam', 'sen', 'tath', "ka'a"])
    p.lexemes.push(createLexeme(lang, lemma))
  const neg = createMorpheme(lang, 'prefix')
  neg.form = 'e-'
  neg.gloss = 'NEG'
  p.morphemes.push(neg)
  p.categories.push({
    id: 'mut',
    name: { zh: '词首音变' },
    values: [{ id: 'len', name: { zh: '软音变' }, abbr: 'LEN' }]
  })
  const para: Paradigm = {
    id: 'P',
    name: { zh: '词首音变' },
    variants: [],
    dimensionIds: ['mut'],
    disabledSlots: [],
    inheritsFrom: null,
    appliesToAll: true,
    generators: {
      len: {
        kind: 'pipeline',
        stem: '',
        steps: [
          { id: 's1', kind: 'adjust', text: 'm > w / #_\ns > h / #_\nlh > l / #_\nt > dh / #_' }
        ]
      }
    }
  }
  p.paradigms.push(para)
  return { p, lang }
}

const lemmaOf = (p: Project, id: string | null | undefined): string | undefined =>
  p.lexemes.find((l) => l.id === id)?.lemma
const WITH_APOSTROPHE = ['-', '=', "'"]

describe('分词的泛用性', () => {
  it('比较前后形式：共同结尾长的算词首变化，共同开头长的算词尾变化', () => {
    expect(edgeChange('sethi', 'hethi')).toEqual({ side: 'initial', pair: { from: 's', to: 'h' } })
    expect(edgeChange('tath', 'dhath')).toEqual({ side: 'initial', pair: { from: 't', to: 'dh' } })
    expect(edgeChange('anar', 'hanar')).toEqual({ side: 'initial', pair: { from: 'a', to: 'ha' } })
    expect(edgeChange('haur', 'chaur')).toEqual({ side: 'initial', pair: { from: 'h', to: 'ch' } })
    expect(edgeChange('goch', 'och')).toEqual({ side: 'initial', pair: { from: 'g', to: '' } })
    expect(edgeChange('kad', 'kat')).toEqual({ side: 'final', pair: { from: 'd', to: 't' } })
    expect(edgeChange('abc', 'abc')).toBeNull()
  })

  it('从词库归纳出词首音变的对照表；词库变了表跟着变；限定了语言只管那门语言', () => {
    const { p, lang } = setup()
    const [tb] = mutationTables(p, lang)
    expect(tb.abbr).toBe('LEN')
    expect(tb.initial.map((x) => `${x.from}>${x.to}`)).toEqual(
      expect.arrayContaining(['m>w', 's>h', 'lh>l', 't>dh'])
    )
    // 去掉唯一的 t 开头的词：t>dh 学不到；加回来又学到（不靠词数分档）
    const tath = p.lexemes.findIndex((l) => l.lemma === 'tath')
    const ta = p.lexemes.findIndex((l) => l.lemma === 'ta')
    const [removedTath] = p.lexemes.splice(tath, 1)
    const [removedTa] = p.lexemes.splice(ta > tath ? ta - 1 : ta, 1)
    expect(mutationTables(p, lang)[0].initial.map((x) => x.from)).not.toContain('t')
    p.lexemes.push(removedTath, removedTa)
    expect(mutationTables(p, lang)[0].initial.map((x) => x.from)).toContain('t')

    const other = createLanguage({ name: 'L2' })
    p.languages.push(other)
    p.lexemes.push(createLexeme(other.id, 'mora'))
    p.paradigms[0].appliesToLanguageId = lang
    expect(mutationTables(p, other.id)).toEqual([])
    expect(analyzeToken(buildIndex(p, other.id), 'wora', [])).toEqual([])
  })

  it('反推词首音变：单独出现、剥过前缀之后都认得，gloss 接上缩写', () => {
    const { p, lang } = setup()
    const idx = buildIndex(p, lang)
    const lemmas = (w: string): (string | undefined)[] =>
      analyzeToken(idx, w, ['-', '=']).map((a) => lemmaOf(p, a.lexemeId))
    expect(lemmas('hethi')).toContain('sethi')
    expect(lemmas('les')).toContain('lhes')
    expect(lemmas('ewenallan')).toContain('menallan')
    expect(analyzeToken(idx, 'hethi', [])[0].morphs[0].gloss).toMatch(/\.LEN$/)
  })

  it('撇号写进边界符号时按缩略补元音；没写时撇号只是字母', () => {
    const { p, lang } = setup()
    const idx = buildIndex(p, lang)
    for (const w of ["t'am", 't’am']) {
      const [a] = analyzeToken(idx, w, WITH_APOSTROPHE)
      expect(a.morphs.map((m) => m.form)).toEqual(["t'", 'am'])
      expect(lemmaOf(p, a.lexemeId)).toBe('am')
    }
    const plain = analyzeToken(idx, "ka'a", ['-', '='])
    expect(lemmaOf(p, plain[0].lexemeId)).toBe("ka'a")
    expect(plain.every((a) => a.morphs.length === 1)).toBe(true)
  })

  it('去附加符、拆成两个词只在别的都找不到时才用，而且记为猜测、不算认出', () => {
    const { p, lang } = setup()
    const idx = buildIndex(p, lang)
    const [folded] = analyzeToken(idx, 'kâm', [])
    expect(lemmaOf(p, folded.lexemeId)).toBe('kam')
    expect(folded.morphs[0].form).toBe('kâm')
    expect(folded.guess).toBe('fold')
    const [compound] = analyzeToken(idx, 'kamsen', [])
    expect(compound.morphs.map((m) => m.form)).toEqual(['kam', 'sen'])
    expect(compound.guess).toBe('split')
    expect(analyzeToken(idx, 'kam', [])).toHaveLength(1)
    const s = createSentence(lang)
    s.text = 'kâm kamsen kam'
    analyzeSentence(p, s)
    expect(coverage(s)).toMatchObject({ total: 3, resolved: 1 })
  })

  it('词典里带空格的形式：连着的词合起来对得上就并成一个词，确认过的词不并', () => {
    const { p, lang } = setup()
    const bae = createLexeme(lang, 'bae')
    bae.forms['泛数'] = { surface: 'ar mae', derived: true, override: false }
    bae.forms['集数'] = { surface: 'sov mae', derived: true, override: false }
    p.lexemes.push(bae)
    const s = createSentence(lang)
    s.text = 'im·lino ar mae kam.'
    analyzeSentence(p, s)
    expect(s.tokens.map((t) => t.surface)).toEqual(['im·lino', 'ar mae', 'kam'])
    expect(s.tokens[1].analyses[0].lexemeId).toBe(bae.id)
    expect(s.tokens[1].analyses[0].slot).toBe('泛数')

    const kept = createSentence(lang)
    kept.text = 'sov mae'
    kept.tokens = [
      { surface: 'sov', analyses: [], chosen: 0, confirmed: true },
      { surface: 'mae', analyses: [], chosen: 0, confirmed: false }
    ]
    analyzeSentence(p, kept)
    expect(kept.tokens.map((t) => t.surface)).toEqual(['sov', 'mae'])
  })
})
