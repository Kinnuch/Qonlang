/**
 * 把例句切成词（语料分析、逐词写文字共用一套切法）。
 */
import type { TokenizerMode } from '$lib/core/model'

export const PUNCT =
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

/** 词两头能剥掉的标点（跟 PUNCT 同一套） */
const LEAD = new RegExp(`^(?:${PUNCT.source.split('|')[0].slice(1)})`, 'u')
const TRAIL = new RegExp(`(?:${PUNCT.source.split('|')[1].slice(0, -1)})$`, 'u')

/** 切出来的一段：word 为 true 的依次就是 tokenize 给出的词，所有段的 text 拼起来是原文 */
export interface TokenSpan {
  text: string
  word: boolean
}

/** 一块不含分隔符的文字：两头的标点单独成段，中间是词 */
function chunkSpans(chunk: string, out: TokenSpan[]): void {
  if (!chunk) return
  const lead = LEAD.exec(chunk)?.[0] ?? ''
  const rest = chunk.slice(lead.length)
  const trail = rest ? (TRAIL.exec(rest)?.[0] ?? '') : ''
  const core = rest.slice(0, rest.length - trail.length)
  if (lead) out.push({ text: lead, word: false })
  if (core) out.push({ text: core, word: true })
  if (trail) out.push({ text: trail, word: false })
}

/**
 * 跟 tokenize 一样切，但词和词之间的空白、分隔符、两头的标点都留着：逐词换写法后要按原样拼回去。
 * 自定义分隔符的正则里带捕获组时，tokenize 会把分隔符也当成词，这里不会——对齐词的时候按写法比。
 */
export function tokenSpans(text: string, opts: TokenizeOptions = {}): TokenSpan[] {
  const out: TokenSpan[] = []
  if (opts.mode === 'character') {
    for (const c of Array.from(text)) chunkSpans(c, out)
    return out
  }
  let re = /\s+/gu
  if (opts.mode === 'custom' && opts.pattern?.trim()) {
    try {
      re = new RegExp(opts.pattern, 'gu')
    } catch {
      // 正则写错了当没设置
    }
  }
  let last = 0
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue
    const at = m.index ?? 0
    chunkSpans(text.slice(last, at), out)
    out.push({ text: m[0], word: false })
    last = at + m[0].length
  }
  chunkSpans(text.slice(last), out)
  return out
}
