/**
 * 词典导出：HTML（含打印样式，供 PDF）、Markdown、按用户模板逐条渲染。
 */
import type { Language, Lexeme, Project } from '$lib/core/model'
import { makeCollator } from '$lib/core/collate'
import { lexemeScript } from '$lib/script/render'
import { scriptFontFamily } from '$lib/script/fonts'

export interface DictOptions {
  title: string
  glossLangs: string[]
  /** 显示哪些义项语言；空 = glossLangs 全部 */
  senseLangs?: string[]
  includeForms: boolean
  includeEtymology: boolean
  includeScript: boolean
  includeNotes: boolean
  /** 按首字母分组 */
  groupByInitial: boolean
  fontFamily?: string
}

export interface DictEntry {
  lexeme: Lexeme
  lemma: string
  pos: string
  ipa: string
  script: string
  senses: { lang: string; text: string; tags: string[] }[]
  forms: { label: string; text: string }[]
  etymology: string
  initial: string
}

function pickText(text: Record<string, string> | undefined, order: string[]): string {
  if (!text) return ''
  for (const l of order) if (text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function collectEntries(project: Project, lang: Language, o: DictOptions): DictEntry[] {
  const collator = makeCollator(lang.alphabet)
  const primary = lang.orthographies.find((x) => x.isPrimary) ?? lang.orthographies[0]
  const senseLangs = o.senseLangs?.length ? o.senseLangs : o.glossLangs
  const lexemes = project.lexemes.filter((l) => l.languageId === lang.id && l.lemma.trim()).sort((a, b) => collator(a.lemma, b.lemma))
  const script = lang.scripts[0]
  return lexemes.map((l) => {
    const pos = project.posList.find((p) => p.id === l.posId)
    const ipa = primary ? (l.pronunciations[primary.id]?.ipa ?? '') : ''
    const senses = l.senses.flatMap((s) => senseLangs.map((g) => ({ lang: g, text: s.definition[g] ?? '', tags: s.tags })).filter((x) => x.text))
    const forms = [...Object.entries(l.stems).map(([k, v]) => ({ label: k, text: v })), ...Object.entries(l.forms).map(([k, f]) => ({ label: k, text: f.surface }))].filter((f) => f.text)
    const ety: string[] = []
    if (l.etymology.protoForm) ety.push('*' + l.etymology.protoForm)
    for (const s of l.etymology.sources) {
      if (s.kind === 'lexeme') ety.push(project.lexemes.find((x) => x.id === s.id)?.lemma ?? '?')
      else if (s.kind === 'morpheme') ety.push(project.morphemes.find((x) => x.id === s.id)?.form ?? '?')
      else ety.push(`${s.language} ${s.form}${s.meaning ? ` ‘${s.meaning}’` : ''}`)
    }
    const first = Array.from(l.lemma.replace(/^[-=*]+/, ''))[0] ?? ''
    return {
      lexeme: l,
      lemma: l.lemma,
      pos: pos ? pos.abbr || pickText(pos.name, o.glossLangs) : '',
      ipa,
      script: o.includeScript && script ? lexemeScript(lang, script, l) : '',
      senses,
      forms,
      etymology: ety.join(' + '),
      initial: first.toLocaleUpperCase()
    }
  })
}

export function dictionaryHtml(project: Project, lang: Language, o: DictOptions): string {
  const entries = collectEntries(project, lang, o)
  const script = lang.scripts[0]
  const scriptFont = script ? scriptFontFamily(script) : ''
  const font = o.fontFamily || "'Gentium Plus', 'Charis SIL', 'Times New Roman', serif"
  const groups = new Map<string, DictEntry[]>()
  for (const e of entries) {
    const k = o.groupByInitial ? e.initial : ''
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(e)
  }
  const entryHtml = (e: DictEntry): string => {
    const parts: string[] = []
    parts.push(`<span class="lemma">${esc(e.lemma)}</span>`)
    if (e.script) parts.push(`<span class="script">${esc(e.script)}</span>`)
    if (e.ipa) parts.push(`<span class="ipa">/${esc(e.ipa)}/</span>`)
    if (e.pos) parts.push(`<span class="pos">${esc(e.pos)}</span>`)
    const senses = e.senses.length > 1 ? `<ol class="senses">${e.senses.map((s) => `<li lang="${s.lang}">${esc(s.text)}${s.tags.length ? ` <span class="tags">${esc(s.tags.join(', '))}</span>` : ''}</li>`).join('')}</ol>` : e.senses[0] ? `<span class="sense" lang="${e.senses[0].lang}">${esc(e.senses[0].text)}</span>` : ''
    let extra = ''
    if (o.includeForms && e.forms.length) extra += `<div class="forms">${e.forms.map((f) => `<span><i>${esc(f.label)}</i> ${esc(f.text)}</span>`).join(' · ')}</div>`
    if (o.includeEtymology && e.etymology) extra += `<div class="ety">← ${esc(e.etymology)}</div>`
    if (o.includeNotes && e.lexeme.notes) extra += `<div class="notes">${esc(e.lexeme.notes)}</div>`
    return `<div class="entry">${parts.join(' ')} ${senses}${extra}</div>`
  }
  const body = [...groups.entries()].map(([k, es]) => `${k ? `<h2 class="initial">${esc(k)}</h2>` : ''}${es.map(entryHtml).join('\n')}`).join('\n')
  const css = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: ${font}; font-size: 11pt; line-height: 1.45; color: #1a1a1a; margin: 0; padding: 24px; }
  h1 { font-size: 22pt; margin: 0 0 4px; }
  .meta { color: #666; font-size: 9pt; margin-bottom: 18px; }
  .columns { column-count: 2; column-gap: 28px; }
  h2.initial { column-span: all; font-size: 16pt; border-bottom: 1px solid #999; margin: 18px 0 8px; padding-bottom: 2px; }
  .entry { break-inside: avoid; margin: 0 0 6px; text-indent: -1.2em; padding-left: 1.2em; }
  .lemma { font-weight: 700; }
  .script { font-family: ${scriptFont ? `'${scriptFont}', ` : ''}${font}; font-size: 12pt; margin-left: 2px; }
  .ipa { color: #444; }
  .pos { font-style: italic; color: #555; font-size: 10pt; }
  .senses { margin: 0; padding-left: 1.4em; text-indent: 0; }
  .tags { color: #888; font-size: 9pt; }
  .forms, .ety, .notes { font-size: 9.5pt; color: #444; text-indent: 0; margin-top: 1px; }
  .ety { color: #6a5a3a; }
  @media print { body { padding: 0; } }`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>${css}</style></head><body><h1>${esc(o.title)}</h1><div class="meta">${entries.length} entries · ${esc(project.meta.name)}</div><div class="columns">${body}</div></body></html>`
}

export function dictionaryMarkdown(project: Project, lang: Language, o: DictOptions): string {
  const entries = collectEntries(project, lang, o)
  const lines: string[] = [`# ${o.title}`, '']
  let cur = ''
  for (const e of entries) {
    if (o.groupByInitial && e.initial !== cur) {
      cur = e.initial
      lines.push(`## ${cur}`, '')
    }
    let head = `**${e.lemma}**`
    if (e.script) head += ` ${e.script}`
    if (e.ipa) head += ` /${e.ipa}/`
    if (e.pos) head += ` *${e.pos}*`
    const senses = e.senses.length > 1 ? e.senses.map((s, i) => `${i + 1}. ${s.text}`).join(' ') : (e.senses[0]?.text ?? '')
    lines.push(`- ${head} — ${senses}`)
    if (o.includeForms && e.forms.length) lines.push(`  - ${e.forms.map((f) => `*${f.label}* ${f.text}`).join(' · ')}`)
    if (o.includeEtymology && e.etymology) lines.push(`  - ← ${e.etymology}`)
  }
  return lines.join('\n')
}

/**
 * 逐条模板：{{lemma}} {{ipa}} {{pos}} {{script}} {{definition}}（首义项）{{etymology}} {{notes}} {{tags}}，
 * 块：{{#senses}}{{n}} {{text}} {{lang}}{{/senses}}、{{#forms}}{{label}} {{text}}{{/forms}}。
 */
export function renderEntries(project: Project, lang: Language, template: string, o: DictOptions): string {
  const entries = collectEntries(project, lang, o)
  const fill = (tpl: string, vars: Record<string, string>): string => tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '')
  const block = (tpl: string, name: string, items: Record<string, string>[]): string =>
    tpl.replace(new RegExp(`\\{\\{#${name}\\}\\}([\\s\\S]*?)\\{\\{\\/${name}\\}\\}`, 'g'), (_m, inner: string) => items.map((it) => fill(inner, it)).join(''))
  return entries
    .map((e) => {
      let s = block(template, 'senses', e.senses.map((x, i) => ({ n: String(i + 1), text: x.text, lang: x.lang, tags: x.tags.join(', ') })))
      s = block(s, 'forms', e.forms.map((f) => ({ label: f.label, text: f.text })))
      return fill(s, {
        lemma: e.lemma,
        ipa: e.ipa,
        pos: e.pos,
        script: e.script,
        definition: e.senses[0]?.text ?? '',
        etymology: e.etymology,
        notes: e.lexeme.notes,
        tags: e.lexeme.tags.join(', '),
        language: lang.name
      })
    })
    .join('\n')
}
