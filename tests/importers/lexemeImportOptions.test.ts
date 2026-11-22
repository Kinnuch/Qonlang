import { describe, it, expect } from 'vitest'
import {
  createProject,
  createLanguage,
  createLexeme,
  createOrthography,
  createSense
} from '$lib/core/factory'
import {
  applyCsvImport,
  defaultMapping,
  guessMapping,
  type CsvMapping
} from '$lib/importers/csvImport'
import { scratchProject } from '$lib/importers/preview'
import { parseProject, serializeProject } from '$lib/core/serialize'

function fixture() {
  const project = createProject({
      name: 'Import QA',
      template: 'blank',
      appVersion: '1',
      uiLocale: 'zh'
    }),
    lang = project.languages[0],
    primary = lang.orthographies[0],
    other = createOrthography('Other')
  lang.orthographies.push(other)
  primary.rulesToIpa = 'f > ɸ'
  other.rulesToIpa = 'f > v'
  return { project, lang, primary, other }
}
function mapping(languageId: string, header: string[]): CsvMapping {
  return guessMapping(header, defaultMapping(languageId, header.length))
}

describe('词表导入自动IPA与保守覆盖', () => {
  it('默认继续追加且明确IPA仍不规则', () => {
    const { project, lang, primary } = fixture()
    project.lexemes.push(createLexeme(lang.id, 'fana'))
    const header = ['lemma', 'IPA'],
      m = mapping(lang.id, header)
    m.columns[1] = { kind: 'pronunciation', orthography: '' }
    const report = applyCsvImport(project, [header, ['fana', 'USER']], m)
    expect(report.created).toBe(1)
    expect(project.lexemes).toHaveLength(2)
    expect(project.lexemes[1].pronunciations[primary.id]).toEqual({ ipa: 'USER', irregular: true })
  })
  it('勾自动实际取消不规则并即时推导，未参与正字法保持不变', () => {
    const { project, lang, primary, other } = fixture(),
      entry = createLexeme(lang.id, 'fana')
    entry.pronunciations[primary.id] = { ipa: 'old', irregular: true }
    entry.pronunciations[other.id] = { ipa: 'untouched', irregular: true }
    project.lexemes.push(entry)
    const header = ['lemma', 'IPA'],
      m = mapping(lang.id, header)
    m.columns[1] = { kind: 'pronunciation', orthography: primary.name.toUpperCase() }
    m.automaticIpa = true
    m.overwriteExisting = true
    applyCsvImport(project, [header, ['fana', 'MANUAL']], m)
    expect(project.lexemes[0].pronunciations[primary.id]).toEqual({ ipa: 'ɸana', irregular: false })
    expect(project.lexemes[0].pronunciations[other.id]).toEqual({
      ipa: 'untouched',
      irregular: true
    })
  })
  it('无IPA列时也对本次主正字法实际开启自动，保留词头大小写', () => {
    const { project, lang, primary, other } = fixture(),
      entry = createLexeme(lang.id, 'Aufidel')
    entry.pronunciations[primary.id] = { ipa: 'manual', irregular: true }
    entry.pronunciations[other.id] = { ipa: 'other', irregular: true }
    project.lexemes.push(entry)
    const header = ['lemma', 'definition_en'],
      m = mapping(lang.id, header)
    m.automaticIpa = true
    m.overwriteExisting = true
    applyCsvImport(project, [header, ['Aufidel', 'new']], m)
    expect(project.lexemes[0].lemma).toBe('Aufidel')
    expect(project.lexemes[0].pronunciations[primary.id]).toEqual({
      ipa: 'auɸidel',
      irregular: false
    })
    expect(project.lexemes[0].pronunciations[other.id].irregular).toBe(true)
  })
  it('无可用规则仍保持导入IPA原值，但自动状态真实为false', () => {
    const { project, lang, primary } = fixture()
    primary.rulesToIpa = ''
    const header = ['lemma', 'IPA'],
      m = mapping(lang.id, header)
    m.columns[1] = { kind: 'pronunciation', orthography: '' }
    m.automaticIpa = true
    applyCsvImport(project, [header, ['fana', 'USER']], m)
    expect(project.lexemes[0].pronunciations[primary.id]).toEqual({ ipa: 'USER', irregular: false })
  })
  it('覆盖保留目标ID、义项ID、既有关系与未导入数据，空格不擦除旧值', () => {
    const { project, lang } = fixture(),
      entry = createLexeme(lang.id, 'fana'),
      related = createLexeme(lang.id, 'other')
    entry.senses[0].definition = { zh: '旧', en: 'old' }
    entry.senses[0].examples = ['example']
    entry.notes = 'keep'
    entry.stems.root = 'stem'
    entry.relations = [{ kind: 'synonym', lexemeId: related.id }]
    entry.images = [{ id: 'image', dataUrl: 'data:image/png;base64,AA', caption: 'keep' }]
    entry.senses.push({
      ...createSense(),
      definition: { zh: 'extra' },
      registers: ['old-register']
    })
    project.lexemes.push(entry, related)
    const oldId = entry.id,
      oldSense = entry.senses[0].id,
      created = entry.createdAt,
      header = ['lemma', 'definition_en', 'notes'],
      m = mapping(lang.id, header)
    m.overwriteExisting = true
    const report = applyCsvImport(project, [header, ['fana', 'updated', '']], m),
      result = project.lexemes[0]
    expect(report).toMatchObject({ created: 0, updated: 1 })
    expect(result.id).toBe(oldId)
    expect(result.createdAt).toBe(created)
    expect(result.senses[0].id).toBe(oldSense)
    expect(result.senses[0].definition).toEqual({ zh: '旧', en: 'updated' })
    expect(result.senses[1].registers).toEqual(['old-register'])
    expect(result.notes).toBe('keep')
    expect(result.stems.root).toBe('stem')
    expect(result.relations).toEqual(entry.relations)
    expect(result.images).toEqual(entry.images)
    expect(result.senses[0].examples).toEqual(['example'])
  })
  it('多语言只覆盖本行解析的同语言，不把未知语言回退并到旧词', () => {
    const { project, lang } = fixture(),
      second = createLanguage({ name: 'Second' })
    project.languages.push(second)
    for (const language of [lang, second]) project.lexemes.push(createLexeme(language.id, 'same'))
    const ids = project.lexemes.map((entry) => entry.id),
      header = ['lemma', 'language', 'definition_en'],
      m = mapping(lang.id, header)
    m.overwriteExisting = true
    const report = applyCsvImport(
      project,
      [header, ['same', second.id, 'second'], ['same', 'MISSING', 'new']],
      m
    )
    expect(project.lexemes[0].senses[0].definition.en).toBeUndefined()
    expect(project.lexemes[1].senses[0].definition.en).toBe('second')
    expect(project.lexemes.slice(0, 2).map((entry) => entry.id)).toEqual(ids)
    expect(report.updated).toBe(1)
    expect(report.ambiguous).toEqual(['same'])
    expect(project.lexemes).toHaveLength(3)
  })
  it('同形不唯一时追加；提供词类后只更新唯一同词类者', () => {
    const { project, lang } = fixture(),
      noun = { id: 'N', name: { en: 'noun' }, abbr: 'n' },
      verb = { id: 'V', name: { en: 'verb' }, abbr: 'v' }
    project.posList.push(noun, verb)
    const a = createLexeme(lang.id, 'same'),
      b = createLexeme(lang.id, 'same')
    a.posId = noun.id
    b.posId = verb.id
    project.lexemes.push(a, b)
    const header = ['lemma', 'pos', 'definition_en'],
      m = mapping(lang.id, header)
    m.overwriteExisting = true
    const report = applyCsvImport(
      project,
      [header, ['same', 'n', 'noun update'], ['same', '', 'ambiguous']],
      m
    )
    expect(report.updated).toBe(1)
    expect(report.ambiguous).toEqual(['same'])
    expect(project.lexemes[0].senses[0].definition.en).toBe('noun update')
    expect(project.lexemes[1].senses[0].definition.en).toBeUndefined()
    expect(project.lexemes).toHaveLength(3)
  })
  it('预览使用浅数组也不污染原词条，覆盖结果可被独立展示', () => {
    const { project, lang } = fixture(),
      entry = createLexeme(lang.id, 'same')
    project.lexemes.push(entry)
    const before = JSON.stringify(project),
      scratch = scratchProject(project)
    scratch.lexemes = [...project.lexemes]
    const header = ['lemma', 'definition_en'],
      m = mapping(lang.id, header)
    m.overwriteExisting = true
    m.automaticIpa = true
    applyCsvImport(scratch, [header, ['same', 'changed']], m)
    expect(JSON.stringify(project)).toBe(before)
    expect(scratch.lexemes[0].id).toBe(entry.id)
    expect(scratch.lexemes[0]).not.toBe(entry)
    expect(scratch.lexemes[0].senses[0].definition.en).toBe('changed')
  })
  it('同批重复覆盖保留一个ID，延后的关系仍指向最终对象', () => {
    const { project, lang } = fixture(),
      target = createLexeme(lang.id, 'target')
    project.lexemes.push(target)
    const header = ['lemma', 'definition_en', 'relation'],
      m = mapping(lang.id, header)
    m.columns[2] = { kind: 'relation', relKind: 'related' }
    m.overwriteExisting = true
    const report = applyCsvImport(
      project,
      [header, ['new', 'first', 'target'], ['new', 'second', '']],
      m
    )
    expect(report).toMatchObject({ created: 1, updated: 1 })
    expect(project.lexemes).toHaveLength(2)
    expect(project.lexemes[1].senses[0].definition.en).toBe('second')
    expect(project.lexemes[1].relations).toEqual([{ kind: 'related', lexemeId: target.id }])
  })
  it('重复覆盖与保存重开不叠加相同词源或阶段，修改同一阶段保留原ID', () => {
    let { project, lang } = fixture()
    const entry = createLexeme(lang.id, 'fana'),
      base = createLexeme(lang.id, 'base')
    entry.etymology.sources = [
      { kind: 'external', language: 'Unmapped', form: 'keep', meaning: 'keep' }
    ]
    entry.etymology.stages = [
      { id: 'middle', form: 'old', type: 'manual', notes: 'Middle' },
      { id: 'unmapped', form: 'keep', type: 'manual', notes: 'Other' }
    ]
    project.lexemes.push(entry, base)
    const header = ['lemma', 'source', 'stage', 'relation'],
      m = mapping(lang.id, header)
    m.columns[1] = { kind: 'protoForm', language: lang.name }
    m.columns[2] = { kind: 'etymologyStage', label: 'Middle' }
    m.columns[3] = { kind: 'relation', relKind: 'related' }
    m.overwriteExisting = true
    const rows = [header, ['fana', 'base', 'new', 'base']]
    applyCsvImport(project, rows, m)
    applyCsvImport(project, rows, m)
    project = parseProject(serializeProject(project))
    lang = project.languages[0]
    applyCsvImport(project, [header, ['fana', 'base', 'changed', 'base']], m)
    const actual = project.lexemes[0]
    expect(actual.id).toBe(entry.id)
    expect(actual.etymology.sources).toEqual([
      { kind: 'external', language: 'Unmapped', form: 'keep', meaning: 'keep' },
      { kind: 'lexeme', id: base.id }
    ])
    expect(actual.etymology.stages).toEqual([
      { id: 'middle', form: 'changed', type: 'manual', notes: 'Middle' },
      { id: 'unmapped', form: 'keep', type: 'manual', notes: 'Other' }
    ])
    expect(actual.relations).toEqual([{ kind: 'related', lexemeId: base.id }])
  })
  it('新产生无说明阶段按导入列稳定更新，组合来源的有意重复不会消失', () => {
    const { project, lang } = fixture(),
      entry = createLexeme(lang.id, 'fana'),
      base = createLexeme(lang.id, 'base')
    project.lexemes.push(entry, base)
    const header = ['lemma', 'source', 'stage'],
      m = mapping(lang.id, header)
    m.columns[1] = { kind: 'protoForm', language: lang.name }
    m.columns[2] = { kind: 'etymologyStage' }
    m.overwriteExisting = true
    const rows = [header, ['fana', 'base + base', 'middle']]
    applyCsvImport(project, rows, m)
    const stageId = project.lexemes[0].etymology.stages[0].id
    applyCsvImport(project, rows, m)
    applyCsvImport(project, [header, ['fana', 'base + base', 'late']], m)
    expect(project.lexemes[0].etymology.sources).toEqual([
      { kind: 'lexeme', id: base.id },
      { kind: 'lexeme', id: base.id }
    ])
    expect(project.lexemes[0].etymology.stages).toHaveLength(1)
    expect(project.lexemes[0].etymology.stages[0]).toMatchObject({ id: stageId, form: 'late' })
  })
  it('不同来源列中的同形组合部件保留，重复同一覆盖表不叠加', () => {
    const { project, lang } = fixture(),
      entry = createLexeme(lang.id, 'word'),
      base = createLexeme(lang.id, 'base')
    project.lexemes.push(entry, base)
    const header = ['lemma', 'source1', 'source2'],
      m = mapping(lang.id, header)
    m.columns[1] = m.columns[2] = { kind: 'protoForm', language: lang.name }
    m.overwriteExisting = true
    applyCsvImport(project, [header, ['word', 'base', 'base']], m)
    applyCsvImport(project, [header, ['word', 'base', 'base']], m)
    expect(project.lexemes[0].etymology.sources).toEqual([
      { kind: 'lexeme', id: base.id },
      { kind: 'lexeme', id: base.id }
    ])
  })
})
