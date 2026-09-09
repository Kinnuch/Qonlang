/**
 * 反查一个词条出现在哪些例句里：语料、短语、文档。
 * 先认已确认的 gloss 分析，再按词头/词干/屈折形整词匹配。
 */
import type { Id, Lexeme, Project } from './model'
import { pickText } from '$lib/i18n/index.svelte'

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

/** 词条的所有可识别形式：词头、词干、屈折形 */
export function lexemeForms(l: Lexeme): Set<string> {
  const out = new Set<string>()
  const add = (s: string): void => {
    const n = norm(s)
    if (n) out.add(n)
  }
  add(l.lemma)
  for (const s of Object.values(l.stems)) add(s)
  for (const f of Object.values(l.forms)) add(f.surface)
  return out
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
  limit = Infinity
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
    const byAnalysis = s.tokens.some((tk) => tk.analyses[tk.chosen]?.lexemeId === lexeme.id)
    if (!byAnalysis && !hasWord(s.text, forms)) continue
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
