/**
 * 文档里的 [[…]] 链接：写法解析（中英前缀、子目标、显示文字）与在项目里找目标。
 * 这里的语言、术语都是随手编的，只是拿来当容器——软件不认任何一门具体语言。
 */
import { describe, it, expect } from 'vitest'
import {
  docLink,
  docLinkCandidates,
  formatDocLink,
  parseDocLink,
  resolveDocLink,
  ruleSetStages
} from '$lib/core/docLinks'
import { mdToHtml } from '$lib/core/markdown'
import {
  createDoc,
  createLanguage,
  createLexeme,
  createMorpheme,
  createPhrase,
  createProject,
  createRuleSet,
  createScript,
  createSentence,
  newId
} from '$lib/core/factory'
import type { Paradigm, Project } from '$lib/core/model'

function fixture(): Project {
  const p = createProject({ name: 'T', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const lang = createLanguage({ name: '甲语', abbr: 'Ja' })
  lang.scripts.push(createScript('刻文'))
  p.languages = [lang]
  p.settings.defaultLanguageId = lang.id
  p.settings.glossLanguages = ['zh', 'en']

  const lx = createLexeme(lang.id, 'kaso')
  lx.senses[0].definition = { zh: '房子' }
  p.lexemes.push(lx)

  const mo = createMorpheme(lang.id, 'suffix')
  mo.form = '-lAr'
  mo.gloss = 'PL'
  p.morphemes.push(mo)

  const rs = createRuleSet('甲 → 乙', '-* 祖语\nu > o / _#\n-* 现代语 # 到这里为止')
  p.ruleSets.push(rs)

  const num = {
    id: newId(),
    name: { zh: '数', en: 'number' },
    values: [
      { id: newId(), name: { zh: '单数', en: 'singular' }, abbr: 'SG' },
      { id: newId(), name: { zh: '复数', en: 'plural' }, abbr: 'PL' }
    ]
  }
  p.categories.push(num)
  const pd: Paradigm = {
    id: newId(),
    name: { zh: '名词', en: 'noun' },
    variants: [],
    dimensionIds: [num.id],
    disabledSlots: [],
    generators: {},
    inheritsFrom: null
  }
  p.paradigms.push(pd)

  const st = createSentence(lang.id)
  st.text = 'kaso nolu'
  st.translation = { zh: '一座房子' }
  p.sentences.push(st)

  const ph = createPhrase(lang.id, '问候')
  ph.text = 'bil men'
  p.phrasebook.push(ph)

  const doc = createDoc(null, '语法概要')
  p.docs.push(doc)
  return p
}

describe('doc link syntax', () => {
  it('treats a bare name as a lexeme, as it always has', () => {
    const r = parseDocLink('kaso')
    expect(r.kind).toBe('lexeme')
    expect(r.explicit).toBe(false)
    expect(r.name).toBe('kaso')
  })

  it('accepts both the Chinese and the English prefix', () => {
    for (const s of ['语素:-lAr', 'morpheme:-lAr', 'Morpheme: -lAr', '语素：-lAr']) {
      const r = parseDocLink(s)
      expect(r.kind).toBe('morpheme')
      expect(r.explicit).toBe(true)
      expect(r.name).toBe('-lAr')
    }
  })

  it('keeps an unknown prefix as part of the name', () => {
    const r = parseDocLink('a:b')
    expect(r.explicit).toBe(false)
    expect(r.name).toBe('a:b')
  })

  it('reads the display text after |', () => {
    const r = parseDocLink('语言:甲语|我的语言')
    expect(r.kind).toBe('language')
    expect(r.name).toBe('甲语')
    expect(r.label).toBe('我的语言')
  })

  it('splits # only where there is something inside to point at', () => {
    expect(parseDocLink('音变:甲 → 乙#现代语').sub).toBe('现代语')
    expect(parseDocLink('构形:名词#单数').sub).toBe('单数')
    // 词头里的 # 不是子目标
    expect(parseDocLink('a#b').name).toBe('a#b')
    expect(parseDocLink('词条:a#b').name).toBe('a#b')
  })

  it('writes a link back out in either interface language', () => {
    expect(formatDocLink('lexeme', 'kaso')).toBe('[[kaso]]')
    expect(formatDocLink('morpheme', '-lAr', '', 'zh')).toBe('[[语素:-lAr]]')
    expect(formatDocLink('morpheme', '-lAr', '', 'en')).toBe('[[morpheme:-lAr]]')
    expect(formatDocLink('ruleSet', '甲 → 乙', '现代语', 'zh')).toBe('[[音变:甲 → 乙#现代语]]')
  })
})

describe('doc link resolving', () => {
  const p = fixture()
  const hit = (s: string) => docLink(p, s).hit

  it('finds each kind of thing', () => {
    expect(hit('kaso')?.kind).toBe('lexeme')
    expect(hit('语素:-lAr')?.kind).toBe('morpheme')
    expect(hit('语素:lAr')?.kind).toBe('morpheme') // 两头的连字符可写可不写
    expect(hit('语言:甲语')?.kind).toBe('language')
    expect(hit('language:Ja')?.kind).toBe('language') // 缩写也认
    expect(hit('音变:甲 → 乙')?.kind).toBe('ruleSet')
    expect(hit('构形:名词')?.kind).toBe('paradigm')
    expect(hit('paradigm:noun')?.kind).toBe('paradigm') // 名字的另一种语言
    expect(hit('文字:刻文')?.kind).toBe('script')
    expect(hit('例句:kaso nolu')?.kind).toBe('sentence')
    expect(hit('短语:bil men')?.kind).toBe('phrase')
    expect(hit('文档:语法概要')?.kind).toBe('doc')
  })

  it('reports the language of the target so the jump can switch to it', () => {
    expect(hit('kaso')?.languageId).toBe(p.languages[0].id)
    expect(hit('构形:名词')?.languageId).toBe(null)
  })

  it('finds a stage inside a rule set and a slot inside a paradigm', () => {
    expect(ruleSetStages(p.ruleSets[0].text)).toEqual(['祖语', '现代语'])
    expect(hit('音变:甲 → 乙#现代语')?.sub).toBe('现代语')
    const slot = hit('构形:名词#复数')
    expect(slot?.sub).toBe(p.categories[0].values[1].id)
    expect(slot?.subLabel).toBe('复数')
    // gloss 缩写、另一种语言的取值名一样能对上
    expect(hit('构形:名词#PL')?.sub).toBe(slot?.sub)
    expect(hit('构形:名词#plural')?.sub).toBe(slot?.sub)
  })

  it('still links to the parent when only the part after # is unknown', () => {
    const h = hit('音变:甲 → 乙#没有这个阶段')
    expect(h?.kind).toBe('ruleSet')
    expect(h?.subMissing).toBe(true)
    expect(h?.sub).toBe('')
  })

  it('returns nothing when the name is not in the project', () => {
    expect(hit('语素:没有')).toBe(null)
    expect(hit('zzz')).toBe(null)
    // 带前缀就只在那一类里找
    expect(hit('语素:kaso')).toBe(null)
  })

  it('falls back to the other kinds when no prefix is written', () => {
    expect(hit('-lAr')?.kind).toBe('morpheme')
    expect(hit('语法概要')?.kind).toBe('doc')
  })

  it('lists what can be linked to, stages and slots included', () => {
    const rules = docLinkCandidates(p, 'ruleSet')
    expect(rules.map((c) => c.sub)).toEqual(['', '祖语', '现代语'])
    const slots = docLinkCandidates(p, 'paradigm')
    expect(slots.map((c) => c.sub)).toEqual(['', '单数', '复数'])
    expect(docLinkCandidates(p, 'lexeme')[0].name).toBe('kaso')
  })

  it('renders found links as anchors and missing ones as marked text', () => {
    const html = mdToHtml('[[kaso]] [[语素:-lAr|复数]] [[语素:没有]]', {
      resolve: (inner) => {
        const { ref, hit: h } = docLink(p, inner)
        return h
          ? { target: { kind: h.kind, id: h.id, sub: h.sub }, text: ref.name, title: h.name }
          : { text: ref.name, title: '没找到' }
      }
    })
    expect(html).toContain(`data-kind="lexeme" data-id="${p.lexemes[0].id}"`)
    expect(html).toContain(`data-kind="morpheme" data-id="${p.morphemes[0].id}"`)
    expect(html).toContain('>复数</a>')
    expect(html).toContain('<span class="wl missing" title="没找到">没有</span>')
  })
})

describe('doc links keep resolving', () => {
  it('leaves a sub-target alone for kinds that have none', () => {
    const p = fixture()
    const r = parseDocLink('文档:语法概要')
    expect(resolveDocLink(p, r)?.sub).toBe('')
  })
})
