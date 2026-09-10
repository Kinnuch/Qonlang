/**
 * 自动 gloss：分词 → 反向索引查询（已确认分析 / 词头 / 词干 / 屈折形 / 语素）→ 词缀剥离 → 候选排序。
 * 只出草稿，用户逐词确认；确认过的分析成为最高优先级候选。
 */
import type {
  Analysis,
  Id,
  Lexeme,
  Morpheme,
  Project,
  Sentence,
  Token,
  TokenizerMode
} from '$lib/core/model'
import { paradigmFor, paradigmSlots } from '../morph'
import { sentenceScript } from '$lib/script/render'

export interface GlossIndex {
  lemma: Map<string, Lexeme[]>
  stems: Map<string, Lexeme[]>
  forms: Map<string, { lexeme: Lexeme; slot: string; abbr: string }[]>
  morphemes: Map<string, Morpheme[]>
  prefixes: { form: string; morpheme: Morpheme }[]
  suffixes: { form: string; morpheme: Morpheme }[]
  confirmed: Map<string, Analysis[]>
  glossLangs: string[]
}

const PUNCT =
  /^[\s.,;:!?…“”"'()[\]«»‹›—–「」『』，。！？；：、]+|[\s.,;:!?…“”"'()[\]«»‹›—–「」『』，。！？；：、]+$/gu

export interface TokenizeOptions {
  mode?: TokenizerMode
  /** custom 模式的分隔符正则；写错了就退回按空白 */
  pattern?: string
}

/**
 * 把例句切成词。默认按空白切；不用空格的表记可以选逐字，
 * 或者自己给一个分隔符正则（见「设置 → 项目 → 分词方式」）。
 */
export function tokenize(text: string, opts: TokenizeOptions = {}): string[] {
  const clean = (t: string): string => t.replace(PUNCT, '')
  if (opts.mode === 'character')
    return Array.from(text)
      .map(clean)
      .filter((c) => c.trim().length > 0)
  if (opts.mode === 'custom' && opts.pattern?.trim()) {
    try {
      const re = new RegExp(opts.pattern, 'u')
      return text.split(re).map(clean).filter(Boolean)
    } catch {
      // 正则写错了当没设置
    }
  }
  return text.split(/\s+/).map(clean).filter(Boolean)
}

const strip = (s: string): string => s.replace(/^[-=]+|[-=]+$/g, '')
/** 去掉附加符（é → e）：语料里的重音标记与词典未必一致 */
export const foldDiacritics = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
/** 索引键：去首尾边界符、NFC、小写 */
const norm = (s: string): string => strip(s).normalize('NFC').toLowerCase()

/** 词位的简短 gloss：第一义项的第一段（按 ; ， 。 , 切） */
export function lexemeGloss(l: Lexeme, glossLangs: string[]): string {
  for (const g of glossLangs) {
    const d = l.senses[0]?.definition[g]
    if (d) return d.split(/[;；,，。.]/)[0].trim() || d.trim()
  }
  const any = Object.values(l.senses[0]?.definition ?? {}).find(Boolean)
  return any ? any.split(/[;；,，。.]/)[0].trim() : l.lemma
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

export function buildIndex(project: Project, languageId: Id): GlossIndex {
  const glossLangs = project.settings.glossLanguages
  const idx: GlossIndex = {
    lemma: new Map(),
    stems: new Map(),
    forms: new Map(),
    morphemes: new Map(),
    prefixes: [],
    suffixes: [],
    confirmed: new Map(),
    glossLangs
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
    for (const k of formKeys(l.lemma, boundaries, prefixForms)) push(idx.lemma, k, l)
    for (const st of Object.values(l.stems))
      for (const k of formKeys(st, boundaries, prefixForms)) push(idx.stems, k, l)
    const para = paradigmFor(project, l)
    const abbrs = new Map<string, string>()
    if (para)
      for (const s of paradigmSlots(para, project.categories, glossLangs))
        abbrs.set(s.label, s.abbr)
    for (const [slot, f] of Object.entries(l.forms)) {
      for (const v of f.surface.split(/[,，;；/]\s*/)) {
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
  // 长词缀优先
  idx.suffixes.sort((a, b) => b.form.length - a.form.length)
  idx.prefixes.sort((a, b) => b.form.length - a.form.length)
  for (const s of project.sentences) {
    if (s.languageId !== languageId) continue
    for (const tk of s.tokens) {
      if (!tk.confirmed) continue
      const a = tk.analyses[tk.chosen]
      if (a) push(idx.confirmed, tk.surface, a)
    }
  }
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

/** 词缀剥离：最多剥 depth 层前后缀，剩余部分必须能整词匹配 */
function stripAffixes(idx: GlossIndex, w: string, depth: number): Analysis[] {
  const base = wholeWord(idx, w)
  if (depth === 0) return base
  const out = [...base]
  for (const s of idx.suffixes) {
    if (w.length > s.form.length && w.endsWith(s.form)) {
      const rest = w.slice(0, w.length - s.form.length)
      for (const inner of stripAffixes(idx, rest, depth - 1)) {
        out.push({
          ...inner,
          morphs: [
            ...inner.morphs,
            {
              form: s.form,
              gloss: morphemeGloss(s.morpheme, idx.glossLangs),
              morphemeId: s.morpheme.id
            }
          ]
        })
      }
    }
  }
  for (const p of idx.prefixes) {
    if (w.length > p.form.length && w.startsWith(p.form)) {
      const rest = w.slice(p.form.length)
      for (const inner of stripAffixes(idx, rest, depth - 1)) {
        out.push({
          ...inner,
          morphs: [
            {
              form: p.form,
              gloss: morphemeGloss(p.morpheme, idx.glossLangs),
              morphemeId: p.morpheme.id
            },
            ...inner.morphs
          ]
        })
      }
    }
  }
  return out
}

/** 一个表层词的候选分析，按优先级排序、去重 */
export function analyzeToken(idx: GlossIndex, surface: string, boundaries: string[]): Analysis[] {
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
  // 用户已在词里写了边界：按边界切，每段整词匹配，不猜
  const bset = boundaries.filter((b) => b && b !== ' ')
  const hasBoundary = bset.some((b) => surface.includes(b))
  if (hasBoundary) {
    const re = new RegExp(`[${bset.map((b) => b.replace(/[\\\]^-]/g, '\\$&')).join('')}]`)
    const parts = surface.split(re).filter(Boolean)
    const morphs: Analysis['morphs'] = []
    let lexemeId: Id | null = null
    for (const p of parts) {
      const cands = wholeWord(idx, p.toLowerCase())
      const c = cands[0]
      if (c) {
        morphs.push(...c.morphs)
        if (!lexemeId && c.lexemeId) lexemeId = c.lexemeId
      } else morphs.push({ form: p, gloss: '?', morphemeId: null })
    }
    add({ lexemeId, slot: null, morphs })
  }
  const plain = norm(surface)
  const cands = stripAffixes(idx, plain, 2)
  // 排序：先候选来源顺序（已确认 > 词头/屈折形/词干/语素 > 剥离），再语素少者优先
  cands.sort((a, b) => a.morphs.length - b.morphs.length)
  for (const c of cands) add(c)
  const lower = plain.toLowerCase()
  if (lower !== plain) for (const c of stripAffixes(idx, lower, 2)) add(c)
  return out.slice(0, 12)
}

/** 分析整句：默认只重算未确认的词；保留手工分析 */
export function analyzeSentence(
  project: Project,
  sentence: Sentence,
  opts: { force?: boolean } = {}
): Sentence {
  const idx = buildIndex(project, sentence.languageId)
  const words = tokenize(sentence.text, {
    mode: project.settings.tokenizer,
    pattern: project.settings.tokenizerPattern
  })
  const old = new Map(sentence.tokens.map((t) => [t.surface, t]))
  const tokens: Token[] = words.map((w) => {
    const prev = old.get(w)
    if (prev && prev.confirmed && !opts.force) return { ...prev, analyses: [...prev.analyses] }
    const analyses = analyzeToken(idx, w, project.settings.morphemeBoundaries)
    if (prev && !opts.force && prev.analyses[prev.chosen]) {
      const k = key(prev.analyses[prev.chosen])
      const i = analyses.findIndex((a) => key(a) === k)
      if (i >= 0) return { surface: w, analyses, chosen: i, confirmed: prev.confirmed }
    }
    return { surface: w, analyses, chosen: 0, confirmed: false }
  })
  sentence.tokens = tokens
  return sentence
}

export function coverage(s: Sentence): { total: number; resolved: number; confirmed: number } {
  const total = s.tokens.length
  const resolved = s.tokens.filter(
    (t) => t.analyses[t.chosen] && !t.analyses[t.chosen].morphs.some((m) => m.gloss === '?')
  ).length
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

function joiner(a: Analysis, i: number, project: Project): string {
  const m = a.morphs[i]
  const mo = m.morphemeId ? project.morphemes.find((x) => x.id === m.morphemeId) : null
  return mo?.type === 'clitic' ? '=' : '-'
}

export function interlinear(project: Project, s: Sentence, glossLang?: string): Interlinear {
  const words = s.tokens.map((t) => {
    const a = t.analyses[t.chosen]
    if (!a) return { surface: t.surface, morphs: t.surface, gloss: '?', resolved: false }
    let morphs = ''
    let gloss = ''
    a.morphs.forEach((m, i) => {
      const j = i === 0 ? '' : joiner(a, i, project)
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
        .map((sc) => ({ name: sc.name, scriptId: sc.id, text: sentenceScript(lang, sc, s) }))
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
