/** 只反查译文里的释义，不参与音变、词形生成或句子输出。 */
import type { ComposeApproximation } from './composeApprox'
export interface GlossSpan {
  at: number
  end: number
}

export interface GlossMatch extends GlossSpan {
  approximate?: ComposeApproximation
  /** 只标固定部分；槽里的内容还要继续查词。 */
  anchors: GlossSpan[]
  template: boolean
  literalLength: number
}

interface Word extends GlossSpan {
  w: string
  raw: string
}

/** 这段文字用不用空格隔词（汉字、假名、谚文以外的都按用空格算）。 */
const SPACELESS = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/
export const isSpaceless = (text: string): boolean => SPACELESS.test(text) && !/\s\S+\s/.test(text)

function wordsOf(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{N}'’-]+/gu)].map((m) => ({
    w: m[0].toLowerCase(),
    raw: m[0],
    at: m.index,
    end: m.index + m[0].length
  }))
}

/** 沿用原有的轻量词尾匹配，三个字母只认复数 s，免得 see 对上 seed。 */
const sameWord = (have: string, w: string): boolean =>
  have === w ||
  (w.length >= 4 && have.startsWith(w) && have.length - w.length <= 3) ||
  (w.length === 3 && have === w + 's')

interface Literal {
  text: string
  words?: string[]
  spaceless: boolean
}
export interface GlossPattern {
  item: string
  parts: Literal[]
  template: boolean
  literalLength: number
}

/** 只缓存释义字符串，不缓存可变工程；上限避免长期编辑积累旧释义。 */
const patterns = new Map<string, GlossPattern>()
const SLOT = /(?:\.{3,}|…+)+/g
export function prepareGlossPattern(item: string): GlossPattern {
  const old = patterns.get(item)
  if (old) return old
  const parts = item
    .split(SLOT)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({ text, spaceless: isSpaceless(text) }))
  const value = {
    item,
    parts,
    template: parts.length > 1,
    literalLength: parts.reduce((n, part) => n + part.text.length, 0)
  }
  if (patterns.size >= 1024) patterns.delete(patterns.keys().next().value!)
  patterns.set(item, value)
  return value
}

export interface GlossMatcher {
  text: string
  words: Word[]
  match: (item: string | GlossPattern) => GlossMatch[]
}

/**
 * 一次准备译文的词边界与句界，所有词条共用。槽至少含一个非空白字符，不跨分句标点、冒号、括号或换行。
 * 多种配对都成立时，每个起点取最近的完整配对；从后往前接锚点，不用回溯正则。
 */
export function prepareGlossMatcher(text: string): GlossMatcher {
  const words = wordsOf(text)
  const spaceless = isSpaceless(text)
  const stops = new Uint32Array(text.length + 1)
  const content = new Uint32Array(text.length + 1)
  for (let i = 0; i < text.length; i++) {
    stops[i + 1] = stops[i] + Number(/[\r\n,.!?;:，。！？；：（）()[\]［］【】]/.test(text[i]))
    content[i + 1] = content[i] + Number(/\S/.test(text[i]))
  }
  const literals = new Map<string, GlossSpan[]>()
  const results = new Map<string, GlossMatch[]>()
  const literal = (part: Literal): GlossSpan[] => {
    const old = literals.get(part.text)
    if (old) return old
    const out: GlossSpan[] = []
    if (part.spaceless || spaceless) {
      for (let at = text.indexOf(part.text); at >= 0; at = text.indexOf(part.text, at + 1))
        out.push({ at, end: at + part.text.length })
    } else {
      const want = (part.words ??= wordsOf(part.text).map((w) => w.w))
      if (want.length)
        for (let i = 0; i + want.length <= words.length; i++)
          if (want.every((w, j) => sameWord(words[i + j].w, w)))
            out.push({ at: words[i].at, end: words[i + want.length - 1].end })
    }
    literals.set(part.text, out)
    return out
  }
  const match = (input: string | GlossPattern): GlossMatch[] => {
    const item = typeof input === 'string' ? input : input.item
    const old = results.get(item)
    if (old) return old
    const pattern = typeof input === 'string' ? prepareGlossPattern(input) : input
    const { parts, template, literalLength } = pattern
    let chains: GlossSpan[][] = parts.length ? literal(parts.at(-1)!).map((s) => [s]) : []
    for (let i = parts.length - 2; i >= 0; i--) {
      const next: GlossSpan[][] = []
      let j = 0
      for (const span of literal(parts[i])) {
        while (
          j < chains.length &&
          (chains[j][0].at <= span.end || content[chains[j][0].at] === content[span.end])
        )
          j++
        const chain = chains[j]
        if (chain && stops[chain[0].at] === stops[span.end]) next.push([span, ...chain])
      }
      chains = next
    }
    const out = chains.map((anchors) => ({
      at: anchors[0].at,
      end: anchors.at(-1)!.end,
      anchors,
      template,
      literalLength
    }))
    results.set(item, out)
    return out
  }
  return { text, words, match }
}
