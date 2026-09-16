/**
 * 逐词查词库写文字。文字的「转写来源」挑了检视器模块时（比如意音文字把字号 aa01 填在「文字」那一栏），
 * 句子本身的拼写是转不出字的：一个词一个词找到对应的词条，用词条那一栏转写；找不到的词照原文转写。
 * 语料、短语、文字页的预览、导出都走这里；来源是单词、词干、发音的文字照旧直接转句子。
 */
import type { Id, Language, Lexeme, Project, Script, Sentence, Token } from '$lib/core/model'
import { tokenSpans } from '$lib/engine/gloss/tokens'
import {
  lexemeScript,
  readsInspectorField,
  renderScript,
  scriptCacheStamp,
  scriptCacheValid
} from './render'

/** 给一个词找词条：语料里有分析的词先看分析，别的交给它 */
export type WordLookup = (token: Token) => Id | null | undefined

export const writesFromLexicon = readsInspectorField

interface LexiconIndex {
  stamp: number
  byId: Map<Id, Lexeme>
  /** 语言 id → 写法（小写、去掉两头连字符、括号两种读法、去附加符）→ 词条 */
  byWord: Map<Id, Map<string, Lexeme>>
  /** 词头两头出现过的撇号一类：切句子时算字母 */
  letters: string
}
const indexes = new WeakMap<Lexeme[], LexiconIndex>()

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
const trimMarks = (s: string): string => s.replace(/^[-=…·.]+|[-=…·.]+$/gu, '')
/** 可能是字母的符号：词头两头出现过就当字母（跟语料分析一致） */
const LETTERLIKE = new Set(Array.from("'’‘ʼʻʽ`´ʔʕ"))

/** 词头的几种写法：原样、(le)kùti 去掉括号里的与留下括号里的，各自再去附加符 */
function wordKeys(lemma: string): string[] {
  const base = trimMarks(lemma.normalize('NFC').toLowerCase().trim())
  if (!base) return []
  const out = new Set<string>([base])
  if (/[（(]/u.test(base)) {
    out.add(trimMarks(base.replace(/[（(][^)）]*[)）]/gu, '')))
    out.add(trimMarks(base.replace(/[（()）]/gu, '')))
  }
  for (const k of [...out]) out.add(fold(k))
  out.delete('')
  return [...out]
}

function lexiconIndex(project: Project): LexiconIndex {
  const hit = indexes.get(project.lexemes)
  if (hit && scriptCacheValid(hit.stamp)) return hit
  const index: LexiconIndex = {
    stamp: scriptCacheStamp(),
    byId: new Map(),
    byWord: new Map(),
    letters: ''
  }
  const edge = new Set<string>()
  for (const l of project.lexemes) {
    index.byId.set(l.id, l)
    let words = index.byWord.get(l.languageId)
    if (!words) index.byWord.set(l.languageId, (words = new Map()))
    const forms = [l.lemma, ...Object.values(l.forms ?? {}).map((f) => f.surface)]
    for (const f of forms) {
      const t = f.trim()
      if (t) for (const c of [t[0], t[t.length - 1]]) if (LETTERLIKE.has(c)) edge.add(c)
      for (const k of wordKeys(f)) if (!words.has(k)) words.set(k, l)
    }
  }
  index.letters = [...edge].join('')
  indexes.set(project.lexemes, index)
  return index
}

/** 只有写法的词：按词头、屈折形找同一门语言里的词条 */
function lexemeByWord(index: LexiconIndex, languageId: Id, word: string): Lexeme | undefined {
  const words = index.byWord.get(languageId)
  if (!words) return undefined
  for (const k of wordKeys(word)) {
    const l = words.get(k)
    if (l) return l
  }
  return undefined
}

/** 语料里的一个词：分析给了词条就用它；切成几段的，每段都认得出才拼起来 */
function tokenScript(
  index: LexiconIndex,
  lang: Language,
  script: Script,
  tk: Token,
  lookup: WordLookup | undefined
): string | null {
  const a = tk.analyses[tk.chosen]
  const single = a?.lexemeId ?? (a?.morphs.length === 1 ? a.morphs[0].lexemeId : null)
  const id = single ?? lookup?.(tk) ?? null
  const whole = (id ? index.byId.get(id) : undefined) ?? lexemeByWord(index, lang.id, tk.surface)
  if (whole) return lexemeScript(lang, script, whole)
  if (a && a.morphs.length > 1) {
    const parts = a.morphs.map((m) => {
      const l =
        (m.lexemeId ? index.byId.get(m.lexemeId) : undefined) ??
        lexemeByWord(index, lang.id, m.form)
      return l ? lexemeScript(lang, script, l) : null
    })
    if (parts.every((p) => p !== null)) return parts.join('')
  }
  return null
}

/** 一段文字（带语料的分词结果就一起给）按词查词库写成这套文字 */
function viaLexicon(
  project: Project,
  lang: Language,
  script: Script,
  text: string,
  tokens: readonly Token[],
  lookup: WordLookup | undefined
): string {
  const index = lexiconIndex(project)
  const spans = tokenSpans(text, {
    mode: project.settings.tokenizer,
    pattern: project.settings.tokenizerPattern,
    letters: index.letters + (project.settings.tokenizerLetters ?? '')
  })
  let next = 0
  let out = ''
  for (const span of spans) {
    if (!span.word) {
      out += renderScript(lang, script, span.text)
      continue
    }
    // 跟分析结果对齐：按顺序往后找写法一样的词（最多跳过两个）
    let tk: Token | undefined
    for (let k = next; k < Math.min(tokens.length, next + 3); k++)
      if (tokens[k].surface === span.text) {
        tk = tokens[k]
        next = k + 1
        break
      }
    const written = tokenScript(
      index,
      lang,
      script,
      tk ?? { surface: span.text, analyses: [], chosen: 0, confirmed: false },
      lookup
    )
    out += written ?? renderScript(lang, script, span.text)
  }
  return out
}

/** 一段文字的这套文字写法（自动的，不看手填） */
export function textScript(
  project: Project,
  lang: Language,
  script: Script,
  text: string,
  tokens: readonly Token[] = [],
  lookup?: WordLookup
): string {
  if (!text) return ''
  return writesFromLexicon(script)
    ? viaLexicon(project, lang, script, text, tokens, lookup)
    : renderScript(lang, script, text)
}

/** 例句的文字写法：手填的优先，其次自动 */
export function sentenceScriptText(
  project: Project,
  lang: Language,
  script: Script,
  s: Sentence,
  lookup?: WordLookup
): string {
  const o = s.scriptForms?.[script.id]
  if (o) return writesFromLexicon(script) ? renderScript(lang, script, o) : o
  return textScript(project, lang, script, s.text, s.tokens, lookup)
}
