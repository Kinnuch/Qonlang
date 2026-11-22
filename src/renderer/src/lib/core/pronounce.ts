/**
 * 正字法 → IPA 的自动标音。规则文本按正字法解析并缓存；不规则发音不覆盖。
 */
import type { Language, Lexeme, Orthography, Project, Pronunciation } from './model'
import {
  parseRuleText,
  runRules,
  runRulesOnText,
  mapRuleWords,
  type RuleProgram,
  type WordStress,
  type RunOptions,
  type RunResult
} from '$lib/engine/sca'
import { languageParseOptions } from '$lib/engine/phon'
import { inferFeatures } from '$lib/ipa/features'
import { canonicalG } from '$lib/ipa/equivalence'
import { lexemeStress } from './stressInfo'
import {
  preparePhonemeMapping,
  prepareLiteralMapping,
  orthographyInput,
  orthographyIgnoresCase,
  hasPhonemeRules,
  type OrthographyDirection
} from './phonemeSpelling'

const cache = new Map<string, { text: string; classes: string; program: RuleProgram }>()
export function clearPronounceCache(): void {
  cache.clear()
}

export function orthoProgram(
  lang: Language,
  ortho: Orthography,
  direction: 'toIpa' | 'fromIpa' = 'toIpa'
): RuleProgram | null {
  const text = direction === 'toIpa' ? ortho.rulesToIpa : ortho.rulesFromIpa
  if (!text.trim()) return null
  const opts = {
    ...languageParseOptions(lang),
    caseInsensitive: direction === 'toIpa' && orthographyIgnoresCase(ortho)
  }
  const classesKey = JSON.stringify(opts)
  const key = `${ortho.id}:${direction}`
  const hit = cache.get(key)
  if (hit && hit.text === text && hit.classes === classesKey) return hit.program
  const program = parseRuleText(text, opts)
  cache.set(key, { text, classes: classesKey, program })
  return program
}

export function hasOrthographyRules(
  ortho: Orthography,
  direction: OrthographyDirection = 'toIpa'
): boolean {
  return (
    hasPhonemeRules(ortho, direction) ||
    !!(direction === 'toIpa' ? ortho.rulesToIpa : ortho.rulesFromIpa).trim()
  )
}
/** 构形等调用方的缓存必须同时看基础条目和高级规则。 */
export function orthographySignature(
  lang: Language,
  ortho: Orthography,
  direction: OrthographyDirection = 'toIpa'
): string {
  return JSON.stringify([
    ortho.id,
    direction === 'toIpa' ? ortho.rulesToIpa : ortho.rulesFromIpa,
    ortho.phonemeRules?.[direction] ?? null,
    direction === 'toIpa' && orthographyIgnoresCase(ortho),
    languageParseOptions(lang)
  ])
}

/** 基础条目一次同时转写，再执行原有高级规则；不会把结果再次送回默认写法回退。 */
export function runOrthography(
  lang: Language,
  ortho: Orthography,
  direction: OrthographyDirection,
  word: string,
  options: RunOptions = {},
  program?: RuleProgram | null
): RunResult {
  return orthographyRunner(lang, ortho, direction, options, program)(word)
}
/** 批量或整段转写时只准备一次基础映射和高级程序。 */
export function orthographyRunner(
  lang: Language,
  ortho: Orthography,
  direction: OrthographyDirection,
  options: RunOptions = {},
  program?: RuleProgram | null
): (word: string) => RunResult {
  const convert = preparePhonemeMapping(ortho, direction)
  const advanced = program === undefined ? orthoProgram(lang, ortho, direction) : program
  const runOptions = {
    ...(direction === 'toIpa'
      ? { keepUnits: ipaUnits(lang), caseInsensitive: orthographyIgnoresCase(ortho) }
      : {}),
    ...options
  }
  return (word) => {
    const mapped = convert(direction === 'toIpa' ? orthographyInput(ortho, word) : word)
    if (!advanced) return { input: word, output: mapped, stages: [], trace: [] }
    return { ...runRules(advanced, mapped, runOptions), input: word }
  }
}

/** 与原正字法规则一样按词处理，空白和词界标点保持原来的规则语义。 */
export function runOrthographyOnText(
  lang: Language,
  ortho: Orthography,
  direction: OrthographyDirection,
  text: string,
  options: RunOptions = {}
): string {
  const program = orthoProgram(lang, ortho, direction)
  const run = orthographyRunner(lang, ortho, direction, { ...options, trace: false }, program)
  return mapRuleWords(text, (word) => run(word).output)
}

/**
 * 多合字母里本来就是音标的内部符号（θ、ð、ŋ，或者音位表里有的）：转成音标时留着，不换回 th 这类写法；
 * 只是占位用的（ʦ 这类表里没有、IPA 表也不认的）照旧换回去。
 */
export function ipaUnits(lang: Language): string[] {
  const inventory = new Set(lang.phonemes.map((p) => canonicalG(p.symbol)))
  return lang.digraphs
    .map((d) => d.to)
    .filter((to) => {
      if (!to) return false
      if (inventory.has(canonicalG(to))) return true
      const f = inferFeatures(to)
      return f.type === 'vowel' || f.type === 'consonant'
    })
}

/** 按空白分词逐个转写：`A B` 里 A 的末尾同样算词尾（`_#` 的规则对每个词都生效） */
export function transcribe(
  lang: Language,
  ortho: Orthography,
  text: string,
  word?: WordStress
): string | null {
  if (!hasOrthographyRules(ortho)) return null
  return runOrthographyOnText(lang, ortho, 'toIpa', text, { word })
}

/**
 * 拼写转音标：正字法写了转音标规则的按规则转；没写规则的按各音位在这套正字法里的写法最长匹配换成音位；
 * 都没有就原样返回。
 */
export function spellToIpa(
  lang: Language,
  ortho: Orthography | null | undefined,
  text: string
): string {
  if (!ortho) return text
  const byRules = transcribe(lang, ortho, text)
  if (byRules !== null) return byRules
  const rows: { from: string; to: string }[] = []
  for (const p of lang.phonemes)
    for (const g of (p.graphemes[ortho.id] ?? '').split(/[\s,，、/]+/).filter(Boolean))
      rows.push({ from: g, to: p.symbol })
  if (!rows.length) return orthographyInput(ortho, text)
  return prepareLiteralMapping(rows, orthographyIgnoresCase(ortho))(orthographyInput(ortho, text))
}

const stressCache = new Map<string, { key: string; program: RuleProgram }>()

/** 音系页「音节与韵律」里自定义重音规则解析出来的规则（诊断也在里面）；没选自定义时为 null */
export function customStressProgram(lang: Language): RuleProgram | null {
  const pr = lang.prosody
  const rule = pr.stressRule?.trim()
  if (!rule || pr.stressPosition !== 'custom' || !(pr.type === 'stress' || pr.type === 'pitch'))
    return null
  const opts = languageParseOptions(lang)
  const key = rule + '\n' + JSON.stringify(opts)
  let hit = stressCache.get(lang.id)
  if (!hit || hit.key !== key) {
    hit = { key, program: parseRuleText(`ˈ = ${rule}`, opts) }
    stressCache.set(lang.id, hit)
  }
  return hit.program
}

/** 选了自定义重音时按那里的重音规则给音标标上重音；已经带 ˈ ˌ 的（正字法里标过、手填的）不动 */
export function stressWord(lang: Language, ipa: string, word?: WordStress): string {
  if (/[ˈˌ]/.test(ipa)) return ipa
  const program = customStressProgram(lang)
  return program ? runRulesOnText(program, ipa, { keepUnits: ipaUnits(lang), word }) : ipa
}

/** 给一个词位按各正字法重算发音（不规则的保留）。返回是否有变化。 */
export function derivePronunciations(lang: Language, lexeme: Lexeme, project?: Project): boolean {
  // 勾了「对重音影响」的词条：词类与特殊重音交给正字法里的重音规则
  const word = project ? lexemeStress(project, lexeme) : undefined
  let changed = false
  for (const o of lang.orthographies) {
    const ipa = transcribe(lang, o, lexeme.lemma, word)
    if (ipa == null) continue
    const cur = lexeme.pronunciations[o.id]
    if (cur?.irregular) continue
    if (!cur || cur.ipa !== ipa) {
      lexeme.pronunciations[o.id] = { ipa, irregular: false }
      changed = true
    }
  }
  return changed
}

/** 详情按当前规则惰性显示普通读音；打开旧工程不改词条或存盘，手标不规则照旧。 */
export function pronunciationOf(
  lang: Language,
  ortho: Orthography,
  lexeme: Lexeme,
  project?: Project
): Pronunciation | undefined {
  const stored = lexeme.pronunciations[ortho.id]
  if (!stored || stored.irregular !== false) return stored
  const ipa = transcribe(
    lang,
    ortho,
    lexeme.lemma,
    project ? lexemeStress(project, lexeme) : undefined
  )
  return ipa === null ? stored : { ipa, irregular: false }
}

/** 整门语言重标音；返回改动的词条数 */
export function deriveAll(project: Project, lang: Language): number {
  let n = 0
  for (const l of project.lexemes)
    if (l.languageId === lang.id && derivePronunciations(lang, l, project)) n++
  return n
}
