import { describe, expect, it } from 'vitest'
import { morphemeSlotsFixture } from '../helpers/morphemeSlotsFixture'
import { boundMorpheme, splitMorphemePart } from '$lib/core/morphemeSlots'
import {
  deriveForms,
  generateForm,
  generateFormWithDiagnostics,
  makeContext
} from '$lib/engine/morph'
import {
  parseProject,
  projectFromFolder,
  projectToFolder,
  serializeProject
} from '$lib/core/serialize'
import type { Paradigm } from '$lib/core/model'
import { projectFromCsv, projectToCsv } from '$lib/core/projectCsv'

describe('reusable per-lexeme morpheme slots', () => {
  it('two different bound prefix morphemes use the exact same paradigm and current slot values', () => {
    const { project, language, word, otherWord, paradigm, slots } = morphemeSlotsFixture()
    const ctx = makeContext(project, language),
      rows = (lexeme: typeof word) =>
        Object.fromEntries(
          slots.map((slot) => [slot.label, generateForm(ctx, lexeme, paradigm, slot)?.surface])
        )
    expect(word.paradigmId).toBe(otherWord.paradigmId)
    expect(rows(word)).toEqual({
      '独立.普通': 'pa·mora',
      '附属.普通': 'pe·mora',
      '独立.轻微命令': 'pa·morbu',
      '附属.轻微命令': 'pe·morbu',
      '独立.强调': 'pa·morbu',
      '附属.强调': 'pe·morbu'
    })
    expect(rows(otherWord)).toEqual({
      '独立.普通': 'na·demo',
      '附属.普通': 'ni·demo',
      '独立.轻微命令': 'na·dembu',
      '附属.轻微命令': 'ni·dembu',
      '独立.强调': 'na·dembu',
      '附属.强调': 'ni·dembu'
    })
    expect(project.paradigms).toHaveLength(1)
  })
  it('bound morpheme still obeys environment and traces the actual binding and morb + -u', () => {
    const { project, language, prefix, word, paradigm, slots } = morphemeSlotsFixture(),
      ctx = makeContext(project, language)
    prefix.allomorphs[1].environment = '_V'
    const plain = slots.find((s) => s.label === '附属.普通')!,
      soft = slots.find((s) => s.label === '独立.轻微命令')!
    expect(generateForm(ctx, word, paradigm, plain)?.surface).toBe('pa·mora')
    prefix.allomorphs[1].environment = '_m'
    expect(generateForm(ctx, word, paradigm, plain)?.surface).toBe('pe·mora')
    const generated = generateForm(ctx, word, paradigm, soft)!
    expect(generated.trace.join('\n')).toContain('词干 u前词干: morb')
    expect(generated.trace.join('\n')).toContain('语素槽「词条前缀」引用语素「pa-」')
    expect(generated.trace.join('\n')).toContain('- → -u')
  })
  it.each(['unbound', 'deleted', 'foreign', 'missing-slot'] as const)(
    'invalid binding %s stops generation without literal or base fallback',
    (kind) => {
      const { project, language, prefix, foreign, word, paradigm, slots } = morphemeSlotsFixture()
      if (kind === 'unbound') delete word.morphemeBindings!['prefix-slot']
      if (kind === 'deleted')
        project.morphemes = project.morphemes.filter((m) => m.id !== prefix.id)
      if (kind === 'foreign') word.morphemeBindings!['prefix-slot'] = foreign.id
      if (kind === 'missing-slot')
        project.morphemeSlots = project.morphemeSlots!.filter((s) => s.id !== 'prefix-slot')
      const result = generateFormWithDiagnostics(
        makeContext(project, language),
        word,
        paradigm,
        slots[0]
      )
      expect(result.generated).toBeNull()
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0]).toContain('语素槽')
      const saved = { surface: 'stored form', derived: true, override: false, trace: [] }
      word.forms[slots[0].label] = saved
      expect(deriveForms(makeContext(project, language), word, paradigm, [slots[0]])).toBe(1)
      expect(word.forms[slots[0].label]).toBeUndefined()
    }
  )
  it.each(['clear binding', 'delete morpheme'] as const)(
    'regenerating after %s removes only stale automatic slot results',
    (change) => {
      const { project, language, prefix, word, paradigm, slots } = morphemeSlotsFixture(),
        ctx = makeContext(project, language)
      expect(deriveForms(ctx, word, paradigm)).toBe(6)
      expect(word.forms[slots[0].label].surface).toBe('pa·mora')
      word.forms[slots[1].label] = {
        surface: 'manual override',
        derived: true,
        override: true,
        trace: []
      }
      word.forms[slots[2].label] = {
        surface: 'manual raw',
        derived: false,
        override: false,
        trace: []
      }
      if (change === 'clear binding') delete word.morphemeBindings!['prefix-slot']
      else project.morphemes = project.morphemes.filter((m) => m.id !== prefix.id)
      expect(deriveForms(ctx, word, paradigm)).toBe(4)
      expect(word.forms[slots[0].label]).toBeUndefined()
      expect(word.forms[slots[1].label].surface).toBe('manual override')
      expect(word.forms[slots[2].label].surface).toBe('manual raw')
      expect(generateFormWithDiagnostics(ctx, word, paradigm, slots[0]).diagnostics).toHaveLength(1)
    }
  )
  it('no-generator slots keep previously stored forms when there is no binding error', () => {
    const { project, language, word, paradigm, slots } = morphemeSlotsFixture(),
      ctx = makeContext(project, language)
    deriveForms(ctx, word, paradigm)
    const previous = word.forms[slots[0].label]
    paradigm.generators[slots[0].key] = { kind: 'none' }
    expect(deriveForms(ctx, word, paradigm, [slots[0]])).toBe(0)
    expect(word.forms[slots[0].label]).toBe(previous)
  })
  it('explicit ID binding is stable through same-name morphemes and slot rename, and allows other types', () => {
    const { project, language, prefix, otherPrefix, word, paradigm, slots } = morphemeSlotsFixture()
    prefix.form = 'same-'
    otherPrefix.form = 'same-'
    prefix.gloss = otherPrefix.gloss = 'SAME'
    otherPrefix.type = 'root'
    word.morphemeBindings!['prefix-slot'] = otherPrefix.id
    project.morphemeSlots![0].name = '改名槽'
    const generated = generateForm(makeContext(project, language), word, paradigm, slots[0])!
    expect(generated.surface).toBe('na·mora')
    expect(generated.trace.join('\n')).toContain('语素槽「改名槽」')
  })
  it('legacy concrete @ references remain compatible and literal separators remain exact', () => {
    const { project, language, word, paradigm, slots } = morphemeSlotsFixture(),
      g = paradigm.generators[slots[0].key]
    if (g.kind !== 'pipeline') throw Error('fixture')
    g.steps = [
      { id: 'legacy', kind: 'prefix', text: '@MOTION.PFX·' },
      {
        id: 'slot',
        kind: 'suffix',
        text: 'DO NOT USE',
        morphemeSlot: 'ending-slot',
        slotBefore: ' ',
        slotAfter: '-'
      }
    ]
    expect(generateForm(makeContext(project, language), word, paradigm, slots[0])?.surface).toBe(
      'pa·mora -'
    )
  })
  it('missing bindings in nested and inherited pipelines propagate instead of producing partial forms', () => {
    const { project, language, unboundWord, paradigm, slots } = morphemeSlotsFixture()
    const outer: Paradigm = {
      id: 'outer',
      name: { zh: '外层' },
      dimensionIds: paradigm.dimensionIds,
      variants: [],
      disabledSlots: [],
      inheritsFrom: null,
      generators: {
        [slots[0].key]: {
          kind: 'pipeline',
          stem: '普通词干',
          steps: [
            { id: 'nested', kind: 'paradigm', paradigmId: paradigm.id, slotKey: slots[0].key }
          ]
        }
      }
    }
    project.paradigms.push(outer)
    expect(
      generateFormWithDiagnostics(makeContext(project, language), unboundWord, outer, slots[0])
        .diagnostics
    ).toHaveLength(1)
    outer.generators[slots[0].key] = {
      kind: 'pipeline',
      stem: '普通词干',
      base: { paradigmId: paradigm.id, slotKey: slots[0].key },
      steps: []
    }
    expect(
      generateFormWithDiagnostics(makeContext(project, language), unboundWord, outer, slots[0])
        .generated
    ).toBeNull()
  })
  it('pronunciation pipeline resolves the same binding and rejects missing bindings', () => {
    const { project, language, word, unboundWord, paradigm, slots } = morphemeSlotsFixture(),
      g = paradigm.generators[slots[0].key]
    if (g.kind !== 'pipeline') throw Error('fixture')
    g.steps = []
    g.pron = {
      on: true,
      from: 'form',
      steps: [{ id: 'pron', kind: 'prefix', text: '', morphemeSlot: 'prefix-slot' }]
    }
    expect(generateForm(makeContext(project, language), word, paradigm, slots[0])?.ipa).toBe(
      'pamora'
    )
    expect(
      generateFormWithDiagnostics(makeContext(project, language), unboundWord, paradigm, slots[0])
        .generated
    ).toBeNull()
  })
  it('JSON and folder round trips retain definitions, bindings, generators and generated results', () => {
    const { project, word, paradigm, slots } = morphemeSlotsFixture()
    for (const restored of [
      parseProject(serializeProject(project)),
      projectFromFolder(projectToFolder(project)),
      projectFromCsv(projectToCsv(project))
    ]) {
      expect(restored.morphemeSlots).toEqual(project.morphemeSlots)
      expect(restored.lexemes[0].morphemeBindings).toEqual(word.morphemeBindings)
      expect(restored.paradigms[0]).toEqual(paradigm)
      expect(
        generateForm(
          makeContext(restored, restored.languages[0]),
          restored.lexemes[0],
          restored.paradigms[0],
          slots[0]
        )?.surface
      ).toBe('pa·mora')
    }
  })
  it('legacy projects do not acquire optional binding collections', () => {
    const { project } = morphemeSlotsFixture()
    delete project.morphemeSlots
    for (const l of project.lexemes) delete l.morphemeBindings
    const restored = projectFromFolder(projectToFolder(project))
    expect(restored).not.toHaveProperty('morphemeSlots')
    expect(restored.lexemes[0]).not.toHaveProperty('morphemeBindings')
  })
  it('manual split requires an exact nonempty edge including its separator and never rewrites the lemma', () => {
    expect(splitMorphemePart('pa·mora', 'pa·', 'prefix')).toBe('mora')
    expect(splitMorphemePart('morb-u', '-u', 'suffix')).toBe('morb')
    expect(splitMorphemePart('g·merɡ', 'ɡ·', 'prefix')).toBe('merɡ')
    expect(splitMorphemePart('ɡer-g', '-ɡ', 'suffix')).toBe('ɡer')
    expect(splitMorphemePart('pa·mora', 'mer', 'prefix')).toBeNull()
    expect(splitMorphemePart('pa·mora', 'pa·mora', 'prefix')).toBeNull()
    expect(splitMorphemePart('pa·mora', '', 'prefix')).toBeNull()
    const { project, word, foreign } = morphemeSlotsFixture()
    word.morphemeBindings!['prefix-slot'] = foreign.id
    expect(boundMorpheme(project, word, 'prefix-slot').issue).toBe('wrong-language')
  })
})
