/**
 * 自动 gloss：分词 → 反向索引查询（已确认分析 / 词头 / 词干 / 屈折形 / 语素）→ 词缀剥离 → 候选排序。
 * 只出草稿，用户逐词确认；确认过的分析成为最高优先级候选。
 */
import type { Analysis, Id, Lexeme, Morpheme, Project, Sentence, Token } from '$lib/core/model'
import {
  generateForm,
  lexemeSlots,
  makeContext,
  paradigmsFor,
  resolveGenerator,
  selectAllomorph,
  type MorphContext
} from '../morph'
import { nucleusSet } from '../phon'
import { mutationTables, type MutationTable } from '../morph/mutation'
import { sentenceScriptText } from '$lib/script/lexiconScript'
import { piecesOf } from './candidates'
import {
  pieceKeys,
  segmentWord,
  toAnalysis,
  type ChunkMorph,
  type LearnStats,
  type Piece,
  type SegmentSource
} from './segment'

export interface GlossIndex {
  lemma: Map<string, Lexeme[]>
  stems: Map<string, Lexeme[]>
  forms: Map<string, { lexeme: Lexeme; slot: string; abbr: string }[]>
  morphemes: Map<string, Morpheme[]>
  prefixes: { form: string; morpheme: Morpheme }[]
  suffixes: { form: string; morpheme: Morpheme }[]
  confirmed: Map<string, Analysis[]>
  glossLangs: string[]
  /** 作用于所有词的构形（词首音变这类）归纳出来的对照表，分词时反推用；第一次用到才算 */
  readonly mutations: MutationTable[]
  /** 撇号缩略时可以补回去的元音（这门语言音系里的元音，去掉附加符） */
  vowels: Set<string>
  /** 词典里带空格的形式（ar mae），分词时连着的词合起来查 */
  phrases: Set<string>
  /** 带空格的形式最多有几个词 */
  maxPhrase: number
  /** 这门语言里算字母的符号：词头、屈折形两头出现过的撇号一类（分词时不当标点剥掉） */
  wordChars: string
  /** 从确认过的分析里学到的切分统计 */
  learn: LearnStats
  /**
   * 没存进词条的屈折形：构形里只加词缀这类便宜的槽位现推出来（没点过「推导」的词也认得出）。
   * 第一次用到才算
   */
  readonly virtual: Map<string, { lexeme: Lexeme; slot: string; abbr: string }[]>
  /** 切分用的词典接口（segment.ts） */
  readonly source: SegmentSource
  /** 词条 id → 词条（挑义项时用，第一次问才建） */
  readonly lexemeById: Map<Id, Lexeme>
  project: Project
}

import { discontinuousEntries, matchDiscontinuous } from './discontinuous'
import { tokenize } from './tokens'
export { tokenize, type TokenizeOptions } from './tokens'

const strip = (s: string): string => s.replace(/^[-=]+|[-=]+$/g, '')
/** 去掉附加符（é → e）：语料里的重音标记与词典未必一致 */
export const foldDiacritics = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
/** 索引键：去首尾边界符、NFC、小写 */
const norm = (s: string): string => strip(s).normalize('NFC').toLowerCase()

/** 释义截成简短 gloss 的切点：分号、逗号、句号、冒号、括号（省略号里的点不算） */
const GLOSS_CUT = /[;；,，。:：(（]|(?<!\.)\.(?!\.)/
/** 释义的第一小段；开头就是括号注（「（植物）生长」）时去掉括号注再取 */
export function shortGloss(d: string): string {
  const cut = (x: string): string => x.split(GLOSS_CUT)[0].trim()
  return cut(d) || cut(d.replace(/[（(][^）)]*[）)]/g, '')) || d.trim()
}

/** 词位某个义项的简短 gloss（见 shortGloss） */
export function senseGloss(l: Lexeme, i: number, glossLangs: string[]): string {
  const def = l.senses[i]?.definition
  if (!def) return ''
  for (const g of glossLangs) if (def[g]) return shortGloss(def[g])
  const any = Object.values(def).find(Boolean)
  return any ? shortGloss(any) : ''
}

/** 词位的简短 gloss：第一义项的第一小段（见 shortGloss） */
export function lexemeGloss(l: Lexeme, glossLangs: string[]): string {
  for (const g of glossLangs) {
    const d = l.senses[0]?.definition[g]
    if (d) return shortGloss(d)
  }
  const any = Object.values(l.senses[0]?.definition ?? {}).find(Boolean)
  return any ? shortGloss(any) : l.lemma
}

/**
 * 一处写了几个异写（`fóros/fauros`、`eñgan//eñgaun`、逗号分号分开的）：拆成一个个写法。
 * 词头、词干、屈折形都这样入索引，语料里写哪一个都认得出
 */
export function variants(text: string): string[] {
  return text
    .split(/[,，;；/]+\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}

/**
 * 一个词形的等价写法，都进索引：
 * 原样、去掉内部边界符、按边界切出来的段、以及剥掉一个已知前缀后的余部。
 * 语料里常见的省略写法（词头脱落、连字符写法）才对得上词典里的形式。
 */
function formKeys(raw: string, boundaries: string[], prefixes: string[]): string[] {
  const base = norm(raw)
  if (!base) return []
  const out = new Set([base])
  const folded = foldDiacritics(base)
  if (folded !== base) out.add(folded)
  // 「alch(elch)」这类括号写法：括号内外都算一个形式
  const paren = /^([^()（）]*)[（(]([^)）]+)[)）]([^()（）]*)$/.exec(base)
  if (paren) {
    const [, a, inner, b] = paren
    for (const v of [a + b, a + inner + b, inner]) if (v.length > 1) out.add(v)
  }
  const bset = boundaries.filter((b) => b && b !== ' ')
  if (bset.some((b) => base.includes(b))) {
    const re = new RegExp(`[${bset.map((b) => b.replace(/[\\\]^-]/g, '\\$&')).join('')}]`, 'g')
    out.add(base.replace(re, ''))
    for (const part of base.split(re)) if (part.length > 1) out.add(part)
  }
  // 词头脱落：dictionary 里写成一个词的形式，正文里可能只剩后半段
  for (const pre of prefixes) {
    if (pre.length < 1 || !base.startsWith(pre)) continue
    const rest = base.slice(pre.length).replace(/^[-=·'’]+/, '')
    if (rest.length > 1) out.add(rest)
  }
  return [...out]
}

/** 常见拉丁元音：语言没有音系数据时撇号缩略用它 */
const FALLBACK_VOWELS = 'aeiouyæøœɑɛɔəɪʊɨʉɯ'

/** 可能是字母的符号：转写里常见的几种撇号、送气 / 喉塞记号 */
const LETTERLIKE = new Set(Array.from("'’‘ʼʻʽ`´ʔʕ"))

export interface BuildIndexOptions {
  /** 这一句的确认记录不进索引（准确率自测时用：拿别的句子学到的东西分析这一句） */
  excludeSentenceId?: Id
}

export function buildIndex(
  project: Project,
  languageId: Id,
  opts: BuildIndexOptions = {}
): GlossIndex {
  const glossLangs = project.settings.glossLanguages
  const language = project.languages.find((l) => l.id === languageId)
  const vowels = new Set(
    [...(language ? nucleusSet(language) : [])].map((v) => foldDiacritics(v).toLowerCase())
  )
  if (!vowels.size) for (const v of FALLBACK_VOWELS) vowels.add(v)
  let mutations: MutationTable[] | null = null
  let lexemeById: Map<Id, Lexeme> | null = null
  let virtual: GlossIndex['virtual'] | null = null
  let source: SegmentSource | null = null
  let morphCtx: MorphContext | null = null
  const ctxOf = (): MorphContext | null => {
    if (!language) return null
    morphCtx ??= makeContext(project, language)
    return morphCtx
  }
  const idx: GlossIndex = {
    lemma: new Map(),
    stems: new Map(),
    forms: new Map(),
    morphemes: new Map(),
    prefixes: [],
    suffixes: [],
    confirmed: new Map(),
    glossLangs,
    get mutations() {
      mutations ??= mutationTables(project, languageId)
      return mutations
    },
    vowels,
    phrases: new Set(),
    maxPhrase: 1,
    wordChars: '',
    learn: { formKey: new Map(), keyCount: new Map(), next: new Map(), chunks: new Map() },
    project,
    get lexemeById() {
      lexemeById ??= new Map(project.lexemes.map((l) => [l.id, l]))
      return lexemeById
    },
    get virtual() {
      virtual ??= virtualForms(project, languageId, ctxOf)
      return virtual
    },
    get source() {
      source ??= segmentSource(idx, ctxOf)
      return source
    }
  }
  // 撇号这类符号，词库里有词以它开头或结尾就当字母（阿拉伯语转写的 'llhi）
  const edgeChars = new Set<string>()
  const noteEdges = (form: string): void => {
    const s = form.trim()
    if (!s) return
    for (const c of [s[0], s[s.length - 1]]) if (LETTERLIKE.has(c)) edgeChars.add(c)
  }
  const boundaries = project.settings.morphemeBoundaries
  // 本语言（含祖语）的前缀与附着词，用来还原脱落词头的写法
  const prefixForms = [
    ...new Set(
      project.morphemes
        .filter((m) => m.type === 'prefix' || m.type === 'clitic')
        .map((m) => norm(m.form))
        .filter((f) => f.length > 0)
    )
  ]
  for (const l of project.lexemes) {
    if (l.languageId !== languageId) continue
    noteEdges(l.lemma)
    for (const v of variants(l.lemma))
      for (const k of formKeys(v, boundaries, prefixForms)) push(idx.lemma, k, l)
    for (const st of Object.values(l.stems))
      for (const v of variants(st))
        for (const k of formKeys(v, boundaries, prefixForms)) push(idx.stems, k, l)
    const abbrs = new Map<string, string>()
    for (const s of lexemeSlots(project, l, glossLangs)) abbrs.set(s.key, s.slot.abbr)
    for (const [slot, f] of Object.entries(l.forms)) {
      for (const v of variants(f.surface)) {
        noteEdges(v)
        for (const k of formKeys(v.trim().replace(/^\*/, ''), boundaries, prefixForms))
          push(idx.forms, k, { lexeme: l, slot, abbr: abbrs.get(slot) ?? slot })
      }
    }
  }
  // 本语言的语素优先；找不到时退到祖语链上的语素（词根表常放在祖语）
  const lineage: Id[] = [languageId]
  let cur = project.languages.find((l) => l.id === languageId)
  while (cur?.parentId && !lineage.includes(cur.parentId)) {
    lineage.push(cur.parentId)
    cur = project.languages.find((l) => l.id === cur!.parentId)
  }
  const ordered = [...project.morphemes].sort(
    (a, b) => lineage.indexOf(a.languageId) - lineage.indexOf(b.languageId)
  )
  for (const m of ordered) {
    if (!lineage.includes(m.languageId)) continue
    const forms = [m.form, ...m.allomorphs.map((a) => a.form)].map(norm).filter(Boolean)
    for (const f of new Set(forms)) {
      push(idx.morphemes, f, m)
      if (m.type === 'suffix' || m.type === 'clitic') idx.suffixes.push({ form: f, morpheme: m })
      if (m.type === 'prefix' || m.type === 'clitic') idx.prefixes.push({ form: f, morpheme: m })
    }
  }
  idx.wordChars = [...edgeChars].join('')
  // 带空格的形式（ar mae 这种限定词 + 名词分开写的屈折形）
  for (const k of [...idx.lemma.keys(), ...idx.forms.keys(), ...idx.stems.keys()]) {
    if (!k.includes(' ')) continue
    idx.phrases.add(k)
    idx.maxPhrase = Math.max(idx.maxPhrase, k.split(/\s+/).length)
  }
  // 长词缀优先
  idx.suffixes.sort((a, b) => b.form.length - a.form.length)
  idx.prefixes.sort((a, b) => b.form.length - a.form.length)
  for (const s of project.sentences) {
    if (s.languageId !== languageId || s.id === opts.excludeSentenceId) continue
    for (const tk of s.tokens) {
      if (!tk.confirmed) continue
      const a = tk.analyses[tk.chosen]
      if (!a) continue
      push(idx.confirmed, tk.surface, a)
      learnFrom(idx.learn, a)
    }
  }
  return idx
}

/** 学一条确认过的分析：每一段确认成了什么、前后怎么接 */
function learnFrom(learn: LearnStats, a: Analysis): void {
  const bump = (m: Map<string, number>, k: string): void => {
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  // 没挂语素、没手动指定词条的段只有一个时，它就是整词对应的那个词条
  const bare = a.morphs.filter((m) => !m.morphemeId && !m.lexemeId)
  let prev: string[] = []
  const seq: ChunkMorph[] = []
  for (const m of a.morphs) {
    const ref = m.lexemeId ?? (bare.length === 1 && bare[0] === m ? a.lexemeId : null)
    const keys = pieceKeys({ morphemeId: m.morphemeId, lexemeId: ref, gloss: m.gloss })
    const form = norm(m.form.replace(/^[·'’]+|[·'’]+$/g, ''))
    if (!form) continue
    let byForm = learn.formKey.get(form)
    if (!byForm) learn.formKey.set(form, (byForm = new Map()))
    for (const k of keys) {
      bump(byForm, k)
      bump(learn.keyCount, k)
      for (const p of prev) {
        let set = learn.next.get(p)
        if (!set) learn.next.set(p, (set = new Set()))
        set.add(k)
      }
    }
    prev = keys
    seq.push({ form, gloss: m.gloss, morphemeId: m.morphemeId, lexemeId: m.lexemeId, ref, keys })
  }
  // 连着两到四段：合起来的文字记下这种切法
  for (let i = 0; i < seq.length; i++)
    for (let k = i + 2; k <= Math.min(seq.length, i + 4); k++) {
      const run = seq.slice(i, k)
      const text = run.map((m) => m.form).join('')
      const sig = JSON.stringify(
        run.map((m) => [m.form, m.gloss, m.morphemeId, m.lexemeId ?? null])
      )
      let list = learn.chunks.get(text)
      if (!list) learn.chunks.set(text, (list = []))
      const hit = list.find(
        (c) =>
          JSON.stringify(
            c.morphs.map((m) => [m.form, m.gloss, m.morphemeId, m.lexemeId ?? null])
          ) === sig
      )
      if (hit) hit.count++
      else list.push({ morphs: run, count: 1 })
    }
}

/** 构形里只加词缀、重叠这类不跑音变的槽位，现推出没存进词条的形式（最多推这么多格，免得大项目卡住） */
const VIRTUAL_CAP = 60000
const CHEAP_STEPS = new Set(['prefix', 'suffix', 'circumfix', 'infix', 'reduplication'])

function virtualForms(
  project: Project,
  languageId: Id,
  ctxOf: () => MorphContext | null
): GlossIndex['virtual'] {
  const out: GlossIndex['virtual'] = new Map()
  const ctx = ctxOf()
  if (!ctx || !project.paradigms.length) return out
  const boundaries = project.settings.morphemeBoundaries
  let budget = VIRTUAL_CAP
  for (const l of project.lexemes) {
    if (l.languageId !== languageId || budget <= 0) continue
    const lps = paradigmsFor(project, l)
    if (!lps.length) continue
    for (const s of lexemeSlots(project, l)) {
      if (l.forms[s.key]?.surface.trim()) continue
      const g = resolveGenerator(
        s.lp.paradigm,
        s.slot.key,
        project.paradigms,
        0,
        s.lp.variantId ?? l.paradigmVariantId
      )
      const cheap =
        g.kind === 'affix' ||
        g.kind === 'reduplication' ||
        (g.kind === 'pipeline' && g.steps.every((st) => CHEAP_STEPS.has(st.kind)))
      if (!cheap) continue
      if (--budget <= 0) break
      let surface = ''
      try {
        surface = generateForm(ctx, l, s.lp.paradigm, s.slot, s.lp.variantId)?.surface ?? ''
      } catch {
        continue
      }
      for (const v of variants(surface))
        for (const k of formKeys(v.trim(), boundaries, []))
          push(out, k, { lexeme: l, slot: s.key, abbr: s.slot.abbr })
    }
  }
  return out
}

/** 切分用的词典：一段文字能当哪些块、词缀的出现环境、词条释义片段 */
function segmentSource(idx: GlossIndex, ctxOf: () => MorphContext | null): SegmentSource {
  const envMemo = new Map<string, number>()
  const defMemo = new Map<Id, string[]>()
  let typeById: Map<Id, Morpheme['type']> | null = null
  /** 学来的整块算哪种块：有词条或词根就是词干，全是前缀是前缀，全是后缀是后缀 */
  const chunkRole = (morphs: ChunkMorph[]): { role: Piece['role']; stems: number } => {
    typeById ??= new Map(idx.project.morphemes.map((m) => [m.id, m.type]))
    let stems = 0
    let pre = 0
    let suf = 0
    for (const m of morphs) {
      const t = m.morphemeId ? typeById.get(m.morphemeId) : undefined
      if (!m.morphemeId || t === 'root') stems++
      else if (t === 'prefix' || t === 'clitic') pre++
      else if (t === 'suffix') suf++
    }
    if (stems) return { role: 'stem', stems }
    if (pre && !suf) return { role: 'pre', stems: 0 }
    if (suf && !pre) return { role: 'suf', stems: 0 }
    return { role: morphs[0] && pre ? 'pre' : 'suf', stems: 0 }
  }
  const withEnv = new Set<Id>()
  const exact = (sub: string, whole: boolean): Piece[] => {
    const out: Piece[] = []
    const seen = new Set<string>()
    const add = (p: Piece): void => {
      const k = `${p.role}/${p.lexemeId ?? ''}/${p.morphemeId ?? ''}/${p.slot ?? ''}`
      if (seen.has(k)) return
      seen.add(k)
      out.push(p)
    }
    const stem = (l: Lexeme, cost: number, slot: string | null = null, abbr = ''): void =>
      add({
        form: sub,
        role: 'stem',
        gloss: abbr ? `${lexemeGloss(l, idx.glossLangs)}.${abbr}` : lexemeGloss(l, idx.glossLangs),
        morphemeId: null,
        lexemeId: l.id,
        slot,
        cost,
        lexeme: l
      })
    for (const l of idx.lemma.get(sub) ?? []) stem(l, 1)
    const stored = new Set<string>()
    for (const f of idx.forms.get(sub) ?? []) {
      stored.add(`${f.lexeme.id}/${f.slot}`)
      stem(f.lexeme, 1, f.slot, f.abbr)
    }
    for (const l of idx.stems.get(sub) ?? []) stem(l, 1.05)
    for (const m of idx.morphemes.get(sub) ?? []) {
      const gloss = morphemeGloss(m, idx.glossLangs)
      const base = { form: sub, gloss, morphemeId: m.id, lexemeId: null, slot: null, morpheme: m }
      if (m.type === 'prefix' || m.type === 'clitic')
        add({ ...base, role: 'pre', cost: m.type === 'clitic' ? 0.95 : 0.9 })
      if (m.type === 'suffix' || m.type === 'clitic')
        add({ ...base, role: 'suf', cost: m.type === 'clitic' ? 0.95 : 0.9 })
      if (m.type === 'root') add({ ...base, role: 'stem', cost: 1.1 })
      else if (whole) add({ ...base, role: 'whole', cost: 1.05 })
    }
    // 学来的整块：确认得越多越便宜
    for (const c of idx.learn.chunks.get(sub) ?? []) {
      const { role, stems } = chunkRole(c.morphs)
      out.push({
        form: sub,
        role,
        gloss: c.morphs.map((m) => m.gloss).join('-'),
        morphemeId: null,
        lexemeId: null,
        slot: null,
        cost: 0.75 - 0.1 * Math.min(c.count - 1, 2),
        chunk: c.morphs,
        chunkStems: stems
      })
    }
    // 构形现推出来的形式：词条里存了同一格的就不要
    if (sub.length > 1)
      for (const f of idx.virtual.get(sub) ?? [])
        if (!stored.has(`${f.lexeme.id}/${f.slot}`)) stem(f.lexeme, 1.2, f.slot, f.abbr)
    return out
  }
  return {
    learn: idx.learn,
    pieces(sub, whole) {
      let out = exact(sub, whole)
      // 作用于所有词的构形（词首音变）：换回原形能对上词条的也当词干
      if (
        !out.some((p) => p.role === 'stem') &&
        Array.from(sub).length >= 2 &&
        idx.mutations.length
      )
        for (const a of demutate(idx, sub))
          if (a.lexemeId && a.morphs.length === 1)
            out.push({
              form: sub,
              role: 'stem',
              gloss: a.morphs[0].gloss,
              morphemeId: null,
              lexemeId: a.lexemeId,
              slot: a.slot,
              cost: 1.3
            })
      if (!out.length) {
        const folded = foldDiacritics(sub)
        if (folded !== sub)
          out = exact(folded, whole).map((p) => ({
            ...p,
            form: sub,
            cost: p.cost + 0.9,
            fold: true
          }))
      }
      return out
    },
    envFit(p, before, after) {
      const m = p.morpheme
      if (!m) return 0
      if (!withEnv.has(m.id)) {
        if (!m.allomorphs.some((a) => a.environment.trim())) return 0
        withEnv.add(m.id)
      }
      const side = p.role === 'suf' ? 'suffix' : 'prefix'
      const neighbor = side === 'suffix' ? before : after
      if (!neighbor) return 0
      const key = `${m.id}|${side}|${neighbor}|${p.form}`
      let fit = envMemo.get(key)
      if (fit === undefined) {
        const ctx = ctxOf()
        fit = 0
        if (ctx) {
          try {
            fit = norm(selectAllomorph(ctx, m, neighbor, side).form) === p.form ? 1 : -1
          } catch {
            fit = 0
          }
        }
        envMemo.set(key, fit)
      }
      return fit
    },
    defPieces(l) {
      let hit = defMemo.get(l.id)
      if (!hit) {
        hit = piecesOf(l.senses.flatMap((se) => Object.values(se.definition)).join('；'))
        defMemo.set(l.id, hit)
      }
      return hit
    }
  }
}

/** 分词用的索引按项目缓存：整批重新分析时不必每句重建；项目一改（updatedAt 变了）就重建 */
let indexCache = new WeakMap<Project, Map<Id, { stamp: string; idx: GlossIndex }>>()
export function glossIndexFor(project: Project, languageId: Id): GlossIndex {
  const stamp = [
    project.meta.updatedAt,
    project.lexemes.length,
    project.morphemes.length,
    project.sentences.length,
    project.paradigms.length
  ].join('|')
  let byLang = indexCache.get(project)
  if (!byLang) indexCache.set(project, (byLang = new Map()))
  const hit = byLang.get(languageId)
  if (hit && hit.stamp === stamp) return hit.idx
  const idx = buildIndex(project, languageId)
  byLang.set(languageId, { stamp, idx })
  return idx
}

function morphemeGloss(m: Morpheme, glossLangs: string[]): string {
  if (m.gloss) return m.gloss
  for (const g of glossLangs) if (m.meaning[g]) return m.meaning[g]
  return Object.values(m.meaning).find(Boolean) ?? m.form
}

const key = (a: Analysis): string =>
  JSON.stringify([a.lexemeId, a.slot, a.morphs.map((m) => [m.form, m.gloss, m.morphemeId])])

/** 一个完整词（不含内部边界）的候选：词头 / 屈折形 / 词干 / 语素 */
function wholeWord(idx: GlossIndex, w: string): Analysis[] {
  const out: Analysis[] = []
  for (const l of idx.lemma.get(w) ?? [])
    out.push({
      lexemeId: l.id,
      slot: null,
      morphs: [{ form: w, gloss: lexemeGloss(l, idx.glossLangs), morphemeId: null }]
    })
  for (const f of idx.forms.get(w) ?? [])
    out.push({
      lexemeId: f.lexeme.id,
      slot: f.slot,
      morphs: [
        { form: w, gloss: `${lexemeGloss(f.lexeme, idx.glossLangs)}.${f.abbr}`, morphemeId: null }
      ]
    })
  for (const l of idx.stems.get(w) ?? [])
    out.push({
      lexemeId: l.id,
      slot: null,
      morphs: [{ form: w, gloss: lexemeGloss(l, idx.glossLangs), morphemeId: null }]
    })
  for (const m of idx.morphemes.get(w) ?? [])
    out.push({
      lexemeId: null,
      slot: null,
      morphs: [{ form: w, gloss: morphemeGloss(m, idx.glossLangs), morphemeId: m.id }]
    })
  return out
}

/** 整词候选；没有时去掉附加符再试（语料里的重音记号与词典未必一致），形式仍记表层写法 */
function lookupWord(idx: GlossIndex, w: string): Analysis[] {
  const hit = wholeWord(idx, w)
  if (hit.length) return hit
  const f = foldDiacritics(w)
  return f === w ? [] : withForm(wholeWord(idx, f), w)
}

/** 只有一段的候选改记成表层写法 */
function withForm(list: Analysis[], form: string): Analysis[] {
  return list.map((a) => (a.morphs.length === 1 ? { ...a, morphs: [{ ...a.morphs[0], form }] } : a))
}

/**
 * 反推「作用于所有词」的构形（词首音变这类）：按归纳出的对照表把开头 / 结尾换回原形再查，
 * gloss 后面接上那个槽位的缩写（wenallan → menallan「遥远的.LEN」）。
 */
function demutate(idx: GlossIndex, w: string): Analysis[] {
  const out: Analysis[] = []
  for (const tb of idx.mutations) {
    const bases = new Set<string>()
    for (const pr of tb.initial)
      if (w.length > pr.to.length && w.startsWith(pr.to)) bases.add(pr.from + w.slice(pr.to.length))
    for (const pr of tb.final)
      if (w.length > pr.to.length && w.endsWith(pr.to))
        bases.add(w.slice(0, w.length - pr.to.length) + pr.from)
    bases.delete(w)
    const tag = tb.abbr || tb.label
    for (const base of bases) {
      const found = lookupWord(idx, base)
      // 对照表只记了开头换了什么，丢了上下文（t>d 碰上 th 就不成立）：正着推回来得是这个词才算
      if (!found.length || norm(tb.apply(base)) !== w) continue
      for (const a of found)
        out.push({
          ...a,
          morphs: a.morphs.map((m, i) =>
            i === 0 ? { ...m, form: w, gloss: tag ? `${m.gloss}.${tag}` : m.gloss } : m
          )
        })
    }
  }
  return out
}

/** 缩略用的撇号：写进语素边界符号才算（很多语言拿撇号当字母，如声门塞音） */
const ELISION = new Set(["'", '’', 'ʼ'])

/** 语素边界符号；写了 ' 的话输入法打出的 ’ 也算同一个 */
function boundarySet(boundaries: string[]): string[] {
  const set = new Set(boundaries.filter((b) => b && b !== ' '))
  if (set.has("'")) set.add('’')
  return [...set]
}

/**
 * 撇号缩略：t'am 的 t' 是省掉词尾元音的 ta；'s 这类是省掉词首元音的。
 * 在词头与语素里找补上一两个元音（这门语言的元音）就对得上的，补得少的排前面。
 */
function elided(idx: GlossIndex, part: string, side: 'final' | 'initial'): Analysis[] {
  if (!part) return []
  const isVowels = (x: string): boolean => {
    const f = foldDiacritics(x).toLowerCase()
    const units = Array.from(f)
    return idx.vowels.has(f) || (units.length <= 2 && units.every((u) => idx.vowels.has(u)))
  }
  const keys = new Set<string>()
  for (const k of [...idx.lemma.keys(), ...idx.morphemes.keys()]) {
    if (k.length <= part.length) continue
    let extra = ''
    if (side === 'final' && k.startsWith(part)) extra = k.slice(part.length)
    if (side === 'initial' && k.endsWith(part)) extra = k.slice(0, k.length - part.length)
    if (extra && isVowels(extra)) keys.add(k)
  }
  const form = side === 'final' ? `${part}'` : `'${part}`
  return [...keys]
    .sort((x, y) => x.length - y.length)
    .flatMap((k) => withForm(wholeWord(idx, k), form))
}

/** 每段最多留几个候选；最多拼出几种整词分析 */
const PIECE_CHOICES = 3
const MAX_SPLITS = 6

/**
 * 按边界符切开，每段各自找候选；紧挨着缩略撇号的段先按缩略补元音找（t' → ta），再照常找。
 * 先给每段都取第一个候选拼一种，再一次换一段的候选，最多六种——第一个候选挑错了还有得选。
 * 整词对应的词条取最长的那段（介词缩略 + 名词时是名词）。
 */
function splitAt(idx: GlossIndex, surface: string, seps: string[], hint?: string[]): Analysis[] {
  const re = new RegExp(`([${seps.map((b) => b.replace(/[\\\]^-]/g, '\\$&')).join('')}])`)
  const pieces = surface.split(re)
  const slots: { piece: string; sep: string; cands: Analysis[] }[] = []
  for (let i = 0; i < pieces.length; i += 2) {
    const piece = pieces[i]
    if (!piece) continue
    const w = norm(piece)
    const elision = [
      ...(ELISION.has(pieces[i + 1] ?? '') ? elided(idx, w, 'final') : []),
      ...(ELISION.has(pieces[i - 1] ?? '') ? elided(idx, w, 'initial') : [])
    ]
    // 同一个词条（或语素）的几个形式只留第一个，名额留给不同的词
    const seen = new Set<string>()
    const cands: Analysis[] = []
    // 每段按通用切分找：可以只有词缀（动词头 dáfes· 的词干在点号后面）
    const parts = segmentWord(idx.source, w, { requireStem: false, hint, limit: 8 }).map(toAnalysis)
    for (const c of [...elision, ...parts]) {
      const k = c.lexemeId ?? c.morphs.map((m) => m.morphemeId ?? m.gloss).join('|')
      if (seen.has(k)) continue
      seen.add(k)
      cands.push(c)
    }
    slots.push({ piece, sep: pieces[i - 1] ?? '', cands: cands.slice(0, PIECE_CHOICES) })
  }
  const build = (choice: number[]): Analysis => {
    const morphs: Analysis['morphs'] = []
    let main: Id | null = null
    let mainLen = 0
    for (let n = 0; n < slots.length; n++) {
      const { piece, cands, sep } = slots[n]
      const at = morphs.length
      const c = cands[choice[n]]
      if (!c) morphs.push({ form: piece, gloss: '?', morphemeId: null })
      else {
        morphs.push(...c.morphs)
        if (c.lexemeId && piece.length > mainLen) {
          main = c.lexemeId
          mainLen = piece.length
        }
      }
      // 用户在词里写的分隔符照原样记下来：写 = 就一直是 =
      if (n > 0 && (sep === '-' || sep === '=') && morphs[at]) morphs[at] = { ...morphs[at], sep }
    }
    const out: Analysis = { lexemeId: main, slot: null, morphs }
    // 某一段是猜出来的（去附加符、单字母、拼了几个词干），整个词也算猜测
    const guesses = slots.map((sl, k) => sl.cands[choice[k]]?.guess).filter(Boolean)
    if (guesses.length) out.guess = guesses.includes('fold') ? 'fold' : 'split'
    return out
  }
  const first = slots.map(() => 0)
  const out = [build(first)]
  for (let n = 0; n < slots.length && out.length < MAX_SPLITS; n++)
    for (let k = 1; k < slots[n].cands.length && out.length < MAX_SPLITS; k++) {
      const choice = [...first]
      choice[n] = k
      out.push(build(choice))
    }
  return out
}

/**
 * 一个表层词的候选分析，按优先级排序、去重：
 * 确认过的 → 词里写了边界就按边界切 → 通用切分（整词、词缀、复合、构形推出的形式、词首音变、去附加符都在里面按代价排）。
 * hint：本句译文切好的片段，几种切法里词条释义对得上译文的排前面。
 */
export function analyzeToken(
  idx: GlossIndex,
  surface: string,
  boundaries: string[],
  hint?: string[]
): Analysis[] {
  const out: Analysis[] = []
  const seen = new Set<string>()
  const add = (a: Analysis): void => {
    const k = key(a)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(a)
    }
  }
  for (const a of idx.confirmed.get(surface) ?? []) add(a)
  surface = surface.normalize('NFC')
  const bset = boundarySet(boundaries)
  // 用户已在词里写了边界：按边界切，每段各自找，不猜整词
  if (bset.some((b) => surface.includes(b)))
    for (const a of splitAt(idx, surface, bset, hint)) add(a)
  const plain = norm(surface)
  for (const seg of segmentWord(idx.source, plain, { requireStem: true, hint }))
    add(toAnalysis(seg))
  // 一个词条几个义项：整词对上它时每个义项各给一条候选，语料里挑得出是哪个意思
  for (const a of [...out]) {
    if (a.morphs.length !== 1 || !a.lexemeId) continue
    const l = idx.lexemeById.get(a.lexemeId)
    if (!l || l.senses.length < 2) continue
    const base = a.morphs[0]
    for (let i = 1; i < l.senses.length; i++) {
      const g = senseGloss(l, i, idx.glossLangs)
      if (!g || g === base.gloss) continue
      add({ ...a, morphs: [{ ...base, gloss: g }] })
    }
  }
  // 语料里也写了几个异写（`Degnes/Degnant`）：整串认不出时逐个异写去认
  if (!out.length) {
    const alts = variants(surface)
    if (alts.length > 1)
      for (const alt of alts) {
        for (const a of analyzeToken(idx, alt, boundaries, hint)) add(a)
        if (out.length) break
      }
  }
  return out.slice(0, 12)
}

/**
 * 词典里带空格的形式（ar mae 这种限定词 + 名词分开写的屈折形）：
 * 连着的几个词合起来对得上就并成一个词；用户已经确认过的词不并。
 */
export function mergePhrases(
  idx: GlossIndex,
  words: string[],
  isConfirmed: (word: string) => boolean = () => false
): string[] {
  if (idx.maxPhrase < 2) return words
  const out: string[] = []
  for (let i = 0; i < words.length;) {
    let take = 1
    for (let n = Math.min(idx.maxPhrase, words.length - i); n >= 2; n--) {
      const span = words.slice(i, i + n)
      if (span.some(isConfirmed)) continue
      const k = norm(span.join(' '))
      if (idx.phrases.has(k) || idx.phrases.has(foldDiacritics(k))) {
        take = n
        break
      }
    }
    out.push(words.slice(i, i + take).join(' '))
    i += take
  }
  return out
}

/** 分析整句：默认只重算未确认的词；保留手工分析 */
export function analyzeSentence(
  project: Project,
  sentence: Sentence,
  opts: { force?: boolean } = {}
): Sentence {
  const idx = glossIndexFor(project, sentence.languageId)
  const tr = Object.values(sentence.translation ?? {}).join('；')
  const hint = tr.trim() ? piecesOf(tr) : undefined
  const old = new Map(sentence.tokens.map((t) => [t.surface, t]))
  const words = mergePhrases(
    idx,
    tokenize(sentence.text, {
      mode: project.settings.tokenizer,
      pattern: project.settings.tokenizerPattern,
      letters: idx.wordChars + (project.settings.tokenizerLetters ?? '')
    }),
    (w) => !!old.get(w)?.confirmed && !opts.force
  )
  const tokens: Token[] = words.map((w) => {
    const prev = old.get(w)
    if (prev && prev.confirmed && !opts.force) return { ...prev, analyses: [...prev.analyses] }
    const analyses = analyzeToken(idx, w, project.settings.morphemeBoundaries, hint)
    if (prev && !opts.force && prev.analyses[prev.chosen]) {
      const k = key(prev.analyses[prev.chosen])
      const i = analyses.findIndex((a) => key(a) === k)
      if (i >= 0) return { surface: w, analyses, chosen: i, confirmed: prev.confirmed }
    }
    return { surface: w, analyses, chosen: 0, confirmed: false }
  })
  sentence.tokens = tokens
  // 隔开写的词（`ma…gò`）：段跟段之间隔着几个词，挨个挂上同一个词条
  const entries = discontinuousEntries(project, sentence.languageId)
  if (entries.length) {
    const taken = (i: number): boolean => tokens[i].confirmed && !opts.force
    for (const hit of matchDiscontinuous(entries, tokens, taken)) {
      const gloss = lexemeGloss(hit.lexeme, idx.glossLangs)
      hit.positions.forEach((at, i) => {
        const tk = tokens[at]
        const a: Analysis = {
          lexemeId: hit.lexeme.id,
          slot: null,
          part: { i, n: hit.positions.length },
          morphs: [{ form: tk.surface, gloss, morphemeId: null, lexemeId: hit.lexeme.id }]
        }
        const already = tk.analyses.findIndex((x) => key(x) === key(a))
        if (already >= 0) tk.analyses.splice(already, 1)
        tk.analyses = [a, ...tk.analyses].slice(0, 12)
        tk.chosen = 0
      })
    }
  }
  return sentence
}

export function coverage(s: Sentence): { total: number; resolved: number; confirmed: number } {
  const total = s.tokens.length
  // 猜出来的分析（去附加符、拆词）确认之前不算认出
  const resolved = s.tokens.filter((t) => {
    const a = t.analyses[t.chosen]
    return a && (t.confirmed || !a.guess) && !a.morphs.some((m) => m.gloss === '?')
  }).length
  const confirmed = s.tokens.filter((t) => t.confirmed).length
  return { total, resolved, confirmed }
}

// ───────────────────────── 渲染与导出 ─────────────────────────

export interface Interlinear {
  words: { surface: string; morphs: string; gloss: string; resolved: boolean }[]
  translation: string
  extra: { label: string; text: string }[]
  /** 自定义文字行（每套文字一行） */
  scripts: { name: string; text: string; scriptId: Id }[]
}

/** 语素 id → 类型；整批导出时每个语素只查一次（项目一改就重建） */
let typeCache = new WeakMap<Project, { stamp: string; types: Map<Id, string> }>()
export function clearGlossCaches(): void {
  typeCache = new WeakMap()
  indexCache = new WeakMap()
}
function morphemeType(project: Project, id: Id): string | undefined {
  const stamp = `${project.meta.updatedAt}|${project.morphemes.length}`
  let c = typeCache.get(project)
  if (!c || c.stamp !== stamp) {
    c = { stamp, types: new Map(project.morphemes.map((m) => [m.id, m.type])) }
    typeCache.set(project, c)
  }
  return c.types.get(id)
}

/** 两段之间写什么：用户在切分里写了什么就照写，没写才按语素类型定（附着词用 =） */
export function morphJoiner(project: Project, a: Analysis, i: number): string {
  const m = a.morphs[i]
  if (m.sep === '-' || m.sep === '=') return m.sep
  return m.morphemeId && morphemeType(project, m.morphemeId) === 'clitic' ? '=' : '-'
}

export function interlinear(project: Project, s: Sentence, glossLang?: string): Interlinear {
  const words = s.tokens.map((t) => {
    const a = t.analyses[t.chosen]
    if (!a) return { surface: t.surface, morphs: t.surface, gloss: '?', resolved: false }
    let morphs = ''
    let gloss = ''
    a.morphs.forEach((m, i) => {
      const j = i === 0 ? '' : morphJoiner(project, a, i)
      morphs += j + m.form
      gloss += j + m.gloss
    })
    return { surface: t.surface, morphs, gloss, resolved: !a.morphs.some((m) => m.gloss === '?') }
  })
  const langs = glossLang
    ? [glossLang, ...project.settings.glossLanguages]
    : project.settings.glossLanguages
  const translation =
    langs.map((g) => s.translation[g]).find(Boolean) ??
    Object.values(s.translation).find(Boolean) ??
    ''
  const lang = project.languages.find((l) => l.id === s.languageId)
  const scripts = lang
    ? lang.scripts
        .map((sc) => ({
          name: sc.name,
          scriptId: sc.id,
          text: sentenceScriptText(project, lang, sc, s)
        }))
        .filter((x) => x.text)
    : []
  return { words, translation, extra: s.extraLines, scripts }
}

function pad(s: string, n: number): string {
  const w = Array.from(s).reduce((a, c) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0)
  return s + ' '.repeat(Math.max(0, n - w))
}

export function toLeipzig(il: Interlinear): string {
  const widths = il.words.map(
    (w) =>
      Math.max(
        ...[w.morphs, w.gloss].map((x) =>
          Array.from(x).reduce((a, c) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0)
        )
      ) + 2
  )
  const line1 = il.words
    .map((w, i) => pad(w.morphs, widths[i]))
    .join('')
    .trimEnd()
  const line2 = il.words
    .map((w, i) => pad(w.gloss, widths[i]))
    .join('')
    .trimEnd()
  const lines = [...il.scripts.map((x) => x.text), line1, line2]
  for (const e of il.extra) lines.push(`${e.label ? e.label + ': ' : ''}${e.text}`)
  lines.push(`‘${il.translation}’`)
  return lines.join('\n')
}

export function toMarkdown(il: Interlinear): string {
  const head = '| ' + il.words.map((w) => w.morphs).join(' | ') + ' |'
  const sep = '|' + il.words.map(() => ' --- ').join('|') + '|'
  const gl = '| ' + il.words.map((w) => w.gloss).join(' | ') + ' |'
  return [...il.scripts.map((x) => x.text + '  '), head, sep, gl, '', `‘${il.translation}’`].join(
    '\n'
  )
}

export function toHtml(il: Interlinear): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const words = il.words
    .map(
      (w) =>
        `<span class="gl__w"><span class="gl__m">${esc(w.morphs)}</span><span class="gl__g">${esc(w.gloss)}</span></span>`
    )
    .join('')
  const scr = il.scripts.map((x) => `<div class="gloss__script">${esc(x.text)}</div>`).join('')
  return `<div class="gloss">${scr}<div class="gloss__row">${words}</div><div class="gloss__tr">${esc(il.translation)}</div></div>`
}

export function toLatex(il: Interlinear): string {
  const esc = (s: string): string => s.replace(/([&%$#_{}])/g, '\\$1')
  return [
    '\\begin{exe}',
    '\\ex',
    ...il.scripts.map((x) => esc(x.text) + ' \\\\'),
    `\\gll ${il.words.map((w) => esc(w.morphs)).join(' ')} \\\\`,
    `${il.words.map((w) => esc(w.gloss)).join(' ')} \\\\`,
    `\\glt ‘${esc(il.translation)}’`,
    '\\end{exe}'
  ].join('\n')
}

/**
 * 自定义模板：{{text}} {{translation}} {{source}} {{morphs}} {{gloss}}，
 * 逐词块 {{#tokens}}…{{/tokens}} 内可用 {{surface}} {{morphs}} {{gloss}} {{sep}}（非首词为一个空格）。
 */
export function renderTemplate(template: string, il: Interlinear, s: Sentence): string {
  const fill = (tpl: string, vars: Record<string, string>): string =>
    tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '')
  const tokensBlock = template.replace(
    /\{\{#tokens\}\}([\s\S]*?)\{\{\/tokens\}\}/g,
    (_m, inner: string) =>
      il.words
        .map((w, i) =>
          fill(inner, { surface: w.surface, morphs: w.morphs, gloss: w.gloss, sep: i ? ' ' : '' })
        )
        .join('')
  )
  return fill(tokensBlock, {
    text: s.text,
    translation: il.translation,
    source: s.source,
    morphs: il.words.map((w) => w.morphs).join(' '),
    gloss: il.words.map((w) => w.gloss).join(' '),
    script: il.scripts.map((x) => x.text).join('\n')
  })
}

// ───────────────────────── 统计 ─────────────────────────

export function corpusStats(
  project: Project,
  languageId: Id
): { frequency: { surface: string; n: number }[]; unresolved: string[]; lexemeCoverage: number } {
  const freq = new Map<string, number>()
  const unresolved = new Set<string>()
  const usedLexemes = new Set<Id>()
  for (const s of project.sentences) {
    if (s.languageId !== languageId) continue
    for (const t of s.tokens) {
      freq.set(t.surface, (freq.get(t.surface) ?? 0) + 1)
      const a = t.analyses[t.chosen]
      if (!a || a.morphs.some((m) => m.gloss === '?')) unresolved.add(t.surface)
      if (a?.lexemeId) usedLexemes.add(a.lexemeId)
    }
  }
  const total = project.lexemes.filter((l) => l.languageId === languageId).length
  return {
    frequency: [...freq.entries()]
      .map(([surface, n]) => ({ surface, n }))
      .sort((a, b) => b.n - a.n),
    unresolved: [...unresolved],
    lexemeCoverage: total ? usedLexemes.size / total : 0
  }
}

/** 莱比锡标准缩写（常用子集），供一键填入 */
export const LEIPZIG: { abbr: string; en: string; zh: string }[] = [
  ['1', 'first person', '第一人称'],
  ['2', 'second person', '第二人称'],
  ['3', 'third person', '第三人称'],
  ['A', 'agent-like argument', '施事论元'],
  ['ABL', 'ablative', '夺格'],
  ['ABS', 'absolutive', '通格'],
  ['ACC', 'accusative', '宾格'],
  ['ADJ', 'adjective', '形容词'],
  ['ADV', 'adverb(ial)', '副词'],
  ['AGR', 'agreement', '一致'],
  ['ALL', 'allative', '向格'],
  ['ANTIP', 'antipassive', '反被动'],
  ['APPL', 'applicative', '施用'],
  ['ART', 'article', '冠词'],
  ['AUX', 'auxiliary', '助动词'],
  ['BEN', 'benefactive', '受益格'],
  ['CAUS', 'causative', '使役'],
  ['CLF', 'classifier', '量词'],
  ['COM', 'comitative', '伴随格'],
  ['COMP', 'complementizer', '补语标记'],
  ['COMPL', 'completive', '完结体'],
  ['COND', 'conditional', '条件'],
  ['COP', 'copula', '系词'],
  ['CVB', 'converb', '副动词'],
  ['DAT', 'dative', '与格'],
  ['DECL', 'declarative', '陈述'],
  ['DEF', 'definite', '定指'],
  ['DEM', 'demonstrative', '指示词'],
  ['DET', 'determiner', '限定词'],
  ['DIST', 'distal', '远指'],
  ['DISTR', 'distributive', '分配'],
  ['DU', 'dual', '双数'],
  ['DUR', 'durative', '持续'],
  ['ERG', 'ergative', '作格'],
  ['EXCL', 'exclusive', '排除式'],
  ['F', 'feminine', '阴性'],
  ['FOC', 'focus', '焦点'],
  ['FUT', 'future', '将来'],
  ['GEN', 'genitive', '属格'],
  ['IMP', 'imperative', '祈使'],
  ['INCL', 'inclusive', '包括式'],
  ['IND', 'indicative', '直陈'],
  ['INDF', 'indefinite', '不定指'],
  ['INF', 'infinitive', '不定式'],
  ['INS', 'instrumental', '工具格'],
  ['INTR', 'intransitive', '不及物'],
  ['IPFV', 'imperfective', '未完成体'],
  ['IRR', 'irrealis', '非现实'],
  ['LOC', 'locative', '位格'],
  ['M', 'masculine', '阳性'],
  ['N', 'neuter', '中性'],
  ['NEG', 'negation', '否定'],
  ['NMLZ', 'nominalizer', '名物化'],
  ['NOM', 'nominative', '主格'],
  ['OBJ', 'object', '宾语'],
  ['OBL', 'oblique', '斜格'],
  ['P', 'patient-like argument', '受事论元'],
  ['PASS', 'passive', '被动'],
  ['PFV', 'perfective', '完成体'],
  ['PL', 'plural', '复数'],
  ['POSS', 'possessive', '领属'],
  ['PRED', 'predicative', '谓语'],
  ['PRF', 'perfect', '完成时'],
  ['PRS', 'present', '现在'],
  ['PROG', 'progressive', '进行'],
  ['PROH', 'prohibitive', '禁止'],
  ['PROX', 'proximal', '近指'],
  ['PST', 'past', '过去'],
  ['PTCP', 'participle', '分词'],
  ['PURP', 'purposive', '目的'],
  ['Q', 'question particle', '疑问'],
  ['QUOT', 'quotative', '引语'],
  ['RECP', 'reciprocal', '相互'],
  ['REFL', 'reflexive', '反身'],
  ['REL', 'relative', '关系'],
  ['RES', 'resultative', '结果'],
  ['S', 'single argument', '单论元'],
  ['SBJ', 'subject', '主语'],
  ['SBJV', 'subjunctive', '虚拟'],
  ['SG', 'singular', '单数'],
  ['TOP', 'topic', '话题'],
  ['TR', 'transitive', '及物'],
  ['VOC', 'vocative', '呼格']
].map(([abbr, en, zh]) => ({ abbr, en, zh }))
