/**
 * 「作用于所有词」的构形（词首音变、连读变化这类）：分词时拿它反推。
 *
 * 规则一般改不回去（l 可能来自 l，也可能来自 lh），所以不去逆向规则：
 * 从词库里按开头、结尾各挑几个词喂给这条构形，比较前后，归纳出「词首 X 变成 Y」「词尾 X 变成 Y」的对照表；
 * 分词时把表层词开头的 Y 换回 X 再去查词（见 gloss/index.ts 的 demutate）。
 * 不靠元音表分组，任何文字都一样挑样本。
 */
import type { Id, Language, Lexeme, Paradigm, Project } from '$lib/core/model'
import { languageParseOptions } from '../phon'
import { parseRuleText, runRules } from '../sca'
import { generateForm, makeContext, paradigmSlots, resolveGenerator, stemOf } from './index'

export interface MutationPair {
  /** 原形这一头 */
  from: string
  /** 变化以后这一头 */
  to: string
}

export interface MutationTable {
  /** 槽位名（软音变）与缩写（LEN）：反推出来的 gloss 后面接缩写 */
  label: string
  abbr: string
  initial: MutationPair[]
  final: MutationPair[]
  /** 把这个槽位正着作用在一个形式上（反推出原形后拿它核对一遍） */
  apply: (form: string) => string
}

/** 只认开头、结尾这么长以内的变化；再长就不像是音变了 */
const MAX_EDGE = 3
/** 每种开头两个字、结尾两个字各挑几个词 */
const PER_GROUP = 2
const MAX_SAMPLES = 600

const norm = (s: string): string =>
  s
    .replace(/^[-=·]+|[-=·]+$/g, '')
    .normalize('NFC')
    .toLowerCase()

/** 按开头两个字、结尾两个字分组，各挑几个：各种词首、词尾都有样本 */
function pickSamples(lexemes: Lexeme[]): Lexeme[] {
  const head = new Map<string, Lexeme[]>()
  const tail = new Map<string, Lexeme[]>()
  const put = (m: Map<string, Lexeme[]>, k: string, l: Lexeme): void => {
    const list = m.get(k) ?? []
    if (list.length < PER_GROUP) m.set(k, [...list, l])
  }
  for (const l of lexemes) {
    const cps = Array.from(norm(l.lemma))
    put(head, cps.slice(0, 2).join(''), l)
    put(tail, cps.slice(-2).join(''), l)
  }
  return [...new Set([...[...head.values()].flat(), ...[...tail.values()].flat()])].slice(
    0,
    MAX_SAMPLES
  )
}

/**
 * 原形与变化后的形式比一比：共同的结尾越长，变化就在开头；共同的开头越长，变化就在结尾。
 * 两头都有变化、或者变化太长的，不算。
 */
export function edgeChange(
  before: string,
  after: string
): { side: 'initial' | 'final'; pair: MutationPair } | null {
  if (before === after) return null
  let s = 0
  while (
    s < before.length &&
    s < after.length &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++
  let p = 0
  while (p < before.length && p < after.length && before[p] === after[p]) p++
  // 原形整个都算进了共同部分（haur → chaur 的共同结尾是 haur）：退回一个字母，
  // 记成 h → ch 而不是「前面加 c」，免得反推时把所有 c 开头的词都当成音变
  if (s === before.length && s > 0) s--
  if (p === before.length && p > 0) p--
  const ini = { from: before.slice(0, before.length - s), to: after.slice(0, after.length - s) }
  const fin = { from: before.slice(p), to: after.slice(p) }
  const iniOk = s > 0 && ini.from.length <= MAX_EDGE && ini.to.length <= MAX_EDGE
  const finOk = p > 0 && fin.from.length <= MAX_EDGE && fin.to.length <= MAX_EDGE
  if (iniOk && (!finOk || ini.from.length + ini.to.length <= fin.from.length + fin.to.length))
    return { side: 'initial', pair: ini }
  if (finOk) return { side: 'final', pair: fin }
  return null
}

/** 这门语言要反推的构形：勾了「作用于所有词」、没限定语言或限定的就是它 */
function paradigmsFor(project: Project, languageId: Id): Paradigm[] {
  return project.paradigms.filter(
    (p) => p.appliesToAll && (!p.appliesToLanguageId || p.appliesToLanguageId === languageId)
  )
}

function fnv(s: string, h: number): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 缓存键：对照表只取决于这些东西——构形本身（连同继承的父构形）、用到的规则集与维度、
 * 语言的音类与多合字母、词库里这门语言的词头与词干，以及被 @ 引用的语素。
 */
function signature(
  project: Project,
  language: Language,
  paradigms: Paradigm[],
  lexemes: Lexeme[]
): string {
  const chain = new Map<Id, Paradigm>()
  const visit = (p: Paradigm | undefined, depth: number): void => {
    if (!p || chain.has(p.id) || depth > 8) return
    chain.set(p.id, p)
    if (p.inheritsFrom)
      visit(
        project.paradigms.find((x) => x.id === p.inheritsFrom),
        depth + 1
      )
  }
  for (const p of paradigms) visit(p, 0)
  const ruleSets = new Set<Id>()
  const dims = new Set<Id>()
  for (const p of chain.values()) {
    for (const d of p.dimensionIds) dims.add(d)
    for (const g of Object.values(p.generators)) {
      if (g.kind === 'pipeline')
        for (const st of g.steps) if (st.kind === 'sca' && st.ruleSetId) ruleSets.add(st.ruleSetId)
      if (g.kind === 'affix-sca' && g.ruleSetId) ruleSets.add(g.ruleSetId)
    }
  }
  const body = JSON.stringify([...chain.values()])
  let h = 2166136261
  for (const l of lexemes) h = fnv(`${l.lemma}${JSON.stringify(l.stems)}`, h)
  if (body.includes('@'))
    for (const m of project.morphemes)
      if (m.languageId === language.id)
        h = fnv(`${m.form}|${m.gloss}|${JSON.stringify(m.allomorphs)}`, h)
  return JSON.stringify([
    language.id,
    h,
    body,
    project.ruleSets.filter((r) => ruleSets.has(r.id)).map((r) => r.text),
    project.categories.filter((c) => dims.has(c.id)),
    languageParseOptions(language, project)
  ])
}

const cache = new Map<string, MutationTable[]>()

/** 这门语言所有「作用于所有词」的构形槽位各自的对照表 */
export function mutationTables(project: Project, languageId: Id): MutationTable[] {
  const paradigms = paradigmsFor(project, languageId)
  if (!paradigms.length) return []
  const language = project.languages.find((l) => l.id === languageId)
  if (!language) return []
  const lexemes = project.lexemes.filter((l) => l.languageId === languageId && l.lemma.trim())
  const key = signature(project, language, paradigms, lexemes)
  const hit = cache.get(key)
  if (hit) return hit
  const samples = pickSamples(lexemes)
  const ctx = makeContext(project, language)
  // 空规则只做多合字母的来回替换：词头先过一遍，写法上的差异（ch 与 x）不算成音变
  const spelled = parseRuleText('', languageParseOptions(language, project))
  const glossLangs = project.settings.glossLanguages
  const tables: MutationTable[] = []
  for (const p of paradigms) {
    for (const slot of paradigmSlots(p, project.categories, glossLangs)) {
      const gen = resolveGenerator(p, slot.key, project.paradigms)
      if (gen.kind === 'none' || gen.kind === 'table') continue
      const found = {
        initial: new Map<string, MutationPair>(),
        final: new Map<string, MutationPair>()
      }
      for (const l of samples) {
        const out = generateForm(ctx, l, p, slot)
        if (!out) continue
        const base = runRules(spelled, stemOf(l, gen.stem).value, { trace: false }).output
        const change = edgeChange(norm(base), norm(out.surface))
        if (change) found[change.side].set(`${change.pair.from}>${change.pair.to}`, change.pair)
      }
      // 每一对都会试；变化后更长的排前面，同一个词反推出几种原形时它们的读法排在前
      const sorted = (m: Map<string, MutationPair>): MutationPair[] =>
        [...m.values()].sort((a, b) => b.to.length - a.to.length)
      const para = p
      const def = slot
      tables.push({
        label: slot.label,
        abbr: slot.abbr,
        initial: sorted(found.initial),
        final: sorted(found.final),
        // 拿一个只有词头的临时词条正着推：屈折形、词干也一样能核对
        apply: (form) =>
          generateForm(
            ctx,
            { lemma: form, stems: {}, paradigmVariantId: null } as unknown as Lexeme,
            para,
            def
          )?.surface ?? form
      })
    }
  }
  if (cache.size > 16) cache.clear()
  cache.set(key, tables)
  return tables
}
