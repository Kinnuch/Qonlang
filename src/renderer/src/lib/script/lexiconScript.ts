/**
 * 逐词查词库写文字。文字的「转写来源」挑了检视器模块时（比如意音文字把字号 aa01 填在「文字」那一栏），
 * 句子本身的拼写是转不出字的：一个词一个词找到对应的词条，用词条那一栏转写；找不到的词照原文转写。
 * 语料、短语、文字页的预览、导出都走这里；来源是单词、词干、发音的文字照旧直接转句子。
 */
import type {
  Analysis,
  Id,
  Language,
  Lexeme,
  Morpheme,
  Project,
  Script,
  Sentence,
  Token
} from '$lib/core/model'
import { lexemeMatchesGloss } from '$lib/core/glossMatch'
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
  /** 语言 id → 写法（小写、去掉两头连字符、括号两种读法、去附加符）→ 同一个写法的几个词条 */
  byWord: Map<Id, Map<string, Lexeme[]>>
  /** 语素：分析里的一段挂着语素时，按语素的写法再去词库里找 */
  byMorpheme: Map<Id, Morpheme>
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

/** 词头的几种写法：原样、(le)kùti 去掉括号里的与留下括号里的（附加符照旧） */
function wordForms(lemma: string): string[] {
  const base = trimMarks(lemma.normalize('NFC').toLowerCase().trim())
  if (!base) return []
  const out = new Set<string>([base])
  if (/[（(]/u.test(base)) {
    out.add(trimMarks(base.replace(/[（(][^)）]*[)）]/gu, '')))
    out.add(trimMarks(base.replace(/[（()）]/gu, '')))
  }
  out.delete('')
  return [...out]
}

/** 查词库用的几种写法：上面那几种，各自再去附加符 */
function wordKeys(lemma: string): string[] {
  const out = new Set(wordForms(lemma))
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
    byMorpheme: new Map(project.morphemes.map((m) => [m.id, m])),
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
      for (const k of wordKeys(f)) {
        const same = words.get(k)
        if (!same) words.set(k, [l])
        else if (!same.includes(l)) same.push(l)
      }
    }
  }
  index.letters = [...edge].join('')
  indexes.set(project.lexemes, index)
  return index
}

/** 只有写法的词：按词头、屈折形找同一门语言里的词条，同形的都给 */
function lexemesByWord(index: LexiconIndex, languageId: Id, word: string): Lexeme[] {
  const words = index.byWord.get(languageId)
  if (!words) return []
  for (const k of wordKeys(word)) {
    const same = words.get(k)
    if (same) return same
  }
  return []
}

/** 同上，只要排在最前的那个（词库里先收的） */
function lexemeByWord(index: LexiconIndex, languageId: Id, word: string): Lexeme | undefined {
  return lexemesByWord(index, languageId, word)[0]
}

/** 几个同形词条：释义跟这一段的 gloss 对得上的优先（gloss 只是缩写时无从核对，按先收的算） */
function byWordAndGloss(
  index: LexiconIndex,
  languageId: Id,
  word: string,
  gloss: string
): Lexeme | undefined {
  const same = lexemesByWord(index, languageId, word)
  if (same.length < 2) return same[0]
  return same.find((l) => lexemeMatchesGloss(l, gloss)) ?? same[0]
}

/**
 * 词条收的就是这个词本身吗：写法要一模一样才算（两头的连字符、大小写、括号里可省的不计较，
 * 但附加符要对上）。差一个附加符的是另一个词——用户既然把这个词切成了几段，就照几段写。
 */
function isSameWord(a: string, b: string): boolean {
  const keys = new Set(wordForms(a))
  return wordForms(b).some((k) => keys.has(k))
}

/** 这个词条认不认这个写法（词头或者哪个屈折形对得上，附加符不计较） */
function entryHasWord(l: Lexeme, w: string): boolean {
  const keys = new Set(wordKeys(w))
  const hit = (f: string): boolean => wordKeys(f).some((k) => keys.has(k))
  if (hit(l.lemma)) return true
  for (const f of Object.values(l.forms ?? {})) if (f.surface && hit(f.surface)) return true
  return false
}

/**
 * 分析里的一段找哪个词条写：这一段自己挂的词条 → 分析给的那个词条（几段的分析只给一个，
 * 写法对得上哪一段就是哪一段的，同形词才不会挑错）→ 语素的写法（语素挂不了词条，数据模型里只有写法，
 * 只能拿它跟同位素的写法再查一遍词库）→ 这一段的写法（两头的 `-` `=` `·` 不算）、写法对得上的屈折形。
 */
function partLexeme(
  index: LexiconIndex,
  languageId: Id,
  m: Analysis['morphs'][number],
  head: Lexeme | undefined
): Lexeme | undefined {
  const own = m.lexemeId ? index.byId.get(m.lexemeId) : undefined
  if (own) return own
  if (head && entryHasWord(head, m.form)) return head
  const mo = m.morphemeId ? index.byMorpheme.get(m.morphemeId) : undefined
  if (mo)
    for (const f of [mo.form, mo.form2, ...(mo.allomorphs ?? []).map((x) => x.form)]) {
      const l = f ? byWordAndGloss(index, languageId, f, m.gloss) : undefined
      if (l) return l
    }
  return byWordAndGloss(index, languageId, m.form, m.gloss)
}

/**
 * 切成几段的词：每段各自查、各自写。认不出的那段退回照它自己的写法转写，
 * 一段写不出也不连累旁边几段；全都写不出才算这个词没写出来。
 */
function morphsScript(
  index: LexiconIndex,
  lang: Language,
  script: Script,
  a: Analysis
): string | null {
  const head = a.lexemeId ? index.byId.get(a.lexemeId) : undefined
  let out = ''
  for (const m of a.morphs) {
    const l = partLexeme(index, lang.id, m, head)
    out += (l ? lexemeScript(lang, script, l) : '') || renderScript(lang, script, m.form)
  }
  return out || null
}

/**
 * 语料里的一个词：分析给了词条就用它；切成几段的每段各自写。
 * 几段的分析给的那个词条常常只是词干（`naegō-moh` 给的是 `naegō`），
 * 只有整个词本身就是这个词条时才照它写，不然会把词干以外的几段都丢掉。
 */
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
  const picked = id ? index.byId.get(id) : undefined
  // 隔开写的词（`ma…gò`）照旧按整个词条的写法切段
  const multi = !!a && a.morphs.length > 1 && !a.part
  // 切成几段时，分析给的词条常常只是其中的词干：整个词本身就是那个词条才照它写
  const fits = (l: Lexeme | undefined): Lexeme | undefined =>
    !multi || (l && isSameWord(l.lemma, tk.surface)) ? l : undefined
  const whole = fits(picked) ?? fits(lexemeByWord(index, lang.id, tk.surface))
  if (whole) {
    const written = lexemeScript(lang, script, whole)
    // 隔开写的词（`ma…gò`）：这个词只是其中一段，文字也只写那一段
    if (a?.part && written) {
      const parts = written.split(/…+|\.{3,}/u)
      if (parts.length === a.part.n) return parts[a.part.i].trim()
    }
    if (written) return written
  }
  if (multi) return morphsScript(index, lang, script, a)
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
