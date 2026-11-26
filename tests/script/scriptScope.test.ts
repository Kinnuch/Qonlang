import { describe, expect, it } from 'vitest'
import {
  createLanguage,
  createLexeme,
  createProject,
  createScript,
  createSentence
} from '$lib/core/factory'
import {
  createScriptScopeResolver,
  normalizeScriptFolderScope,
  setSentenceScriptVisible
} from '$lib/core/scriptScope'
import {
  parseProject,
  projectFromFolder,
  projectToFolder,
  serializeProject
} from '$lib/core/serialize'
import { sentenceScriptText } from '$lib/script/lexiconScript'
import { lexemeScript } from '$lib/script/render'
import { interlinear } from '$lib/engine/gloss'
import { importSentencesJson, sentencesToJson, sentencesToText } from '$lib/importers/corpusIO'

function fixture() {
  const project = createProject({
      name: 'Script scope QA',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.1'
    }),
    language = project.languages[0]
  project.folders = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'c', name: 'C', parentId: 'b' },
    { id: 'd', name: 'D' }
  ]
  const first = createScript('First'),
    second = createScript('Second'),
    third = createScript('Third')
  first.id = 'first'
  second.id = 'second'
  third.id = 'third'
  first.rules = 'a > α'
  second.rules = 'a > β'
  third.rules = 'a > γ'
  language.scripts.push(first, second, third)
  const sentence = createSentence(language.id)
  sentence.id = 'sentence'
  sentence.folderId = 'b'
  sentence.text = 'a'
  sentence.scriptForms = { first: 'MANUAL' }
  sentence.tokens = [
    {
      surface: 'a',
      chosen: 0,
      confirmed: true,
      analyses: [
        {
          lexemeId: 'chosen-id',
          slot: null,
          morphs: [{ form: 'a', gloss: 'KEEP', morphemeId: null }]
        }
      ]
    }
  ]
  project.sentences.push(sentence)
  return { project, language, first, second, third, sentence }
}
const ids = (scripts: { id: string }[]) => scripts.map((s) => s.id)

describe('script folder scope', () => {
  it('missing configuration preserves every script and does not add persistence fields', () => {
    const { project, language, sentence } = fixture(),
      before = serializeProject(project)
    expect(ids(createScriptScopeResolver(project, language).visible(sentence))).toEqual([
      'first',
      'second',
      'third'
    ])
    const back = parseProject(before)
    expect(back.languages[0].scripts.every((s) => !('folderScope' in s))).toBe(true)
    expect(back.sentences[0]).not.toHaveProperty('hiddenScriptIds')
  })
  it('none excludes even a hand-entered form without deleting it or confirmed analysis', () => {
    const { project, language, first, sentence } = fixture()
    first.folderScope = { mode: 'none', folderIds: [] }
    const before = JSON.stringify(sentence)
    expect(ids(createScriptScopeResolver(project, language).applicable(sentence))).toEqual([
      'second',
      'third'
    ])
    expect(sentenceScriptText(project, language, first, sentence)).toBe('')
    expect(JSON.stringify(sentence)).toBe(before)
  })
  it('a selected folder includes its descendants and an excluded subtree wins', () => {
    const { project, language, first, sentence } = fixture()
    first.folderScope = { mode: 'selected', folderIds: ['a'], excludedFolderIds: ['b'] }
    const scope = createScriptScopeResolver(project, language)
    expect(scope.includes(first, { ...sentence, folderId: 'a' })).toBe(true)
    expect(scope.includes(first, sentence)).toBe(false)
    expect(scope.includes(first, { ...sentence, folderId: 'c' })).toBe(false)
    expect(scope.includes(first, { ...sentence, folderId: 'd' })).toBe(false)
  })
  it('Default selects only unfiled and orphan records, never every root subtree', () => {
    const { project, language, first, sentence } = fixture()
    first.folderScope = { mode: 'selected', folderIds: [''] }
    const scope = createScriptScopeResolver(project, language)
    for (const folderId of [undefined, '', 'removed'])
      expect(scope.includes(first, { ...sentence, folderId })).toBe(true)
    for (const folderId of ['a', 'b', 'c', 'd'])
      expect(scope.includes(first, { ...sentence, folderId })).toBe(false)
  })
  it('Default can be excluded independently of selected real folders', () => {
    const { project, language, first, sentence } = fixture()
    first.folderScope = { mode: 'selected', folderIds: ['', 'a'], excludedFolderIds: [''] }
    const scope = createScriptScopeResolver(project, language)
    expect(scope.includes(first, sentence)).toBe(true)
    expect(scope.includes(first, { ...sentence, folderId: '' })).toBe(false)
  })
  it('empty custom scope and missing folder references stay empty rather than broadening', () => {
    const { project, language, first, sentence } = fixture()
    for (const folderIds of [[], ['deleted']]) {
      first.folderScope = { mode: 'selected', folderIds }
      expect(createScriptScopeResolver(project, language).includes(first, sentence)).toBe(false)
    }
  })
  it('language isolation applies to all modes and missing language is harmless', () => {
    const { project, language, first, sentence } = fixture(),
      other = createLanguage({ name: 'Other' })
    project.languages.push(other)
    expect(
      createScriptScopeResolver(project, language).applicable({ ...sentence, languageId: other.id })
    ).toEqual([])
    expect(createScriptScopeResolver(project, other).includes(first, sentence)).toBe(false)
    expect(createScriptScopeResolver(project, null).visible(sentence)).toEqual([])
  })
  it('readonly resolver understands legacy folder ownership without migrating the source', () => {
    const { project, language, first, sentence } = fixture()
    delete project.folders
    project.corpusFolders = [{ id: 'legacy', languageId: language.id, name: 'Legacy' }]
    sentence.folderId = 'legacy'
    const before = JSON.stringify(project)
    first.folderScope = { mode: 'selected', folderIds: ['legacy'] }
    const after = JSON.stringify(project)
    expect(createScriptScopeResolver(project, language).includes(first, sentence)).toBe(true)
    expect(JSON.stringify(project)).toBe(after)
    expect(before).not.toBe(after)
  })
  it('a new resolver observes move and scope edits without a permanent project cache', () => {
    const { project, language, first, sentence } = fixture()
    first.folderScope = { mode: 'selected', folderIds: ['a'] }
    expect(createScriptScopeResolver(project, language).includes(first, sentence)).toBe(true)
    project.folders!.find((f) => f.id === 'b')!.parentId = 'd'
    expect(createScriptScopeResolver(project, language).includes(first, sentence)).toBe(false)
  })
  it('normalizes untrusted optional values without inventing an explicit all setting', () => {
    expect(normalizeScriptFolderScope(null)).toBeUndefined()
    expect(normalizeScriptFolderScope({ mode: 'other' })).toBeUndefined()
    expect(normalizeScriptFolderScope({ mode: 'none', folderIds: ['a'] })).toEqual({
      mode: 'none',
      folderIds: []
    })
    expect(
      normalizeScriptFolderScope({
        mode: 'selected',
        folderIds: ['', 'a', 'a', 3],
        excludedFolderIds: ['b', 'b']
      })
    ).toEqual({ mode: 'selected', folderIds: ['', 'a'], excludedFolderIds: ['b'] })
  })
})

describe('per-sentence script visibility', () => {
  it('defaults to checked, supports hiding every applicable script, and is independent per sentence', () => {
    const { project, language, sentence } = fixture(),
      other = createSentence(language.id),
      scope = createScriptScopeResolver(project, language)
    other.folderId = 'b'
    for (const id of ['first', 'second', 'third'])
      expect(setSentenceScriptVisible(sentence, id, false, scope)).toBe(true)
    expect(scope.visible(sentence)).toEqual([])
    expect(ids(scope.visible(other))).toEqual(['first', 'second', 'third'])
    expect(setSentenceScriptVisible(sentence, 'first', true, scope)).toBe(true)
    expect(ids(scope.visible(sentence))).toEqual(['first'])
  })
  it('a single applicable script is always shown while its previous hidden choice survives', () => {
    const { project, language, first, second, third, sentence } = fixture()
    sentence.hiddenScriptIds = ['first']
    second.folderScope = { mode: 'none', folderIds: [] }
    third.folderScope = { mode: 'none', folderIds: [] }
    let scope = createScriptScopeResolver(project, language)
    expect(ids(scope.visible(sentence))).toEqual([first.id])
    expect(setSentenceScriptVisible(sentence, first.id, false, scope)).toBe(false)
    expect(sentence.hiddenScriptIds).toEqual(['first'])
    delete second.folderScope
    scope = createScriptScopeResolver(project, language)
    expect(ids(scope.visible(sentence))).toEqual(['second'])
  })
  it('zero applicable scripts stays empty even if manual text exists', () => {
    const { project, language, sentence } = fixture()
    for (const script of language.scripts) script.folderScope = { mode: 'none', folderIds: [] }
    expect(createScriptScopeResolver(project, language).visible(sentence)).toEqual([])
  })
  it('invalid, duplicate and idempotent toggles do not mutate the sentence', () => {
    const { project, language, sentence } = fixture(),
      scope = createScriptScopeResolver(project, language),
      before = JSON.stringify(sentence)
    expect(setSentenceScriptVisible(sentence, 'foreign', false, scope)).toBe(false)
    expect(setSentenceScriptVisible(sentence, 'first', true, scope)).toBe(false)
    expect(JSON.stringify(sentence)).toBe(before)
    expect(setSentenceScriptVisible(sentence, 'first', false, scope)).toBe(true)
    expect(setSentenceScriptVisible(sentence, 'first', false, scope)).toBe(false)
  })
  it('toggling preserves stale IDs and all non-display data; returning to all removes the optional field', () => {
    const { project, language, sentence } = fixture(),
      scope = createScriptScopeResolver(project, language),
      tokens = JSON.stringify(sentence.tokens),
      forms = JSON.stringify(sentence.scriptForms)
    sentence.hiddenScriptIds = ['removed']
    setSentenceScriptVisible(sentence, 'first', false, scope)
    setSentenceScriptVisible(sentence, 'first', true, scope)
    expect(sentence.hiddenScriptIds).toEqual(['removed'])
    expect(JSON.stringify(sentence.tokens)).toBe(tokens)
    expect(JSON.stringify(sentence.scriptForms)).toBe(forms)
    sentence.hiddenScriptIds = ['first']
    setSentenceScriptVisible(sentence, 'first', true, scope)
    expect(sentence).not.toHaveProperty('hiddenScriptIds')
  })
})

describe('script scope display and persistence', () => {
  it('manual overrides and generated lines share the same visibility in corpus/export without editing tokens', () => {
    const { project, language, first, second, third, sentence } = fixture()
    sentence.hiddenScriptIds = ['first']
    third.folderScope = { mode: 'none', folderIds: [] }
    const before = JSON.stringify(sentence)
    expect(sentenceScriptText(project, language, first, sentence)).toBe('')
    expect(sentenceScriptText(project, language, second, sentence)).toBe('β')
    expect(interlinear(project, sentence).scripts).toEqual([
      { name: second.name, scriptId: second.id, text: 'β' }
    ])
    const output = sentencesToText(project, [sentence], 'leipzig')
    expect(output).toContain('β')
    expect(output).not.toContain('MANUAL')
    expect(output).not.toContain('γ')
    expect(JSON.stringify(sentence)).toBe(before)
  })
  it('folder scope does not restrict a lexeme script form', () => {
    const { project, language, first } = fixture()
    first.folderScope = { mode: 'none', folderIds: [] }
    const word = createLexeme(language.id, 'a')
    word.scriptForms[first.id] = 'LEXEME'
    expect(lexemeScript(language, first, word)).toBe('LEXEME')
    expect(project.lexemes).toEqual([])
  })
  it.each(['json', 'folder'] as const)(
    '%s retains scope, sentence choices, manual text, raw text and bound IDs',
    (format) => {
      const { project, language, first, sentence } = fixture()
      first.folderScope = { mode: 'selected', folderIds: ['', 'a'], excludedFolderIds: ['c'] }
      sentence.hiddenScriptIds = ['second', 'stale']
      const back =
        format === 'json'
          ? parseProject(serializeProject(project))
          : projectFromFolder(projectToFolder(project))
      expect(back.languages[0].scripts[0].folderScope).toEqual(first.folderScope)
      expect(back.sentences[0]).toEqual(sentence)
      expect(back.languages[0].id).toBe(language.id)
      expect(
        ids(createScriptScopeResolver(back, back.languages[0]).visible(back.sentences[0]))
      ).toEqual(['first', 'third'])
    }
  )
  it('cleans malformed optional data while preserving known and stale references in project files', () => {
    const { project } = fixture(),
      raw = JSON.parse(serializeProject(project))
    raw.languages[0].scripts[0].folderScope = { mode: 'selected', folderIds: ['a', 'a', false] }
    raw.languages[0].scripts[1].folderScope = { mode: 'invalid' }
    raw.sentences[0].hiddenScriptIds = ['first', 'first', 8, '', 'stale']
    const back = parseProject(JSON.stringify(raw))
    expect(back.languages[0].scripts[0].folderScope).toEqual({ mode: 'selected', folderIds: ['a'] })
    expect(back.languages[0].scripts[1]).not.toHaveProperty('folderScope')
    expect(back.sentences[0].hiddenScriptIds).toEqual(['first', 'stale'])
  })
  it('corpus JSON import keeps applicable script preferences without binding foreign script IDs', () => {
    const { project, sentence } = fixture()
    sentence.hiddenScriptIds = ['second', 'foreign']
    const text = sentencesToJson([sentence])
    project.sentences = []
    importSentencesJson(project, sentence.languageId, text)
    expect(project.sentences[0].hiddenScriptIds).toEqual(['second'])
    expect(project.sentences[0].scriptForms).toEqual(sentence.scriptForms)
  })
})
