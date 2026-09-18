/**
 * 反查一个词条出现在哪些例句里：语料、短语、文档。
 * 先认 gloss 分析，再按词头 / 屈折形整词匹配。
 * 词干不拿来匹配：词干槽里常常只是词根、词干元音这种不单独成词的片段（填了个 a，就会把所有带 a 的句子都算上）；
 * 带连字符的词头（al-、-lar）同理，是黏着形式，只认它的屈折形。
 * 命中的同时把它在原文里的位置也算出来（界面标出来用）；位置定不下来时宁可不给，也不瞎标。
 */
import type { Analysis, Id, LocalizedText, Lexeme, Project, Sentence } from './model'

/** 默认按释义语言的顺序挑译文；界面里传 i18n 的 pickText（界面语言优先） */
const pickFirst = (text: LocalizedText | undefined, langs: string[]): string => {
  if (!text) return ''
  for (const l of langs) if (text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}

/** 命中在原文里的位置：[start, end) 的字符下标 */
export interface ExampleSpan {
  start: number
  end: number
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
  /** 这个词在 text 里的位置，可能有好几处；定不下来时是空的 */
  spans: ExampleSpan[]
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
 * 一个词里属于这个词条的那几段在词里的位置（复合词、黏着的词缀）。
 * 有一段找不着就返回 null，交给上面整词标出来——总比标错地方强。
 */
function morphSpans(surface: string, morphs: Analysis['morphs'], id: Id): ExampleSpan[] | null {
  const low = surface.toLowerCase()
  // 大小写换算后长度变了（İ 这类）：下标对不上，不标
  if (low.length !== surface.length) return null
  const out: ExampleSpan[] = []
  let at = 0
  for (const m of morphs) {
    const mine = m.lexemeId === id
    const form = m.form.replace(/^[-=]+|[-=]+$/gu, '')
    const lowForm = form.toLowerCase()
    if (!form || lowForm.length !== form.length) {
      if (mine) return null
      continue
    }
    const i = low.indexOf(lowForm, at)
    if (i < 0) {
      if (mine) return null
      continue
    }
    at = i + form.length
    if (mine) out.push({ start: i, end: at })
  }
  return out.length ? out : null
}

/**
 * 例句里有没有这个词，有的话在哪儿：分析里认的是它就算；
 * 某个词已经确认成了别的词条，写法一样也不算它；其余的按写法整词比。
 * 没命中返回 null。
 */
function sentenceSpans(s: Sentence, lexeme: Lexeme, forms: Set<string>): ExampleSpan[] | null {
  if (!s.tokens.length) return textSpans(s.text, forms)
  let hit = false
  const out: ExampleSpan[] = []
  // 词是按顺序从原文里切出来的：一路往后找，同一个词出现几次也各是各的位置
  let at = 0
  for (const tk of s.tokens) {
    const a = tk.analyses[tk.chosen]
    const whole = a?.lexemeId === lexeme.id
    const inMorphs = !!a?.morphs.some((m) => m.lexemeId === lexeme.id)
    const byForm =
      !whole && !inMorphs && !(tk.confirmed && a?.lexemeId) && forms.has(norm(tk.surface))
    const start = tk.surface ? s.text.indexOf(tk.surface, at) : -1
    if (start >= 0) at = start + tk.surface.length
    if (!whole && !inMorphs && !byForm) continue
    hit = true
    // 这个词在原文里对不上（手改过原文、分词结果旧了）：算命中，但不标
    if (start < 0) continue
    const parts = inMorphs && !whole && a ? morphSpans(tk.surface, a.morphs, lexeme.id) : null
    if (parts) for (const p of parts) out.push({ start: start + p.start, end: start + p.end })
    else out.push({ start, end: start + tk.surface.length })
  }
  return hit ? out : null
}

/** 没有分词结果的一段话：按空白切开、剥掉两头标点整词比；没命中返回 null */
function textSpans(text: string, forms: Set<string>): ExampleSpan[] | null {
  const out: ExampleSpan[] = []
  for (const m of text.matchAll(/\S+/gu)) {
    const raw = m[0]
    const core = raw.replace(PUNCT, '')
    if (!core) continue
    if (!forms.has(norm(core))) continue
    // core 的头一个字符不是标点，indexOf 找到的就是剥掉前缀标点之后的那一处
    const lead = raw.indexOf(core)
    const start = (m.index ?? 0) + lead
    out.push({ start, end: start + core.length })
  }
  return out.length ? out : null
}

/** 把原文按命中的位置切成几段：mark 为 true 的标出来 */
export function markParts(
  text: string,
  spans: readonly ExampleSpan[] = []
): { text: string; mark: boolean }[] {
  if (!spans.length) return [{ text, mark: false }]
  const out: { text: string; mark: boolean }[] = []
  let at = 0
  for (const sp of [...spans].sort((a, b) => a.start - b.start)) {
    const start = Math.max(at, sp.start)
    const end = Math.min(text.length, sp.end)
    if (end <= start) continue
    if (start > at) out.push({ text: text.slice(at, start), mark: false })
    out.push({ text: text.slice(start, end), mark: true })
    at = end
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false })
  return out
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
    const spans = sentenceSpans(s, lexeme, forms)
    if (!spans) continue
    push({
      kind: 'sentence',
      id: s.id,
      text: s.text,
      translation: pickText(s.translation, glossLangs),
      where: s.source,
      spans
    })
    if (done()) return out
  }
  for (const p of project.phrasebook) {
    if (p.languageId !== lexeme.languageId) continue
    const spans = textSpans(p.text, forms)
    // 正文里没有、换一种说法里有：照样列出来，只是没处可标
    if (!spans && !p.variants.some((v) => textSpans(v.text, forms))) continue
    push({
      kind: 'phrase',
      id: p.id,
      text: p.text,
      translation: pickText(p.translation, glossLangs),
      where: p.category,
      spans: spans ?? []
    })
    if (done()) return out
  }
  for (const d of project.docs) {
    if (d.languageId && d.languageId !== lexeme.languageId) continue
    for (const raw of d.markdown.split(/\n+/)) {
      const line = raw.trim()
      const spans = textSpans(line, forms)
      if (!spans) continue
      push({ kind: 'doc', id: d.id, text: line, translation: '', where: d.title, spans })
      if (done()) return out
    }
  }
  return out
}
