import type { Lexeme } from '$lib/core/model'
import type { ParsedRule, RuleProgram } from './parse'
import { changedRuleResult } from './apply'
import type { RunOptions } from './apply'
import { sampleForRule } from './sample'

export interface ExampleWord {
  word: string
  lemma: string
}
export interface RuleExample {
  sample: string
  after: string
  lemma?: string
}
export type ExampleInput = 'both' | 'spelling' | 'ipa'
export type ExampleWordSource = (entry: Lexeme) => string

/** 按需索引当前语言的词头和已存读音。每次只取一批，命中后不再读后面的词条。 */
export class ExampleWordIndex {
  private entriesRead = 0
  private words: ExampleWord[] = []
  private seen = new Set<string>()
  readonly results = new WeakMap<ParsedRule, RuleExample>()

  constructor(
    private entries: readonly Lexeme[],
    private languageId: string,
    private input: ExampleInput = 'both',
    private orthographyId?: string,
    private source?: ExampleWordSource
  ) {}

  private add(raw: string, lemma: string): void {
    const word = raw.trim()
    if (!word || this.seen.has(word)) return
    this.seen.add(word)
    this.words.push({ word, lemma })
  }

  batch(offset: number): { words: ExampleWord[]; done: boolean } {
    const limit = 96
    const end = Math.min(this.entriesRead + limit, this.entries.length)
    const deadline = performance.now() + 3
    while (this.words.length < offset + limit && this.entriesRead < end) {
      const entry = this.entries[this.entriesRead++]
      if (entry.languageId === this.languageId) {
        if (this.source) this.add(this.source(entry), entry.lemma)
        else {
          if (this.input !== 'ipa') this.add(entry.lemma, entry.lemma)
          if (this.input !== 'spelling') {
            const pronunciations = entry.pronunciations ?? {}
            if (this.orthographyId) {
              this.add(pronunciations[this.orthographyId]?.ipa ?? '', entry.lemma)
            } else {
              for (const p of Object.values(pronunciations))
                if (p?.ipa) this.add(p.ipa, entry.lemma)
            }
          }
        }
      }
      if (performance.now() >= deadline) break
    }
    const words = this.words.slice(offset, offset + limit)
    return {
      words,
      done: this.entriesRead >= this.entries.length && offset + words.length >= this.words.length
    }
  }
}

export function firstChangedExample(
  program: RuleProgram,
  rule: ParsedRule,
  words: ExampleWord[],
  options: RunOptions = {}
): RuleExample | null {
  for (const { word, lemma } of words) {
    const after = changedRuleResult(program, rule, word, options)
    if (after !== null) return { sample: word, after, lemma }
  }
  return null
}

export function syntheticExample(
  program: RuleProgram,
  rule: ParsedRule,
  options: RunOptions = {}
): RuleExample {
  const sample = sampleForRule(program, rule, { runOptions: options })
  const after = sample && changedRuleResult(program, rule, sample, options)
  return after === null || !sample ? { sample: '', after: '' } : { sample, after }
}

export type SampleMessage =
  | { kind: 'start'; program: RuleProgram; rule: ParsedRule; options?: RunOptions }
  | { kind: 'batch'; words: ExampleWord[]; done: boolean }
export type SampleReply = { kind: 'more' } | { kind: 'result'; preview: RuleExample }
