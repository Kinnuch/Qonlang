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
import {
  isSpaceless,
  prepareGlossMatcher,
  prepareGlossPattern,
  type GlossMatch,
  type GlossMatcher,
  type GlossPattern
} from './composeMatch'
export { isSpaceless } from './composeMatch'

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
  /** 对上范围的末尾（不包含）；框架包含槽内文本。旧调用方可以不提供。 */
  end?: number
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
    .filter((s) => s && s.replace(/(?:\.{3,}|…+)+/g, '…').length <= 24)
}

/**
 * 一个说法在译文里出现在哪（没出现给 -1）；省略号表示非空槽，其余文字沿用子串 / 词边界匹配。
 */
export function findIn(text: string, item: string): number {
  return prepareGlossMatcher(text).match(item)[0]?.at ?? -1
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

export interface ComposeIndex {
  entries: Entry[]
  patterns: Map<string, GlossPattern>
  memory: { translation: string; used: string[] }[]
}

/**
 * 只读取候选有关的工程字段，预先拆义项、编译锚点与收集语料经验。
 * 界面放在独立 $derived 中，工程真有相关改动才更新；纯函数调用方随时可以重建。
 */
export function prepareComposeIndex(
  project: Project,
  languageId: Id,
  langs: string[]
): ComposeIndex {
  const entries = entriesOf(project, languageId, langs)
  const patterns = new Map<string, GlossPattern>()
  for (const e of entries)
    for (const item of e.items)
      if (!patterns.has(item)) patterns.set(item, prepareGlossPattern(item))
  const memory: ComposeIndex['memory'] = []
  for (const x of [...project.sentences, ...project.phrasebook]) {
    if (x.languageId !== languageId) continue
    const translation =
      langs.map((l) => x.translation[l]).find(Boolean) ?? Object.values(x.translation).find(Boolean)
    if (!translation) continue
    const used = usedIn(x.tokens)
    if (used.length) memory.push({ translation, used })
  }
  return { entries, patterns, memory }
}

interface MatchedEntry {
  entry: Entry
  items: { item: string; matches: GlossMatch[] }[]
}
interface ComposeScan {
  matcher: GlossMatcher
  entries: MatchedEntry[]
  covered: Uint8Array
  /** 固定锚点以外字符的前缀计数，用来判断短候选是否全部已由框架解释。 */
  outsideFrames: Uint32Array
  frameEnds: Map<number, number>
}

function scanGlosses(index: ComposeIndex, text: string): ComposeScan {
  const matcher = prepareGlossMatcher(text)
  const covered = new Uint8Array(text.length)
  const frames = new Uint8Array(text.length)
  const entries: MatchedEntry[] = []
  const frameEnds = new Map<number, number>()
  const seenCoverage = new Set<string>()
  if (text.trim())
    for (const entry of index.entries) {
      const items = entry.items
        .map((item) => ({ item, matches: matcher.match(index.patterns.get(item)!) }))
        .filter((x) => x.matches.length)
      if (!items.length) continue
      entries.push({ entry, items })
      for (const { item, matches } of items) {
        if (seenCoverage.has(item)) continue
        seenCoverage.add(item)
        for (const match of matches) {
          if (match.template)
            frameEnds.set(match.at, Math.max(match.end, frameEnds.get(match.at) ?? 0))
          for (const anchor of match.anchors) {
            covered.fill(1, anchor.at, anchor.end)
            if (match.template) frames.fill(1, anchor.at, anchor.end)
          }
        }
      }
    }
  const outsideFrames = new Uint32Array(text.length + 1)
  for (let i = 0; i < text.length; i++) outsideFrames[i + 1] = outsideFrames[i] + 1 - frames[i]
  return { matcher, entries, covered, outsideFrames, frameEnds }
}

interface RankedCandidate {
  candidate: ComposeCandidate
  /** 同起点：覆盖完整框架的精准短语 > 框架 > 部分短语；总排序保持可传递。 */
  priority: number
}

/** 同一起点的精准完整短语优先于带槽框架，其余沿用长度、经验和稳定字形顺序。 */
function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  const ca = a.candidate
  const cb = b.candidate
  if (ca.at !== cb.at) return ca.at - cb.at
  return (
    b.priority - a.priority ||
    cb.score - ca.score ||
    ca.surface.localeCompare(cb.surface) ||
    ca.key.localeCompare(cb.key)
  )
}

function candidatesFrom(scan: ComposeScan, index: ComposeIndex, limit: number): ComposeCandidate[] {
  const found = new Map<string, RankedCandidate>()
  for (const { entry: e, items } of scan.entries) {
    let best: RankedCandidate | null = null
    for (const { item, matches } of items) {
      const match = matches.find(
        (m) => m.template || scan.outsideFrames[m.end] !== scan.outsideFrames[m.at]
      )
      if (!match) continue
      // 省略号长短不参与计分，只看固定文字。
      const score = Math.min(match.literalLength, 8) + (e.items.length === 1 ? 1 : 0)
      const frameEnd = scan.frameEnds.get(match.at)
      const hit: RankedCandidate = {
        candidate: {
          key: e.key,
          lexemeId: e.lexemeId,
          morphemeId: e.morphemeId,
          surface: e.surface,
          matched: item,
          at: match.at,
          end: match.end,
          score
        },
        priority: frameEnd === undefined ? 0 : match.template ? 1 : match.end >= frameEnd ? 2 : 0
      }
      if (
        !best ||
        score > best.candidate.score ||
        (score === best.candidate.score && compareCandidates(hit, best) < 0)
      )
        best = hit
    }
    if (best) found.set(e.key, best)
  }
  if (!found.size) return []
  // 借经验：译文跟这句重叠的例句、短语，它们用过的词加分
  for (const x of index.memory) {
    const used = x.used
      .map((key) => found.get(key)?.candidate)
      .filter((c): c is ComposeCandidate => !!c)
    if (!used.length) continue
    const matcher = prepareGlossMatcher(x.translation)
    for (const c of used) if (matcher.match(index.patterns.get(c.matched)!).length) c.score += 2
  }
  // 同一处对上好几个的：按分数排，位置相同的高分在前；整体按位置
  return [...found.values()]
    .sort(compareCandidates)
    .slice(0, limit)
    .map((x) => x.candidate)
}

export interface ComposeGap {
  /** 译文里没对上的那一段（原样） */
  text: string
  /** 在译文里第一次出现的位置 */
  at: number
}

/**
 * 译文里哪些部分在词库、语素表里都没有对上（标点、空白不算）：不用空格的文字按连着没对上的一段算
 * （「云鸟飞往森林」里的「往」），用空格的按词算；同一段出现几次只列一次，按在译文里的先后
 */
function gapsFrom({ matcher, covered }: ComposeScan): ComposeGap[] {
  const text = matcher.text
  const out: ComposeGap[] = []
  const seen = new Set<string>()
  const push = (s: string, at: number): void => {
    const k = s.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push({ text: s, at })
  }
  for (const w of matcher.words)
    if (isSpaceless(w.raw)) {
      let start = -1
      // 按码点读字，保存的仍是原译文 UTF-16 位置。
      for (const m of w.raw.matchAll(/[\s\S]/gu)) {
        const at = w.at + m.index
        const gap = !covered[at] && /[\p{L}\p{N}]/u.test(m[0])
        if (gap && start < 0) start = at
        if (!gap && start >= 0) {
          push(text.slice(start, at), start)
          start = -1
        }
      }
      if (start >= 0) push(text.slice(start, w.end), start)
    } else if (covered.subarray(w.at, w.end).some((n) => !n)) push(w.raw, w.at)
  return out
}

export interface ComposeSuggestions {
  candidates: ComposeCandidate[]
  gaps: ComposeGap[]
}

/** 输入变化时复用已准备的释义索引，候选和缺词共用一次匹配。 */
export function composeSuggestionsFrom(
  index: ComposeIndex,
  translation: string,
  limit = 40
): ComposeSuggestions {
  const scan = scanGlosses(index, translation)
  return { candidates: candidatesFrom(scan, index, limit), gaps: gapsFrom(scan) }
}

/** 工作台一次反查，同时得到候选和缺词；不缓存工程对象，不改写词条或译文。 */
export function composeSuggestions(
  project: Project,
  languageId: Id,
  translation: string,
  langs: string[],
  limit = 40
): ComposeSuggestions {
  return composeSuggestionsFrom(prepareComposeIndex(project, languageId, langs), translation, limit)
}

/** 兼容原有的单独候选查询；同时需要缺词时请用 composeSuggestions，避免重复扫描。 */
export function composeCandidates(
  project: Project,
  languageId: Id,
  translation: string,
  langs: string[],
  limit = 40
): ComposeCandidate[] {
  const index = prepareComposeIndex(project, languageId, langs)
  return candidatesFrom(scanGlosses(index, translation), index, limit)
}

export function composeGaps(
  project: Project,
  languageId: Id,
  translation: string,
  langs: string[]
): ComposeGap[] {
  return gapsFrom(scanGlosses(prepareComposeIndex(project, languageId, langs), translation))
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
  /** 来源句里已确认的手选分析；词块重新构形后不再沿用。 */
  analysis?: Analysis
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
    if (k < 0) {
      // 逐字／自定义分词可能把一个已选词块切成多个 token；仍按顺序确认同一身份。
      const compact = (text: string): string =>
        text.normalize('NFC').toLowerCase().replace(/\s+/gu, '')
      const wanted = compact(w.form)
      let range: { start: number; end: number } | null = null
      for (let start = j; start < tokens.length && !range; start++) {
        let joined = ''
        for (let end = start; end < tokens.length; end++) {
          joined += compact(tokens[end].surface)
          if (joined === wanted) {
            if (end > start) range = { start, end: end + 1 }
            break
          }
          if (joined.length >= wanted.length) break
        }
      }
      if (!range) continue
      j = range.end
      if (!w.lexemeId && !w.morphemeId) continue
      const group = tokens.slice(range.start, range.end),
        parts: PinnedWord[] = group.map((token, i) => ({
          ...w,
          form: token.surface,
          analysis: {
            lexemeId: w.lexemeId ?? null,
            slot: w.slotKey,
            part: { i, n: group.length },
            morphs: [
              {
                form: token.surface,
                gloss: glossOf(w) || '?',
                morphemeId: w.morphemeId ?? null,
                ...(w.lexemeId ? { lexemeId: w.lexemeId } : {})
              }
            ]
          }
        }))
      pinned += pinChoices(group, parts, glossOf)
      continue
    }
    j = k + 1
    if (!w.lexemeId && !w.morphemeId && !w.analysis) continue
    const tk = tokens[k]
    if (
      w.analysis &&
      (!w.lexemeId ||
        w.analysis.lexemeId === w.lexemeId ||
        w.analysis.morphs.some((m) => m.lexemeId === w.lexemeId)) &&
      (!w.morphemeId || w.analysis.morphs.some((m) => m.morphemeId === w.morphemeId))
    ) {
      const signature = (a: Analysis): string =>
        JSON.stringify([
          a.lexemeId,
          a.slot,
          a.part?.i,
          a.part?.n,
          a.morphs.map((m) => [
            m.form.normalize('NFC').toLowerCase(),
            m.gloss,
            m.morphemeId,
            m.lexemeId,
            m.sep
          ])
        ])
      const wanted = signature(w.analysis)
      let chosen = tk.analyses.findIndex((a) => signature(a) === wanted)
      if (chosen < 0) {
        tk.analyses.push({
          ...w.analysis,
          morphs: w.analysis.morphs.map((m) => ({ ...m })),
          ...(w.analysis.part ? { part: { ...w.analysis.part } } : {})
        })
        chosen = tk.analyses.length - 1
      }
      tk.chosen = chosen
      tk.confirmed = true
      pinned++
      continue
    }
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
