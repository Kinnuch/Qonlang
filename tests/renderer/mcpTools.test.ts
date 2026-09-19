/**
 * MCP 工具的纯逻辑：搭一个两门语言的小项目，逐个工具跑一遍——查询、算、写，以及
 * 没打开项目、语言 id 不对、词条不存在、超出上限这些情况。
 *
 * 工具的返回值是现拼的普通对象（外层会 JSON 化），这里按字段取值，所以用 any。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import {
  createLanguage,
  createLexeme,
  createMorpheme,
  createProject,
  createRuleSet
} from '$lib/core/factory'
import type { Id, Project } from '$lib/core/model'
import { mcpTools, type McpContext } from '$lib/mcp/tools'

const NUM = 'cat-num'
const SG = 'val-sg'
const PL = 'val-pl'

interface Fixture {
  project: Project
  /** 第一门语言 */
  a: Id
  /** 第二门语言 */
  b: Id
  kala: Id
}

function fixture(): Fixture {
  const project = createProject({
    name: '试验项目',
    template: 'blank',
    appVersion: 'test',
    uiLocale: 'zh'
  })
  // 模板自带一门同名语言，这里换成自己的两门
  const a = createLanguage({ name: 'Aro', abbr: 'ar' })
  const b = createLanguage({ name: 'Beto', abbr: 'be' })
  project.languages = [a, b]
  project.settings.defaultLanguageId = a.id
  project.categories = [
    {
      id: NUM,
      name: { zh: '数', en: 'Number' },
      values: [
        { id: SG, name: { zh: '单数', en: 'singular' }, abbr: 'SG' },
        { id: PL, name: { zh: '复数', en: 'plural' }, abbr: 'PL' }
      ]
    }
  ]
  project.posList = [
    { id: 'pos-n', name: { zh: '名词', en: 'noun' }, abbr: 'n.', paradigmId: 'pd' }
  ]
  project.paradigms = [
    {
      id: 'pd',
      name: { zh: '变格', en: 'declension' },
      variants: [],
      dimensionIds: [NUM],
      disabledSlots: [],
      inheritsFrom: null,
      generators: {
        [SG]: { kind: 'pipeline', stem: 'lemma', steps: [] },
        [PL]: {
          kind: 'pipeline',
          stem: 'lemma',
          steps: [{ id: 'st-1', kind: 'suffix', text: 'ni' }]
        }
      }
    }
  ]
  project.ruleSets = [
    createRuleSet('古今', ['V=aeiou', '-* 一期', 'k > g / V_V', '-* 二期', 'a > e / _#'].join('\n'))
  ]

  const kala = createLexeme(a.id, 'kala')
  kala.posId = 'pos-n'
  kala.tags = ['基本词']
  kala.senses[0].definition = { zh: '石头' }
  kala.senses[0].registers = ['口语']
  const tovi = createLexeme(a.id, 'tovi')
  tovi.posId = 'pos-n'
  tovi.senses[0].definition = { zh: '水' }
  const kalaB = createLexeme(b.id, 'kala')
  kalaB.senses[0].definition = { zh: '另一门语言里的同形词' }
  project.lexemes = [kala, tovi, kalaB]

  const suffix = createMorpheme(a.id, 'suffix')
  suffix.form = '-ni'
  suffix.gloss = 'PL'
  project.morphemes = [suffix]

  return { project, a: a.id, b: b.id, kala: kala.id }
}

function ctxOf(project: Project | null, currentLanguageId: Id | null = null): McpContext {
  const need = (): Project => {
    if (!project) throw new Error('没有打开的项目')
    return project
  }
  return {
    project: need,
    edit: (fn) => fn(need()),
    currentLanguageId: () => currentLanguageId
  }
}

function call(name: string, args: Record<string, unknown>, ctx: McpContext): any {
  const tool = mcpTools().find((t) => t.name === name)
  if (!tool) throw new Error(`没有这个工具：${name}`)
  return tool.run(args, ctx)
}

describe('mcp tools', () => {
  it('每个工具都有名字、说明和 object 类型的 schema', () => {
    const tools = mcpTools()
    expect(tools.map((t) => t.name)).toEqual([
      'project_info',
      'search_lexicon',
      'get_entry',
      'run_sound_changes',
      'gloss_sentence',
      'derive_forms',
      'add_entry',
      'update_entry',
      'add_sentence'
    ])
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length)
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(5)
      const s = t.inputSchema as {
        type: string
        properties: Record<string, { description?: string }>
      }
      expect(s.type).toBe('object')
      // 每个字段都要有说明，LLM 才知道填什么
      for (const [key, def] of Object.entries(s.properties))
        expect(def.description, `${t.name}.${key}`).toBeTruthy()
    }
    // 只有这三个会改项目
    expect(tools.filter((t) => t.write).map((t) => t.name)).toEqual([
      'add_entry',
      'update_entry',
      'add_sentence'
    ])
  })

  it('没有打开项目时每个工具都抛错', () => {
    const ctx = ctxOf(null)
    for (const t of mcpTools())
      expect(() =>
        t.run({ query: 'x', text: 'x', lemma: 'x', id: 'x', definition: 'x', words: ['x'] }, ctx)
      ).toThrow(/没有打开的项目/)
  })

  // ───────── 只读 ─────────

  it('project_info 给出语言、词类、维度、音变与构形', () => {
    const f = fixture()
    const info = call('project_info', {}, ctxOf(f.project, f.a))
    expect(info.name).toBe('试验项目')
    expect(info.currentLanguageId).toBe(f.a)
    expect(info.languages.map((l: any) => [l.name, l.abbr, l.lexemes])).toEqual([
      ['Aro', 'ar', 2],
      ['Beto', 'be', 1]
    ])
    expect(info.posList[0]).toMatchObject({ id: 'pos-n', name: '名词', abbr: 'n.' })
    expect(info.categories[0].name).toBe('数')
    expect(info.categories[0].values.map((v: any) => v.abbr)).toEqual(['SG', 'PL'])
    expect(info.ruleSets[0]).toMatchObject({ name: '古今', stages: ['一期', '二期'] })
    expect(info.paradigms[0]).toMatchObject({ name: '变格', dimensions: ['数'] })
    expect(info.counts).toMatchObject({ languages: 2, lexemes: 3, morphemes: 1 })
  })

  it('search_lexicon 认得搜索语法，也认得语言与上限', () => {
    const f = fixture()
    const ctx = ctxOf(f.project, f.a)
    // 不给语言时所有语言都搜
    expect(call('search_lexicon', { query: 'kala' }, ctx).total).toBe(2)
    // 语言可以写 id、名字或缩写
    expect(call('search_lexicon', { query: 'kala', languageId: f.a }, ctx).total).toBe(1)
    expect(call('search_lexicon', { query: 'kala', languageId: 'Beto' }, ctx).total).toBe(1)
    expect(call('search_lexicon', { query: 'kala', languageId: 'ar' }, ctx).total).toBe(1)
    // 字段写法
    expect(call('search_lexicon', { query: 'gloss=水' }, ctx).results[0].lemma).toBe('tovi')
    expect(call('search_lexicon', { query: 'pos=名词' }, ctx).total).toBe(2)
    expect(call('search_lexicon', { query: 'tag=基本词' }, ctx).results[0].lemma).toBe('kala')
    expect(call('search_lexicon', { query: '/^to/' }, ctx).results[0].lemma).toBe('tovi')
    // 结果的形状
    const one = call('search_lexicon', { query: 'word==kala', languageId: f.a }, ctx).results[0]
    expect(one).toMatchObject({ id: f.kala, lemma: 'kala', pos: '名词', tags: ['基本词'] })
    expect(one.senses).toEqual([{ definition: '石头', register: '口语' }])
    // 上限：默认 20、最大 100、要多了也按 100 截
    const many = call('search_lexicon', { query: 'a', limit: 1 }, ctx)
    expect(many.results).toHaveLength(1)
    expect(many.truncated).toBe(true)
    expect(
      call('search_lexicon', { query: 'a', limit: 9999 }, ctx).results.length
    ).toBeLessThanOrEqual(100)
    // 错处
    expect(() => call('search_lexicon', { query: '   ' }, ctx)).toThrow(/缺少参数 query/)
    expect(() => call('search_lexicon', { query: 'k', languageId: '没有这门' }, ctx)).toThrow(
      /没有这门语言/
    )
    expect(() => call('search_lexicon', { query: 5 }, ctx)).toThrow(/要是文字/)
  })

  it('get_entry 给出整条词条，屈折形分得清手改', () => {
    const f = fixture()
    const ctx = ctxOf(f.project, f.a)
    const lex = f.project.lexemes.find((l) => l.id === f.kala)!
    lex.stems = { 强形: 'kal' }
    lex.pronunciations = {
      [f.project.languages[0].orthographies[0].id]: { ipa: 'kala', irregular: false }
    }
    lex.forms = {
      单数: { surface: 'kala', derived: true, override: false, trace: [] },
      复数: { surface: 'kalar', derived: false, override: false, trace: [] }
    }
    lex.relations = [{ kind: '近义', lexemeId: f.project.lexemes[1].id }]
    lex.features = { [NUM]: SG }

    const e = call('get_entry', { id: f.kala }, ctx)
    expect(e).toMatchObject({ lemma: 'kala', language: 'Aro', pos: '名词' })
    expect(e.senses[0]).toMatchObject({ definition: '石头', registers: ['口语'] })
    expect(e.stems).toEqual({ 强形: 'kal' })
    expect(e.features).toEqual({ 数: '单数' })
    expect(e.pronunciations[0]).toMatchObject({ orthography: 'Romanization', ipa: 'kala' })
    expect(e.forms).toEqual([
      { slot: '单数', abbr: 'SG', surface: 'kala', ipa: undefined, derived: true, manual: false },
      { slot: '复数', abbr: 'PL', surface: 'kalar', ipa: undefined, derived: false, manual: true }
    ])
    expect(e.relations[0]).toMatchObject({ kind: '近义', lemma: 'tovi' })
    // 按词头找：限定语言就一条，不限定就撞上另一门语言的同形词
    expect(call('get_entry', { lemma: 'kala', languageId: 'Aro' }, ctx).id).toBe(f.kala)
    expect(() => call('get_entry', { lemma: 'kala' }, ctx)).toThrow(/请用 id 指定/)
    expect(() => call('get_entry', { lemma: '没有这个词' }, ctx)).toThrow(/词库里没有/)
    expect(() => call('get_entry', { id: '不存在' }, ctx)).toThrow(/没有这条词条/)
    expect(() => call('get_entry', {}, ctx)).toThrow(/请给出词条 id/)
  })

  it('run_sound_changes 逐阶段推词形', () => {
    const f = fixture()
    const ctx = ctxOf(f.project, f.a)
    const r = call('run_sound_changes', { words: ['kaka'] }, ctx)
    expect(r.ruleSet.name).toBe('古今')
    expect(r.stages).toEqual(['一期', '二期'])
    expect(r.results[0].output).toBe('kage')
    expect(r.results[0].stages).toEqual([
      { name: '一期', form: 'kaka' },
      { name: '二期', form: 'kaga' }
    ])
    // 从某个阶段开始：前面的规则不跑
    const later = call('run_sound_changes', { words: ['kaka'], fromStage: '二期' }, ctx)
    expect(later.results[0].output).toBe('kake')
    // 推到某个阶段为止
    expect(
      call('run_sound_changes', { words: ['kaka'], toStage: '二期' }, ctx).results[0].output
    ).toBe('kaga')
    // 按名字挑音变
    expect(
      call('run_sound_changes', { words: ['kaka'], ruleSetName: '古今' }, ctx).results[0].output
    ).toBe('kage')
    // 错处
    expect(() => call('run_sound_changes', { words: ['k'], fromStage: '三期' }, ctx)).toThrow(
      /没有这个阶段/
    )
    expect(() => call('run_sound_changes', { words: ['k'], ruleSetName: '别的' }, ctx)).toThrow(
      /没有这套音变/
    )
    expect(() => call('run_sound_changes', { words: [] }, ctx)).toThrow(/至少一个词/)
    expect(() =>
      call('run_sound_changes', { words: Array.from({ length: 101 }, () => 'a') }, ctx)
    ).toThrow(/最多推 100 个词/)
    // 有几套音变时要指定
    f.project.ruleSets.push(createRuleSet('另一套', ''))
    expect(() => call('run_sound_changes', { words: ['k'] }, ctx)).toThrow(/请用 ruleSetId/)
  })

  it('gloss_sentence 分词并逐词 gloss，不往语料里塞句子', () => {
    const f = fixture()
    const ctx = ctxOf(f.project, f.a)
    const g = call('gloss_sentence', { text: 'kala tovi' }, ctx)
    expect(g.languageId).toBe(f.a)
    expect(g.tokens.map((t: any) => t.surface)).toEqual(['kala', 'tovi'])
    expect(g.tokens[0].lexemeId).toBe(f.kala)
    expect(g.tokens[0].lemma).toBe('kala')
    expect(g.tokens[0].gloss).toBeTruthy()
    expect(g.coverage.total).toBe(2)
    // 只是试算
    expect(f.project.sentences).toHaveLength(0)
    // 语言不对、句子太长
    expect(() => call('gloss_sentence', { text: 'x', languageId: '没有' }, ctx)).toThrow(
      /没有这门语言/
    )
    expect(() => call('gloss_sentence', { text: 'a'.repeat(2001) }, ctx)).toThrow(/太长/)
    // 没给语言、也没有当前语言、项目里又不止一门：要求指定
    expect(() => call('gloss_sentence', { text: 'kala' }, ctxOf(f.project, null))).toThrow(
      /请用 languageId 指定/
    )
  })

  it('derive_forms 只算不写', () => {
    const f = fixture()
    const ctx = ctxOf(f.project, f.a)
    const d = call('derive_forms', { lexemeId: f.kala }, ctx)
    expect(d.lemma).toBe('kala')
    expect(d.paradigms).toHaveLength(1)
    expect(d.paradigms[0].name).toBe('变格')
    expect(d.paradigms[0].slots.map((s: any) => [s.slot, s.surface])).toEqual([
      ['单数', 'kala'],
      ['复数', 'kalani']
    ])
    expect(d.paradigms[0].slots[1].trace.length).toBeGreaterThan(0)
    // 词条里一个形式都没写进去
    expect(f.project.lexemes.find((l) => l.id === f.kala)!.forms).toEqual({})
    // 按词头找、按名字挑构形
    expect(
      call('derive_forms', { lemma: 'tovi', paradigmId: '变格' }, ctx).paradigms[0].slots[1].surface
    ).toBe('tovini')
    // 错处
    expect(() => call('derive_forms', { lexemeId: '不存在' }, ctx)).toThrow(/没有这条词条/)
    expect(() => call('derive_forms', { lemma: 'tovi', paradigmId: '没有这套' }, ctx)).toThrow(
      /没有这套构形/
    )
    expect(() => call('derive_forms', { lemma: 'tovi', variantId: '书面' }, ctx)).toThrow(
      /没有这个变体/
    )
    // 没绑构形的词条
    expect(() => call('derive_forms', { lemma: 'kala', languageId: 'Beto' }, ctx)).toThrow(
      /没有绑定构形/
    )
  })

  // ───────── 写 ─────────

  it('add_entry 新建词条', () => {
    const f = fixture()
    const ctx = ctxOf(f.project, f.a)
    const r = call('add_entry', { lemma: 'miru', definition: '天', pos: 'n.', tags: ['新'] }, ctx)
    expect(r.lemma).toBe('miru')
    expect(r.languageId).toBe(f.a)
    const made = f.project.lexemes.find((l) => l.id === r.id)!
    expect(made.senses[0].definition).toEqual({ zh: '天' })
    expect(made.posId).toBe('pos-n')
    expect(made.tags).toEqual(['新'])
    // 语言可以写名字；词类写不出来的就报错并列出有哪些
    expect(
      call('add_entry', { lemma: 'x', definition: 'y', languageId: 'Beto' }, ctx).languageId
    ).toBe(f.b)
    expect(() => call('add_entry', { lemma: 'x', definition: 'y', pos: '动词' }, ctx)).toThrow(
      /没有这个词类/
    )
    expect(() => call('add_entry', { definition: 'y' }, ctx)).toThrow(/缺少参数 lemma/)
    expect(() => call('add_entry', { lemma: 'x' }, ctx)).toThrow(/缺少参数 definition/)
  })

  it('update_entry 只改传了的字段', () => {
    const f = fixture()
    const ctx = ctxOf(f.project, f.a)
    const before = f.project.lexemes.find((l) => l.id === f.kala)!
    const stamp = before.updatedAt
    before.notes = '原来的备注'
    const r = call('update_entry', { id: f.kala, definition: '岩石', tags: ['改过'] }, ctx)
    expect(r.changed).toEqual(['definition', 'tags'])
    expect(before.lemma).toBe('kala')
    expect(before.senses[0].definition).toEqual({ zh: '岩石' })
    expect(before.tags).toEqual(['改过'])
    expect(before.notes).toBe('原来的备注')
    expect(before.updatedAt >= stamp).toBe(true)
    // 备注可以清空
    call('update_entry', { id: f.kala, notes: '' }, ctx)
    expect(before.notes).toBe('')
    // 错处
    expect(() => call('update_entry', { id: '不存在', lemma: 'x' }, ctx)).toThrow(/没有这条词条/)
    expect(() => call('update_entry', { id: f.kala }, ctx)).toThrow(/至少给一个/)
  })

  it('add_sentence 加进语料并自动分析', () => {
    const f = fixture()
    const ctx = ctxOf(f.project, f.a)
    const r = call(
      'add_sentence',
      { text: 'kala tovi', translation: '石头和水', source: '自造' },
      ctx
    )
    expect(f.project.sentences).toHaveLength(1)
    const s = f.project.sentences[0]
    expect(s.id).toBe(r.id)
    expect(s.text).toBe('kala tovi')
    expect(s.translation).toEqual({ zh: '石头和水' })
    expect(s.source).toBe('自造')
    expect(s.tokens.map((t) => t.surface)).toEqual(['kala', 'tovi'])
    expect(r.tokens[0].lexemeId).toBe(f.kala)
    expect(r.coverage.total).toBe(2)
    expect(() => call('add_sentence', {}, ctx)).toThrow(/缺少参数 text/)
  })
})
