/**
 * 悬浮一个词时认它是哪个词条 / 语素、切分里的每一段挂到哪。
 * 语料页和开始页的画廊共用同一套判断（画廊里的项目没有打开，拿读进来的那一份建一个），
 * 两边悬浮出来的结果才一致。索引、构形词缀、词形表都是第一次用到时才建；项目一改就换一个新的。
 */
import type { Id, Lexeme, Project, Sentence, Token } from '$lib/core/model'
import type { HoverPart } from '$lib/state/wordHover.svelte'
import { glossHasMeaning, lexemeMatchesGloss } from '$lib/core/glossMatch'
import { paradigmAffixes, reverseDerive } from '$lib/engine/morph/reverse'
import { buildIndex, foldDiacritics } from './index'
import {
  homographIds,
  piecesOf,
  rankHomographs,
  surfaceKey,
  type SurfaceEvidence
} from './candidates'

type GlossIndex = ReturnType<typeof buildIndex>

export class WordResolver {
  private idx: GlossIndex | null = null
  private affixCache: ReturnType<typeof paradigmAffixes> | null = null
  private formList: { lexeme: Lexeme; forms: string[] }[] | null = null
  private byId: Map<Id, Lexeme> | null = null

  constructor(
    private readonly project: Project,
    private readonly languageId: Id | null,
    /** 同形词排序用的旁证（语料页随例句改动重算后传进来；画廊里一次算好） */
    private readonly evidence: () => Map<string, SurfaceEvidence> = () => new Map()
  ) {}

  private index(): GlossIndex | null {
    if (!this.languageId) return null
    this.idx ??= buildIndex(this.project, this.languageId)
    return this.idx
  }
  private affixes(): ReturnType<typeof paradigmAffixes> {
    this.affixCache ??= this.languageId
      ? paradigmAffixes(this.project, this.languageId)
      : { prefixes: [], suffixes: [] }
    return this.affixCache
  }
  private lexemeById(): Map<Id, Lexeme> {
    this.byId ??= new Map(this.project.lexemes.map((l) => [l.id, l]))
    return this.byId
  }

  lexemeOf(tk: Token): Id | null {
    return tk.analyses[tk.chosen]?.lexemeId ?? null
  }

  /** 分析没给出词条时：先查词头 / 词干 / 屈折形，再剥一层构形词缀重查 */
  resolveWord(tk: Token): { lexemeId?: Id; morphemeId?: Id } | null {
    // 1. 用户确认过的分析最可信
    const a = tk.analyses[tk.chosen]
    if (tk.confirmed && a?.lexemeId) return { lexemeId: a.lexemeId }
    const idx = this.index()
    // 2. 同一个写法在别处被确认过，照搬那次的结论
    const elsewhere = idx?.confirmed.get(tk.surface)?.find((x) => x.lexemeId)
    if (elsewhere?.lexemeId) return { lexemeId: elsewhere.lexemeId }
    const direct = this.lexemeOf(tk)
    if (direct) return { lexemeId: direct }
    // 3. 确认过的切分里认出的语素
    const mid =
      a?.morphs.find((m) => m.morphemeId)?.morphemeId ??
      elsewhere?.morphs.find((m) => m.morphemeId)?.morphemeId
    if (idx) {
      const gloss = a?.morphs.map((m) => m.gloss).join(' ') ?? ''
      const byForm = this.lookupByForm(tk.surface, gloss)
      if (byForm) return { lexemeId: byForm }
      const rev = reverseDerive(tk.surface, this.affixes(), (form) =>
        this.lookupByForm(form, gloss)
      )
      if (rev) return { lexemeId: rev.lexemeId }
      // 再试剥一个语素前缀 / 后缀（语流前缀、格缀这些都在语素表里）
      const byAffix = this.stripMorphemeAffix(tk.surface, gloss)
      if (byAffix) return { lexemeId: byAffix }
      // 还不行就逐段试：已确认的切分里，词干那一段往往才是词典里的形式
      for (const m of a?.morphs ?? []) {
        // 已经挂着语素的段（感音、式、体这些）不是词典里的词：跳过去，找词干那一段
        if (m.morphemeId) continue
        const seg = m.form.replace(/^[-=·']+|[-=·']+$/g, '')
        if (seg.length < 2) continue
        const hit =
          this.lookupByForm(seg, m.gloss || gloss) ??
          this.stripMorphemeAffix(seg, m.gloss || gloss) ??
          this.lookupByGlossAndForm(seg, m.gloss || gloss)
        if (hit) return { lexemeId: hit }
      }
      // 词条里找不到就查语素：限定词、小品词这类都在语素表里
      const key = tk.surface.normalize('NFC').toLowerCase()
      const mo = idx.morphemes.get(key)?.[0]
      if (mo) return { morphemeId: mo.id }
    }
    return mid ? { morphemeId: mid } : null
  }

  /** 剥掉一个已知的语素前缀或后缀再查一次 */
  private stripMorphemeAffix(surface: string, gloss: string): Id | null {
    const idx = this.index()
    if (!idx) return null
    const w = surface.normalize('NFC').toLowerCase()
    for (const { form } of idx.prefixes)
      if (form && w.startsWith(form) && w.length - form.length > 1) {
        const hit = this.lookupByForm(w.slice(form.length), gloss)
        if (hit) return hit
      }
    for (const { form } of idx.suffixes)
      if (form && w.endsWith(form) && w.length - form.length > 1) {
        const hit = this.lookupByForm(w.slice(0, w.length - form.length), gloss)
        if (hit) return hit
      }
    return null
  }

  /**
   * 按形式查词条：同形的候选还要跟标注的意思对得上才认，
   * 一个都对不上就宁可不给，免得悬浮出毫不相干的词。
   */
  private lookupByForm(form: string, gloss: string): Id | null {
    const idx = this.index()
    if (!idx) return null
    const key = form.normalize('NFC').toLowerCase()
    const folded = foldDiacritics(key)
    const pool = (k: string): Lexeme[] => [
      ...(idx.lemma.get(k) ?? []),
      ...(idx.forms.get(k) ?? []).map((f) => f.lexeme),
      ...(idx.stems.get(k) ?? [])
    ]
    const cands = pool(key).length ? pool(key) : pool(folded)
    const good = cands.find((l) => lexemeMatchesGloss(l, gloss))
    return good ? good.id : null
  }

  /**
   * 形式对不上时宽一点再找：这门语言里释义对得上 gloss 的词条，某个形式（词头、词干、屈折形，去掉附加符与音节点比）
   * 整个出现在这一段里——带了前缀、重音写法不同的词干也认得出来（wéñgaus 里有 eñgaus）。取包含得最长的那个。
   * gloss 里没有意思成分（纯缩写）时不猜。
   */
  private lookupByGlossAndForm(form: string, gloss: string): Id | null {
    if (!this.languageId || !glossHasMeaning(gloss)) return null
    const foldForm = (x: string): string =>
      foldDiacritics(x.normalize('NFC').toLowerCase()).replace(/[.·='’-]/g, '')
    const lid = this.languageId
    this.formList ??= this.project.lexemes
      .filter((l) => l.languageId === lid)
      .map((l) => ({
        lexeme: l,
        forms: [
          ...new Set(
            [
              l.lemma,
              ...Object.values(l.stems),
              ...Object.values(l.forms).flatMap((f) => f.surface.split(/[,，;；/]\s*/))
            ]
              .map((x) => foldForm(x ?? ''))
              .filter((x) => x.length >= 3)
          )
        ]
      }))
    const f = foldForm(form)
    let best: { id: Id; len: number } | null = null
    for (const c of this.formList) {
      const len = Math.max(0, ...c.forms.filter((x) => f.includes(x)).map((x) => x.length))
      if (len && (!best || len > best.len) && lexemeMatchesGloss(c.lexeme, gloss))
        best = { id: c.lexeme.id, len }
    }
    return best?.id ?? null
  }

  /**
   * 悬浮卡顶上的切分：优先用这个词已确认的分析，
   * 每一段能对上语素或词条就挂上，点得开。
   */
  hoverParts(tk: Token): HoverPart[] {
    const idx = this.index()
    const a =
      (tk.confirmed ? tk.analyses[tk.chosen] : null) ??
      idx?.confirmed.get(tk.surface)?.[0] ??
      tk.analyses[tk.chosen]
    if (!a || a.morphs.length < 2) return []
    return a.morphs.map((m) => {
      if (m.morphemeId) return { label: m.form, gloss: m.gloss, morphemeId: m.morphemeId }
      if (m.lexemeId) return { label: m.form, gloss: m.gloss, lexemeId: m.lexemeId }
      const key = m.form
        .normalize('NFC')
        .toLowerCase()
        .replace(/^[-=·']+|[-=·']+$/g, '')
      const mo = idx?.morphemes.get(key)?.[0]
      if (mo) return { label: m.form, gloss: m.gloss, morphemeId: mo.id }
      // 词条：先按形式找；再看整个词分析出来的词条是不是就是这一段（意思对得上）；再按意思 + 形式包含宽一点找
      const main = a.lexemeId ? this.lexemeById().get(a.lexemeId) : undefined
      const lexemeId =
        this.lookupByForm(key, m.gloss) ??
        (main && glossHasMeaning(m.gloss) && lexemeMatchesGloss(main, m.gloss) ? main.id : null) ??
        this.lookupByGlossAndForm(key, m.gloss)
      // 既不是语素也挂不上词条——有没有 gloss 都一样：点开是「没有找到」，要手动指定
      return { label: m.form, gloss: m.gloss, lexemeId, missing: !lexemeId }
    })
  }

  /** 便宜的可点判断：重的反推留到真正悬浮时再做 */
  linkable(tk: Token): boolean {
    return (
      !!this.lexemeOf(tk) ||
      (tk.confirmed && (tk.analyses[tk.chosen]?.morphs.length ?? 0) > 0) ||
      !!tk.analyses[tk.chosen]?.morphs.some((m) => m.morphemeId)
    )
  }

  private definitionPieces(id: Id): string[] {
    const l = this.lexemeById().get(id)
    return l ? piecesOf(l.senses.flatMap((se) => Object.values(se.definition)).join('；')) : []
  }
  private rankOf(tk: Token, s: Sentence, ids: Id[]): Id[] {
    return rankHomographs(ids, s, this.evidence().get(surfaceKey(tk.surface)), (id) =>
      this.definitionPieces(id)
    )
  }

  /** 这个词可能是哪个词条：确认过的就是它；几个同形词条时按意思线索挑，挑不出来就都给 */
  candidatesOf(tk: Token, s: Sentence): { lexemeId?: Id; morphemeId?: Id }[] {
    const a = tk.analyses[tk.chosen]
    if (tk.confirmed) {
      if (a?.lexemeId) return [{ lexemeId: a.lexemeId }]
      const one = this.resolveWord(tk)
      return one ? [one] : []
    }
    const ids = homographIds(tk)
    if (ids.length > 1) return this.rankOf(tk, s, ids).map((id) => ({ lexemeId: id }))
    const one = this.resolveWord(tk)
    return one ? [one] : ids.map((id) => ({ lexemeId: id }))
  }

  /** 几个候选分不出来：这个词在列表里用警告色标出来（与悬浮时并排给候选是同一个判断） */
  ambiguous(tk: Token, s: Sentence): boolean {
    if (tk.confirmed) return false
    const ids = homographIds(tk)
    return ids.length > 1 && this.rankOf(tk, s, ids).length > 1
  }
}
