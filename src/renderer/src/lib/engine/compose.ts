/**
 * 译文工作台的「候选词」：先写好译文，照着译文反查词库，给出这句话大概要用到的词。
 * 纯函数，不碰界面（能单独测），对任何语言都一样：不认识哪门语言的语法，只做三件通用的事——
 *
 * 1. **反查释义**：词条每个义项的释义（按释义语言）、语素的释义与 gloss，拆成一个个说法，
 *    在译文里出现的就是候选。汉字这类不用空格的文字按子串找（长的优先），拉丁字母这类按词找
 *    （允许词尾多几个字母：know → knows）。
 * 2. **借语料和短语的经验**：已经分析过的例句、存了分析的短语，译文里跟这句有重叠说法的，
 *    它们用到的词加分——同一个意思这个项目以前怎么说，这次多半还这么说。
 * 3. **按在译文里的位置排**：泡泡按译文的先后摆，同一处有几个候选的，分高的在前。
 */
import type { Analysis, Id, LocalizedText, Project, Token } from '$lib/core/model'

export interface ComposeCandidate {
  /** 同一个词条 / 语素只出一个泡泡 */
  key: string
  lexemeId?: Id
  morphemeId?: Id
  /** 泡泡上写的：词头 / 语素的写法 */
  surface: string
  /** 对上的那个说法（写在泡泡下面，告诉用户为什么推荐它） */
  matched: string
  /** 在译文里第一次对上的位置（排序用） */
  at: number
  score: number
}

/** 释义里一个个说法的分隔：分号、逗号、顿号、斜线；括号里的补充说明不算 */
const SPLIT = /[;；,，、/／|]+/
const STRIP = /[（(［[【][^）)］\]】]*[）)］\]】]/g

/** 一条释义拆成几个说法（去掉括号里的补充、两头空白，太长的整句释义不要） */
export function glossItems(text: string): string[] {
  return text
    .replace(STRIP, ' ')
    .split(SPLIT)
    .map((s) =>
      s.replace(/^[\s“”"'‘’「」『』…·.。!！?？]+|[\s“”"'‘’「」『』…·.。!！?？]+$/g, '').trim()
    )
    .filter((s) => s && s.length <= 24)
}

/** 这段文字用不用空格隔词（汉字、假名、谚文以外的都按用空格算） */
const SPACELESS = /[぀-ヿ㐀-鿿豈-﫿가-힯]/
export const isSpaceless = (text: string): boolean => SPACELESS.test(text) && !/\s\S+\s/.test(text)

/** 拉丁字母这类：切成小写的词，记下每个词的起点 */
function wordsOf(text: string): { w: string; at: number }[] {
  const out: { w: string; at: number }[] = []
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}'’-]+/gu))
    out.push({ w: m[0], at: m.index ?? 0 })
  return out
}

/**
 * 一个说法在译文里出现在哪（没出现给 -1）。
 * 不用空格的文字按子串找；用空格的按词找，几个词的说法要连着出现，词尾可以多两三个字母
 */
export function findIn(text: string, item: string): number {
  if (!item) return -1
  if (isSpaceless(item) || isSpaceless(text)) return text.indexOf(item)
  const words = wordsOf(text)
  const want = wordsOf(item).map((x) => x.w)
  if (!want.length) return -1
  const same = (have: string, w: string): boolean =>
    have === w || (w.length >= 4 && have.startsWith(w) && have.length - w.length <= 3)
  for (let i = 0; i + want.length <= words.length; i++)
    if (want.every((w, j) => same(words[i + j].w, w))) return words[i].at
  return -1
}

interface Entry {
  key: string
  lexemeId?: Id
  morphemeId?: Id
  surface: string
  items: string[]
}

/** 这门语言里能反查的：词条的每个义项、语素的释义和 gloss */
function entriesOf(project: Project, languageId: Id, langs: string[]): Entry[] {
  const pick = (t: LocalizedText | undefined): string[] => {
    if (!t) return []
    const own = langs.map((l) => t[l]).filter(Boolean)
    return own.length ? own : Object.values(t).filter(Boolean)
  }
  const out: Entry[] = []
  for (const l of project.lexemes) {
    if (l.languageId !== languageId || !l.lemma.trim()) continue
    const items = l.senses.flatMap((s) => pick(s.definition).flatMap(glossItems))
    if (items.length) out.push({ key: 'l:' + l.id, lexemeId: l.id, surface: l.lemma, items })
  }
  for (const m of project.morphemes) {
    if (m.languageId !== languageId || !m.form.trim()) continue
    const items = [...pick(m.meaning).flatMap(glossItems)]
    // gloss 是缩写（PL、1SG）的不拿来反查；写的是意思（你、房子）才算
    if (m.gloss && !/^[A-Z0-9.=\-_]+$/.test(m.gloss)) items.push(...glossItems(m.gloss))
    if (items.length) out.push({ key: 'm:' + m.id, morphemeId: m.id, surface: m.form, items })
  }
  return out
}

/** 一条例句 / 短语用到的词条、语素（拿分析里选中的那种） */
function usedIn(tokens: Token[] | undefined): string[] {
  const out: string[] = []
  for (const tk of tokens ?? []) {
    const a = tk.analyses[tk.chosen]
    if (!a) continue
    if (a.lexemeId) out.push('l:' + a.lexemeId)
    for (const m of a.morphs) if (m.morphemeId) out.push('m:' + m.morphemeId)
  }
  return out
}

/**
 * 候选词：译文里对上的词条与语素，按在译文里的先后排。
 * `langs` 是释义语言的先后（译文是哪种语言就把它放最前）
 */
export function composeCandidates(
  project: Project,
  languageId: Id,
  translation: string,
  langs: string[],
  limit = 40
): ComposeCandidate[] {
  const text = translation.trim()
  if (!text) return []
  const found = new Map<string, ComposeCandidate>()
  for (const e of entriesOf(project, languageId, langs)) {
    let best: ComposeCandidate | null = null
    for (const item of e.items) {
      const at = findIn(text, item)
      if (at < 0) continue
      // 长的说法更可信（「房子」比「房」可信）；整条释义就是这个说法的再加一点
      const score = Math.min(item.length, 8) + (e.items.length === 1 ? 1 : 0)
      if (!best || score > best.score)
        best = {
          key: e.key,
          lexemeId: e.lexemeId,
          morphemeId: e.morphemeId,
          surface: e.surface,
          matched: item,
          at,
          score
        }
    }
    if (best) found.set(e.key, best)
  }
  // 借经验：译文跟这句重叠的例句、短语，它们用过的词加分
  const memory: { tr: LocalizedText; tokens?: Token[] }[] = [
    ...project.sentences
      .filter((s) => s.languageId === languageId)
      .map((s) => ({ tr: s.translation, tokens: s.tokens })),
    ...project.phrasebook
      .filter((p) => p.languageId === languageId)
      .map((p) => ({ tr: p.translation, tokens: p.tokens }))
  ]
  for (const x of memory) {
    const tr = langs.map((l) => x.tr[l]).find(Boolean) ?? Object.values(x.tr).find(Boolean)
    if (!tr) continue
    for (const key of usedIn(x.tokens)) {
      const c = found.get(key)
      if (c && tr.includes(c.matched)) c.score += 2
    }
  }
  // 同一处对上好几个的：按分数排，位置相同的高分在前；整体按位置
  return [...found.values()]
    .sort((a, b) => a.at - b.at || b.score - a.score || a.surface.localeCompare(b.surface))
    .slice(0, limit)
}

/** 拼出来的原文：每个词之间按项目的分词方式隔开（逐字的文字不加空格） */
export function joinForms(forms: string[], tokenizer: string | undefined): string {
  const parts = forms.map((f) => f.trim()).filter(Boolean)
  return parts.join(tokenizer === 'character' ? '' : ' ')
}

/** 工作台里挑定的一个词（Workbench 的 BenchWord 里用得到的那几项） */
export interface PinnedWord {
  lexemeId?: Id
  morphemeId?: Id
  form: string
  /** 词条 forms 里的键（跟分析里的 slot 一个口径）；原形是 null */
  slotKey: string | null
  /** 工作台里拼好的各段（加了词缀、动词头、词首音变的）：分析里没有对得上的就照它记 */
  morphs?: Analysis['morphs']
}

/**
 * 句子自动分析过之后，把工作台里挑定的词钉上去：按顺序对齐每个词，
 * 分析里有这个词条（这一格、加的这几个语素都在）的就选中它并算作确认；没有就照工作台拼的各段补一个。
 * 手打的自由词（没挂词条、语素）不动，交给自动分析
 */
export function pinChoices(
  tokens: Token[],
  words: PinnedWord[],
  glossOf: (w: PinnedWord) => string
): number {
  let j = 0
  let pinned = 0
  const same = (a: string, b: string): boolean =>
    a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()
  for (const w of words) {
    const k = tokens.findIndex((tk, i) => i >= j && same(tk.surface, w.form))
    if (k < 0) continue
    j = k + 1
    if (!w.lexemeId && !w.morphemeId) continue
    const tk = tokens[k]
    // 工作台里加上的语素，分析里都得有
    const need = (w.morphs ?? [])
      .map((m) => m.morphemeId)
      .filter((x): x is Id => !!x && x !== w.morphemeId)
    const hit = (a: Analysis, withSlot: boolean): boolean =>
      (w.lexemeId
        ? (a.lexemeId === w.lexemeId || a.morphs.some((m) => m.lexemeId === w.lexemeId)) &&
          (!withSlot || !w.slotKey || a.slot === w.slotKey)
        : a.morphs.some((m) => m.morphemeId === w.morphemeId)) &&
      need.every((id) => a.morphs.some((m) => m.morphemeId === id))
    // 对得上的几种里挑切法最像工作台拼的那种：没加东西的词挑整词的，加了词缀的挑段落一样的
    // （é·falt 就是一个词，别切成限定词 + 名词）
    const bareForm = (s: string): string =>
      s
        .normalize('NFC')
        .toLowerCase()
        .replace(/^[·'’\-=]+|[·'’\-=]+$/g, '')
    const want = (w.morphs?.length ? w.morphs.map((m) => m.form) : [w.form]).map(bareForm)
    const fit = (a: Analysis): number => {
      const got = a.morphs.map((m) => bareForm(m.form))
      let n = 0
      for (let x = 0; x < Math.min(got.length, want.length); x++) if (got[x] === want[x]) n++
      return n * 2 - Math.abs(got.length - want.length)
    }
    const best = (withSlot: boolean): number => {
      let at = -1
      tk.analyses.forEach((a, x) => {
        if (hit(a, withSlot) && (at < 0 || fit(a) > fit(tk.analyses[at]))) at = x
      })
      return at
    }
    let i = best(true)
    if (i < 0) i = best(false)
    if (i < 0) {
      // 拼好的各段连起来正好是这个词才照它记，否则整词记成一段
      const parts = w.morphs?.length ? w.morphs : null
      const ok = parts && same(parts.map((m) => m.form).join(''), tk.surface)
      tk.analyses.push({
        lexemeId: w.lexemeId ?? null,
        slot: w.slotKey,
        morphs: ok
          ? parts.map((m) => ({ ...m }))
          : [{ form: tk.surface, gloss: glossOf(w) || '?', morphemeId: w.morphemeId ?? null }]
      })
      i = tk.analyses.length - 1
    }
    tk.chosen = i
    tk.confirmed = true
    pinned++
  }
  return pinned
}
