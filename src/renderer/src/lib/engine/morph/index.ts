/**
 * 形态引擎：范式槽位、生成器、推导与对账。
 * 生成器只做机械拼接 / 替换；语音层面的调整交给规则引擎（affix-sca）。
 */
import type {
  GrammaticalCategory,
  MorphStep,
  Id,
  Language,
  Lexeme,
  Morpheme,
  Paradigm,
  Project,
  SlotGenerator
} from '$lib/core/model'
import { parseRuleText, runRules, type RuleProgram } from '../sca'
import { languageParseOptions, nucleusSet, segment } from '../phon'
import { transcribe } from '$lib/core/pronounce'

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

export function slotKey(values: { categoryId: Id; valueId: Id }[]): string {
  return values.map((v) => v.valueId).join('|')
}

/** 维度笛卡尔积 → 槽位（已屏蔽的除外） */
export function paradigmSlots(
  p: Paradigm,
  categories: GrammaticalCategory[],
  glossLangs: string[],
  includeDisabled = false
): SlotDef[] {
  const dims = p.dimensionIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is GrammaticalCategory => !!c)
  if (!dims.length) return []
  let combos: { categoryId: Id; valueId: Id }[][] = [[]]
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

export function paradigmFor(project: Project, lexeme: Lexeme): Paradigm | null {
  // 词条上指名了就用指名的；作用于所有词的构形（词首音变这类）不往词条里写形式
  if (lexeme.paradigmId) {
    const p = project.paradigms.find((x) => x.id === lexeme.paradigmId)
    if (p && !p.appliesToAll) return p
  }
  const pos = project.posList.find((p) => p.id === lexeme.posId)
  if (!pos?.paradigmId) return null
  const p = project.paradigms.find((x) => x.id === pos.paradigmId)
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
 */
function resolveAffix(
  ctx: MorphContext,
  text: string,
  stem: string,
  side: 'prefix' | 'suffix'
): { form: string; note: string } {
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
  const allo = selectAllomorph(ctx, r.morpheme, stem, side)
  // 引用前后写的空格、中点照样拼上（@定指· + derg → sa·derg）
  return { form: trimHyphens(r.lead + trimHyphens(allo.form) + r.tail), note: allo.note }
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

/** 生成器里写词缀的那些文本（前缀、后缀、中缀、环缀两截） */
export function affixTexts(g: SlotGenerator): string[] {
  if (g.kind === 'pipeline')
    return g.steps.flatMap((st) =>
      st.kind === 'prefix' || st.kind === 'suffix' || st.kind === 'infix'
        ? [st.text]
        : st.kind === 'circumfix'
          ? [st.text, st.text2]
          : []
    )
  if (g.kind === 'affix') return [g.prefix, g.suffix, g.infix]
  if (g.kind === 'affix-sca') return [g.prefix, g.suffix]
  return []
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

export function selectAllomorph(
  ctx: MorphContext,
  m: Morpheme,
  stem: string,
  side: 'prefix' | 'suffix'
): { form: string; note: string } {
  const spoken = spokenForm(ctx, stem)
  for (const a of m.allomorphs) {
    const env = a.environment.trim()
    if (!env) continue
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
    if (hits(stem) || (spoken !== null && hits(spoken)))
      return { form: a.form, note: `${m.form} → ${a.form} (${env})` }
  }
  const fallback = m.allomorphs.find((a) => !a.environment.trim())?.form ?? m.form
  return { form: fallback, note: `${m.form} → ${fallback}` }
}

function insertInfix(
  stem: string,
  infix: string,
  at: string,
  nuclei: Set<string>,
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
    for (let i = 0; i < segs.length; i++) if (nuclei.has(segs[i]) === wantVowel) idx.push(i)
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
  nuclei: Set<string>,
  inventory: string[]
): string {
  const segs = segment(stem, inventory)
  const cons = segs.filter((s) => !nuclei.has(s))
  const vows = segs.filter((s) => nuclei.has(s))
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

/** 跑一步：把上一步的结果变成这一步的结果，并记一条轨迹 */
function runStep(ctx: MorphContext, step: MorphStep, surface: string, trace: string[]): string {
  const nuclei = nucleusSet(ctx.language)
  const inventory = ctx.language.phonemes.map((p) => p.symbol)
  switch (step.kind) {
    case 'prefix': {
      const a = resolveAffix(ctx, step.text, surface, 'prefix')
      if (a.note) trace.push(a.note)
      surface = a.form + surface
      trace.push(`前缀 ${step.text}: ${surface}`)
      return surface
    }
    case 'suffix': {
      const a = resolveAffix(ctx, step.text, surface, 'suffix')
      if (a.note) trace.push(a.note)
      surface = surface + a.form
      trace.push(`后缀 ${step.text}: ${surface}`)
      return surface
    }
    case 'circumfix': {
      const a = resolveAffix(ctx, step.text, surface, 'prefix')
      const b = resolveAffix(ctx, step.text2, surface, 'suffix')
      if (a.note) trace.push(a.note)
      if (b.note) trace.push(b.note)
      surface = a.form + surface + b.form
      trace.push(`环缀 ${step.text}…${step.text2}: ${surface}`)
      return surface
    }
    case 'infix': {
      const a = resolveAffix(ctx, step.text, surface, 'prefix')
      surface = insertInfix(surface, trimHyphens(a.form), step.at, nuclei, inventory)
      trace.push(`中缀 ${step.text} @ ${step.at || 'V1'}: ${surface}`)
      return surface
    }
    case 'pattern': {
      surface = applyPattern(surface, step.pattern, nuclei, inventory)
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
      return applyAdjust(ctx, surface, step.text, trace, '微调')
    case 'sca': {
      if (!step.ruleSetId) return surface
      const prog = ctx.program(step.ruleSetId)
      if (!prog) {
        trace.push('规则集不存在')
        return surface
      }
      const r = runRules(prog, surface, {
        startAt: step.fromStage || undefined,
        stopAt: step.toStage || undefined
      })
      for (const e of r.trace)
        trace.push(
          `${e.before} → ${e.after} (${e.target || '∅'} → ${e.replacement || '∅'}, L${e.line})`
        )
      return r.output
    }
    default:
      return surface
  }
}

export function generateForm(
  ctx: MorphContext,
  lexeme: Lexeme,
  paradigm: Paradigm,
  slot: SlotDef,
  variantId?: Id | null
): Generated | null {
  const g = resolveGenerator(
    paradigm,
    slot.key,
    ctx.project.paradigms,
    0,
    variantId ?? lexeme.paradigmVariantId
  )
  if (g.kind === 'none' || g.kind === 'table') return null
  const trace: string[] = []
  const stem = stemOf(lexeme, g.stem)
  trace.push(`词干 ${stem.note}: ${stem.value}`)
  if (g.kind === 'pipeline') {
    let out = stem.value
    for (const step of g.steps) out = runStep(ctx, step, out, trace)
    return { surface: out, trace }
  }
  const nuclei = nucleusSet(ctx.language)
  const inventory = ctx.language.phonemes.map((p) => p.symbol)
  let surface = stem.value
  if (g.kind === 'affix' || g.kind === 'affix-sca') {
    const pre = resolveAffix(ctx, g.prefix ?? '', surface, 'prefix')
    const suf = resolveAffix(ctx, g.suffix ?? '', surface, 'suffix')
    if (pre.note) trace.push(pre.note)
    if (suf.note) trace.push(suf.note)
    if (g.kind === 'affix' && g.infix) {
      surface = insertInfix(surface, trimHyphens(g.infix), g.infixAt, nuclei, inventory)
      trace.push(`中缀 ${g.infix} @ ${g.infixAt || 'V1'}: ${surface}`)
    }
    surface = pre.form + surface + suf.form
    trace.push(`拼接: ${surface}`)
    surface = applyAdjust(ctx, surface, g.pre, trace, '微调(前)')
    if (g.kind === 'affix-sca' && g.ruleSetId) {
      const prog = ctx.program(g.ruleSetId)
      if (prog) {
        const r = runRules(prog, surface, {
          startAt: g.fromStage || undefined,
          stopAt: g.toStage || undefined
        })
        for (const e of r.trace)
          trace.push(
            `${e.before} → ${e.after} (${e.target || '∅'} → ${e.replacement || '∅'}, L${e.line})`
          )
        surface = r.output
      } else trace.push('规则集不存在')
    }
  } else if (g.kind === 'pattern') {
    surface = applyAdjust(ctx, surface, g.pre, trace, '微调(前)')
    surface = applyPattern(surface, g.pattern, nuclei, inventory)
    trace.push(`模板 ${g.pattern}: ${surface}`)
  } else if (g.kind === 'reduplication') {
    surface = applyAdjust(ctx, surface, g.pre, trace, '微调(前)')
    const segs = segment(surface, inventory)
    const n = Math.max(1, g.length || 1)
    if (g.scope === 'full') surface = surface + surface
    else if (g.scope === 'initial') surface = segs.slice(0, n).join('') + surface
    else surface = surface + segs.slice(-n).join('')
    trace.push(`重叠 ${g.scope}: ${surface}`)
  }
  surface = applyAdjust(ctx, surface, g.post, trace, '微调(后)')
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
  let n = 0
  for (const s of defs) {
    const cur = lexeme.forms[s.label]
    if (cur?.override) continue
    const g = generateForm(ctx, lexeme, paradigm, s, variantId)
    if (!g) continue
    if (!cur || cur.surface !== g.surface || !cur.derived) {
      lexeme.forms[s.label] = { surface: g.surface, derived: true, override: false, trace: g.trace }
      n++
    }
  }
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
    const stored = l.forms[slot.label]
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
