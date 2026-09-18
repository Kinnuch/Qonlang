/**
 * 按位置改写例句原文里的某一个词（语料里「改」成别的词条时，勾了「同时改语料原文」才用）。
 * 同一个词在一句里可能出现好几次，所以一律按 tokenSpans 给的位置改，不做整句替换。
 */
import { tokenSpans, type TokenizeOptions } from './tokens'

/** 原来的词是大写开头的，换上去的词也大写开头（没有大小写之分的文字照原样） */
export function matchCase(original: string, replacement: string): string {
  const first = Array.from(original)[0]
  const next = Array.from(replacement)[0]
  if (!first || !next) return replacement
  // 原词不是大写开头（含没有大小写的文字）：照词条自己的写法
  if (first.toLowerCase() === first) return replacement
  return next.toUpperCase() + replacement.slice(next.length)
}

/** 第 index 个词（连着 count 段的是词典里带空格的形式）在原文里的段落范围 */
function spanRange(
  spans: { text: string; word: boolean }[],
  index: number,
  count: number
): { from: number; to: number } | null {
  let seen = -1
  let from = -1
  for (let i = 0; i < spans.length; i++) {
    if (!spans[i].word) continue
    seen++
    if (seen === index) from = i
    if (from >= 0 && seen === index + count - 1) return { from, to: i }
  }
  return null
}

/**
 * 原文里第 index 个词的写法（连着 count 段的按空格拼起来，跟分词结果里的 surface 一个样子）。
 * 对不上就返回 null：改之前先核对一遍，免得改错地方。
 */
export function wordAt(
  text: string,
  index: number,
  opts: TokenizeOptions = {},
  count = 1
): string | null {
  if (index < 0 || count < 1) return null
  const spans = tokenSpans(text, opts)
  const at = spanRange(spans, index, count)
  if (!at) return null
  return spans
    .slice(at.from, at.to + 1)
    .filter((x) => x.word)
    .map((x) => x.text)
    .join(' ')
}

/**
 * 把原文里第 index 个词换成 replacement：只换这一处，两头的标点、空白原样留着，
 * 大小写跟着原来的词走。换不动（位置不对、换的跟原来一样）时原样返回。
 */
export function replaceWordAt(
  text: string,
  index: number,
  replacement: string,
  opts: TokenizeOptions = {},
  count = 1
): string {
  if (index < 0 || count < 1 || !replacement) return text
  const spans = tokenSpans(text, opts)
  const at = spanRange(spans, index, count)
  if (!at) return text
  const next = matchCase(spans[at.from].text, replacement)
  const old = spans
    .slice(at.from, at.to + 1)
    .map((x) => x.text)
    .join('')
  if (next === old) return text
  const head = spans
    .slice(0, at.from)
    .map((x) => x.text)
    .join('')
  const tail = spans
    .slice(at.to + 1)
    .map((x) => x.text)
    .join('')
  return head + next + tail
}

/**
 * 第 at 个分词结果在原文的词序列里从第几个词开始、占几个词。
 * 词典里带空格的形式（`ar mae`）会并成一个词，所以两边的编号对不上号。
 */
export function wordRangeOfToken(
  surfaces: readonly string[],
  at: number
): { index: number; count: number } | null {
  if (at < 0 || at >= surfaces.length) return null
  const words = (s: string): number => s.split(' ').filter(Boolean).length || 1
  let index = 0
  for (let i = 0; i < at; i++) index += words(surfaces[i])
  return { index, count: words(surfaces[at]) }
}
