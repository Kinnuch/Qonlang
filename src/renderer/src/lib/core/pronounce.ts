/**
 * 正字法 → IPA 的自动标音。规则文本按正字法解析并缓存；不规则发音不覆盖。
 */
import type { Language, Lexeme, Orthography, Project } from './model'
import { parseRuleText, runRules, type RuleProgram } from '$lib/engine/sca'
import { languageParseOptions } from '$lib/engine/phon'

const cache = new Map<string, { text: string; classes: string; program: RuleProgram }>()

export function orthoProgram(lang: Language, ortho: Orthography, direction: 'toIpa' | 'fromIpa' = 'toIpa'): RuleProgram | null {
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

export function transcribe(lang: Language, ortho: Orthography, text: string): string | null {
  const p = orthoProgram(lang, ortho, 'toIpa')
  if (!p) return null
  return runRules(p, text, { trace: false }).output
}

/** 给一个词位按各正字法重算发音（不规则的保留）。返回是否有变化。 */
export function derivePronunciations(lang: Language, lexeme: Lexeme): boolean {
  let changed = false
  for (const o of lang.orthographies) {
    const ipa = transcribe(lang, o, lexeme.lemma)
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
  for (const l of project.lexemes) if (l.languageId === lang.id && derivePronunciations(lang, l)) n++
  return n
}
