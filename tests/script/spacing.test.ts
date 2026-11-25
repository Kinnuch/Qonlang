import { describe, it, expect } from 'vitest'
import {
  createCustomField,
  createLexeme,
  createProject,
  createScript,
  createSentence
} from '$lib/core/factory'
import { scriptSpacing } from '$lib/script/spacing'
import { textScript, sentenceScriptText } from '$lib/script/lexiconScript'
import { analyzeSentence } from '$lib/engine/gloss'
describe('自造文字的空格展示', () => {
  it('默认保留所有字符，仅明确false移除间隔空白并保留换行和连接控制', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1.1.0', uiLocale: 'zh' }),
      input = '木 水\t火\u3000土\n山\r\n河\u200d海'
    expect(scriptSpacing(p, input)).toBe(input)
    p.settings.scriptShowSpaces = false
    expect(scriptSpacing(p, input)).toBe('木水火土\n山\r\n河\u200d海')
  })
  it('映射后再去空格，原拼写与实际分词、确认分析和词条不变', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1.1.0', uiLocale: 'zh' }),
      l = p.languages[0],
      sc = createScript('QA')
    sc.glyphs = [
      { id: 'g', char: '木', value: 'grof', name: '', category: 'glyph', notes: '' },
      { id: 'u', char: '水', value: 'ue', name: '', category: 'glyph', notes: '' }
    ]
    l.scripts = [sc]
    for (const form of ['grof', 'ue']) {
      const lex = createLexeme(l.id, form)
      lex.senses[0].definition.zh = form
      p.lexemes.push(lex)
    }
    const s = createSentence(l.id)
    s.text = 'grof ue'
    p.sentences.push(s)
    analyzeSentence(p, s)
    const original = JSON.stringify({ text: s.text, tokens: s.tokens, lexemes: p.lexemes })
    expect(sentenceScriptText(p, l, sc, s)).toBe('木 水')
    p.settings.scriptShowSpaces = false
    expect(sentenceScriptText(p, l, sc, s)).toBe('木水')
    expect(textScript(p, l, sc, 'grof  ue')).toBe('木水')
    expect(JSON.stringify({ text: s.text, tokens: s.tokens, lexemes: p.lexemes })).toBe(original)
    p.settings.scriptShowSpaces = true
    expect(sentenceScriptText(p, l, sc, s)).toBe('木 水')
  })
  it('逐词自定义字段与手填覆盖也只改变输出展示', () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1.1.0', uiLocale: 'zh' }),
      l = p.languages[0],
      field = createCustomField({ zh: '字码' }),
      sc = createScript('QA')
    p.customFields.push(field)
    sc.from = 'custom:' + field.id
    sc.glyphs = [
      { id: 'a', char: '日', value: 'aa', name: '', category: 'glyph', notes: '' },
      { id: 'b', char: '月', value: 'bb', name: '', category: 'glyph', notes: '' }
    ]
    const lex = createLexeme(l.id, 'demo')
    lex.custom = { [field.id]: 'aa bb' }
    p.lexemes.push(lex)
    p.settings.scriptShowSpaces = false
    expect(textScript(p, l, sc, 'demo demo')).toBe('日月日月')
    const s = createSentence(l.id)
    s.text = 'demo'
    s.scriptForms[sc.id] = 'aa bb'
    expect(sentenceScriptText(p, l, sc, s)).toBe('日月')
    expect(s.scriptForms[sc.id]).toBe('aa bb')
    expect(lex.custom[field.id]).toBe('aa bb')
  })
})
