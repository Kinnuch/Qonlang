/**
 * 反查一个词条出现在哪些例句里：语料、短语、文档。
 * 先认 gloss 分析，再按词头 / 屈折形整词匹配。
 * 词干不拿来匹配：词干槽里常常只是词根、词干元音这种不单独成词的片段（填了个 a，就会把所有带 a 的句子都算上）；
 * 带连字符的词头（al-、-lar）同理，是黏着形式，只认它的屈折形。
 */
import type { Id, LocalizedText, Lexeme, Project, Sentence } from './model'

/** 默认按释义语言的顺序挑译文；界面里传 i18n 的 pickText（界面语言优先） */
const pickFirst = (text: LocalizedText | undefined, langs: string[]): string => {
  if (!text) return ''
  for (const l of langs) if (text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}

export interface ExampleHit {
  kind: 'sentence' | 'phrase' | 'doc'
  id: Id
  /** 原文（文档里是命中所在的那一段） */
  text: string
  /** 译文或说明 */
  translation: string
  /** 出处：文档标题、短语分类等 */
  where: string
}

const PUNCT =
  /^[\s.,;:!?…“”"'()[\]«»‹›—–「」『』，。！？；：、*_`#>-]+|[\s.,;:!?…“”"'()[\]«»‹›—–「」『』，。！？；：、*_`#>-]+$/gu

const norm = (s: string): string => s.replace(PUNCT, '').normalize('NFC').toLowerCase()

/** 词条能在原文里整词认出来的形式：词头（黏着形式除外）、屈折形（一格里写了几个的拆开） */
export function lexemeForms(l: Lexeme): Set<string> {
  const out = new Set<string>()
  const add = (s: string): void => {
    const n = norm(s)
    if (n) out.add(n)
  }
  const lemma = l.lemma.trim()
  if (!/^[-=]|[-=]$/.test(lemma)) add(lemma)
  for (const f of Object.values(l.forms))
    for (const part of f.surface.split(/[,，;；/]/)) add(part.replace(/^\*/, ''))
  return out
}

/**
 * 例句里有没有这个词：分析里认的是它就算；
 * 某个词已经确认成了别的词条，写法一样也不算它；其余的按写法整词比。
 */
function sentenceHas(s: Sentence, lexeme: Lexeme, forms: Set<string>): boolean {
  if (!s.tokens.length) return hasWord(s.text, forms)
  for (const tk of s.tokens) {
    const a = tk.analyses[tk.chosen]
    if (a?.lexemeId === lexeme.id || a?.morphs.some((m) => m.lexemeId === lexeme.id)) return true
    if (tk.confirmed && a?.lexemeId) continue
    if (forms.has(norm(tk.surface))) return true
  }
  return false
}

function hasWord(text: string, forms: Set<string>): boolean {
  for (const w of text.split(/\s+/)) if (forms.has(norm(w))) return true
  return false
}

/**
 * 找出所有例句。`limit` 只是提前收手的上限，不传就全找。
 */
export function findExamples(
  project: Project,
  lexeme: Lexeme,
  glossLangs: string[],
  limit = Infinity,
  pickText: (text: LocalizedText | undefined, langs: string[]) => string = pickFirst
): ExampleHit[] {
  const forms = lexemeForms(lexeme)
  const out: ExampleHit[] = []
  // 同一条出处只列一次（文档里重复的行、同句多次命中都算一条）
  const seen = new Set<string>()
  const push = (h: ExampleHit): void => {
    const key = h.kind + '|' + h.id + '|' + h.text
    if (seen.has(key)) return
    seen.add(key)
    out.push(h)
  }
  const done = (): boolean => out.length >= limit

  for (const s of project.sentences) {
    if (s.languageId !== lexeme.languageId) continue
    if (!sentenceHas(s, lexeme, forms)) continue
    push({
      kind: 'sentence',
      id: s.id,
      text: s.text,
      translation: pickText(s.translation, glossLangs),
      where: s.source
    })
    if (done()) return out
  }
  for (const p of project.phrasebook) {
    if (p.languageId !== lexeme.languageId) continue
    if (!hasWord(p.text, forms) && !p.variants.some((v) => hasWord(v.text, forms))) continue
    push({
      kind: 'phrase',
      id: p.id,
      text: p.text,
      translation: pickText(p.translation, glossLangs),
      where: p.category
    })
    if (done()) return out
  }
  for (const d of project.docs) {
    if (d.languageId && d.languageId !== lexeme.languageId) continue
    for (const line of d.markdown.split(/\n+/)) {
      if (!hasWord(line, forms)) continue
      push({ kind: 'doc', id: d.id, text: line.trim(), translation: '', where: d.title })
      if (done()) return out
    }
  }
  return out
}
