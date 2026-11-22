import { describe, expect, it } from 'vitest'
import { createLanguage, createLexeme, createProject } from '$lib/core/factory'
import {
  derivePronunciations,
  orthographySignature,
  pronunciationOf,
  runOrthography,
  spellToIpa,
  transcribe
} from '$lib/core/pronounce'
import { syncPhonemeRules } from '$lib/core/phonemeSpelling'
import { parseProject, serializeProject } from '$lib/core/serialize'
import { parseRuleText, runRules } from '$lib/engine/sca'
import { inferFeatures } from '$lib/ipa/features'

function fixture() {
  const lang = createLanguage({ name: 'Case QA' }),
    ortho = lang.orthographies[0]
  lang.phonemes = [
    ['a', 'a'],
    ['ɸ', 'f'],
    ['u', 'u'],
    ['i', 'i'],
    ['d', 'd'],
    ['e', 'e'],
    ['l', 'l']
  ].map(([symbol, written], i) => ({
    id: 'p' + i,
    symbol,
    graphemes: { [ortho.id]: written },
    features: inferFeatures(symbol),
    notes: ''
  }))
  return { lang, ortho }
}
describe('case handling belongs to spelling → IPA only', () => {
  it('lazily displays old automatic pronunciations without rewriting stored data', () => {
    const { lang, ortho } = fixture()
    ortho.rulesToIpa = 'f > ɸ'
    delete ortho.caseInsensitive
    const entry = createLexeme(lang.id, 'Aufidel')
    expect(pronunciationOf(lang, ortho, entry)).toBeUndefined()
    entry.pronunciations[ortho.id] = { ipa: 'Auɸidel', irregular: false }
    const before = JSON.stringify(entry)
    expect(pronunciationOf(lang, ortho, entry)?.ipa).toBe('auɸidel')
    expect(JSON.stringify(entry)).toBe(before)
    ortho.caseInsensitive = false
    expect(pronunciationOf(lang, ortho, entry)?.ipa).toBe('Auɸidel')
    entry.pronunciations[ortho.id].irregular = true
    ortho.caseInsensitive = true
    expect(pronunciationOf(lang, ortho, entry)?.ipa).toBe('Auɸidel')
    entry.pronunciations[ortho.id].irregular = false
    ortho.rulesToIpa = ''
    expect(pronunciationOf(lang, ortho, entry)?.ipa).toBe('Auɸidel')
  })
  it('defaults new and old orthographies to the same IPA without changing the source', () => {
    const { lang, ortho } = fixture()
    ortho.rulesToIpa = 'f > ɸ'
    expect(ortho.caseInsensitive).toBe(true)
    delete ortho.caseInsensitive
    const before = JSON.stringify(ortho)
    expect(transcribe(lang, ortho, 'Aufidel AUFIDEL aufidel')).toBe('auɸidel auɸidel auɸidel')
    expect(JSON.stringify(ortho)).toBe(before)
    expect(runOrthography(lang, ortho, 'toIpa', 'Aufidel').input).toBe('Aufidel')
  })
  it('toggles both base and advanced mappings and invalidates downstream signatures', () => {
    const { lang, ortho } = fixture()
    syncPhonemeRules(lang, ortho, { initialize: true, activateAll: true })
    ortho.rulesToIpa = 'ɸ > X / a_'
    const on = orthographySignature(lang, ortho)
    expect(transcribe(lang, ortho, 'AF')).toBe('aX')
    ortho.caseInsensitive = false
    expect(orthographySignature(lang, ortho)).not.toBe(on)
    expect(transcribe(lang, ortho, 'AF af')).toBe('AF aX')
    ortho.caseInsensitive = true
    expect(transcribe(lang, ortho, 'AF')).toBe('aX')
  })
  it('respects separately defined uppercase spellings when disabled and preserves uppercase IPA output', () => {
    const { lang, ortho } = fixture()
    ortho.rulesToIpa = 'F > X\nf > ɸ'
    expect(transcribe(lang, ortho, 'F f')).toBe('X X')
    ortho.caseInsensitive = false
    expect(transcribe(lang, ortho, 'F f')).toBe('X ɸ')
  })
  it('uses the same switch in legacy fallback and multiword punctuation', () => {
    const { lang, ortho } = fixture()
    expect(spellToIpa(lang, ortho, 'Aufidel')).toBe('auɸidel')
    ortho.caseInsensitive = false
    expect(spellToIpa(lang, ortho, 'Aufidel')).toBe('Auɸidel')
    ortho.caseInsensitive = true
    ortho.rulesToIpa = 'f > ɸ\nl > / _#'
    expect(transcribe(lang, ortho, '“AUFIDEL,”\tAufidel!')).toBe('“auɸide,”\tauɸide!')
  })
  it('keeps reverse rules, sound changes, stored spellings and irregular IPA intact', () => {
    const { lang, ortho } = fixture()
    ortho.rulesToIpa = 'f > ɸ'
    ortho.rulesFromIpa = 'X > F'
    expect(runOrthography(lang, ortho, 'fromIpa', 'X x').output).toBe('F x')
    expect(runRules(parseRuleText('f > ɸ'), 'F f').output).toBe('F ɸ')
    const project = createProject({ name: 'Case preservation', template: 'blank', uiLocale: 'zh' })
    project.languages = [lang]
    const entry = createLexeme(lang.id, 'Aufidel')
    project.lexemes.push(entry)
    derivePronunciations(lang, entry, project)
    expect(entry.lemma).toBe('Aufidel')
    expect(entry.pronunciations[ortho.id].ipa).toBe('auɸidel')
    entry.pronunciations[ortho.id] = { ipa: 'Q', irregular: true }
    derivePronunciations(lang, entry, project)
    expect(entry.pronunciations[ortho.id].ipa).toBe('Q')
    ortho.caseInsensitive = false
    const saved = parseProject(serializeProject(project))
    expect(saved.languages[0].orthographies[0].caseInsensitive).toBe(false)
    expect(saved.languages[0].orthographies[0].rulesFromIpa).toBe('X > F')
    expect(saved.lexemes[0].lemma).toBe('Aufidel')
  })
})
