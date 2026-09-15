/**
 * 正字法 → IPA 的自动标音。规则文本按正字法解析并缓存；不规则发音不覆盖。
 */
import type { Language, Lexeme, Orthography, Project } from './model'
import { parseRuleText, runRulesOnText, type RuleProgram, type WordStress } from '$lib/engine/sca'
import { languageParseOptions, segment } from '$lib/engine/phon'
import { inferFeatures } from '$lib/ipa/features'
import { lexemeStress } from './stressInfo'

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
  const opts = languageParseOptions(lang)
  const classesKey = JSON.stringify(opts)
  const key = `${ortho.id}:${direction}`
  const hit = cache.get(key)
  if (hit && hit.text === text && hit.classes === classesKey) return hit.program
  const program = parseRuleText(text, opts)
  cache.set(key, { text, classes: classesKey, program })
  return program
}

/**
 * 多合字母里本来就是音标的内部符号（θ、ð、ŋ，或者音位表里有的）：转成音标时留着，不换回 th 这类写法；
 * 只是占位用的（ʦ 这类表里没有、IPA 表也不认的）照旧换回去。
 */
export function ipaUnits(lang: Language): string[] {
  const inventory = new Set(lang.phonemes.map((p) => p.symbol))
  return lang.digraphs
    .map((d) => d.to)
    .filter((to) => {
      if (!to) return false
      if (inventory.has(to)) return true
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
  const p = orthoProgram(lang, ortho, 'toIpa')
  if (!p) return null
  return runRulesOnText(p, text, { keepUnits: ipaUnits(lang), word })
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
  const map = new Map<string, string>()
  for (const p of lang.phonemes)
    for (const g of (p.graphemes[ortho.id] ?? '').split(/[\s,，、/]+/).filter(Boolean))
      if (!map.has(g)) map.set(g, p.symbol)
  if (!map.size) return text
  return segment(text.toLowerCase(), [...map.keys()])
    .map((x) => map.get(x) ?? x)
    .join('')
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

/** 整门语言重标音；返回改动的词条数 */
export function deriveAll(project: Project, lang: Language): number {
  let n = 0
  for (const l of project.lexemes)
    if (l.languageId === lang.id && derivePronunciations(lang, l, project)) n++
  return n
}
