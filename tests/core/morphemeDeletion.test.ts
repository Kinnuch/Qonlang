import { describe, expect, it } from 'vitest'
import { createLexeme, createMorpheme, createProject, createSentence } from '$lib/core/factory'
import { removeMorphemes, restoreMorphemes } from '$lib/core/morphemeDeletion'

function setup() {
  const project = createProject({ name: 'Public deletion QA', template: 'blank', uiLocale: 'en' })
  const language = project.languages[0]
  project.morphemes = ['a-', '-b', '-c', '-d'].map((form) => {
    const m = createMorpheme(language.id, 'suffix')
    m.form = form
    return m
  })
  return { project, language, ids: project.morphemes.map((m) => m.id) }
}

describe('morpheme deletion and undo', () => {
  it('single and batch deletion restore original IDs and order without duplication', () => {
    const { project, ids } = setup()
    const removed = removeMorphemes(project, new Set([ids[0], ids[2], 'missing']))
    expect(project.morphemes.map((m) => m.id)).toEqual([ids[1], ids[3]])
    expect(restoreMorphemes(project, removed)).toEqual([ids[0], ids[2]])
    expect(project.morphemes.map((m) => m.id)).toEqual(ids)
    expect(restoreMorphemes(project, removed)).toEqual([])
    expect(project.morphemes.map((m) => m.id)).toEqual(ids)
  })
  it('restoring a deletion preserves a subsequently added morpheme and edits to survivors', () => {
    const { project, language, ids } = setup()
    const removed = removeMorphemes(project, new Set([ids[1]]))
    const added = createMorpheme(language.id, 'root')
    project.morphemes.push(added)
    project.morphemes[0].form = 'edited'
    restoreMorphemes(project, removed)
    expect(project.morphemes.map((m) => m.id)).toEqual([...ids, added.id])
    expect(project.morphemes[0].form).toBe('edited')
  })
  it('retains etymology, corpus and paradigm references exactly as the old single-delete path', () => {
    const { project, language, ids } = setup()
    const lexeme = createLexeme(language.id, 'word')
    lexeme.etymology.sources = [{ kind: 'morpheme', id: ids[1] }]
    project.lexemes.push(lexeme)
    project.morphemes[3].etymology.sources = [{ kind: 'morpheme', id: ids[1] }]
    project.morphemes[1].gloss = 'BOUND'
    project.paradigms.push({
      id: 'p',
      name: { en: 'Uses BOUND' },
      dimensionIds: [],
      variants: [],
      disabledSlots: [],
      inheritsFrom: null,
      generators: {
        slot: {
          kind: 'pipeline',
          stem: '',
          steps: [{ id: 'step', kind: 'suffix', text: '@BOUND' }]
        }
      }
    })
    const sentence = createSentence(language.id)
    sentence.tokens = [
      {
        surface: 'wordb',
        chosen: 0,
        confirmed: true,
        analyses: [
          {
            lexemeId: lexeme.id,
            slot: null,
            morphs: [{ form: 'b', gloss: 'BOUND', morphemeId: ids[1] }]
          }
        ]
      }
    ]
    project.sentences.push(sentence)
    const references = JSON.stringify({
      lexemes: project.lexemes,
      paradigms: project.paradigms,
      sentences: project.sentences,
      source: project.morphemes[3].etymology
    })
    const removed = removeMorphemes(project, new Set([ids[1]]))
    expect(
      JSON.stringify({
        lexemes: project.lexemes,
        paradigms: project.paradigms,
        sentences: project.sentences,
        source: project.morphemes.at(-1)!.etymology
      })
    ).toBe(references)
    restoreMorphemes(project, removed)
    expect(project.lexemes[0].etymology.sources[0]).toEqual({ kind: 'morpheme', id: ids[1] })
  })
})
