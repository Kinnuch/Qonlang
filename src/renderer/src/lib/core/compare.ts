/**
 * 词关系图的「对比」：找出跟中心词同一个词根来源的词，逐项对比。
 *
 * 词根按词源往上追：词条的来源（词条、语素、自定义来源拆开的每个成分）一层层找上去，都算这个词的词根来源；
 * 前缀、后缀这类词缀不算词根，只算「构成」。中心词自己也算它派生词的词根。
 * 同一个词根下有两个以上的词（不算词根本身那个词）就能对比：
 * - 不同语言的：从来源到现在各自经过了哪些音变（按音变规则集里阶段绑定的语言重新推一遍）、语音怎么对应、意思怎么变；
 * - 同一语言的：各自加了哪些前后缀或别的成分、意思有什么不同。
 * 都是纯函数，不碰界面，不写死任何语言。
 */
import type { Etymology, Id, Lexeme, LocalizedText, Morpheme, Project } from './model'
import { findLanguageByName, morphemeLabel, splitSourceForm } from './etymology'
import { languageParseOptions } from '$lib/engine/phon'
import { parseRuleText, revertReplacements, runRules, type RuleProgram } from '$lib/engine/sca'

export type RootKind = 'lexeme' | 'morpheme' | 'external'

export interface RootRef {
  /** `l:词条 id`、`m:语素 id`、`x:语言名|成分`（项目里对不上的自定义来源成分） */
  key: string
  kind: RootKind
  id?: Id
  label: string
  languageId: Id | null
  languageName: string
  gloss: string
  /** 语素的类型（词缀不算词根，但会出现在「构成」里） */
  morphemeType?: Morpheme['type']
}

export interface CompareGroup {
  root: RootRef
  /** 离中心词隔了几层（中心词自己是 0） */
  depth: number
  /** 同一词根下的词（不含词根本身那个词条），中心词排第一 */
  lexemes: Lexeme[]
  /** 一共几个（lexemes 最多列 MAX_MEMBERS 个） */
  total: number
  languageCount: number
}

/** 词缀类的语素：不算词根 */
const AFFIX_TYPES = new Set<Morpheme['type']>([
  'prefix',
  'suffix',
  'infix',
  'circumfix',
  'clitic',
  'pattern'
])
const MAX_DEPTH = 8
export const MAX_MEMBERS = 40
const MAX_GROUPS = 12

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const strip = (s: string): string => s.replace(/^[-=*·]+|[-=*·]+$/g, '').trim()

function textOf(t: LocalizedText | undefined, langs: string[]): string {
  if (!t) return ''
  for (const g of langs) if (t[g]?.trim()) return t[g].trim()
  return (
    Object.values(t)
      .find((v) => v?.trim())
      ?.trim() ?? ''
  )
}

export interface CompareContext {
  project: Project
  langs: string[]
  refs: Map<string, RootRef>
  lexemeById: Map<Id, Lexeme>
  morphemeById: Map<Id, Morpheme>
  /** 语言 id（或 * 表示所有语言）→ 折叠后的写法 → 词条或语素 */
  forms: Map<string, Map<string, { kind: 'lexeme' | 'morpheme'; id: Id }>>
  langByName: Map<string, Id | null>
  ancestors: Map<string, Map<string, number>>
}

export function compareContext(project: Project, langs: string[]): CompareContext {
  const forms = new Map<string, Map<string, { kind: 'lexeme' | 'morpheme'; id: Id }>>()
  const put = (lang: string, form: string, v: { kind: 'lexeme' | 'morpheme'; id: Id }): void => {
    const k = fold(strip(form))
    if (!k) return
    for (const bucket of [lang, '*']) {
      let m = forms.get(bucket)
      if (!m) forms.set(bucket, (m = new Map()))
      if (!m.has(k)) m.set(k, v)
    }
  }
  for (const l of project.lexemes) put(l.languageId, l.lemma, { kind: 'lexeme', id: l.id })
  for (const m of project.morphemes) put(m.languageId, m.form, { kind: 'morpheme', id: m.id })
  return {
    project,
    langs,
    refs: new Map(),
    lexemeById: new Map(project.lexemes.map((l) => [l.id, l])),
    morphemeById: new Map(project.morphemes.map((m) => [m.id, m])),
    forms,
    langByName: new Map(),
    ancestors: new Map()
  }
}

function languageIdByName(ctx: CompareContext, name: string): Id | null {
  const k = name.trim().toLowerCase()
  if (!k) return null
  if (!ctx.langByName.has(k))
    ctx.langByName.set(k, findLanguageByName(ctx.project, name)?.id ?? null)
  return ctx.langByName.get(k) ?? null
}

function languageName(ctx: CompareContext, id: Id | null): string {
  return ctx.project.languages.find((l) => l.id === id)?.name ?? ''
}

export function lexemeRef(ctx: CompareContext, l: Lexeme): RootRef {
  const key = `l:${l.id}`
  let r = ctx.refs.get(key)
  if (!r) {
    r = {
      key,
      kind: 'lexeme',
      id: l.id,
      label: l.lemma,
      languageId: l.languageId,
      languageName: languageName(ctx, l.languageId),
      gloss: textOf(l.senses[0]?.definition, ctx.langs)
    }
    ctx.refs.set(key, r)
  }
  return r
}

function morphemeRef(ctx: CompareContext, m: Morpheme): RootRef {
  const key = `m:${m.id}`
  let r = ctx.refs.get(key)
  if (!r) {
    r = {
      key,
      kind: 'morpheme',
      id: m.id,
      label: morphemeLabel(m),
      languageId: m.languageId,
      languageName: languageName(ctx, m.languageId),
      gloss: m.gloss || textOf(m.meaning, ctx.langs),
      morphemeType: m.type
    }
    ctx.refs.set(key, r)
  }
  return r
}

/** 来源里的一项（自定义来源拆成几个成分）直接指向的东西；form 是这一项完整的来源形（音变从它推） */
export interface SourcePart {
  ref: RootRef
  /** 这一项所在的整个来源形（自定义来源拆开前的写法；词条、语素就是它自己的写法） */
  form: string
  languageId: Id | null
}

/** 一个词条或语素的来源，拆到成分：词条、语素直接给；自定义来源按项目里的语素边界拆开，逐个到那门语言里找 */
export function sourceParts(ctx: CompareContext, ety: Etymology): SourcePart[] {
  const out: SourcePart[] = []
  for (const s of ety.sources) {
    if (s.kind === 'lexeme') {
      const l = ctx.lexemeById.get(s.id)
      if (l) out.push({ ref: lexemeRef(ctx, l), form: l.lemma, languageId: l.languageId })
    } else if (s.kind === 'morpheme') {
      const m = ctx.morphemeById.get(s.id)
      if (m) out.push({ ref: morphemeRef(ctx, m), form: m.form, languageId: m.languageId })
    } else {
      const lid = languageIdByName(ctx, s.language)
      const pieces = splitSourceForm(ctx.project, s.form)
      const list = pieces.length ? pieces : [strip(s.form)]
      for (const piece of list) {
        if (!piece) continue
        const hit = ctx.forms.get(lid ?? '*')?.get(fold(strip(piece)))
        if (hit?.kind === 'lexeme') {
          const l = ctx.lexemeById.get(hit.id)!
          out.push({ ref: lexemeRef(ctx, l), form: s.form, languageId: lid })
        } else if (hit?.kind === 'morpheme') {
          const m = ctx.morphemeById.get(hit.id)!
          out.push({ ref: morphemeRef(ctx, m), form: s.form, languageId: lid })
        } else {
          const key = `x:${s.language.trim().toLowerCase()}|${fold(piece)}`
          let r = ctx.refs.get(key)
          if (!r) {
            r = {
              key,
              kind: 'external',
              label: piece,
              languageId: lid,
              languageName: s.language.trim(),
              gloss: list.length === 1 ? s.meaning : ''
            }
            ctx.refs.set(key, r)
          }
          out.push({ ref: r, form: s.form, languageId: lid })
        }
      }
    }
  }
  return out
}

/** 这一项算不算词根：词缀不算；只有一个字母的对不上的成分多半是词缀，也不算 */
export function isRootLike(ref: RootRef): boolean {
  if (ref.kind === 'morpheme') return !AFFIX_TYPES.has(ref.morphemeType!)
  if (ref.kind === 'external')
    return Array.from(strip(ref.label)).filter((c) => /\p{L}/u.test(c)).length >= 2
  return true
}

function etymologyOf(ctx: CompareContext, key: string): Etymology | null {
  if (key.startsWith('l:')) return ctx.lexemeById.get(key.slice(2))?.etymology ?? null
  if (key.startsWith('m:')) return ctx.morphemeById.get(key.slice(2))?.etymology ?? null
  return null
}

/** 词根来源（按层往上追，词缀不算；词源成环也只走一遍）：key → 隔了几层 */
export function ancestorsOf(ctx: CompareContext, key: string): Map<string, number> {
  const hit = ctx.ancestors.get(key)
  if (hit) return hit
  const out = new Map<string, number>()
  const queue: [string, number][] = [[key, 0]]
  const seen = new Set([key])
  while (queue.length) {
    const [k, depth] = queue.shift()!
    if (depth >= MAX_DEPTH) continue
    const ety = etymologyOf(ctx, k)
    if (!ety) continue
    for (const p of sourceParts(ctx, ety)) {
      if (!isRootLike(p.ref) || seen.has(p.ref.key)) continue
      seen.add(p.ref.key)
      out.set(p.ref.key, depth + 1)
      queue.push([p.ref.key, depth + 1])
    }
  }
  ctx.ancestors.set(key, out)
  return out
}

/** 跟中心词同一个词根来源的几组词：跨语言的排前面，其次离中心词近的、词少的（更具体） */
export function compareGroups(ctx: CompareContext, center: Lexeme): CompareGroup[] {
  const selfKey = `l:${center.id}`
  const roots = new Map<string, number>([[selfKey, 0], ...ancestorsOf(ctx, selfKey)])
  const all = ctx.project.lexemes.map((l) => ({ l, anc: ancestorsOf(ctx, `l:${l.id}`) }))
  const found: CompareGroup[] = []
  for (const [rk, depth] of roots) {
    const ref = rk === selfKey ? lexemeRef(ctx, center) : ctx.refs.get(rk)
    if (!ref) continue
    const members = all.filter((x) => x.l.id !== ref.id && x.anc.has(rk)).map((x) => x.l)
    if (rk !== selfKey && !members.some((m) => m.id === center.id)) continue
    if (members.length < 2) continue
    const ordered = [
      ...members.filter((m) => m.id === center.id),
      ...members
        .filter((m) => m.id !== center.id)
        .sort(
          (a, b) =>
            Number(a.languageId === center.languageId) -
              Number(b.languageId === center.languageId) || a.lemma.localeCompare(b.lemma)
        )
    ]
    found.push({
      root: ref,
      depth,
      lexemes: ordered.slice(0, MAX_MEMBERS),
      total: ordered.length,
      languageCount: new Set(ordered.map((m) => m.languageId)).size
    })
  }
  found.sort(
    (a, b) =>
      Number(b.languageCount > 1) - Number(a.languageCount > 1) ||
      a.depth - b.depth ||
      a.total - b.total
  )
  const seen = new Set<string>()
  const out: CompareGroup[] = []
  for (const g of found) {
    const sig = g.lexemes
      .filter((m) => m.id !== center.id)
      .map((m) => m.id)
      .sort()
      .join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(g)
    if (out.length >= MAX_GROUPS) break
  }
  return out
}

// ───────────────────────── 单个词：从词根到它的路径、构成 ─────────────────────────

export interface ChainStep {
  /** 这一步的来源（路径上的上一个节点） */
  from: SourcePart
  /** 这一步得到的词条或语素 */
  to: RootRef
  /** 这一步的词源类别（继承、派生、复合……） */
  type: string
}

export interface Component {
  ref: RootRef
  /** 在哪一步加进来的（路径上那个节点的写法） */
  at: string
}

export interface WordPath {
  steps: ChainStep[]
  /** 路径上各个词自己的来源里，除了通往词根的那一项以外的成分（前后缀、复合的另一半……） */
  components: Component[]
}

/** 从词根到这个词的路径（沿词源往回找最短的一条），以及一路上加进来的其他成分 */
export function wordPath(ctx: CompareContext, word: Lexeme, rootKey: string): WordPath {
  const start = `l:${word.id}`
  const prev = new Map<string, { part: SourcePart; child: string }>()
  const queue = [start]
  const seen = new Set([start])
  while (queue.length && !prev.has(rootKey)) {
    const k = queue.shift()!
    const ety = etymologyOf(ctx, k)
    if (!ety) continue
    for (const p of sourceParts(ctx, ety)) {
      if (seen.has(p.ref.key)) continue
      seen.add(p.ref.key)
      prev.set(p.ref.key, { part: p, child: k })
      if (p.ref.key === rootKey) break
      queue.push(p.ref.key)
    }
  }
  const steps: ChainStep[] = []
  const onPath = new Set<string>([rootKey])
  let cur = rootKey
  while (cur !== start && prev.has(cur)) {
    const { part, child } = prev.get(cur)!
    const to = child === start ? lexemeRef(ctx, word) : ctx.refs.get(child)!
    steps.push({ from: part, to, type: etymologyOf(ctx, child)?.type ?? '' })
    onPath.add(child)
    cur = child
  }
  const components: Component[] = []
  for (const s of steps) {
    const ety = etymologyOf(ctx, s.to.key)
    if (!ety) continue
    for (const p of sourceParts(ctx, ety)) {
      if (onPath.has(p.ref.key)) continue
      // 本身就是从同一个词根来的（比如同时记了祖语词条和祖语词根）：不算额外的成分
      if (ancestorsOf(ctx, p.ref.key).has(rootKey)) continue
      if (components.some((c) => c.ref.key === p.ref.key)) continue
      components.push({ ref: p.ref, at: s.to.label })
    }
  }
  return { steps, components }
}

// ───────────────────────── 音变：按规则集重新推一遍 ─────────────────────────

export interface AppliedRule {
  line: number
  rule: string
  stage: string
  before: string
  after: string
}

export interface SoundPath {
  ruleSetId: Id
  ruleSetName: string
  /** 喂给规则的形式（来源形去掉边界符号） */
  input: string
  output: string
  /** 推出来的跟词库里的写法一致 */
  matches: boolean
  stages: { name: string; form: string }[]
  rules: AppliedRule[]
}

/** 同一次对比里规则集只解析一次 */
export type ProgramCache = Map<Id, RuleProgram>

function programOf(project: Project, cache: ProgramCache, rsId: Id): RuleProgram | null {
  const hit = cache.get(rsId)
  if (hit) return hit
  const rs = project.ruleSets.find((r) => r.id === rsId)
  if (!rs) return null
  // 跟音变页一样：第一个绑定了语言的阶段所属语言的音类和多合字母作为基础
  const boundId = Object.values(rs.stageLanguages).find((id) => !!id)
  const base = project.languages.find((l) => l.id === boundId) ?? null
  const program = parseRuleText(rs.text, languageParseOptions(base, project))
  cache.set(rsId, program)
  return program
}

const looseForm = (s: string): string => fold(s.replace(/[-=*·+\sˈˌ]/g, ''))

/**
 * 从 fromLanguage 的形式推到 toLexeme 所在语言：找一个规则集，它有绑定到来源语言的阶段，
 * 后面又有绑定到这个词的语言的阶段；从来源阶段开始跑（来源阶段是第一个阶段时从头跑），
 * 在绑定到目标语言的几个阶段里挑推出来跟词库写法一样的那个（都不一样就取最后一个）。找不到规则集返回 null。
 */
export function soundPath(
  project: Project,
  cache: ProgramCache,
  fromLanguageId: Id,
  fromForm: string,
  toLexeme: Lexeme
): SoundPath | null {
  const input = splitSourceForm(project, fromForm).join('') || strip(fromForm)
  if (!input) return null
  for (const rs of project.ruleSets) {
    const program = programOf(project, cache, rs.id)
    if (!program) continue
    const markers = program.steps.filter((s) => s.kind === 'marker') as {
      name: string
      line: number
    }[]
    const iFrom = markers.findIndex((m) => rs.stageLanguages[m.name] === fromLanguageId)
    if (iFrom < 0) continue
    const targets = markers
      .map((m, i) => ({ m, i }))
      .filter((x) => x.i > iFrom && rs.stageLanguages[x.m.name] === toLexeme.languageId)
    if (!targets.length) continue
    let run
    try {
      run = runRules(program, input, {
        startAt: iFrom === 0 ? undefined : markers[iFrom].name,
        trace: true
      })
    } catch {
      continue
    }
    const formAt = (name: string): string => run.stages.find((s) => s.name === name)?.form ?? ''
    const want = looseForm(toLexeme.lemma)
    const chosen =
      targets.find((x) => looseForm(formAt(x.m.name)) === want) ?? targets[targets.length - 1]
    const stopLine = chosen.m.line
    const startLine = markers[iFrom].line
    const rawOf = new Map(
      program.steps.filter((s) => s.kind !== 'marker').map((s) => [s.line, s.raw.trim()])
    )
    const back = (x: string): string => revertReplacements(x, program.replacements)
    const output = formAt(chosen.m.name)
    return {
      ruleSetId: rs.id,
      ruleSetName: rs.name,
      input,
      output,
      matches: looseForm(output) === want,
      stages: run.stages.filter((s) => {
        const m = markers.find((x) => x.name === s.name)
        return !!m && m.line >= startLine && m.line <= stopLine
      }),
      rules: run.trace
        .filter((e) => e.line > (iFrom === 0 ? 0 : startLine) && e.line < stopLine)
        .map((e) => ({
          line: e.line,
          rule: rawOf.get(e.line) ?? `${e.target} > ${e.replacement}`,
          stage: e.stage,
          before: back(e.before),
          after: back(e.after)
        }))
    }
  }
  return null
}

/** 这个词在路径上第一次换语言的那一步（继承、借用）：从那一步的来源形推到这个词或它的上一代 */
export function soundPathOfWord(
  ctx: CompareContext,
  cache: ProgramCache,
  word: Lexeme,
  path: WordPath
): { path: SoundPath; via: string } | null {
  for (const s of path.steps) {
    const lid = s.from.languageId
    const target = s.to.kind === 'lexeme' ? ctx.lexemeById.get(s.to.id!) : undefined
    if (!lid || !target || lid === target.languageId) continue
    const p = soundPath(ctx.project, cache, lid, s.from.form, target)
    if (p) return { path: p, via: target.id === word.id ? '' : target.lemma }
  }
  return null
}

// ───────────────────────── 意思、语音对应 ─────────────────────────

/** 释义拆成小块（按标点、空格），对比时标出几个词共有的意思 */
export function meaningPieces(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[，,；;、。．./\s（）()「」“”"'：:！!？?]+/u)
        .map((x) => x.trim())
        .filter(Boolean)
    )
  ]
}

/** 两个写法按字母对齐（编辑距离回溯）：[a 的字母或空, b 的字母或空] */
export function alignForms(a: string, b: string): [string, string][] {
  const A = Array.from(a.normalize('NFC'))
  const B = Array.from(b.normalize('NFC'))
  const n = A.length
  const m = B.length
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(
        d[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1),
        d[i - 1][j] + 1,
        d[i][j - 1] + 1
      )
  const out: [string, string][] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1)) {
      out.push([A[i - 1], B[j - 1]])
      i--
      j--
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      out.push([A[i - 1], ''])
      i--
    } else {
      out.push(['', B[j - 1]])
      j--
    }
  }
  return out.reverse()
}

export interface Correspondence {
  /** 词根里的这个音（字母） */
  source: string
  /** 词 id → 在这个词里变成了什么（空串是脱落了；后面多出来的字母并进前一个） */
  reflex: Record<Id, string>
}

/** 词根形式跟各个词的形式逐音对齐，只留下有变化、或者几个词之间不一样的位置 */
export function correspondences(
  source: string,
  words: { id: Id; form: string }[]
): Correspondence[] {
  const src = Array.from(source.normalize('NFC'))
  if (!src.length || words.length === 0) return []
  const rows: Correspondence[] = src.map((c) => ({ source: c, reflex: {} }))
  for (const w of words) {
    let pos = -1
    const acc: string[] = src.map(() => '')
    let lead = ''
    for (const [s, t] of alignForms(source, w.form)) {
      if (s) {
        pos++
        acc[pos] = t
      } else if (pos < 0) lead += t
      else acc[pos] += t
    }
    if (lead) acc[0] = lead + acc[0]
    acc.forEach((x, k) => (rows[k].reflex[w.id] = x))
  }
  return rows.filter((r) => {
    const vals = words.map((w) => r.reflex[w.id])
    return vals.some((v) => v !== r.source) || new Set(vals).size > 1
  })
}
