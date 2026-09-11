/**
 * 项目级一致性检查：找出断掉的引用、漏填的字段、重复的条目、没接上的配置。
 * 每条问题带上能跳过去的目标；文字由界面按 kind 翻译。
 */
import type { Id, Project } from '$lib/core/model'
import { paradigmSlots, resolveGenerator } from './morph'

export type IssueSeverity = 'error' | 'warn' | 'info'
export type IssueTarget =
  'lexeme' | 'morpheme' | 'sentence' | 'paradigm' | 'taxonomy' | 'script' | 'abbr' | null

export interface Issue {
  kind: string
  severity: IssueSeverity
  /** 显示用的对象名（词头、语素形式、句子开头…） */
  label: string
  /** 补充信息（哪一列、哪个槽位…） */
  detail: string
  target: IssueTarget
  targetId: Id | null
}

export interface IssueGroup {
  kind: string
  severity: IssueSeverity
  issues: Issue[]
}

function pick(text: Record<string, string>, langs: string[]): string {
  for (const l of langs) if (text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}

export function checkConsistency(project: Project, languageId: Id | null): Issue[] {
  const langs = project.settings.glossLanguages
  const out: Issue[] = []
  const add = (
    kind: string,
    severity: IssueSeverity,
    label: string,
    target: IssueTarget,
    targetId: Id | null,
    detail = ''
  ): void => {
    out.push({ kind, severity, label, detail, target, targetId })
  }
  const inLang = <T extends { languageId: Id | null }>(xs: T[]): T[] =>
    languageId ? xs.filter((x) => x.languageId === languageId) : xs
  const lexemes = inLang(project.lexemes)
  const morphemes = inLang(project.morphemes)
  const sentences = inLang(project.sentences)
  const lexById = new Map(project.lexemes.map((l) => [l.id, l]))
  const morphById = new Map(project.morphemes.map((m) => [m.id, m]))
  const sentById = new Map(project.sentences.map((s) => [s.id, s]))
  const posById = new Map(project.posList.map((p) => [p.id, p]))
  const paraById = new Map(project.paradigms.map((p) => [p.id, p]))

  // ── 词库 ──
  const lemmaKey = new Map<string, Id[]>()
  for (const l of lexemes) {
    const head = l.lemma || '—'
    if (!l.lemma.trim()) add('lexeme.emptyLemma', 'error', head, 'lexeme', l.id)
    if (!l.senses.some((s) => Object.values(s.definition).some((d) => d.trim())))
      add('lexeme.noDefinition', 'warn', head, 'lexeme', l.id)
    if (!l.posId) add('lexeme.noPos', 'warn', head, 'lexeme', l.id)
    else if (!posById.has(l.posId)) add('lexeme.missingPos', 'error', head, 'lexeme', l.id)
    if (l.paradigmId && !paraById.has(l.paradigmId))
      add('lexeme.missingParadigm', 'error', head, 'lexeme', l.id)
    const pos = l.posId ? posById.get(l.posId) : null
    const paraId = l.paradigmId ?? pos?.paradigmId ?? null
    if (paraId && paraById.has(paraId) && !Object.keys(l.forms).length)
      add('lexeme.noForms', 'info', head, 'lexeme', l.id, pick(paraById.get(paraId)!.name, langs))
    for (const s of l.etymology.sources) {
      if (s.kind === 'morpheme' && !morphById.has(s.id))
        add('lexeme.brokenSource', 'error', head, 'lexeme', l.id)
      if (s.kind === 'lexeme' && !lexById.has(s.id))
        add('lexeme.brokenSource', 'error', head, 'lexeme', l.id)
      if (s.kind === 'lexeme' && s.id === l.id)
        add('lexeme.selfSource', 'error', head, 'lexeme', l.id)
    }
    for (const r of l.relations) {
      if (!lexById.has(r.lexemeId))
        add('lexeme.brokenRelation', 'error', head, 'lexeme', l.id, r.kind)
      else if (r.lexemeId === l.id) add('lexeme.selfRelation', 'warn', head, 'lexeme', l.id, r.kind)
    }
    for (const s of l.senses)
      for (const ex of s.examples)
        if (!sentById.has(ex)) add('lexeme.brokenExample', 'error', head, 'lexeme', l.id)
    for (const [cid, vid] of Object.entries(l.features)) {
      const cat = project.categories.find((c) => c.id === cid)
      if (!cat || !cat.values.some((v) => v.id === vid))
        add('lexeme.brokenFeature', 'error', head, 'lexeme', l.id)
    }
    const k = `${l.lemma.trim().toLowerCase()}|${l.posId ?? ''}`
    if (l.lemma.trim()) lemmaKey.set(k, [...(lemmaKey.get(k) ?? []), l.id])
  }
  for (const [k, ids] of lemmaKey)
    if (ids.length > 1) {
      const lemma = k.split('|')[0]
      add('lexeme.duplicate', 'warn', lemma, 'lexeme', ids[0], String(ids.length))
    }

  // ── 语素 ──
  const formKey = new Map<string, Id[]>()
  for (const m of morphemes) {
    const head = m.form || '—'
    if (!m.form.trim()) add('morpheme.emptyForm', 'error', head, 'morpheme', m.id)
    if (!m.gloss.trim() && !Object.values(m.meaning).some((x) => x.trim()))
      add('morpheme.noGloss', 'warn', head, 'morpheme', m.id)
    for (const s of m.etymology.sources) {
      if (s.kind === 'morpheme' && (!morphById.has(s.id) || s.id === m.id))
        add('morpheme.brokenSource', 'error', head, 'morpheme', m.id)
      if (s.kind === 'lexeme' && !lexById.has(s.id))
        add('morpheme.brokenSource', 'error', head, 'morpheme', m.id)
    }
    const k = `${m.type}|${m.form.trim().toLowerCase()}`
    if (m.form.trim()) formKey.set(k, [...(formKey.get(k) ?? []), m.id])
  }
  for (const [k, ids] of formKey)
    if (ids.length > 1)
      add('morpheme.duplicate', 'warn', k.split('|')[1], 'morpheme', ids[0], String(ids.length))

  // ── 语料 ──
  const abbrs = new Set(project.abbreviations.map((a) => a.abbr))
  const catAbbrs = new Set(
    project.categories.flatMap((c) => c.values.map((v) => v.abbr)).filter(Boolean)
  )
  const missingAbbr = new Map<string, number>()
  for (const s of sentences) {
    const head = s.text.slice(0, 40) || '—'
    if (!s.text.trim()) add('sentence.emptyText', 'error', head, 'sentence', s.id)
    if (!Object.values(s.translation).some((x) => x.trim()))
      add('sentence.noTranslation', 'warn', head, 'sentence', s.id)
    if (s.text.trim() && !s.tokens.length) add('sentence.noTokens', 'info', head, 'sentence', s.id)
    let unresolved = 0
    let unconfirmed = 0
    for (const t of s.tokens) {
      const a = t.analyses[t.chosen]
      if (!a || a.morphs.some((m) => m.gloss === '?')) unresolved++
      if (!t.confirmed) unconfirmed++
      if (a?.lexemeId && !lexById.has(a.lexemeId))
        add('sentence.brokenLexeme', 'error', head, 'sentence', s.id, t.surface)
      for (const m of a?.morphs ?? []) {
        if (m.morphemeId && !morphById.has(m.morphemeId))
          add('sentence.brokenMorpheme', 'error', head, 'sentence', s.id, t.surface)
        for (const g of m.gloss.split(/[.\-=:~]/))
          // 缩写不限拉丁字母：任何大写字母（含西里尔、希腊）加数字都算
          if (/^\p{Lu}[\p{Lu}\p{Nd}]{0,5}$/u.test(g) && !abbrs.has(g) && !catAbbrs.has(g))
            missingAbbr.set(g, (missingAbbr.get(g) ?? 0) + 1)
      }
    }
    if (unresolved) add('sentence.unresolved', 'warn', head, 'sentence', s.id, String(unresolved))
    else if (unconfirmed)
      add('sentence.unconfirmed', 'info', head, 'sentence', s.id, String(unconfirmed))
  }
  for (const [g, n] of [...missingAbbr.entries()].sort((a, b) => b[1] - a[1]))
    add('abbr.missing', 'info', g, 'abbr', null, String(n))

  // ── 词类 / 维度 / 构形 ──
  for (const p of project.posList)
    if (p.paradigmId && !paraById.has(p.paradigmId))
      add('pos.missingParadigm', 'error', pick(p.name, langs) || p.abbr, 'taxonomy', p.id)
  const usedCats = new Set(project.paradigms.flatMap((p) => p.dimensionIds))
  for (const l of project.lexemes) for (const cid of Object.keys(l.features)) usedCats.add(cid)
  for (const c of project.categories) {
    const name = pick(c.name, langs) || '—'
    if (!c.values.length) add('category.noValues', 'warn', name, 'taxonomy', c.id)
    if (!usedCats.has(c.id)) add('category.unused', 'info', name, 'taxonomy', c.id)
    for (const v of c.values)
      if (!v.abbr.trim())
        add('category.noAbbr', 'info', name, 'taxonomy', c.id, pick(v.name, langs))
  }
  for (const p of project.paradigms) {
    const name = pick(p.name, langs) || '—'
    // 作用于所有词的构形（词首音变这类）本来就不绑定词类
    if (
      !p.appliesToAll &&
      !project.posList.some((x) => x.paradigmId === p.id) &&
      !project.lexemes.some((l) => l.paradigmId === p.id)
    )
      add('paradigm.unbound', 'info', name, 'paradigm', p.id)
    if (p.inheritsFrom && !paraById.has(p.inheritsFrom))
      add('paradigm.missingParent', 'error', name, 'paradigm', p.id)
    for (const d of p.dimensionIds)
      if (!project.categories.some((c) => c.id === d))
        add('paradigm.missingDimension', 'error', name, 'paradigm', p.id)
    const slots = paradigmSlots(p, project.categories, langs)
    const empty = slots.filter((s) => resolveGenerator(p, s.key, project.paradigms).kind === 'none')
    if (slots.length && empty.length === slots.length)
      add('paradigm.noGenerators', 'warn', name, 'paradigm', p.id)
    else if (empty.length)
      add('paradigm.emptySlots', 'info', name, 'paradigm', p.id, `${empty.length}/${slots.length}`)
  }

  // ── 文字 ──
  for (const lang of project.languages) {
    if (languageId && lang.id !== languageId) continue
    for (const sc of lang.scripts) {
      const noValue = sc.glyphs.filter((g) => !g.value.trim())
      if (noValue.length)
        add('script.glyphNoValue', 'info', sc.name, 'script', sc.id, String(noValue.length))
      const seen = new Map<string, number>()
      for (const g of sc.glyphs) if (g.char) seen.set(g.char, (seen.get(g.char) ?? 0) + 1)
      const dup = [...seen.values()].filter((n) => n > 1).length
      if (dup) add('script.duplicateGlyph', 'warn', sc.name, 'script', sc.id, String(dup))
    }
    // 字母表之外的字符（有字母表才查；忽略大小写与常见分隔符；带变音符的字母折掉变音符后在表里也算在表里）
    if (lang.alphabet.length && (!languageId || lang.id === languageId)) {
      const fold = (x: string): string => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      const alpha = lang.alphabet
        .map((a) => a.toLowerCase())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
      const alphaFolded = alpha.map(fold)
      for (const l of project.lexemes) {
        if (l.languageId !== lang.id) continue
        let w = l.lemma.toLowerCase().replace(/[-=*·'\s()]/g, '')
        const bad = new Set<string>()
        while (w.length) {
          const hit = alpha.find((a) => w.startsWith(a))
          if (hit) {
            w = w.slice(hit.length)
            continue
          }
          const ch = Array.from(w)[0]
          const fch = fold(ch)
          if (!fch || !alphaFolded.some((a) => a === fch || a.startsWith(fch))) bad.add(ch)
          w = w.slice(ch.length)
        }
        if (bad.size)
          add('lexeme.outsideAlphabet', 'info', l.lemma, 'lexeme', l.id, [...bad].join(' '))
      }
    }
  }
  return out
}

const ORDER: Record<IssueSeverity, number> = { error: 0, warn: 1, info: 2 }

export function groupIssues(issues: Issue[]): IssueGroup[] {
  const m = new Map<string, IssueGroup>()
  for (const i of issues) {
    const g = m.get(i.kind)
    if (g) g.issues.push(i)
    else m.set(i.kind, { kind: i.kind, severity: i.severity, issues: [i] })
  }
  return [...m.values()].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || b.issues.length - a.issues.length
  )
}
