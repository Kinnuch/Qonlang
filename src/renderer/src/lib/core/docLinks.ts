/**
 * 文档页里的 `[[…]]` 链接：写法解析 + 在项目里找目标。
 *
 * 写法：`[[名字]]` 不带前缀时先当词条找；带前缀时按类型找（`[[语素:na-]]`、`[[morpheme:na-]]` 一样认），
 * 音变规则集与构形还能用 `#` 指到里面的一条（`[[音变:甲 → 乙#现代语]]`、`[[构形:名词#单数.主格]]`）；
 * `|` 后面写显示文字。前缀是固定的中英两套词，跟界面语言无关——换了界面语言，文档里的链接照样有效。
 *
 * 纯逻辑，不碰界面：找到什么交给文档页去画、去跳转。
 */
import type { Id, LocalizedText, Project } from './model'
import { paradigmSlots } from '$lib/engine/morph'

/** 能链过去的东西 */
export type DocLinkKind =
  | 'lexeme'
  | 'morpheme'
  | 'language'
  | 'ruleSet'
  | 'paradigm'
  | 'script'
  | 'sentence'
  | 'phrase'
  | 'doc'

/** 不带前缀时按这个顺序找：先词条（一直以来的写法），再往下试 */
export const DOC_LINK_KINDS: DocLinkKind[] = [
  'lexeme',
  'morpheme',
  'doc',
  'phrase',
  'sentence',
  'language',
  'paradigm',
  'ruleSet',
  'script'
]

/** 能用 `#` 再指到里面一条的类型：规则集里的阶段、构形里的槽位 */
export const DOC_LINK_SUB_KINDS: ReadonlySet<DocLinkKind> = new Set<DocLinkKind>([
  'ruleSet',
  'paradigm'
])

/**
 * 前缀：中英两套都认，大小写、空格、连字符忽略（`sound change` = `soundchange`）。
 * 每一套的第一个是插入链接时写进去的那个。
 */
const PREFIXES: Record<DocLinkKind, { zh: string[]; en: string[] }> = {
  lexeme: { zh: ['词条', '词'], en: ['lexeme', 'word', 'entry'] },
  morpheme: { zh: ['语素', '词缀'], en: ['morpheme', 'affix'] },
  language: { zh: ['语言'], en: ['language', 'lang'] },
  ruleSet: { zh: ['音变', '规则集'], en: ['soundchange', 'ruleset', 'rules'] },
  paradigm: { zh: ['构形', '范式'], en: ['paradigm', 'inflection'] },
  script: { zh: ['文字'], en: ['script', 'writing'] },
  sentence: { zh: ['例句', '语料'], en: ['sentence', 'corpus'] },
  phrase: { zh: ['短语'], en: ['phrase'] },
  doc: { zh: ['文档', '页面'], en: ['doc', 'document', 'page'] }
}

/** 每种东西在哪一页、跳过去时报的是哪个 kind */
export const DOC_LINK_TARGET: Record<DocLinkKind, { section: string; pending: string }> = {
  lexeme: { section: 'lexicon', pending: 'lexeme' },
  morpheme: { section: 'morphemes', pending: 'morpheme' },
  language: { section: 'languages', pending: 'language' },
  ruleSet: { section: 'soundChanges', pending: 'ruleSet' },
  paradigm: { section: 'paradigms', pending: 'paradigm' },
  script: { section: 'script', pending: 'script' },
  sentence: { section: 'corpus', pending: 'sentence' },
  phrase: { section: 'phrasebook', pending: 'phrase' },
  doc: { section: 'docs', pending: 'doc' }
}

/** 插入链接时用哪个前缀（词条不写前缀，保持一直以来的 `[[词头]]`） */
export function docLinkPrefix(kind: DocLinkKind, locale: string): string {
  if (kind === 'lexeme') return ''
  const set = PREFIXES[kind]
  return (locale === 'zh' ? set.zh[0] : set.en[0]) ?? set.en[0]
}

/** 拼一条链接文本 */
export function formatDocLink(kind: DocLinkKind, name: string, sub = '', locale = 'zh'): string {
  const px = docLinkPrefix(kind, locale)
  const s = sub && DOC_LINK_SUB_KINDS.has(kind) ? `#${sub}` : ''
  return `[[${px ? `${px}:` : ''}${name}${s}]]`
}

const alias = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')

const PREFIX_LOOKUP = ((): Map<string, DocLinkKind> => {
  const m = new Map<string, DocLinkKind>()
  for (const k of Object.keys(PREFIXES) as DocLinkKind[])
    for (const name of [...PREFIXES[k].zh, ...PREFIXES[k].en]) m.set(alias(name), k)
  return m
})()

/** 方括号里那一截拆开的结果 */
export interface DocLinkRef {
  /** 原样写的那一截（不含 `|显示文字`） */
  raw: string
  kind: DocLinkKind
  /** 明写了前缀；没写就是按词条起头的那一路 */
  explicit: boolean
  name: string
  /** `#` 后面的阶段 / 槽位；没写是空的 */
  sub: string
  /** `|` 后面的显示文字；没写是空的 */
  label: string
}

/** 解析 `[[…]]` 里面那一截（可以带 `|显示文字`） */
export function parseDocLink(inner: string): DocLinkRef {
  const bar = inner.indexOf('|')
  const label = bar < 0 ? '' : inner.slice(bar + 1).trim()
  const raw = (bar < 0 ? inner : inner.slice(0, bar)).trim()
  // 前缀：冒号（半角或全角）前那一截对得上固定词表才算前缀，否则整截都是名字
  const colon = raw.search(/[:：]/)
  const kind = colon > 0 ? PREFIX_LOOKUP.get(alias(raw.slice(0, colon))) : undefined
  const explicit = !!kind
  const rest = explicit ? raw.slice(colon + 1).trim() : raw
  // `#` 只对能再指到里面一条的类型生效，免得把词头里的 # 当成子目标
  const hash = kind && DOC_LINK_SUB_KINDS.has(kind) ? rest.search(/[#＃]/) : -1
  return {
    raw,
    kind: kind ?? 'lexeme',
    explicit,
    name: (hash < 0 ? rest : rest.slice(0, hash)).trim(),
    sub: hash < 0 ? '' : rest.slice(hash + 1).trim(),
    label
  }
}

/** 找到的目标 */
export interface DocLinkHit {
  kind: DocLinkKind
  id: Id
  /** 找到的那一条显示成什么 */
  name: string
  /** 跳过去之后还要定位到里面的哪一条（阶段名 / 槽位键） */
  sub: string
  /** 子目标显示成什么 */
  subLabel: string
  /** 目标属于哪门语言；项目级的东西是 null */
  languageId: Id | null
  /** 名字找到了，但 `#` 后面那一条没找到 */
  subMissing: boolean
}

const text = (v: LocalizedText | undefined, langs: string[]): string => {
  if (!v) return ''
  for (const l of langs) if (v[l]) return v[l]
  return Object.values(v).find(Boolean) ?? ''
}

/** 一条东西的所有可用名字（多语言字段每种语言都算） */
const allNames = (v: LocalizedText | undefined): string[] =>
  v ? Object.values(v).filter(Boolean) : []

/** 先原样对，再忽略大小写对 */
function byName<T>(items: readonly T[], names: (x: T) => string[], want: string): T | null {
  const w = want.trim()
  if (!w) return null
  for (const it of items) if (names(it).some((n) => n.trim() === w)) return it
  const lw = w.toLowerCase()
  for (const it of items) if (names(it).some((n) => n.trim().toLowerCase() === lw)) return it
  return null
}

/** 语素形式两头的连字符、等号可写可不写 */
const bare = (s: string): string => s.replace(/^[-=–—]+|[-=–—]+$/g, '')

/** 规则集文本里的阶段标记（`-* 名字`），按先后排 */
export function ruleSetStages(ruleText: string): string[] {
  const out: string[] = []
  for (const raw of ruleText.split(/\r?\n/)) {
    // 去掉行末注释（`\#` 是写在规则里的井号，不算注释）
    const content = raw.replace(/(^|[^\\])#.*$/, '$1').trim()
    if (!content.startsWith('-*')) continue
    const name = content.slice(2).trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 槽位名拆成一个个取值（`单数.主格`、`单数 · 主格` 都行） */
const slotParts = (s: string): string[] =>
  s
    .split(/[.·・、,，\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)

/**
 * 构形里按名字找一格：槽位名（`单数.主格`）或 gloss 缩写（`SG.NOM`）都认，
 * 取值名按各种释义语言逐段比，中英文写法都对得上。
 */
function findSlot(
  project: Project,
  paradigmId: Id,
  want: string
): { key: string; label: string } | null {
  const p = project.paradigms.find((x) => x.id === paradigmId)
  if (!p) return null
  const langs = project.settings.glossLanguages
  const slots = paradigmSlots(p, project.categories, langs, true)
  const hit = byName(slots, (s) => [s.label, s.abbr], want)
  if (hit) return { key: hit.key, label: hit.label }
  const parts = slotParts(want)
  if (!parts.length) return null
  for (const s of slots) {
    if (s.values.length !== parts.length) continue
    const ok = s.values.every((v, i) => {
      const cat = project.categories.find((c) => c.id === v.categoryId)
      const val = cat?.values.find((x) => x.id === v.valueId)
      if (!val) return false
      return [...allNames(val.name), val.abbr]
        .filter(Boolean)
        .some((n) => n.trim().toLowerCase() === parts[i])
    })
    if (ok) return { key: s.key, label: s.label }
  }
  return null
}

/** 按某一类在项目里找；找不到返回 null */
function findOne(project: Project, kind: DocLinkKind, name: string): DocLinkHit | null {
  const langs = project.settings.glossLanguages
  const base = (id: Id, label: string, languageId: Id | null): DocLinkHit => ({
    kind,
    id,
    name: label,
    sub: '',
    subLabel: '',
    languageId,
    subMissing: false
  })
  switch (kind) {
    case 'lexeme': {
      const x = byName(project.lexemes, (l) => [l.lemma], name)
      return x ? base(x.id, x.lemma, x.languageId) : null
    }
    case 'morpheme': {
      const x = byName(project.morphemes, (m) => [m.form, bare(m.form), m.form2], name)
      return x ? base(x.id, x.form, x.languageId) : null
    }
    case 'language': {
      const x = byName(project.languages, (l) => [l.name, l.abbr], name)
      return x ? base(x.id, x.name, x.id) : null
    }
    case 'ruleSet': {
      const x = byName(project.ruleSets, (r) => [r.name], name)
      return x ? base(x.id, x.name, null) : null
    }
    case 'paradigm': {
      const x = byName(project.paradigms, (p) => allNames(p.name), name)
      return x ? base(x.id, text(x.name, langs), null) : null
    }
    case 'script': {
      for (const l of project.languages) {
        const x = byName(l.scripts, (s) => [s.name], name)
        if (x) return base(x.id, x.name, l.id)
      }
      return null
    }
    case 'sentence': {
      const x =
        byName(project.sentences, (s) => [s.text, ...allNames(s.translation)], name) ??
        project.sentences.find((s) => s.text.startsWith(name.trim())) ??
        null
      return x ? base(x.id, x.text, x.languageId) : null
    }
    case 'phrase': {
      const x = byName(project.phrasebook, (p) => [p.text, ...allNames(p.translation)], name)
      return x ? base(x.id, x.text, x.languageId) : null
    }
    case 'doc': {
      const x = byName(project.docs, (d) => [d.title], name)
      return x ? base(x.id, x.title, x.languageId) : null
    }
  }
}

/**
 * 在项目里找链接的目标。带前缀就只找那一类；没带前缀先找词条，再按 DOC_LINK_KINDS 往下试
 * （文档里写惯的 `[[词头]]` 照旧最先当词条）。
 */
export function resolveDocLink(project: Project, ref: DocLinkRef): DocLinkHit | null {
  if (!ref.name) return null
  const kinds = ref.explicit ? [ref.kind] : DOC_LINK_KINDS
  let found: DocLinkHit | null = null
  for (const k of kinds) {
    found = findOne(project, k, ref.name)
    if (found) break
  }
  const hit = found
  if (!hit || !ref.sub) return hit
  if (hit.kind === 'ruleSet') {
    const rs = project.ruleSets.find((r) => r.id === hit.id)
    const stage = byName(ruleSetStages(rs?.text ?? ''), (s) => [s], ref.sub)
    if (stage) return { ...hit, sub: stage, subLabel: stage }
  } else if (hit.kind === 'paradigm') {
    const slot = findSlot(project, hit.id, ref.sub)
    if (slot) return { ...hit, sub: slot.key, subLabel: slot.label }
  }
  return { ...hit, subMissing: true }
}

/** 解析一截并在项目里找：文档页画链接时一步到位 */
export function docLink(
  project: Project,
  inner: string
): { ref: DocLinkRef; hit: DocLinkHit | null } {
  const ref = parseDocLink(inner)
  return { ref, hit: resolveDocLink(project, ref) }
}

/** 插入链接时列出来的一条 */
export interface DocLinkCandidate {
  kind: DocLinkKind
  /** 写进链接里的名字 */
  name: string
  /** 写进 `#` 后面的那一截；没有就是空的 */
  sub: string
  /** 列表里跟在名字后面的一句说明 */
  detail: string
}

/** 某一类里能链过去的全部条目（规则集连它的阶段、构形连它的槽位一起列出来） */
export function docLinkCandidates(project: Project, kind: DocLinkKind): DocLinkCandidate[] {
  const langs = project.settings.glossLanguages
  const langName = (id: Id | null): string => project.languages.find((l) => l.id === id)?.name ?? ''
  const out: DocLinkCandidate[] = []
  const add = (name: string, detail = '', sub = ''): void => {
    if (name.trim()) out.push({ kind, name, sub, detail })
  }
  switch (kind) {
    case 'lexeme':
      for (const l of project.lexemes)
        add(
          l.lemma,
          [langName(l.languageId), text(l.senses[0]?.definition, langs)].filter(Boolean).join(' · ')
        )
      break
    case 'morpheme':
      for (const m of project.morphemes)
        add(m.form, [m.gloss, text(m.meaning, langs)].filter(Boolean).join(' · '))
      break
    case 'language':
      for (const l of project.languages) add(l.name, l.abbr)
      break
    case 'ruleSet':
      for (const r of project.ruleSets) {
        add(r.name, r.notes)
        for (const s of ruleSetStages(r.text)) add(r.name, r.name, s)
      }
      break
    case 'paradigm':
      for (const p of project.paradigms) {
        const name = text(p.name, langs)
        add(name)
        for (const s of paradigmSlots(p, project.categories, langs, true))
          add(name, `${name} · ${s.abbr}`, s.label)
      }
      break
    case 'script':
      for (const l of project.languages) for (const s of l.scripts) add(s.name, l.name)
      break
    case 'sentence':
      for (const s of project.sentences) add(s.text, text(s.translation, langs))
      break
    case 'phrase':
      for (const p of project.phrasebook) add(p.text, text(p.translation, langs))
      break
    case 'doc':
      for (const d of project.docs) add(d.title, langName(d.languageId))
      break
  }
  return out
}
