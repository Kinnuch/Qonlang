import { describe, expect, it } from 'vitest'
import { createLexeme, createProject, createSentence } from '$lib/core/factory'
import {
  availableDisplayLanguages,
  definitionColumnKeys,
  displayTextRows,
  normalizeDisplayLanguages
} from '$lib/core/displayLanguages'
import {
  parseProject,
  serializeProject,
  projectFromFolder,
  projectToFolder
} from '$lib/core/serialize'
import { findExamples } from '$lib/core/examples'

function fixture() {
  const p = createProject({
    name: 'Display language QA',
    template: 'blank',
    uiLocale: 'zh',
    appVersion: '1.1.0'
  })
  p.settings.glossLanguages = ['zh', 'en']
  p.settings.glossInputs = ['zh']
  const w = createLexeme(p.languages[0].id, 'nera')
  w.senses[0].definition = { zh: '微光', en: 'glimmer', fr: 'lueur' }
  p.lexemes.push(w)
  const s = createSentence(p.languages[0].id)
  s.text = 'nera'
  s.translation = { zh: '微光闪耀。', en: 'A glimmer shines.', de: 'Ein Licht schimmert.' }
  s.tokens = [
    {
      surface: 'nera',
      confirmed: true,
      chosen: 0,
      analyses: [
        {
          lexemeId: w.id,
          slot: null,
          morphs: [{ form: 'nera', gloss: 'glimmer', morphemeId: null }]
        }
      ]
    }
  ]
  p.sentences.push(s)
  return { p, w, s }
}
const texts = (rows: ReturnType<typeof displayTextRows>) => rows.map((row) => row.text)

describe('独立显示语言选择', () => {
  it('只允许明确选择一或两种，全部不限内容语言数', () => {
    expect(normalizeDisplayLanguages({ mode: 'one', languages: ['zh', 'en', 'fr'] })).toEqual({
      mode: 'one',
      languages: ['zh']
    })
    expect(
      normalizeDisplayLanguages({ mode: 'two', languages: [' zh ', 'zh', 'en', 'fr'] })
    ).toEqual({ mode: 'two', languages: ['zh', 'en'] })
    expect(normalizeDisplayLanguages({ mode: 'all', languages: ['zh', 'en', 'fr'] })).toEqual({
      mode: 'all'
    })
  })
  it.each([
    undefined,
    null,
    [],
    {},
    'all',
    { mode: 'three', languages: ['zh', 'en', 'fr'] },
    { mode: 'one', languages: [] }
  ])('无效可选值%j按旧显示处理', (value) => {
    expect(normalizeDisplayLanguages(value)).toBeUndefined()
  })
  it('一门可用语言不伪造第二门，空值和重复项安全处理', () => {
    expect(normalizeDisplayLanguages({ mode: 'two', languages: [null, 'en', ' en ', ''] })).toEqual(
      { mode: 'one', languages: ['en'] }
    )
  })
  it('选项区分释义与译文，包含设置及对应记录遗留语种', () => {
    const { p } = fixture()
    expect(availableDisplayLanguages(p, 'definition')).toEqual(['zh', 'en', 'fr'])
    expect(availableDisplayLanguages(p, 'translation')).toEqual(['zh', 'en', 'de'])
  })
  it('记录删除后保留显式选择代码，不悄悄换成另一门语言', () => {
    const { p } = fixture()
    p.settings.definitionDisplay = { mode: 'one', languages: ['fr'] }
    p.lexemes = []
    expect(availableDisplayLanguages(p, 'definition')).toEqual(['zh', 'en', 'fr'])
  })
  it('旧词条卡仍按项目首选语言逐行，语料仍只取首个可用译文', () => {
    const values = { fr: 'français', zh: '中文', en: 'English' }
    expect(texts(displayTextRows(values, undefined, ['zh', 'en'], 'preferred'))).toEqual([
      '中文',
      'English'
    ])
    expect(texts(displayTextRows(values, undefined, ['en', 'zh']))).toEqual(['English'])
    expect(texts(displayTextRows(values, undefined, ['ja']))).toEqual(['français'])
  })
  it('明确的一种和两种按用户顺序显示，互不影响', () => {
    const { p, w, s } = fixture()
    p.settings.definitionDisplay = { mode: 'one', languages: ['en'] }
    p.settings.translationDisplay = { mode: 'two', languages: ['zh', 'en'] }
    expect(
      texts(
        displayTextRows(
          w.senses[0].definition,
          p.settings.definitionDisplay,
          p.settings.glossLanguages,
          'preferred'
        )
      )
    ).toEqual(['glimmer'])
    expect(
      texts(
        displayTextRows(s.translation, p.settings.translationDisplay, p.settings.glossLanguages)
      )
    ).toEqual(['微光闪耀。', 'A glimmer shines.'])
  })
  it('全部包含遗留语种且不去重相同文本，不产生重复语言行', () => {
    expect(
      displayTextRows({ zh: 'same', en: 'same', fr: 'autre' }, { mode: 'all' }, ['zh', 'en', 'zh'])
    ).toEqual([
      { language: 'zh', text: 'same' },
      { language: 'en', text: 'same' },
      { language: 'fr', text: 'autre' }
    ])
  })
  it('所选内容为空时不偷换成未选语言', () => {
    expect(
      displayTextRows({ fr: 'hidden' }, { mode: 'two', languages: ['zh', 'en'] }, ['fr'])
    ).toEqual([])
    expect(displayTextRows(undefined, { mode: 'all' }, [])).toEqual([])
  })
  it('显示与列投影不修改原文或原列配置，旧模式可恢复', () => {
    const keys = ['pos', 'def:fr', 'tags', 'def:zh', 'pron'],
      before = [...keys]
    expect(
      definitionColumnKeys(keys, { mode: 'two', languages: ['zh', 'en'] }, ['zh', 'en', 'fr'])
    ).toEqual(['pos', 'def:zh', 'def:en', 'tags', 'pron'])
    expect(definitionColumnKeys(keys, { mode: 'all' }, ['zh', 'en', 'fr'])).toEqual([
      'pos',
      'def:zh',
      'def:en',
      'def:fr',
      'tags',
      'pron'
    ])
    expect(definitionColumnKeys(keys, undefined, ['zh', 'en'])).toEqual(before)
    expect(keys).toEqual(before)
  })
  it('JSON与文件夹保存重开都保留两项及全部语言、已确认词条绑定', () => {
    const { p, w, s } = fixture(),
      definition = { ...w.senses[0].definition },
      translation = { ...s.translation },
      tokens = JSON.stringify(s.tokens)
    p.settings.definitionDisplay = { mode: 'one', languages: ['fr'] }
    p.settings.translationDisplay = { mode: 'two', languages: ['zh', 'en'] }
    for (const loaded of [
      parseProject(serializeProject(p)),
      projectFromFolder(projectToFolder(p))
    ]) {
      expect(loaded.settings.definitionDisplay).toEqual(p.settings.definitionDisplay)
      expect(loaded.settings.translationDisplay).toEqual(p.settings.translationDisplay)
      expect(loaded.lexemes[0].senses[0].definition).toEqual(definition)
      expect(loaded.sentences[0].translation).toEqual(translation)
      expect(JSON.stringify(loaded.sentences[0].tokens)).toBe(tokens)
    }
  })
  it('旧项目不被写入新的默认值，也不裁掉任何旧释义译文', () => {
    const { p, w, s } = fixture(),
      before = JSON.stringify({
        definition: w.senses[0].definition,
        translation: s.translation,
        tokens: s.tokens
      })
    const loaded = parseProject(serializeProject(p))
    expect(loaded.settings.definitionDisplay).toBeUndefined()
    expect(loaded.settings.translationDisplay).toBeUndefined()
    expect(
      JSON.stringify({
        definition: loaded.lexemes[0].senses[0].definition,
        translation: loaded.sentences[0].translation,
        tokens: loaded.sentences[0].tokens
      })
    ).toBe(before)
  })
  it('读入超额显式选择只规范设置，不改任何语言记录', () => {
    const { p } = fixture(),
      raw = JSON.parse(serializeProject(p))
    raw.settings.definitionDisplay = { mode: 'two', languages: ['zh', 'en', 'fr'] }
    const loaded = parseProject(JSON.stringify(raw))
    expect(loaded.settings.definitionDisplay).toEqual({ mode: 'two', languages: ['zh', 'en'] })
    expect(loaded.lexemes[0].senses[0].definition.fr).toBe('lueur')
  })
  it('词条例句仍保留旧单行值和完整译文，供多行显示', () => {
    const { p, w, s } = fixture(),
      hit = findExamples(p, w, ['zh'])[0]
    expect(hit.translation).toBe(s.translation.zh)
    expect(hit.translations).toEqual(s.translation)
    expect(texts(displayTextRows(hit.translations, { mode: 'all' }, ['en', 'zh']))).toEqual([
      'A glimmer shines.',
      '微光闪耀。',
      'Ein Licht schimmert.'
    ])
  })
})
