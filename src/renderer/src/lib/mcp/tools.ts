/**
 * MCP 工具的纯逻辑层：每个工具拿到参数和一个上下文，算出一个普通对象交回去。
 *
 * 这里只管「做什么」，不管怎么送出去——主进程、preload、要不要先问用户，都由外层决定。
 * 约定：
 * - 返回值一律是可以直接 JSON 化的普通对象，别放 Map、Set、类实例。
 * - 找不到东西、参数不对时抛 Error，消息写人话（中文），外层转成 isError。
 * - 不写死任何一门语言的术语：名字、缩写、维度都从项目里读。
 * - 这个文件会被 vitest 直接 import，所以不能碰 `.svelte.ts`（那边的 `$state` 在测试里没有）。
 */
import type {
  GrammaticalCategory,
  Id,
  Language,
  Lexeme,
  LocalizedText,
  Paradigm,
  PartOfSpeech,
  Project,
  RuleSet,
  Sentence
} from '$lib/core/model'
import { createLexeme, createSense, createSentence } from '$lib/core/factory'
import { matchQuery, parseQuery } from '$lib/core/query'
import { SEARCH_FIELDS, categoryFields, featureValueTexts } from '$lib/core/searchFields'
import { findPos, lexemePosIds } from '$lib/core/pos'
import { languageParseOptions } from '$lib/engine/phon'
import { parseRuleText, runRules } from '$lib/engine/sca'
import { analyzeSentence, coverage } from '$lib/engine/gloss'
import {
  generateForm,
  lexemeParadigmLabel,
  lexemeSlots,
  makeContext,
  paradigmSlots,
  paradigmsFor,
  type SlotDef
} from '$lib/engine/morph'
import { lexemeScript } from '$lib/script/render'

export interface McpToolDef {
  name: string
  description: string
  /** JSON Schema（object 类型），每个字段都写 description */
  inputSchema: Record<string, unknown>
  /** 会不会改项目：写操作由外层决定要不要先问用户 */
  write?: boolean
  run: (args: Record<string, unknown>, ctx: McpContext) => unknown | Promise<unknown>
}

export interface McpContext {
  /** 当前打开的项目；没有就抛错（外层会把错误转成 isError） */
  project: () => Project
  /** 改项目：回调里改，外层负责 touch / 撤销栈 */
  edit: (fn: (p: Project) => void) => void
  /** 顶栏「当前语言」，可能为 null */
  currentLanguageId: () => Id | null
}

// ───────────────────────── 上限 ─────────────────────────

/** search_lexicon 一次最多给多少条 */
const SEARCH_LIMIT_MAX = 100
const SEARCH_LIMIT_DEFAULT = 20
/** run_sound_changes 一次最多推多少个词 */
const WORDS_MAX = 100
/** derive_forms 一次最多列多少个槽位 */
const FORMS_MAX = 300
/** project_info 里每一类最多列多少项 */
const LIST_MAX = 200
/** gloss_sentence 一次最多分析多长的句子（字符） */
const TEXT_MAX = 2000

// ───────────────────────── 小工具 ─────────────────────────

/**
 * 多语言文字挑一条：按释义语言顺序找，都没有就拿第一个非空的。
 * （i18n 那边的 pickText 在 `.svelte.ts` 里，这里自己写一个纯函数。）
 */
function pick(text: LocalizedText | undefined, langs: readonly string[] = []): string {
  if (!text) return ''
  for (const l of langs) if (text[l]?.trim()) return text[l]
  return Object.values(text).find((v) => v?.trim()) ?? ''
}

function glossLangs(project: Project): string[] {
  return project.settings.glossLanguages ?? []
}

/** 写进哪个语言的释义：释义语言的头一个，一个都没设就用 en */
function writeLang(project: Project): string {
  return glossLangs(project)[0] ?? 'en'
}

function fail(message: string): never {
  throw new Error(message)
}

// ── 参数读取：类型不对就抛错，消息里带上字段名 ──

function optText(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  if (v == null) return undefined
  if (typeof v !== 'string') fail(`参数 ${key} 要是文字`)
  const s = v.trim()
  return s ? s : undefined
}

function needText(args: Record<string, unknown>, key: string): string {
  return optText(args, key) ?? fail(`缺少参数 ${key}`)
}

/** 允许写空串的文字参数（备注这类要能清空） */
function rawText(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  if (v == null) return undefined
  if (typeof v !== 'string') fail(`参数 ${key} 要是文字`)
  return v
}

function optList(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key]
  if (v == null) return undefined
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) fail(`参数 ${key} 要是一串文字`)
  return (v as string[]).map((s) => s.trim()).filter(Boolean)
}

function optInt(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const v = args[key]
  if (v == null) return fallback
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) fail(`参数 ${key} 要是数字`)
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

// ── JSON Schema 小助手 ──

function str(description: string): Record<string, unknown> {
  return { type: 'string', description }
}

function strList(description: string): Record<string, unknown> {
  return { type: 'array', items: { type: 'string' }, description }
}

function int(description: string, minimum: number, maximum: number): Record<string, unknown> {
  return { type: 'integer', description, minimum, maximum }
}

function schema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return { type: 'object', properties, required }
}

// ── 找东西 ──

function languageLabel(l: Language): string {
  return l.abbr ? `${l.name}（${l.abbr}，${l.id}）` : `${l.name}（${l.id}）`
}

/** 按 id 找语言；找不到再按名称、缩写找（大小写不论）；都没有就抛错并列出有哪些 */
function findLanguage(project: Project, idOrName: string): Language {
  const hit = project.languages.find((l) => l.id === idOrName)
  if (hit) return hit
  const key = idOrName.trim().toLowerCase()
  const byName = project.languages.filter(
    (l) => l.name.trim().toLowerCase() === key || l.abbr.trim().toLowerCase() === key
  )
  if (byName.length === 1) return byName[0]
  if (byName.length > 1)
    fail(
      `有几门语言都叫「${idOrName}」，请用 languageId 指定：${byName.map(languageLabel).join('、')}`
    )
  const all = project.languages.map(languageLabel).join('、') || '（项目里还没有语言）'
  return fail(`没有这门语言：${idOrName}。项目里有：${all}`)
}

/** 没给 languageId 时用哪门语言：顶栏当前语言 → 项目里只有一门时就是它 → 否则要求指定 */
function defaultLanguage(project: Project, ctx: McpContext): Language {
  const cur = ctx.currentLanguageId()
  if (cur) {
    const l = project.languages.find((x) => x.id === cur)
    if (l) return l
  }
  if (project.languages.length === 1) return project.languages[0]
  if (!project.languages.length) fail('项目里还没有语言')
  return fail(
    `项目里有几门语言，请用 languageId 指定：${project.languages.map(languageLabel).join('、')}`
  )
}

function languageOf(project: Project, ctx: McpContext, args: Record<string, unknown>): Language {
  const given = optText(args, 'languageId')
  return given ? findLanguage(project, given) : defaultLanguage(project, ctx)
}

function posLabel(project: Project, l: Lexeme): string {
  const ids = lexemePosIds(project, l)
  const names = ids
    .map((id) => findPos(project, id))
    .map((p) => (p ? pick(p.name, glossLangs(project)) || p.abbr : ''))
    .filter(Boolean)
  return names.join('/')
}

function senseBrief(project: Project, l: Lexeme): string {
  const langs = glossLangs(project)
  return l.senses
    .map((s) => pick(s.definition, langs))
    .filter(Boolean)
    .join('；')
}

/** 按 id 找词条；没有 id 就按词头找（限定语言），找到几条时让调用方用 id 再来一次 */
function findLexeme(project: Project, args: Record<string, unknown>, lemmaKey = 'lemma'): Lexeme {
  const id = optText(args, 'id') ?? optText(args, 'lexemeId')
  if (id) {
    const hit = project.lexemes.find((l) => l.id === id)
    return hit ?? fail(`没有这条词条：${id}`)
  }
  const lemma = optText(args, lemmaKey)
  if (!lemma) fail(`请给出词条 id，或者用 ${lemmaKey} 指定词头`)
  const langId = optText(args, 'languageId')
    ? findLanguage(project, optText(args, 'languageId')!).id
    : null
  const key = lemma.trim().toLowerCase()
  const hits = project.lexemes.filter(
    (l) => l.lemma.trim().toLowerCase() === key && (!langId || l.languageId === langId)
  )
  if (!hits.length) fail(`词库里没有「${lemma}」这个词头`)
  if (hits.length > 1)
    fail(
      `词头「${lemma}」有 ${hits.length} 条词条，请用 id 指定：` +
        hits.map((l) => `${l.id}（${senseBrief(project, l) || '没有释义'}）`).join('、')
    )
  return hits[0]
}

/** 词类：按 id、缩写、名称找；找不到就列出项目里有哪些（不擅自新建） */
function findPosByAny(project: Project, text: string): PartOfSpeech {
  const hit = findPos(project, text)
  if (hit) return hit
  const key = text.trim().toLowerCase()
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\.$/, '')
  const byName = project.posList.filter(
    (p) =>
      norm(p.abbr) === norm(key) ||
      Object.values(p.name).some((n) => n.trim().toLowerCase() === key)
  )
  if (byName.length) return byName[0]
  const all =
    project.posList
      .map((p) => `${pick(p.name, glossLangs(project)) || p.abbr}（${p.id}）`)
      .join('、') || '（项目里还没有词类）'
  return fail(`没有这个词类：${text}。项目里有：${all}`)
}

function categoryBrief(c: GrammaticalCategory, langs: string[]): Record<string, unknown> {
  return {
    id: c.id,
    name: pick(c.name, langs),
    values: c.values.slice(0, LIST_MAX).map((v) => ({
      id: v.id,
      name: pick(v.name, langs),
      abbr: v.abbr
    })),
    posIds: c.posIds?.length ? c.posIds : undefined
  }
}

/** 词条的语法特征读成「维度名 → 取值名」 */
function featureLabels(project: Project, features: Record<Id, Id>): Record<string, string> {
  const langs = glossLangs(project)
  const out: Record<string, string> = {}
  for (const [cid, vid] of Object.entries(features)) {
    const c = project.categories.find((x) => x.id === cid)
    const v = c?.values.find((x) => x.id === vid)
    if (c && v) out[pick(c.name, langs) || c.id] = pick(v.name, langs) || v.abbr || v.id
  }
  return out
}

/**
 * 词条在某个字段里的文字（field 为 null 时是默认那一组）。
 * 跟词库页的搜索保持一致——那边在 Lexicon.svelte 里，这里是同一套字段的纯函数版。
 */
function lexemeFieldValues(project: Project, l: Lexeme, field: string | null): string[] {
  const defs = (): string[] =>
    l.senses.flatMap((se) => [...Object.values(se.definition), ...se.registers])
  const forms = (): string[] => Object.values(l.forms).map((f) => f.surface)
  const ipa = (): string[] => Object.values(l.pronunciations).map((pr) => pr.ipa)
  const etym = (): string[] => [
    l.etymology.notes,
    ...l.etymology.stages.map((st) => st.form),
    ...l.etymology.sources.flatMap((src) =>
      src.kind === 'external' ? [src.form, src.meaning] : []
    )
  ]
  const dialects = (): string[] => {
    const lg = project.languages.find((x) => x.id === l.languageId)
    return (lg?.dialects ?? [])
      .filter((d) => l.dialectIds.includes(d.id))
      .flatMap((d) => [d.name, d.abbr])
  }
  switch (field) {
    case 'word':
      return [l.lemma]
    case 'gloss':
      return defs()
    case 'form':
      return forms()
    case 'stem':
      return Object.values(l.stems)
    case 'ipa':
      return ipa()
    case 'pos':
      return lexemePosIds(project, l).flatMap((id) => {
        const p = findPos(project, id)
        return p ? [...Object.values(p.name), p.abbr] : []
      })
    case 'tag':
      return l.tags
    case 'register':
      return l.senses.flatMap((se) => se.registers)
    case 'etym':
      return etym()
    case 'note':
      return [l.notes]
    case 'script': {
      const lg = project.languages.find((x) => x.id === l.languageId)
      return lg ? lg.scripts.map((sc) => lexemeScript(lg, sc, l)) : []
    }
    case 'feature':
      return featureValueTexts(project.categories, l.features)
    case 'dialect':
      return dialects()
    default:
      if (field?.startsWith('custom:')) return [l.custom?.[field.slice(7)] ?? '']
      if (field?.startsWith('feat:'))
        return featureValueTexts(project.categories, l.features, field.slice(5))
      return [
        l.lemma,
        l.notes,
        ...Object.values(l.custom ?? {}),
        ...l.tags,
        ...defs(),
        ...Object.values(l.stems),
        ...forms(),
        ...ipa(),
        ...Object.values(l.scriptForms ?? {}),
        ...etym()
      ]
  }
}

/** 音变文本里的阶段标记（`-* 名字`）：project_info 不值得为它解析整套规则 */
function markerNames(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*-\*(.*)$/.exec(raw.split(';')[0])
    if (!m) continue
    const name = m[1].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 按 id 或名字找一套音变；只有一套时可以不指定 */
function findRuleSet(project: Project, args: Record<string, unknown>): RuleSet {
  const id = optText(args, 'ruleSetId')
  if (id) {
    const hit = project.ruleSets.find((r) => r.id === id)
    if (hit) return hit
  }
  const name = optText(args, 'ruleSetName') ?? id
  if (name) {
    const key = name.trim().toLowerCase()
    const hit = project.ruleSets.find((r) => r.name.trim().toLowerCase() === key)
    if (hit) return hit
  }
  if (!name && project.ruleSets.length === 1) return project.ruleSets[0]
  const all =
    project.ruleSets.map((r) => `${r.name}（${r.id}）`).join('、') || '（项目里还没有音变）'
  if (name) fail(`没有这套音变：${name}。项目里有：${all}`)
  return fail(`项目里有几套音变，请用 ruleSetId 或 ruleSetName 指定：${all}`)
}

/** 这套音变按哪门语言解析：绑了阶段语言就用它，否则用当前语言 */
function ruleSetLanguage(project: Project, ctx: McpContext, rs: RuleSet): Language | null {
  const boundId = Object.values(rs.stageLanguages ?? {}).find((id) => !!id)
  if (boundId) {
    const l = project.languages.find((x) => x.id === boundId)
    if (l) return l
  }
  const cur = ctx.currentLanguageId()
  return (cur ? project.languages.find((x) => x.id === cur) : null) ?? project.languages[0] ?? null
}

/** 按 id 或名字找构形 */
function findParadigm(project: Project, text: string): Paradigm {
  const hit = project.paradigms.find((p) => p.id === text)
  if (hit) return hit
  const key = text.trim().toLowerCase()
  const byName = project.paradigms.find((p) =>
    Object.values(p.name).some((n) => n.trim().toLowerCase() === key)
  )
  if (byName) return byName
  const all =
    project.paradigms.map((p) => `${pick(p.name, glossLangs(project))}（${p.id}）`).join('、') ||
    '（项目里还没有构形）'
  return fail(`没有这套构形：${text}。项目里有：${all}`)
}

// ───────────────────────── 工具 ─────────────────────────

function toolProjectInfo(): McpToolDef {
  return {
    name: 'project_info',
    description:
      '当前打开的造语项目概况：项目名、各语言（id、名字、缩写、词条数）、词类、语法维度、有哪几套音变与构形。别的工具要的 id 都从这里拿。',
    inputSchema: schema({}),
    run: (_args, ctx) => {
      const project = ctx.project()
      const langs = glossLangs(project)
      const countBy = <T extends { languageId: Id }>(arr: T[]): Map<Id, number> => {
        const m = new Map<Id, number>()
        for (const x of arr) m.set(x.languageId, (m.get(x.languageId) ?? 0) + 1)
        return m
      }
      const lexCount = countBy(project.lexemes)
      const morphCount = countBy(project.morphemes)
      const sentCount = countBy(project.sentences)
      return {
        name: project.meta.name,
        description: project.meta.description,
        glossLanguages: langs,
        currentLanguageId: ctx.currentLanguageId(),
        languages: project.languages.slice(0, LIST_MAX).map((l) => ({
          id: l.id,
          name: l.name,
          abbr: l.abbr,
          parentId: l.parentId,
          lexemes: lexCount.get(l.id) ?? 0,
          morphemes: morphCount.get(l.id) ?? 0,
          sentences: sentCount.get(l.id) ?? 0,
          orthographies: l.orthographies.map((o) => ({
            id: o.id,
            name: o.name,
            primary: !!o.isPrimary
          })),
          scripts: l.scripts.map((s) => ({ id: s.id, name: s.name })),
          dialects: l.dialects.map((d) => ({ id: d.id, name: d.name, abbr: d.abbr }))
        })),
        posList: project.posList.slice(0, LIST_MAX).map((p) => ({
          id: p.id,
          name: pick(p.name, langs),
          abbr: p.abbr,
          paradigmId: p.paradigmId,
          components: p.components?.length ? p.components : undefined
        })),
        categories: project.categories.slice(0, LIST_MAX).map((c) => categoryBrief(c, langs)),
        ruleSets: project.ruleSets.slice(0, LIST_MAX).map((r) => ({
          id: r.id,
          name: r.name,
          stages: markerNames(r.text)
        })),
        paradigms: project.paradigms.slice(0, LIST_MAX).map((p) => ({
          id: p.id,
          name: pick(p.name, langs),
          dimensions: p.dimensionIds
            .map((id) => project.categories.find((c) => c.id === id))
            .filter((c): c is GrammaticalCategory => !!c)
            .map((c) => pick(c.name, langs) || c.id),
          variants: p.variants.map((v) => ({ id: v.id, name: v.name })),
          appliesToAll: !!p.appliesToAll
        })),
        counts: {
          languages: project.languages.length,
          lexemes: project.lexemes.length,
          morphemes: project.morphemes.length,
          sentences: project.sentences.length,
          phrases: project.phrasebook.length,
          docs: project.docs.length
        }
      }
    }
  }
}

function toolSearchLexicon(): McpToolDef {
  return {
    name: 'search_lexicon',
    description:
      '按词库搜索语法找词条。普通文字在词头、释义、标签等里找；也可以写「字段=内容」，字段有 word/gloss/form/stem/ipa/pos/tag/register/etym/note/script/feature/dialect，以及语法维度的名字；「字段==内容」要整格相等，「/正则/」按正则找，几个条件用空格隔开要全部满足。不给 languageId 就搜所有语言。',
    inputSchema: schema(
      {
        query: str('搜索式，如 kala、gloss=水、pos=名词 tag=古语、/^ka/'),
        languageId: str('只搜这门语言（语言 id，也认名称或缩写）；不给就搜所有语言'),
        limit: int(`最多返回多少条，默认 ${SEARCH_LIMIT_DEFAULT}`, 1, SEARCH_LIMIT_MAX)
      },
      ['query']
    ),
    run: (args, ctx) => {
      const project = ctx.project()
      const query = needText(args, 'query')
      const langText = optText(args, 'languageId')
      const lang = langText ? findLanguage(project, langText) : null
      const limit = optInt(args, 'limit', SEARCH_LIMIT_DEFAULT, 1, SEARCH_LIMIT_MAX)
      const fields = [
        ...SEARCH_FIELDS.lexicon,
        ...categoryFields(project.categories),
        ...project.customFields.map((f) => ({
          key: `custom:${f.id}`,
          aliases: [...Object.values(f.name).filter(Boolean), ...f.aliases]
        }))
      ]
      const pq = parseQuery(query, fields)
      if (!pq.terms.length) fail('搜索式是空的')
      const langs = glossLangs(project)
      const pool = lang ? project.lexemes.filter((l) => l.languageId === lang.id) : project.lexemes
      const hits = pool.filter((l) => matchQuery(pq, (f) => lexemeFieldValues(project, l, f)))
      return {
        query,
        errors: pq.errors.length ? pq.errors : undefined,
        total: hits.length,
        truncated: hits.length > limit,
        results: hits.slice(0, limit).map((l) => ({
          id: l.id,
          languageId: l.languageId,
          lemma: l.lemma,
          pos: posLabel(project, l),
          senses: l.senses.map((s) => ({
            definition: pick(s.definition, langs),
            register: s.registers.length ? s.registers.join('、') : undefined
          })),
          tags: l.tags
        }))
      }
    }
  }
}

function toolGetEntry(): McpToolDef {
  return {
    name: 'get_entry',
    description:
      '取一条词条的完整信息：义项、词干、屈折形（写明是推导的还是手改的）、发音、词源、关系、标签、语法特征。给 id 最准；只给 lemma 时按词头找，重名会让你改用 id。',
    inputSchema: schema({
      id: str('词条 id（search_lexicon 的结果里有）'),
      lemma: str('词头；没给 id 时按它找'),
      languageId: str('按词头找时限定哪门语言（语言 id，也认名称或缩写）')
    }),
    run: (args, ctx) => {
      const project = ctx.project()
      const l = findLexeme(project, args)
      const lang = project.languages.find((x) => x.id === l.languageId)
      const langs = glossLangs(project)
      const orthoName = (id: Id): string => lang?.orthographies.find((o) => o.id === id)?.name ?? id
      const slotKeys = new Map(lexemeSlots(project, l).map((s) => [s.key, s]))
      return {
        id: l.id,
        languageId: l.languageId,
        language: lang?.name ?? '',
        lemma: l.lemma,
        pos: posLabel(project, l),
        tags: l.tags,
        notes: l.notes,
        features: featureLabels(project, l.features),
        dialects: (lang?.dialects ?? [])
          .filter((d) => l.dialectIds.includes(d.id))
          .map((d) => d.name),
        senses: l.senses.map((s) => ({
          id: s.id,
          definition: pick(s.definition, langs),
          definitions: s.definition,
          registers: s.registers,
          tags: s.tags,
          pos: s.posId ? (pick(findPos(project, s.posId)?.name, langs) ?? '') : undefined
        })),
        pronunciations: Object.entries(l.pronunciations).map(([id, pr]) => ({
          orthography: orthoName(id),
          ipa: pr.ipa,
          irregular: pr.irregular
        })),
        stems: l.stems,
        forms: Object.entries(l.forms).map(([key, f]) => ({
          slot: key,
          abbr: slotKeys.get(key)?.slot.abbr ?? '',
          surface: f.surface,
          ipa: f.ipa || undefined,
          // derived 是构形推出来的，override 是用户在推导值上手改的；两个都不是就是纯手填
          derived: f.derived,
          manual: !f.derived || f.override
        })),
        etymology: {
          type: l.etymology.type,
          notes: l.etymology.notes,
          stages: l.etymology.stages.map((s) => ({ form: s.form, type: s.type, notes: s.notes })),
          sources: l.etymology.sources.map((s) =>
            s.kind === 'external'
              ? { kind: s.kind, language: s.language, form: s.form, meaning: s.meaning }
              : {
                  kind: s.kind,
                  id: s.id,
                  form:
                    s.kind === 'lexeme'
                      ? (project.lexemes.find((x) => x.id === s.id)?.lemma ?? '')
                      : (project.morphemes.find((x) => x.id === s.id)?.form ?? '')
                }
          )
        },
        relations: l.relations.map((r) => ({
          kind: r.kind,
          lexemeId: r.lexemeId,
          lemma: project.lexemes.find((x) => x.id === r.lexemeId)?.lemma ?? ''
        })),
        scriptForms: Object.entries(l.scriptForms ?? {}).map(([id, text]) => ({
          script: lang?.scripts.find((s) => s.id === id)?.name ?? id,
          text
        })),
        custom: Object.entries(l.custom ?? {}).map(([id, text]) => ({
          field: pick(project.customFields.find((f) => f.id === id)?.name, langs) || id,
          text
        }))
      }
    }
  }
}

function toolRunSoundChanges(): McpToolDef {
  return {
    name: 'run_sound_changes',
    description:
      '拿项目里的一套音变推词形：每个词给出各阶段的中间形式与最终形式。只算不写，不会改项目。',
    inputSchema: schema(
      {
        words: strList(`要推的词，最多 ${WORDS_MAX} 个`),
        ruleSetId: str('音变的 id；项目里只有一套时可以不给'),
        ruleSetName: str('音变的名字，跟 ruleSetId 二选一'),
        fromStage: str('输入已经是这个阶段的形式，从它之后开始推（阶段名见 project_info）'),
        toStage: str('推到这个阶段为止')
      },
      ['words']
    ),
    run: (args, ctx) => {
      const project = ctx.project()
      const words = optList(args, 'words') ?? []
      if (!words.length) fail('请给出至少一个词')
      if (words.length > WORDS_MAX)
        fail(`一次最多推 ${WORDS_MAX} 个词，这次给了 ${words.length} 个`)
      const rs = findRuleSet(project, args)
      const lang = ruleSetLanguage(project, ctx, rs)
      const program = parseRuleText(rs.text, languageParseOptions(lang, project))
      const from = optText(args, 'fromStage')
      const to = optText(args, 'toStage')
      const stageList = program.markers.join('、') || '（这套音变没有分阶段）'
      if (from && !program.markers.includes(from))
        fail(`没有这个阶段：${from}。有的是：${stageList}`)
      if (to && !program.markers.includes(to)) fail(`没有这个阶段：${to}。有的是：${stageList}`)
      return {
        ruleSet: { id: rs.id, name: rs.name },
        languageId: lang?.id ?? null,
        stages: program.markers,
        diagnostics: program.diagnostics.length ? program.diagnostics : undefined,
        results: words.map((w) => {
          const r = runRules(program, w, { startAt: from, stopAt: to })
          return {
            input: r.input,
            output: r.output,
            stages: r.stages.map((s) => ({ name: s.name, form: s.form }))
          }
        })
      }
    }
  }
}

function toolGlossSentence(): McpToolDef {
  return {
    name: 'gloss_sentence',
    description: '按词库和语素表给一句话分词并逐词 gloss。只是试算，不会把句子存进语料。',
    inputSchema: schema(
      {
        text: str('要分析的句子（用这门语言自己的拼写）'),
        languageId: str('哪门语言（语言 id，也认名称或缩写）；不给就用当前语言')
      },
      ['text']
    ),
    run: (args, ctx) => {
      const project = ctx.project()
      const text = needText(args, 'text')
      if (text.length > TEXT_MAX) fail(`句子太长了（最多 ${TEXT_MAX} 个字符）`)
      const lang = languageOf(project, ctx, args)
      // 临时句子：只为了借 analyzeSentence 的分词与候选排序，不进项目
      const draft = createSentence(lang.id)
      draft.text = text
      analyzeSentence(project, draft)
      const cov = coverage(draft)
      return {
        languageId: lang.id,
        text,
        coverage: cov,
        tokens: draft.tokens.map((t) => {
          const a = t.analyses[t.chosen]
          const lex = a?.lexemeId ? project.lexemes.find((x) => x.id === a.lexemeId) : undefined
          return {
            surface: t.surface,
            lemma: lex?.lemma ?? '',
            lexemeId: a?.lexemeId ?? null,
            slot: a?.slot ?? null,
            gloss: (a?.morphs ?? []).map((m) => m.gloss).join('-'),
            morphs: (a?.morphs ?? []).map((m) => ({
              form: m.form,
              gloss: m.gloss,
              morphemeId: m.morphemeId,
              lexemeId: m.lexemeId ?? null
            })),
            // 猜出来的（去附加符、拆成两个词）在软件里要人确认才算认出
            guess: a?.guess,
            alternatives: Math.max(0, t.analyses.length - 1)
          }
        })
      }
    }
  }
}

function toolDeriveForms(): McpToolDef {
  return {
    name: 'derive_forms',
    description:
      '按构形把一个词条的全部槽位推一遍，附带每一格的推导轨迹。只算不写，不会把形式存进词条。',
    inputSchema: schema({
      lexemeId: str('词条 id'),
      lemma: str('词头；没给 lexemeId 时按它找'),
      languageId: str('按词头找时限定哪门语言'),
      paradigmId: str('只推这一套构形（id 或名字）；不给就推这个词条用到的每一套'),
      variantId: str('用构形的哪个变体（id 或名字）；不给就用词条自己选的那一套')
    }),
    run: (args, ctx) => {
      const project = ctx.project()
      const lexeme = findLexeme(project, args)
      const lang = project.languages.find((x) => x.id === lexeme.languageId)
      if (!lang) fail(`词条「${lexeme.lemma}」所属的语言已经不在项目里了`)
      const langs = glossLangs(project)
      const wanted = optText(args, 'paradigmId')
      const variantText = optText(args, 'variantId')
      let pairs = paradigmsFor(project, lexeme).map((lp) => ({
        paradigm: lp.paradigm,
        variantId: lp.variantId,
        label: lexemeParadigmLabel(lp, langs)
      }))
      if (wanted) {
        const p = findParadigm(project, wanted)
        const hit = pairs.find((x) => x.paradigm.id === p.id)
        pairs = [
          hit ?? {
            paradigm: p,
            variantId: null,
            label: pick(p.name, langs) || p.id
          }
        ]
      }
      if (variantText) {
        pairs = pairs.map((x) => {
          const v = x.paradigm.variants.find(
            (y) => y.id === variantText || y.name.trim() === variantText.trim()
          )
          if (!v)
            fail(
              `构形「${pick(x.paradigm.name, langs)}」没有这个变体：${variantText}。有的是：` +
                (x.paradigm.variants.map((y) => `${y.name}（${y.id}）`).join('、') ||
                  '（没有变体）')
            )
          return { ...x, variantId: v.id }
        })
      }
      if (!pairs.length) fail(`词条「${lexeme.lemma}」没有绑定构形（词条自己没指定，词类也没绑）`)
      const ctxMorph = makeContext(project, lang)
      const keyOf = new Map(
        lexemeSlots(project, lexeme).map((s) => [
          `${s.lp.paradigm.id}#${s.lp.variantId ?? ''}#${s.slot.key}`,
          s.key
        ])
      )
      let left = FORMS_MAX
      let truncated = false
      const out = pairs.map((x) => {
        const defs: SlotDef[] = paradigmSlots(
          x.paradigm,
          project.categories,
          langs,
          false,
          !project.settings.complexSlots
        )
        const take = defs.slice(0, Math.max(0, left))
        if (take.length < defs.length) truncated = true
        left -= take.length
        return {
          paradigmId: x.paradigm.id,
          name: x.label,
          variantId: x.variantId,
          slots: take.map((s) => {
            const g = generateForm(ctxMorph, lexeme, x.paradigm, s, x.variantId)
            const storeKey = keyOf.get(`${x.paradigm.id}#${x.variantId ?? ''}#${s.key}`) ?? s.label
            const stored = lexeme.forms[storeKey]
            return {
              slot: s.label,
              abbr: s.abbr,
              key: storeKey,
              surface: g?.surface ?? '',
              ipa: g?.ipa || undefined,
              trace: g?.trace ?? [],
              // 词条里存着的形式跟现在推出来的不一样：多半是手改过
              stored: stored ? stored.surface : undefined,
              manual: stored ? !stored.derived || stored.override : undefined
            }
          })
        }
      })
      return {
        lexemeId: lexeme.id,
        lemma: lexeme.lemma,
        languageId: lexeme.languageId,
        truncated,
        paradigms: out
      }
    }
  }
}

function toolAddEntry(): McpToolDef {
  return {
    name: 'add_entry',
    description: '往词库里加一条新词条，返回新词条的 id。',
    inputSchema: schema(
      {
        lemma: str('词头'),
        definition: str('第一个义项的释义（写进释义语言的头一个）'),
        languageId: str('加到哪门语言（语言 id，也认名称或缩写）；不给就用当前语言'),
        pos: str('词类：id、缩写或名字，必须是项目里已有的'),
        tags: strList('标签')
      },
      ['lemma', 'definition']
    ),
    write: true,
    run: (args, ctx) => {
      const project = ctx.project()
      const lemma = needText(args, 'lemma')
      const definition = needText(args, 'definition')
      const lang = languageOf(project, ctx, args)
      const posText = optText(args, 'pos')
      const pos = posText ? findPosByAny(project, posText) : null
      const tags = optList(args, 'tags') ?? []
      const key = writeLang(project)
      let id = ''
      ctx.edit((p) => {
        const l = createLexeme(lang.id, lemma)
        l.posId = pos?.id ?? null
        l.tags = tags
        l.senses[0].definition = { [key]: definition }
        p.lexemes.push(l)
        id = l.id
      })
      return {
        id,
        lemma,
        languageId: lang.id,
        pos: pos ? pick(pos.name, glossLangs(project)) || pos.abbr : '',
        tags
      }
    }
  }
}

function toolUpdateEntry(): McpToolDef {
  return {
    name: 'update_entry',
    description: '改一条已有词条，只改传了的字段；没传的原样不动。',
    inputSchema: schema(
      {
        id: str('要改的词条 id'),
        lemma: str('新的词头'),
        definition: str('第一个义项的释义（写进释义语言的头一个）'),
        tags: strList('新的标签，整组替换'),
        notes: str('备注')
      },
      ['id']
    ),
    write: true,
    run: (args, ctx) => {
      const project = ctx.project()
      const id = needText(args, 'id')
      if (!project.lexemes.some((l) => l.id === id)) fail(`没有这条词条：${id}`)
      const lemma = optText(args, 'lemma')
      const definition = optText(args, 'definition')
      const tags = optList(args, 'tags')
      const notes = rawText(args, 'notes')
      if (lemma == null && definition == null && tags == null && notes == null)
        fail('没有要改的字段：lemma、definition、tags、notes 至少给一个')
      const key = writeLang(project)
      const changed: string[] = []
      ctx.edit((p) => {
        const l = p.lexemes.find((x) => x.id === id)
        if (!l) fail(`没有这条词条：${id}`)
        if (lemma != null) {
          l.lemma = lemma
          changed.push('lemma')
        }
        if (definition != null) {
          if (!l.senses.length) l.senses.push(createSense())
          l.senses[0].definition = { ...l.senses[0].definition, [key]: definition }
          changed.push('definition')
        }
        if (tags != null) {
          l.tags = tags
          changed.push('tags')
        }
        if (notes != null) {
          l.notes = notes
          changed.push('notes')
        }
        l.updatedAt = new Date().toISOString()
      })
      return { id, changed }
    }
  }
}

function toolAddSentence(): McpToolDef {
  return {
    name: 'add_sentence',
    description: '往语料里加一句，并马上自动分词、逐词 gloss；返回分析结果与认出率。',
    inputSchema: schema(
      {
        text: str('句子原文'),
        translation: str('译文（写进释义语言的头一个）'),
        languageId: str('哪门语言（语言 id，也认名称或缩写）；不给就用当前语言'),
        source: str('出处')
      },
      ['text']
    ),
    write: true,
    run: (args, ctx) => {
      const project = ctx.project()
      const text = needText(args, 'text')
      if (text.length > TEXT_MAX) fail(`句子太长了（最多 ${TEXT_MAX} 个字符）`)
      const lang = languageOf(project, ctx, args)
      const translation = optText(args, 'translation')
      const source = optText(args, 'source')
      const key = writeLang(project)
      // 装在对象里：回调里赋的值，外面才拿得到（直接用变量会被窄化成 null）
      const box: { sentence: Sentence | null } = { sentence: null }
      ctx.edit((p) => {
        const draft = createSentence(lang.id)
        draft.text = text
        if (translation) draft.translation = { [key]: translation }
        if (source) draft.source = source
        p.sentences.push(draft)
        analyzeSentence(p, draft)
        box.sentence = draft
      })
      const s = box.sentence
      if (!s) fail('没能加进语料')
      const cov = coverage(s)
      return {
        id: s.id,
        languageId: s.languageId,
        text: s.text,
        coverage: cov,
        tokens: s.tokens.map((t) => {
          const a = t.analyses[t.chosen]
          return {
            surface: t.surface,
            lexemeId: a?.lexemeId ?? null,
            gloss: (a?.morphs ?? []).map((m) => m.gloss).join('-'),
            guess: a?.guess,
            alternatives: Math.max(0, t.analyses.length - 1)
          }
        })
      }
    }
  }
}

/** 第一版的全部工具；顺序就是给 LLM 看的顺序 */
export function mcpTools(): McpToolDef[] {
  const tools: McpToolDef[] = [
    toolProjectInfo(),
    toolSearchLexicon(),
    toolGetEntry(),
    toolRunSoundChanges(),
    toolGlossSentence(),
    toolDeriveForms(),
    toolAddEntry(),
    toolUpdateEntry(),
    toolAddSentence()
  ]
  return tools
}
