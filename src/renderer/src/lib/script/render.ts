/**
 * 转写 → 自定义文字。规则文本里的 `@glyphs` 展开为字形表自动映射；程序按文字缓存。
 */
import type { Language, Lexeme, ParenMode, Script, Sentence } from '$lib/core/model'
import { escapeRuleText, parseRuleText, runRulesOnText, type RuleProgram } from '$lib/engine/sca'
import { packTables, packWord, type PackTables } from './pack'
import { languageParseOptions } from '$lib/engine/phon'
import { canonicalG } from '$lib/ipa/equivalence'

/**
 * 编好的转写，按文字对象记：展开的映射、解析好的规则、音节拼合用的表，外加同一段文字转过的结果。
 * 软件里每次改项目（touch、撤销、打开、刷新）都把代数加一；代数没变时直接用，变了先比一遍字形表和设置的指纹，
 * 真变了才重新编。没接到软件里的场合（测试、生成示例的脚本）每次都比指纹。
 */
interface Compiled {
  generation: number
  lang: Language
  sig: string
  program: RuleProgram | null
  tables: PackTables | null
  readings: Map<string, string> | null
  memo: Map<string, string>
}
const compiled = new WeakMap<Script, Compiled>()
const MEMO_MAX = 20000
let generation = 0
let trusted = false

export function clearScriptCache(): void {
  generation++
}
/** 软件里改项目都会调 clearScriptCache：从此代数没变就不再比指纹 */
export function trustScriptCache(): void {
  trusted = true
}
/** 缓存还能不能直接用：别处按文字记的东西（有没有手写字形）跟着它失效 */
export function scriptCacheValid(stamp: number | undefined): boolean {
  return trusted && stamp === generation
}
export function scriptCacheStamp(): number {
  return generation
}

function fingerprint(lang: Language, script: Script): string {
  const glyphs = script.glyphs.map((g) => `${g.char}\u0001${g.value}`).join('\u0002')
  return [
    script.rules ?? '',
    script.parens ?? '',
    JSON.stringify(script.packing ?? null),
    JSON.stringify(languageParseOptions(lang)),
    // 音节拼合按音位表认元音、辅音
    script.packing?.enabled
      ? JSON.stringify([
          lang.phonemes.map((p) => [p.symbol, p.features]),
          lang.classes.map((c) => [c.name, c.members]),
          lang.phonotactics?.nuclei ?? []
        ])
      : '',
    glyphs
  ].join('\u0003')
}

function compiledFor(lang: Language, script: Script): Compiled {
  const hit = compiled.get(script)
  if (hit && hit.lang === lang && scriptCacheValid(hit.generation)) return hit
  const sig = fingerprint(lang, script)
  if (hit && hit.lang === lang && hit.sig === sig) {
    hit.generation = generation
    return hit
  }
  const text = expandRules(script, lang)
  const entry: Compiled = {
    generation,
    lang,
    sig,
    program: text.trim() ? parseRuleText(text, languageParseOptions(lang)) : null,
    tables: null,
    readings: null,
    memo: new Map()
  }
  compiled.set(script, entry)
  return entry
}

/** 一个字形的全部转写值：value 里可以用 / 、 , 分隔多个读音 */
export function glyphValues(g: { value: string }): string[] {
  return g.value
    .split(/[/、,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** 规则里会被当成音类的单个大写字母：语言的音类，加上这套文字自己的规则里声明的 */
function classLetters(script: Script, lang?: Language | null): Set<string> {
  const out = new Set<string>()
  for (const c of lang?.classes ?? []) if (/^[A-Z]$/.test(c.name)) out.add(c.name)
  for (const m of (script.rules ?? '').matchAll(/^\s*([A-Z])\s*=/gm)) out.add(m[1])
  return out
}

/**
 * 字形表自动生成的映射行：转写值长的在前，避免短的先吃掉。
 * 转写值和字形都按字面写进规则——`?` `.` `#` 这类符号、跟音类同名的大写字母前面加反斜杠，
 * 不然给问号配了字形之后，`? > 字形` 会把每个词都换成这个字形。
 */
export function autoMappingLines(script: Script, lang?: Language | null): string[] {
  return autoMappingRows(script, lang).map((r) => `${r.from} > ${r.to}`)
}

/** 自动映射的每一行拆成两半：左边是转写（规则写法），右边是字形，显示时右边要用文字自己的字体 */
export function autoMappingRows(
  script: Script,
  lang?: Language | null
): { from: string; to: string }[] {
  const letters = classLetters(script, lang)
  const rows: { value: string; char: string }[] = []
  for (const g of script.glyphs) {
    if (!g.char) continue
    for (const v of glyphValues(g)) rows.push({ value: v, char: g.char })
  }
  rows.sort(
    (a, b) =>
      b.value.length - a.value.length || canonicalG(a.value).localeCompare(canonicalG(b.value))
  )
  const seen = new Set<string>()
  const out: { from: string; to: string }[] = []
  for (const r of rows) {
    const key = canonicalG(r.value)
    if (seen.has(key)) continue
    seen.add(key)
    const to = escapeRuleText(r.char, letters)
    // 替换侧单独一个 2 表示「重叠」，字形本身是 2 时也得写成字面
    out.push({ from: escapeRuleText(r.value, letters), to: to === '2' ? '\\2' : to })
  }
  return out
}

export function expandRules(script: Script, lang?: Language | null): string {
  const auto = autoMappingLines(script, lang).join('\n')
  const text = script.rules ?? ''
  if (/^\s*@glyphs\s*$/m.test(text)) return text.replace(/^\s*@glyphs\s*$/m, auto)
  return text.trim() ? `${text}\n${auto}` : auto
}

export function scriptProgram(lang: Language, script: Script): RuleProgram | null {
  return compiledFor(lang, script).program
}

/** 把一段转写文本按文字规则逐词转换（空白与标点原样保留） */
/** 方括号里的占位符（短语里的 [名词] 之类）原样留着，不参与转写 */
const PLACEHOLDER = /\[[^\]]*\]/g
function keepPlaceholders(text: string, run: (part: string) => string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(PLACEHOLDER)) {
    out += run(text.slice(last, m.index)) + m[0]
    last = (m.index ?? 0) + m[0].length
  }
  return out + run(text.slice(last))
}

/** 成对的括号（半角、全角都算），里面不能再套括号 */
const PAREN = /([（(])([^（）()]*)([）)])/g

/**
 * 按文字的括号设置处理一段文本，再交给 run 转写：
 * keep 把括号里外拆开分别转写、括号原样留着；include 去掉括号，贴着词的内容并进词里
 * （tal(a)n → talan、(s)tal → stal），两边都是空白的算独立一段；omit 连内容一起去掉，
 * 贴着词的直接去掉（tal(a)n → taln），独立的换成空格。
 */
export function applyParens(text: string, mode: ParenMode, run: (part: string) => string): string {
  if (!/[（(]/.test(text)) return run(text)
  const around = (all: string, offset: number): { before: boolean; after: boolean } => ({
    before: /\S/.test(text[offset - 1] ?? ''),
    after: /\S/.test(text[offset + all.length] ?? '')
  })
  if (mode === 'omit') {
    const cut = text.replace(PAREN, (all, _o, _inner: string, _c, offset: number) => {
      const e = around(all, offset)
      return e.before && e.after ? '' : ' '
    })
    return run(cut.replace(/[ \t]{2,}/g, ' ').trim())
  }
  if (mode === 'include') {
    const merged = text.replace(PAREN, (all, _o, inner: string, _c, offset: number) => {
      const e = around(all, offset)
      return (e.before || e.after) && !/\s/.test(inner) ? inner : ` ${inner} `
    })
    return run(merged.replace(/[ \t]{2,}/g, ' ').trim())
  }
  // 空段不转写（括号贴着句首句尾时两边会切出空串）
  const go = (part: string): string => (part ? run(part) : '')
  let out = ''
  let last = 0
  for (const m of text.matchAll(PAREN)) {
    const i = m.index ?? 0
    out += go(text.slice(last, i)) + m[1] + go(m[2]) + m[3]
    last = i + m[0].length
  }
  return out + go(text.slice(last))
}

export function renderScript(lang: Language, script: Script, text: string): string {
  if (!text) return ''
  const c = compiledFor(lang, script)
  const done = c.memo.get(text)
  if (done !== undefined) return done
  const out = renderFresh(c, lang, script, text)
  if (c.memo.size >= MEMO_MAX) c.memo.clear()
  c.memo.set(text, out)
  return out
}

function renderFresh(c: Compiled, lang: Language, script: Script, text: string): string {
  const mode = script.parens ?? 'keep'
  // [占位符] 先护住（里面写了括号也不拆开），其余的再按括号设置转写
  if (script.packing?.enabled)
    return keepPlaceholders(text, (part) =>
      applyParens(part, mode, (t) => packText(lang, script, t))
    )
  const p = c.program
  if (!p) return ''
  // 逐词转写（词两头的标点不挡词末规则）；句号在文字转写里是标点，不是隔开字母的点号：留着交给字形表
  return keepPlaceholders(text, (part) =>
    applyParens(part, mode, (t) => runRulesOnText(p, t, { keepDots: true }))
  )
}

/** 音节拼合模式：先拼成读音序列，再按字形表换成字形 */
export function packText(lang: Language, script: Script, text: string): string {
  const c = compiledFor(lang, script)
  if (!c.readings) {
    c.readings = new Map<string, string>()
    for (const g of script.glyphs) {
      if (!g.char) continue
      for (const v of glyphValues(g)) {
        const k = canonicalG(v.toLowerCase())
        if (!c.readings.has(k)) c.readings.set(k, g.char)
      }
    }
  }
  c.tables ??= packTables(lang, script)
  const byReading = c.readings
  const tables = c.tables
  return keepPlaceholders(text, (chunk) =>
    chunk.replace(/[^\s]+/g, (w) => {
      const parts = w.split(/([·-])/)
      let out = ''
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i]
        if (!seg) continue
        if (seg === '·' || seg === '-') continue
        const isHead = parts[i + 1] === '·'
        for (const r of packWord(lang, script, seg, isHead, tables))
          out += byReading.get(canonicalG(r)) ?? r
      }
      return out
    })
  )
}

/**
 * 这套文字按词条的哪一栏转写（文字检视器里的「转写来源」）：
 * 默认单词，也可以是某个词干、屈折形、正字法的发音或检视器模块；那一栏空着就回落到单词。
 */
export function scriptSourceText(script: Script, lexeme: Lexeme): string {
  const from = (script.from ?? '').trim()
  if (!from || from === 'lemma') return lexeme.lemma
  const at = from.indexOf(':')
  const kind = at < 0 ? from : from.slice(0, at)
  const key = at < 0 ? '' : from.slice(at + 1)
  const pick =
    kind === 'stem'
      ? lexeme.stems?.[key]
      : kind === 'form'
        ? lexeme.forms?.[key]?.surface
        : kind === 'pron'
          ? lexeme.pronunciations?.[key]?.ipa
          : kind === 'custom'
            ? lexeme.custom?.[key]
            : ''
  return (pick ?? '').trim() || lexeme.lemma
}

/**
 * 转写来源是检视器模块的文字（意音文字按字号写这类）：手填的写法里也常写字号，
 * 照样过一遍映射——已经是字形的字没有规则对得上，原样留着
 */
export function readsInspectorField(script: Script): boolean {
  return (script.from ?? '').startsWith('custom:')
}

/** 词条的文字写法：手工覆盖优先，其次按「转写来源」那一栏转写 */
export function lexemeScript(
  lang: Language,
  script: Script,
  lexeme: Lexeme,
  surface?: string
): string {
  const o = lexeme.scriptForms?.[script.id]
  if (o && surface === undefined)
    return readsInspectorField(script) ? renderScript(lang, script, o) : o
  return renderScript(lang, script, surface ?? scriptSourceText(script, lexeme))
}

/** 例句的文字写法：逐词转换 */
export function sentenceScript(lang: Language, script: Script, s: Sentence): string {
  const o = s.scriptForms?.[script.id]
  return o ? o : renderScript(lang, script, s.text)
}
