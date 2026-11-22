import type { Language, Lexeme, Orthography, PhonotacticLists, Project } from './model'
import { generateNaturalWords, type WordGenOptions } from '$lib/engine/phon/wordgen'
import { phonemeKind, phonotacticsFromInventory, spellingUnits } from '$lib/engine/phon'
import { hasPhonemeRules, orthographyInput, spellingVariants } from './phonemeSpelling'
import {
  hasOrthographyRules,
  orthoProgram,
  orthographyRunner,
  spellToIpa,
  transcribe
} from './pronounce'
import { stripStress } from '$lib/engine/sca'
import { lexemeStress } from './stressInfo'

export type GenerationNotation = 'spelling' | 'ipa'
export const generationNotation = (lang: Language): GenerationNotation =>
  lang.phonotactics.notation === 'spelling' ? 'spelling' : 'ipa'
export const generationLists = (lang: Language): PhonotacticLists =>
  generationNotation(lang) === 'spelling' && lang.phonotactics.spelling
    ? lang.phonotactics.spelling
    : lang.phonotactics

/** 两个模式各存一张表；切换不把IPA当拼写，也不做有损逆向转换。 */
export function setGenerationNotation(lang: Language, notation: GenerationNotation): void {
  if (notation === 'spelling' && !lang.phonotactics.spelling)
    lang.phonotactics.spelling = {
      onsets: [],
      nuclei: [],
      codas: [],
      illegal: [],
      weights: {},
      minSyllables: lang.phonotactics.minSyllables,
      maxSyllables: lang.phonotactics.maxSyllables
    }
  lang.phonotactics.notation = notation
}

/** 只给造词/配列检查使用的工作音位表，不影响音变与IPA音节分析。 */
export function generationLanguage(lang: Language): Language {
  if (generationNotation(lang) === 'ipa') return lang
  const written = spellingUnits(lang)
  const lists = generationLists(lang)
  const units = [...new Set([...written.units, ...lists.nuclei])]
  return {
    ...lang,
    classes: [],
    digraphs: [],
    phonemes: units.map((symbol, index) => ({
      id: `generation-unit-${index}`,
      symbol,
      notes: '',
      graphemes: {},
      features: {
        type: written.isVowel(symbol) || lists.nuclei.includes(symbol) ? 'vowel' : 'consonant'
      }
    })),
    phonotactics: lists
  }
}

export function generationInventory(lang: Language): ReturnType<typeof phonotacticsFromInventory> {
  if (generationNotation(lang) === 'ipa') return phonotacticsFromInventory(lang)
  const ortho = lang.orthographies.find((o) => o.isPrimary) ?? lang.orthographies[0]
  const consonants: string[] = [],
    vowels: string[] = [],
    unknown: string[] = []
  for (const p of lang.phonemes) {
    const mapping =
      ortho && hasPhonemeRules(ortho, 'toIpa')
        ? ortho.phonemeRules!.toIpa.find((r) => r.phonemeId === p.id && r.enabled)?.from
        : undefined
    const spelling =
      mapping ?? (ortho ? spellingVariants(p.graphemes[ortho.id] ?? '')[0] : undefined) ?? p.symbol
    const kind = phonemeKind(lang, p)
    if (kind === 'consonant') consonants.push(spelling)
    else if (kind === 'vowel') vowels.push(spelling)
    else unknown.push(spelling)
  }
  return {
    onsets: [...new Set(consonants)],
    nuclei: [...new Set(vowels)],
    codas: [...new Set(consonants)],
    unknown
  }
}

export function currentLexemeIpa(
  project: Project,
  lang: Language,
  entry: Lexeme,
  primary?: Orthography
): string {
  const stored = primary ? entry.pronunciations[primary.id] : undefined
  if (stored?.irregular && stored.ipa) return stored.ipa
  return (
    (primary ? transcribe(lang, primary, entry.lemma, lexemeStress(project, entry)) : null) ||
    stored?.ipa ||
    (primary ? spellToIpa(lang, primary, entry.lemma) : entry.lemma)
  )
}

export interface GeneratedCandidate {
  ipa: string
  spelt: string | null
  like: string[]
}

export function generateCandidates(
  project: Project,
  lang: Language,
  options: Pick<WordGenOptions, 'count' | 'minSyllables' | 'maxSyllables' | 'seed'> & {
    learn: boolean
  }
): GeneratedCandidate[] {
  const primary = lang.orthographies.find((o) => o.isPrimary)
  const spelling = generationNotation(lang) === 'spelling'
  const mine = project.lexemes.filter((l) => l.languageId === lang.id && l.lemma.trim())
  const written = (text: string): string => (primary ? orthographyInput(primary, text) : text)
  const existing = new Set(mine.map((l) => (spelling ? written(l.lemma) : l.lemma)))
  const lexicon = options.learn
    ? mine.map((l) => ({
        label: l.lemma,
        ipa: spelling ? written(l.lemma) : currentLexemeIpa(project, lang, l, primary)
      }))
    : []
  const reverse = !spelling && primary ? orthoProgram(lang, primary, 'fromIpa') : null
  const runReverse =
    !spelling && primary ? orthographyRunner(lang, primary, 'fromIpa', {}, reverse) : null
  return generateNaturalWords(generationLanguage(lang), { ...options, lexicon, exclude: existing })
    .map((word) => {
      if (spelling)
        return { spelt: word.ipa, ipa: spellToIpa(lang, primary, word.ipa), like: word.like }
      const converted =
        primary && hasOrthographyRules(primary, 'fromIpa') ? runReverse!(word.ipa).output : null
      return {
        ipa: word.ipa,
        spelt: converted && reverse?.hasStress ? stripStress(converted) : converted,
        like: word.like
      }
    })
    .filter((word) => !existing.has(word.spelt ?? word.ipa))
}

/** 自动生成的逆向表保留存盘；只有实际启用或手调数据才需要兼容编辑入口。 */
export function hasLegacyReverse(ortho: Orthography): boolean {
  return Boolean(ortho.rulesFromIpa.trim() || ortho.phonemeRules?.fromIpa.some((r) => r.edited))
}
