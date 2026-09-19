/**
 * 形态引擎：范式槽位、生成器、推导与对账。
 * 生成器只做机械拼接 / 替换；语音层面的调整交给规则引擎（affix-sca）。
 */
import type {
  Allomorph,
  GrammaticalCategory,
  MorphStep,
  Id,
  Language,
  Lexeme,
  Morpheme,
  Paradigm,
  InflectedForm,
  Project,
  SlotBase,
  SlotGenerator,
  SlotPron
} from '$lib/core/model'
import { parseRuleText, runRules, stripStress, type RuleProgram, type WordStress } from '../sca'
import { lexemeStress, morphemeStress, posNames } from '$lib/core/stressInfo'
import { languageParseOptions, segment, spellingUnits } from '../phon'
import { transcribe } from '$lib/core/pronounce'
import { posParadigmId } from '$lib/core/pos'
import { activeValues, conditionVariants, resolveConditions } from './conditions'
import { activeValueIds, alloValues, valueLabel, valueMatch } from './allomorph'
import type { LayoutDim } from './layout'

export interface SlotDef {
  key: string
  values: { categoryId: Id; valueId: Id }[]
  /** 人类可读的槽位名（取值名用 . 连接），也是词位 forms 里的键 */
  label: string
  /** gloss 缩写（NOM.PL） */
  abbr: string
}

function pick(text: Record<string, string>, langs: string[]): string {
  for (const l of langs) if (text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}

import { slotKey, slotKeyDims, slotKeySubset } from '$lib/core/slotKeys'
export { slotKey, canonicalSlotKey, canonicalizeSlotKeys } from '$lib/core/slotKeys'

/**
 * 一个槽位键还原成槽位（取值按构形里维度的先后排，再按维度表的顺序）：
 * 键里有取值已经不在维度表里时返回 null
 */
export function slotFromKey(
  p: Paradigm,
  categories: GrammaticalCategory[],
  glossLangs: string[],
  key: string
): SlotDef | null {
  const catOf = new Map<Id, GrammaticalCategory>()
  for (const c of categories) for (const v of c.values) catOf.set(v.id, c)
  const values: { categoryId: Id; valueId: Id }[] = []
  for (const valueId of key.split('#')[0].split('|')) {
    const cat = catOf.get(valueId)
    if (!cat) return null
    values.push({ categoryId: cat.id, valueId })
  }
  if (!values.length) return null
  const rank = (cid: Id): number => {
    const i = p.dimensionIds.indexOf(cid)
    return i >= 0 ? i : p.dimensionIds.length + categories.findIndex((c) => c.id === cid)
  }
  const ordered = [...values].sort((a, b) => rank(a.categoryId) - rank(b.categoryId))
  const names = ordered.map((v) => {
    const cat = catOf.get(v.valueId)!
    const val = cat.values.find((x) => x.id === v.valueId)!
    return {
      name: pick(val.name, glossLangs) || val.abbr || '?',
      abbr: val.abbr || pick(val.name, glossLangs)
    }
  })
  return {
    key: slotKey(values),
    values: ordered,
    label: names.map((n) => n.name).join('.'),
    abbr: names.map((n) => n.abbr).join('.')
  }
}

/** 这个构形里维度笛卡尔积之外、还留着的槽位键：固定下来的，和写了生成器的 */
export function extraSlotKeys(p: Paradigm): string[] {
  const keys = new Set<string>(p.lockedSlots ?? [])
  for (const k of Object.keys(p.generators)) {
    const g = p.generators[k]
    if (g && g.kind !== 'none') keys.add(k.split('#')[0])
  }
  return [...keys]
}

/**
 * 维度笛卡尔积 → 槽位（已屏蔽的除外）。
 * 除了眼下这几个维度组出来的，固定下来的槽位和写了生成器的槽位（维度改过之后留下的、
 * 维度多一层的「时-体-人称」这种）也一直算数，排在后面
 */
export function paradigmSlots(
  p: Paradigm,
  categories: GrammaticalCategory[],
  glossLangs: string[],
  includeDisabled = false,
  /**
   * 简洁模式下：维度比眼下少一层的旧槽位不单独列出来（加了维度之后残留的「只有 ABC」那些）。
   * 它们的写法仍然算数——新的每一格按 effectiveGenerator 继承过去
   */
  hideSubsets = false
): SlotDef[] {
  const dims = p.dimensionIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is GrammaticalCategory => !!c)
  const extras = extraSlotKeys(p)
  if (!dims.length && !extras.length) return []
  let combos: { categoryId: Id; valueId: Id }[][] = dims.length ? [[]] : []
  for (const d of dims) {
    const next: { categoryId: Id; valueId: Id }[][] = []
    for (const c of combos)
      for (const v of d.values) next.push([...c, { categoryId: d.id, valueId: v.id }])
    combos = next
  }
  const out: SlotDef[] = []
  for (const values of combos) {
    const key = slotKey(values)
    if (!includeDisabled && p.disabledSlots.includes(key)) continue
    const names = values.map((v) => {
      const cat = dims.find((d) => d.id === v.categoryId)!
      const val = cat.values.find((x) => x.id === v.valueId)!
      return {
        name: pick(val.name, glossLangs) || val.abbr || '?',
        abbr: val.abbr || pick(val.name, glossLangs)
      }
    })
    out.push({
      key,
      values,
      label: names.map((n) => n.name).join('.'),
      abbr: names.map((n) => n.abbr).join('.')
    })
  }
  const seen = new Set(out.map((x) => x.key))
  const catOf = new Map<Id, Id>()
  if (hideSubsets) for (const c of categories) for (const v of c.values) catOf.set(v.id, c.id)
  const dimSet = new Set(p.dimensionIds)
  for (const key of extras) {
    if (seen.has(key)) continue
    if (!includeDisabled && p.disabledSlots.includes(key)) continue
    // 维度是眼下这几个维度的真子集：它只是回退用的写法，不单独占一格
    if (hideSubsets) {
      const kd = slotKeyDims(key, catOf)
      if (kd.length && kd.length < dimSet.size && kd.every((d) => dimSet.has(d))) continue
    }
    const def = slotFromKey(p, categories, glossLangs, key)
    if (!def) continue
    seen.add(def.key)
    out.push(def)
  }
  return out
}

/** 沿继承链找槽位的生成器 */
/** 变体生成器的键 */
export function variantKey(key: string, variantId?: Id | null): string {
  return variantId ? key + '#' + variantId : key
}

export function resolveGenerator(
  p: Paradigm,
  key: string,
  paradigms: Paradigm[],
  depth = 0,
  variantId?: Id | null
): SlotGenerator {
  // 变体优先，没写就退回这个槽位的通用写法
  const g = (variantId ? p.generators[variantKey(key, variantId)] : undefined) ?? p.generators[key]
  if (g && g.kind !== 'none') return g
  if (p.inheritsFrom && depth < 8) {
    const parent = paradigms.find((x) => x.id === p.inheritsFrom)
    if (parent) return resolveGenerator(parent, key, paradigms, depth + 1, variantId)
  }
  return g ?? { kind: 'none' }
}

/** 词条用的一个构形 */
export interface LexemeParadigm {
  paradigm: Paradigm
  variantId: Id | null
  /** 第一个（词条上指名的，或者词类默认的）；其余是另外加的 */
  primary: boolean
}

/** 这一套（构形 + 变体）的标识：同一个构形的不同变体算两套 */
const lpKey = (paradigmId: Id, variantId?: Id | null): string => `${paradigmId}#${variantId ?? ''}`

/** 这一套叫什么：构形名，挑了变体时后面带上变体名 */
export function lexemeParadigmLabel(lp: LexemeParadigm, glossLangs: string[] = []): string {
  const name = pick(lp.paradigm.name, glossLangs) || '?'
  const v = lp.variantId ? lp.paradigm.variants.find((x) => x.id === lp.variantId)?.name : ''
  return v ? `${name}·${v}` : name
}

/**
 * 词条用的全部构形：第一个是指名的或词类默认的，后面是另外加的。
 * 同一个构形的不同变体各算一套（名词兼动词、或者同一套构形的书面 / 口语两个变体都要）；
 * 完全一样的（同构形同变体）与作用于所有词的不算。
 */
export function paradigmsFor(project: Project, lexeme: Lexeme): LexemeParadigm[] {
  const out: LexemeParadigm[] = []
  const seen = new Set<string>()
  const first = paradigmFor(project, lexeme)
  if (first) {
    out.push({ paradigm: first, variantId: lexeme.paradigmVariantId ?? null, primary: true })
    seen.add(lpKey(first.id, lexeme.paradigmVariantId))
  }
  for (const x of lexeme.extraParadigms ?? []) {
    const p = project.paradigms.find((y) => y.id === x.paradigmId)
    if (!p || p.appliesToAll || seen.has(lpKey(p.id, x.variantId))) continue
    seen.add(lpKey(p.id, x.variantId))
    out.push({ paradigm: p, variantId: x.variantId ?? null, primary: false })
  }
  return out
}

export interface LexemeSlot {
  lp: LexemeParadigm
  slot: SlotDef
  /** 这一格的形式存在 forms 的哪个键下 */
  key: string
}

/**
 * 词条用到的全部槽位，以及每一格存在 forms 的哪个键下：第一个构形就是槽位名；
 * 后加的构形槽位名跟前面撞了，就在前面加「构形名·」，两套形式各存各的
 */
export function lexemeSlots(
  project: Project,
  lexeme: Lexeme,
  glossLangs: string[] = project.settings.glossLanguages
): LexemeSlot[] {
  const out: LexemeSlot[] = []
  const used = new Set<string>()
  for (const lp of paradigmsFor(project, lexeme)) {
    const name = lexemeParadigmLabel(lp, glossLangs)
    for (const slot of paradigmSlots(
      lp.paradigm,
      project.categories,
      glossLangs,
      false,
      !project.settings.complexSlots
    )) {
      // 跟前面重名的槽位，名字前面加这一套的名字；还重名就再加个序号
      let key = slot.label
      if (used.has(key)) key = `${name}·${slot.label}`
      for (let i = 2; used.has(key); i++) key = `${name}·${slot.label}·${i}`
      used.add(key)
      out.push({ lp, slot, key })
    }
  }
  return out
}

/** 词条的槽位按「这一套」（构形 + 变体）分组 */
export interface LexemeSlotGroup {
  /** 每一套的标识：构形 id + 变体 id */
  id: string
  /** 这一套叫什么（构形名，挑了变体时带上变体名） */
  name: string
  lp: LexemeParadigm
  slots: LexemeSlot[]
}

export function lexemeSlotGroups(
  project: Project,
  lexeme: Lexeme,
  glossLangs: string[] = project.settings.glossLanguages
): LexemeSlotGroup[] {
  const out: LexemeSlotGroup[] = []
  for (const s of lexemeSlots(project, lexeme, glossLangs)) {
    const id = lpKey(s.lp.paradigm.id, s.lp.variantId)
    let g = out.find((x) => x.id === id)
    if (!g) out.push((g = { id, name: lexemeParadigmLabel(s.lp, glossLangs), lp: s.lp, slots: [] }))
    g.slots.push(s)
  }
  return out
}

/** 一个构形的维度，名字都取好了，给表格 / 树形图排布用（见 layout.ts） */
export function paradigmDims(
  p: Paradigm,
  categories: GrammaticalCategory[],
  glossLangs: string[]
): LayoutDim[] {
  return p.dimensionIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is GrammaticalCategory => !!c)
    .map((c) => ({
      id: c.id,
      name: pick(c.name, glossLangs) || '?',
      values: c.values.map((v) => ({
        id: v.id,
        name: pick(v.name, glossLangs) || v.abbr || '?',
        abbr: v.abbr
      }))
    }))
}

/** 某个构形的某一格在这个词条里存在哪个键下；词条没用这个构形时就是槽位名 */
export function formKeyOf(
  project: Project,
  lexeme: Lexeme,
  paradigmId: Id,
  slot: SlotDef,
  variantId?: Id | null
): string {
  const slots = lexemeSlots(project, lexeme).filter(
    (s) => s.lp.paradigm.id === paradigmId && s.slot.key === slot.key
  )
  const hit =
    (variantId === undefined
      ? slots[0]
      : slots.find((s) => (s.lp.variantId ?? null) === (variantId ?? null))) ?? slots[0]
  return hit?.key ?? slot.label
}

/** 词条在某个构形上选的变体（第一个构形看 paradigmVariantId，后加的看自己那一项） */
export function lexemeVariantFor(lexeme: Lexeme, project: Project, paradigmId: Id): Id | null {
  return paradigmsFor(project, lexeme).find((x) => x.paradigm.id === paradigmId)?.variantId ?? null
}

export function paradigmFor(project: Project, lexeme: Lexeme): Paradigm | null {
  // 词条上指名了就用指名的；作用于所有词的构形（词首音变这类）不往词条里写形式
  if (lexeme.paradigmId) {
    const p = project.paradigms.find((x) => x.id === lexeme.paradigmId)
    if (p && !p.appliesToAll) return p
  }
  // 复合词类自己没绑构形时，用组成词类里第一个绑了的
  const paradigmId = posParadigmId(project, lexeme.posId)
  if (!paradigmId) return null
  const p = project.paradigms.find((x) => x.id === paradigmId)
  return p && !p.appliesToAll ? p : null
}

// ───────────────────────── 生成 ─────────────────────────

export interface MorphContext {
  project: Project
  language: Language
  /** 规则集程序缓存 */
  program: (ruleSetId: Id) => RuleProgram | null
  /** 微调行、异体形环境这些零碎规则的解析缓存（一次推导里同一行只解析一次） */
  rules?: Map<string, RuleProgram>
  /** 词头 → 词条（@引用在语素表里找不到时找同名词条），按词条数失效 */
  lemmas?: { size: number; map: Map<string, Lexeme> }
  /** 词干 → 按主正字法转出来的读音（异体形环境用），正字法规则改了就作废 */
  spoken?: { rules: string; map: Map<string, string | null> }
  /** 语言的解析选项缓存 */
  parseOptions?: ReturnType<typeof languageParseOptions>
}

/** 解析一行零碎规则：有缓存就用缓存 */
function ruleOf(ctx: MorphContext, text: string): RuleProgram {
  const hit = ctx.rules?.get(text)
  if (hit) return hit
  ctx.parseOptions ??= languageParseOptions(ctx.language, ctx.project)
  const prog = parseRuleText(text, ctx.parseOptions)
  ctx.rules?.set(text, prog)
  return prog
}

export function makeContext(project: Project, language: Language): MorphContext {
  const cache = new Map<Id, RuleProgram | null>()
  return {
    project,
    language,
    rules: new Map(),
    program: (id) => {
      if (!cache.has(id)) {
        const rs = project.ruleSets.find((r) => r.id === id)
        cache.set(id, rs ? parseRuleText(rs.text, languageParseOptions(language, project)) : null)
      }
      return cache.get(id) ?? null
    }
  }
}

const trimHyphens = (s: string): string => s.replace(/^-+|-+$/g, '')

export function stemOf(lexeme: Lexeme, name: string): { value: string; note: string } {
  const n = name.trim()
  if (!n || n === 'lemma' || n === '词头')
    return { value: trimHyphens(lexeme.lemma), note: 'lemma' }
  const v = lexeme.stems[n]
  if (v != null && v !== '') return { value: trimHyphens(v), note: n }
  return { value: trimHyphens(lexeme.lemma), note: `${n}→lemma` }
}

/**
 * 词缀文本：以 @ 开头表示引用语素（按形式或 gloss 查找），按异体形环境挑选；否则按字面。
 * 环境用规则语言写，如后缀异体形 `-lar / {Back}[^aeouöü]*_`：左侧是词干末尾的条件。
 * active 是正在生成的那一格的取值，异体形写了语法取值时按它挑（没有就只看环境）。
 */
function resolveAffix(
  ctx: MorphContext,
  text: string,
  stem: string,
  side: 'prefix' | 'suffix',
  active?: ReadonlyMap<Id, Id>
): { form: string; note: string; morpheme?: Morpheme } {
  // 只有全是空白才算没写；写进去的空格、中点这些要原样留着（`ė ` + derg → ė derg）
  if (!text.trim()) return { form: '', note: '' }
  const r = parseAffixRef(text, ctx.project.morphemes, ctx.language.id)
  if (!r) return { form: trimHyphens(text), note: '' }
  if (!r.morpheme) {
    // 语素表里没有就找同名词条（@mo 引用词库里的 mo）；都没有照字面拼，前后的空格、中点照样留着
    const lex = r.ref ? lemmaOf(ctx, r.ref) : undefined
    return {
      form: trimHyphens(r.lead + (lex ? trimHyphens(lex.lemma) : r.ref) + r.tail),
      note: lex ? `引用词条 ${lex.lemma}` : `未找到语素 ${r.ref}`
    }
  }
  const allo = selectAllomorph(ctx, r.morpheme, stem, side, active)
  // 引用前后写的空格、中点照样拼上（@定指· + derg → sa·derg）
  return {
    form: trimHyphens(r.lead + trimHyphens(allo.form) + r.tail),
    note: allo.note,
    morpheme: r.morpheme
  }
}

/** 拼写里有几个音节：按拼写单位数元音，挨着的元音算一个 */
function syllableCount(text: string, units: string[], isVowel: (s: string) => boolean): number {
  let n = 0
  let prev = false
  for (const s of segment(text, units)) {
    const v = isVowel(s)
    if (v && !prev) n++
    prev = v
  }
  return n
}

/**
 * 加了词缀之后，交给重音规则的特殊重音跟着挪：从前数的遇到前缀往后挪、从后数的遇到后缀往前挪，
 * 重音还落在原来那个音节上；词缀自己标了特殊重音（语素里勾了传递）就改成落在词缀上，
 * 词缀「算作」了哪个词类，词就换成那个词类。
 */
function stressAfterAffix(
  ctx: MorphContext,
  word: { current?: WordStress },
  form: string,
  morpheme: Morpheme | undefined,
  side: 'prefix' | 'suffix'
): void {
  const { units, isVowel } = spellingUnits(ctx.language)
  const n = syllableCount(form, units, isVowel)
  const own = morpheme ? morphemeStress(ctx.project, morpheme) : undefined
  const cur: WordStress = { ...word.current }
  if (typeof cur.stress === 'number' && cur.stress !== 0) {
    if (side === 'prefix' && cur.stress > 0) cur.stress += n
    if (side === 'suffix' && cur.stress < 0) cur.stress -= n
  }
  if (own && typeof own.stress === 'number' && own.stress !== 0 && n > 0) {
    const p = own.stress
    cur.stress =
      side === 'suffix'
        ? p > 0
          ? -(n - Math.min(p, n) + 1)
          : Math.max(p, -n)
        : p > 0
          ? Math.min(p, n)
          : n + Math.max(p, -n) + 1
  }
  if (morpheme?.stress?.affects && morpheme.stress.passPos && morpheme.stress.posId && own?.pos) {
    const names = posNames(ctx.project, [morpheme.stress.posId])
    if (names.length) cur.pos = names
  }
  word.current = cur.pos || cur.stress !== undefined ? cur : undefined
}

/** 这门语言里词头是 name 的词条（去掉两头连字符比） */
function lemmaOf(ctx: MorphContext, name: string): Lexeme | undefined {
  const all = ctx.project.lexemes
  if (!ctx.lemmas || ctx.lemmas.size !== all.length) {
    const map = new Map<string, Lexeme>()
    for (const l of all) {
      const k = trimHyphens(l.lemma)
      if (l.languageId === ctx.language.id && k && !map.has(k)) map.set(k, l)
    }
    ctx.lemmas = { size: all.length, map }
  }
  return ctx.lemmas.map.get(trimHyphens(name))
}

/** 只由分隔符组成（没有字母、数字、附加符） */
const ONLY_SEPARATORS = /^[^\p{L}\p{N}\p{M}]*$/u

/** 生成器里写词缀的那些文本（前缀、后缀、中缀、环缀两截）；按条件换字母的写法每种挑法各算一条 */
export function affixTexts(g: SlotGenerator): string[] {
  const raw =
    g.kind === 'pipeline'
      ? g.steps.flatMap((st) =>
          st.kind === 'prefix' || st.kind === 'suffix' || st.kind === 'infix'
            ? [st.text]
            : st.kind === 'circumfix'
              ? [st.text, st.text2]
              : []
        )
      : g.kind === 'affix'
        ? [g.prefix, g.suffix, g.infix]
        : g.kind === 'affix-sca'
          ? [g.prefix, g.suffix]
          : []
  return raw.flatMap((x) => conditionVariants(x ?? '').map((v) => v.text))
}

export interface AffixRef {
  /** @ 前面写的分隔符（空格、中点……） */
  lead: string
  /** 对上的引用名（形式或 gloss） */
  ref: string
  morpheme: Morpheme | null
  /** 引用名后面多写的部分，原样拼上 */
  tail: string
}

/**
 * 词缀文本里的 @语素 引用：`@定指`、`@定指·`、`@定指 `、`·@定指`。
 * 引用名取语素表里能对上的最长一段（形式、gloss 或去掉连字符的形式），
 * 余下的空格、中点这些原样留在前后。@ 前面写了字母的不算引用，返回 null 按字面处理。
 */
export function parseAffixRef(
  text: string,
  morphemes: Morpheme[],
  languageId: Id
): AffixRef | null {
  const at = text.indexOf('@')
  if (at < 0) return null
  const lead = text.slice(0, at)
  // @ 前后多写的只能是分隔符（空格、中点、连字符……），写了字母、数字就不是这种用法
  if (!ONLY_SEPARATORS.test(lead)) return null
  const rest = text.slice(at + 1)
  // 引用名的候选：rest 的每个前缀（开头的空白不算，结尾不能是空白）→ 切在哪
  const names = new Map<string, number>()
  for (let cut = rest.length; cut > 0; cut--) {
    const name = rest.slice(0, cut).trimStart()
    if (!name || /\s$/u.test(name)) continue
    if (!names.has(name)) names.set(name, cut)
    const bare = trimHyphens(name)
    if (bare && !names.has(bare)) names.set(bare, cut)
  }
  let best: { m: Morpheme; name: string; cut: number } | null = null
  for (const m of morphemes) {
    if (m.languageId !== languageId) continue
    for (const k of [m.form, m.gloss, trimHyphens(m.form)]) {
      const cut = k ? names.get(k) : undefined
      // 剩下的得全是分隔符：@PL2、@3SG 这种写错或没有的引用不能悄悄对上 PL、3
      if (cut === undefined || !ONLY_SEPARATORS.test(rest.slice(cut))) continue
      if (!best || cut > best.cut) best = { m, name: k, cut }
    }
  }
  if (best) return { lead, ref: best.name, morpheme: best.m, tail: rest.slice(best.cut) }
  // 没对上：名字后面写的空格、中点这些照样留在 tail 里（@mo + 空格 → 「mo 」）
  const split = /^(.*?)([^\p{L}\p{N}\p{M}]*)$/su.exec(rest)
  return { lead, ref: (split?.[1] ?? rest).trim(), morpheme: null, tail: split?.[2] ?? '' }
}

/**
 * 词干按主正字法转出来的读音（去掉重音、音节点这些记号）。音类常按 IPA 写（C 里是 k，拼写却是 c），
 * 异体形环境拿拼写和读音各比一次。没写正字法规则、或转出来跟拼写一样时为 null。
 */
function spokenForm(ctx: MorphContext, stem: string): string | null {
  const lang = ctx.language
  const ortho = lang.orthographies.find((o) => o.isPrimary) ?? lang.orthographies[0]
  if (!ortho?.rulesToIpa.trim()) return null
  if (ctx.spoken?.rules !== ortho.rulesToIpa)
    ctx.spoken = { rules: ortho.rulesToIpa, map: new Map() }
  const cache = ctx.spoken.map
  if (!cache.has(stem)) {
    const ipa = transcribe(lang, ortho, stem)?.replace(/[ˈˌ.‿|‖]/g, '') ?? null
    cache.set(stem, ipa && ipa !== stem ? ipa : null)
  }
  return cache.get(stem) ?? null
}

/**
 * 挑一个异体形。一条异体形写了的条件都要对上才算候选：
 * - 语法取值（`values`）：要全都在 active 里（正在生成的那一格的维度取值 + 词条自己的语法特征）；
 *   没传 active 的地方（语素页自己的预览、语料分词）写了取值的一律挑不到，行为跟以前一样；
 * - 环境（`environment`）：拿词干的拼写和按主正字法转出来的读音各比一次。
 *
 * 几条都对上时「越具体越优先」，这个顺序是定死的：
 *   1. 对上的语法取值多的先（宾格+复数 先于 只宾格）；
 *   2. 一样多时，写了环境又对上的，排在没写环境的前面；
 *   3. 还一样就按语素里写的先后，靠前的先。
 * 一条都没对上时用默认形：既没写取值也没写环境的那条（也是按上面这个顺序挑出来的），
 * 一条都没有就用语素本身的形式。
 */
export function selectAllomorph(
  ctx: MorphContext,
  m: Morpheme,
  stem: string,
  side: 'prefix' | 'suffix',
  active?: ReadonlyMap<Id, Id>
): { form: string; note: string } {
  const spoken = spokenForm(ctx, stem)
  const activeIds = active ? activeValueIds(active) : null
  /** 环境对不对得上：写成 `> ¤ / 环境` 跑一遍，看标记有没有落在词干那一头 */
  const envHits = (env: string): boolean => {
    const idx = env.indexOf('_')
    const left = idx >= 0 ? env.slice(0, idx) : env
    const right = idx >= 0 ? env.slice(idx + 1) : ''
    // 后缀看词干末尾（左环境），前缀看词干开头（右环境）
    const rule = side === 'suffix' ? `> ¤ / ${left}_#` : `> ¤ / #_${right}`
    const prog = ruleOf(ctx, rule)
    const hits = (form: string): boolean => {
      const out = runRules(prog, form, { trace: false }).output
      return side === 'suffix' ? out.endsWith('¤') : out.startsWith('¤')
    }
    return hits(stem) || (spoken !== null && hits(spoken))
  }
  let best: { a: Allomorph; vals: number; env: string } | null = null
  for (const a of m.allomorphs) {
    const vals = valueMatch(a, activeIds)
    if (vals === null) continue
    const env = a.environment.trim()
    if (env && !envHits(env)) continue
    // 严格大于：并列时留着先写的那条
    const better = best === null || vals > best.vals || (vals === best.vals && !!env && !best.env)
    if (better) best = { a, vals, env }
  }
  if (!best) return { form: m.form, note: `${m.form} → ${m.form}` }
  const langs = ctx.project.settings.glossLanguages
  const why = [
    ...alloValues(best.a).map((v) => valueLabel(ctx.project.categories, v, langs)),
    best.env
  ].filter(Boolean)
  const form = best.a.form
  return {
    form,
    note: why.length ? `${m.form} → ${form} (${why.join(' · ')})` : `${m.form} → ${form}`
  }
}

function insertInfix(
  stem: string,
  infix: string,
  at: string,
  isVowel: (s: string) => boolean,
  inventory: string[]
): string {
  const segs = segment(stem, inventory)
  let a = (at.trim() || 'V1').replace(/\s+/g, '')
  // 开头的 < 表示插在该音段之前，> 或不写表示之后
  let before = false
  if (a.startsWith('<')) {
    before = true
    a = a.slice(1)
  } else if (a.startsWith('>')) a = a.slice(1)
  let pos: number
  const cv = /^([CV])(-?\d*)$/i.exec(a)
  if (/^-?\d+$/.test(a)) {
    // 纯数字是绝对位置：n 表示第 n 个音段之后，负数从末尾数
    const n = Number(a)
    pos = n >= 0 ? Math.min(n, segs.length) : Math.max(0, segs.length + n)
  } else if (cv) {
    const wantVowel = cv[1].toUpperCase() === 'V'
    const idx: number[] = []
    for (let i = 0; i < segs.length; i++) if (isVowel(segs[i]) === wantVowel) idx.push(i)
    const n = cv[2] ? Number(cv[2]) : 1
    // 正数从头数，负数从末尾数：C-1 就是最后一个辅音
    const target = n > 0 ? idx[n - 1] : idx[idx.length + n]
    pos = target === undefined ? segs.length : before ? target : target + 1
  } else pos = 1
  return [...segs.slice(0, pos), infix, ...segs.slice(pos)].join('')
}

/** 词根-模板：C1 / {1} 引用词干第 n 个辅音，bare C 顺序取下一个辅音，V 顺序取下一个元音，其余字面 */
function applyPattern(
  stem: string,
  pattern: string,
  isVowel: (s: string) => boolean,
  inventory: string[]
): string {
  const segs = segment(stem, inventory)
  const cons = segs.filter((s) => !isVowel(s))
  const vows = segs.filter((s) => isVowel(s))
  let ci = 0
  let vi = 0
  let out = ''
  const chars = Array.from(pattern)
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === 'C' || c === '{') {
      let j = i + 1
      let num = ''
      if (c === '{') {
        while (j < chars.length && chars[j] !== '}') num += chars[j++]
        i = j
      } else {
        while (j < chars.length && /\d/.test(chars[j])) num += chars[j++]
        i = j - 1
      }
      if (num) out += cons[Number(num) - 1] ?? ''
      else out += cons[ci++] ?? ''
    } else if (c === 'V') {
      let j = i + 1
      let num = ''
      while (j < chars.length && /\d/.test(chars[j])) num += chars[j++]
      i = j - 1
      if (num) out += vows[Number(num) - 1] ?? ''
      else out += vows[vi++] ?? ''
    } else out += c
  }
  return out
}

export interface Generated {
  surface: string
  trace: string[]
  /** 勾了「影响发音」的槽位：推出来的发音 */
  ipa?: string
}

/**
 * 微调：每行一条。`-x` 去词尾 x，`+x` 追加，`^-x` 去词首，`^+x` 前置；含 > 的行是规则。
 */
export function applyAdjust(
  ctx: MorphContext,
  surface: string,
  text: string | undefined,
  trace: string[],
  label: string
): string {
  if (!text || !text.trim()) return surface
  let s = surface
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';')) continue
    const before = s
    if (line.includes('>')) {
      const prog = ruleOf(ctx, line)
      const err = prog.diagnostics.find((d) => d.severity === 'error')
      if (err) {
        trace.push(`${label} ✗ ${line}: ${err.message}`)
        continue
      }
      s = runRules(prog, s, { trace: false }).output
    } else if (line.startsWith('^-')) {
      const x = line.slice(2)
      if (x && s.startsWith(x)) s = s.slice(x.length)
    } else if (line.startsWith('^+')) {
      s = line.slice(2) + s
    } else if (line.startsWith('-')) {
      const x = line.slice(1)
      if (x && s.endsWith(x)) s = s.slice(0, s.length - x.length)
    } else if (line.startsWith('+')) {
      s = s + line.slice(1)
    } else {
      trace.push(`${label} ? ${line}`)
      continue
    }
    trace.push(`${label} ${line}: ${before} → ${s}`)
  }
  return s
}

/** 词缀文本按条件挑过之后，轨迹里写成「原文 → 挑出来的」 */
const shown = (raw: string, got: string): string => (raw === got ? raw : `${raw} → ${got}`)

/**
 * 跑一步：把上一步的结果变成这一步的结果，并记一条轨迹。
 * pick 把词缀、微调里按条件换字母的写法（`{阴:g|k}`）按这个词条、这个槽位挑好；
 * active 是同一份取值，`@语素` 引用的异体形写了语法取值时按它挑。
 */
function runStep(
  ctx: MorphContext,
  step: MorphStep,
  surface: string,
  trace: string[],
  pick: (text: string) => string = (x) => x,
  word: { current?: WordStress } = {},
  active?: ReadonlyMap<Id, Id>
): string {
  // 按音段数的地方用拼写单位：设了正字法时 th、eu 这类写法是一个音
  const { units: inventory, isVowel } = spellingUnits(ctx.language)
  switch (step.kind) {
    case 'prefix': {
      const text = pick(step.text)
      const a = resolveAffix(ctx, text, surface, 'prefix', active)
      if (a.note) trace.push(a.note)
      stressAfterAffix(ctx, word, a.form, a.morpheme, 'prefix')
      surface = a.form + surface
      trace.push(`前缀 ${shown(step.text, text)}: ${surface}`)
      return surface
    }
    case 'suffix': {
      const text = pick(step.text)
      const a = resolveAffix(ctx, text, surface, 'suffix', active)
      if (a.note) trace.push(a.note)
      stressAfterAffix(ctx, word, a.form, a.morpheme, 'suffix')
      surface = surface + a.form
      trace.push(`后缀 ${shown(step.text, text)}: ${surface}`)
      return surface
    }
    case 'circumfix': {
      const t1 = pick(step.text)
      const t2 = pick(step.text2)
      const a = resolveAffix(ctx, t1, surface, 'prefix', active)
      const b = resolveAffix(ctx, t2, surface, 'suffix', active)
      if (a.note) trace.push(a.note)
      if (b.note) trace.push(b.note)
      stressAfterAffix(ctx, word, a.form, a.morpheme, 'prefix')
      stressAfterAffix(ctx, word, b.form, b.morpheme, 'suffix')
      surface = a.form + surface + b.form
      trace.push(`环缀 ${shown(`${step.text}…${step.text2}`, `${t1}…${t2}`)}: ${surface}`)
      return surface
    }
    case 'infix': {
      const text = pick(step.text)
      const a = resolveAffix(ctx, text, surface, 'prefix', active)
      surface = insertInfix(surface, trimHyphens(a.form), step.at, isVowel, inventory)
      trace.push(`中缀 ${shown(step.text, text)} @ ${step.at || 'V1'}: ${surface}`)
      return surface
    }
    case 'pattern': {
      surface = applyPattern(surface, step.pattern, isVowel, inventory)
      trace.push(`模板 ${step.pattern}: ${surface}`)
      return surface
    }
    case 'reduplication': {
      const segs = segment(surface, inventory)
      const n = Math.max(1, step.length || 1)
      if (step.scope === 'full') surface = surface + surface
      else if (step.scope === 'initial') surface = segs.slice(0, n).join('') + surface
      else surface = surface + segs.slice(-n).join('')
      trace.push(`重叠 ${step.scope}: ${surface}`)
      return surface
    }
    case 'adjust':
      return applyAdjust(ctx, surface, pick(step.text), trace, '微调')
    case 'sca': {
      if (!step.ruleSetId) return surface
      const prog = ctx.program(step.ruleSetId)
      if (!prog) {
        trace.push('规则集不存在')
        return surface
      }
      const r = runRules(prog, surface, {
        startAt: step.fromStage || undefined,
        stopAt: step.toStage || undefined,
        word: word.current
      })
      for (const e of r.trace)
        trace.push(
          `${e.before} → ${e.after} (${e.target || '∅'} → ${e.replacement || '∅'}, L${e.line})`
        )
      // 构形出来的是拼写：规则集里标的重音记号不留在词形里
      return prog.hasStress ? stripStress(r.output) : r.output
    }
    default:
      return surface
  }
}

/** 构形最多套几层（也挡住 A 套 B、B 又套 A 这种绕回来的） */
const MAX_NEST = 4

/**
 * 流水线里「构形」这一步：把到这一步为止的形式当成词干，套另一个构形的某个槽位。
 * 那个构形里写的词干槽都回落到这个形式；按条件换字母仍看这个词条自己的语法特征
 */
function nestParadigm(
  ctx: MorphContext,
  lexeme: Lexeme,
  step: Extract<MorphStep, { kind: 'paradigm' }>,
  surface: string,
  trace: string[],
  depth: number
): string {
  const p = step.paradigmId ? ctx.project.paradigms.find((x) => x.id === step.paradigmId) : null
  if (!p) {
    trace.push('构形不存在')
    return surface
  }
  const name = pick(p.name, ctx.project.settings.glossLanguages) || '?'
  if (depth >= MAX_NEST) {
    trace.push(`构形 ${name}：套得太深（超过 ${MAX_NEST} 层），停在这里`)
    return surface
  }
  const slot = paradigmSlots(
    p,
    ctx.project.categories,
    ctx.project.settings.glossLanguages,
    true
  ).find((s) => s.key === step.slotKey)
  if (!slot) {
    trace.push(`构形 ${name}：没选槽位`)
    return surface
  }
  const inner: Lexeme = {
    ...lexeme,
    lemma: surface,
    stems: {},
    forms: {},
    paradigmVariantId: step.variantId ?? null
  }
  const g = generateForm(ctx, inner, p, slot, step.variantId ?? null, depth + 1)
  if (!g) {
    trace.push(`构形 ${name} · ${slot.label}：这一格没有写法`)
    return surface
  }
  for (const line of g.trace) trace.push('  ' + line)
  trace.push(`构形 ${name} · ${slot.label}: ${g.surface}`)
  return g.surface
}

/**
 * 槽位继承的起点：那一格在这个词条上推出来的形式。那一格手改过（覆盖）就用手改的；
 * 那一格是表格、没写法时用词条里存着的；都没有返回 null（调用处退回词干）
 */
function baseForm(
  ctx: MorphContext,
  lexeme: Lexeme,
  paradigm: Paradigm,
  base: SlotBase,
  variantId: Id | null | undefined,
  trace: string[],
  depth: number
): string | null {
  const p = base.paradigmId ? ctx.project.paradigms.find((x) => x.id === base.paradigmId) : paradigm
  if (!p) {
    trace.push('继承的构形不存在')
    return null
  }
  const name = pick(p.name, ctx.project.settings.glossLanguages) || '?'
  if (depth >= MAX_NEST) {
    trace.push(`继承 ${name}：套得太深（超过 ${MAX_NEST} 层），停在这里`)
    return null
  }
  const slot = paradigmSlots(
    p,
    ctx.project.categories,
    ctx.project.settings.glossLanguages,
    true
  ).find((s) => s.key === base.slotKey)
  if (!slot) {
    trace.push(`继承 ${name}：那一格已经不在了`)
    return null
  }
  const vid = base.variantId !== undefined ? base.variantId : p === paradigm ? variantId : null
  const stored = lexeme.forms[formKeyOf(ctx.project, lexeme, p.id, slot, vid)]
  if (stored?.override && stored.surface) {
    trace.push(`继承 ${name} · ${slot.label}（手改过）: ${stored.surface}`)
    return stored.surface
  }
  const g = generateForm(ctx, lexeme, p, slot, vid, depth + 1)
  const surface = g?.surface ?? stored?.surface ?? ''
  if (!surface) {
    trace.push(`继承 ${name} · ${slot.label}：那一格没有形式`)
    return null
  }
  for (const line of g?.trace ?? []) trace.push('  ' + line)
  trace.push(`继承 ${name} · ${slot.label}: ${surface}`)
  return surface
}

/**
 * 槽位的发音流水线：起点是这一格的拼写按主正字法转出的 IPA（from = form），或词条自己的发音（lemma），
 * 再一步步改。重音另起一份，不跟拼写那条流水线共用
 */
function slotPron(
  ctx: MorphContext,
  lexeme: Lexeme,
  surface: string,
  pron: SlotPron,
  trace: string[],
  pick: (text: string) => string,
  active?: ReadonlyMap<Id, Id>
): string {
  const lang = ctx.language
  const ortho = lang.orthographies.find((o) => o.isPrimary) ?? lang.orthographies[0]
  const word: { current?: WordStress } = { current: lexemeStress(ctx.project, lexeme) }
  let out: string
  if (pron.from === 'lemma') {
    const stored = ortho ? lexeme.pronunciations[ortho.id]?.ipa : ''
    out =
      stored || (ortho ? transcribe(lang, ortho, lexeme.lemma, word.current) : null) || lexeme.lemma
  } else out = (ortho ? transcribe(lang, ortho, surface, word.current) : null) ?? surface
  trace.push(`发音起点: ${out}`)
  for (const step of pron.steps)
    if (step.kind !== 'paradigm') out = runStep(ctx, step, out, trace, pick, word, active)
  trace.push(`发音: ${out}`)
  return out
}

/**
 * 这一格实际用哪份写法：先按槽位键找（含变体、继承的构形）；
 * 简洁模式（默认）下这一格没写法时，按维度少一点的槽位往上找——「时-体-人称」接着「时-体」往下变，
 * 取值仍按这一格自己的（条件换字母、异体形都按这一格算）。复杂模式各算各的
 */
export function effectiveGenerator(
  project: Project,
  paradigm: Paradigm,
  slot: SlotDef,
  variantId?: Id | null
): { generator: SlotGenerator; fromKey: string | null } {
  const own = resolveGenerator(paradigm, slot.key, project.paradigms, 0, variantId)
  if (own.kind !== 'none' || project.settings.complexSlots) return { generator: own, fromKey: null }
  const catOf = new Map<Id, Id>()
  for (const c of project.categories) for (const v of c.values) catOf.set(v.id, c.id)
  // 按构形里维度的先后，从后往前一个个去掉
  const dims = [...new Set(slot.values.map((v) => v.categoryId))].sort(
    (a, b) => paradigm.dimensionIds.indexOf(a) - paradigm.dimensionIds.indexOf(b)
  )
  for (let n = dims.length - 1; n >= 1; n--) {
    const key = slotKeySubset(slot.key, catOf, new Set(dims.slice(0, n)))
    if (!key) continue
    const g = resolveGenerator(paradigm, key, project.paradigms, 0, variantId)
    if (g.kind !== 'none') return { generator: g, fromKey: key }
  }
  return { generator: own, fromKey: null }
}

export function generateForm(
  ctx: MorphContext,
  lexeme: Lexeme,
  paradigm: Paradigm,
  slot: SlotDef,
  variantId?: Id | null,
  depth = 0
): Generated | null {
  const { generator: g } = effectiveGenerator(
    ctx.project,
    paradigm,
    slot,
    variantId ?? lexeme.paradigmVariantId
  )
  if (g.kind === 'none' || g.kind === 'table') return null
  const trace: string[] = []
  const stem = stemOf(lexeme, g.stem)
  const based = g.kind === 'pipeline' && g.base?.slotKey
  if (!based) trace.push(`词干 ${stem.note}: ${stem.value}`)
  // 按条件换字母（{阴:g|k}）：看这个槽位的维度取值，再看词条自己的语法特征
  const active = activeValues(slot.values, lexeme)
  const unknown = new Set<string>()
  const pick = (text: string): string =>
    resolveConditions(text, ctx.project.categories, active, unknown)
  const noteUnknown = (): void => {
    if (unknown.size) trace.push(`条件没对上任何取值：${[...unknown].join('、')}`)
  }
  // 勾了「对重音影响」的词条：词类与特殊重音交给「音变」步骤里的重音规则，加词缀时跟着挪
  const word: { current?: WordStress } = { current: lexemeStress(ctx.project, lexeme) }
  if (g.kind === 'pipeline') {
    let out = stem.value
    if (g.base?.slotKey) {
      const b = baseForm(ctx, lexeme, paradigm, g.base, variantId, trace, depth)
      if (b === null) trace.push(`退回词干 ${stem.note}: ${stem.value}`)
      else out = b
    }
    for (const step of g.steps)
      out =
        step.kind === 'paradigm'
          ? nestParadigm(ctx, lexeme, step, out, trace, depth)
          : runStep(ctx, step, out, trace, pick, word, active)
    noteUnknown()
    if (!g.pron?.on) return { surface: out, trace }
    return { surface: out, trace, ipa: slotPron(ctx, lexeme, out, g.pron, trace, pick, active) }
  }
  const { units: inventory, isVowel } = spellingUnits(ctx.language)
  let surface = stem.value
  if (g.kind === 'affix' || g.kind === 'affix-sca') {
    const pre = resolveAffix(ctx, pick(g.prefix ?? ''), surface, 'prefix', active)
    const suf = resolveAffix(ctx, pick(g.suffix ?? ''), surface, 'suffix', active)
    if (pre.note) trace.push(pre.note)
    if (suf.note) trace.push(suf.note)
    if (g.kind === 'affix' && g.infix) {
      surface = insertInfix(surface, trimHyphens(pick(g.infix)), g.infixAt, isVowel, inventory)
      trace.push(`中缀 ${g.infix} @ ${g.infixAt || 'V1'}: ${surface}`)
    }
    surface = pre.form + surface + suf.form
    trace.push(`拼接: ${surface}`)
    surface = applyAdjust(ctx, surface, g.pre && pick(g.pre), trace, '微调(前)')
    if (g.kind === 'affix-sca' && g.ruleSetId) {
      const prog = ctx.program(g.ruleSetId)
      if (prog) {
        const r = runRules(prog, surface, {
          startAt: g.fromStage || undefined,
          stopAt: g.toStage || undefined,
          word: word.current
        })
        for (const e of r.trace)
          trace.push(
            `${e.before} → ${e.after} (${e.target || '∅'} → ${e.replacement || '∅'}, L${e.line})`
          )
        surface = prog.hasStress ? stripStress(r.output) : r.output
      } else trace.push('规则集不存在')
    }
  } else if (g.kind === 'pattern') {
    surface = applyAdjust(ctx, surface, g.pre && pick(g.pre), trace, '微调(前)')
    surface = applyPattern(surface, g.pattern, isVowel, inventory)
    trace.push(`模板 ${g.pattern}: ${surface}`)
  } else if (g.kind === 'reduplication') {
    surface = applyAdjust(ctx, surface, g.pre && pick(g.pre), trace, '微调(前)')
    const segs = segment(surface, inventory)
    const n = Math.max(1, g.length || 1)
    if (g.scope === 'full') surface = surface + surface
    else if (g.scope === 'initial') surface = segs.slice(0, n).join('') + surface
    else surface = surface + segs.slice(-n).join('')
    trace.push(`重叠 ${g.scope}: ${surface}`)
  }
  surface = applyAdjust(ctx, surface, g.post && pick(g.post), trace, '微调(后)')
  noteUnknown()
  return { surface, trace }
}

/** 推导一个词位的全部槽位并写回 forms（覆盖值不动）。返回改动数。 */
export function deriveForms(
  ctx: MorphContext,
  lexeme: Lexeme,
  paradigm: Paradigm,
  slots?: SlotDef[],
  variantId?: Id | null
): number {
  const defs =
    slots ?? paradigmSlots(paradigm, ctx.project.categories, ctx.project.settings.glossLanguages)
  const keys = new Map(
    lexemeSlots(ctx.project, lexeme)
      .filter(
        (s) => s.lp.paradigm.id === paradigm.id && (s.lp.variantId ?? null) === (variantId ?? null)
      )
      .map((s) => [s.slot.key, s.key])
  )
  let n = 0
  for (const s of defs) {
    const key = keys.get(s.key) ?? s.label
    const cur = lexeme.forms[key]
    if (cur?.override) continue
    const g = generateForm(ctx, lexeme, paradigm, s, variantId)
    if (!g) continue
    if (!cur || cur.surface !== g.surface || !cur.derived || cur.ipa !== g.ipa) {
      const f: InflectedForm = {
        surface: g.surface,
        derived: true,
        override: false,
        trace: g.trace
      }
      if (g.ipa) f.ipa = g.ipa
      lexeme.forms[key] = f
      n++
    }
  }
  return n
}

/** 词条用的每个构形的全部槽位都推一遍（手填的不动），返回改动数 */
export function deriveLexemeForms(ctx: MorphContext, lexeme: Lexeme): number {
  let n = 0
  for (const lp of paradigmsFor(ctx.project, lexeme))
    n += deriveForms(ctx, lexeme, lp.paradigm, undefined, lp.variantId)
  return n
}

// ───────────────────────── 对账 ─────────────────────────

export interface SlotReport {
  slot: SlotDef
  same: number
  diff: number
  missing: number
  /** 没有生成器 */
  skipped: boolean
  examples: { lemma: string; stored: string; generated: string }[]
}

/** 一个槽位的一致性检查；分批跑时按槽位切 */
export function reconcileSlot(
  ctx: MorphContext,
  lexemes: Lexeme[],
  paradigm: Paradigm,
  slot: SlotDef,
  variantId?: Id | null
): SlotReport {
  const rep: SlotReport = { slot, same: 0, diff: 0, missing: 0, skipped: false, examples: [] }
  const g0 = resolveGenerator(paradigm, slot.key, ctx.project.paradigms, 0, variantId)
  if (g0.kind === 'none' || g0.kind === 'table') {
    rep.skipped = true
    return rep
  }
  for (const l of lexemes) {
    const stored = l.forms[formKeyOf(ctx.project, l, paradigm.id, slot)]
    const gen = generateForm(ctx, l, paradigm, slot, variantId)
    if (!gen) continue
    // 只与用户录入 / 覆盖的形式比对；推导出来的值不算已录入
    if (!stored || !stored.surface || !stored.override) {
      rep.missing++
      continue
    }
    // 录入值可能是逗号分隔的多个变体，任一相等即算一致
    const variants = stored.surface.split(/[,，;；/]\s*/).map((v) => v.trim().replace(/^\*/, ''))
    if (variants.includes(gen.surface)) rep.same++
    else {
      rep.diff++
      if (rep.examples.length < 30)
        rep.examples.push({ lemma: l.lemma, stored: stored.surface, generated: gen.surface })
    }
  }
  return rep
}

/** 把推导值与词位里已录入（override）的形式比对 */
export function reconcile(ctx: MorphContext, lexemes: Lexeme[], paradigm: Paradigm): SlotReport[] {
  const slots = paradigmSlots(paradigm, ctx.project.categories, ctx.project.settings.glossLanguages)
  return slots.map((slot) => reconcileSlot(ctx, lexemes, paradigm, slot))
}
