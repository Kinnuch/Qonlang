import { parseFragment, type DefaultTreeAdapterTypes as Tree } from 'parse5'
import type { DocPage } from './model'
import { renderDocument, escapeDocumentText } from './documentFormat'

type Node = Tree.ChildNode
interface Run {
  text: string
  start: number
  prefix: string
  suffix: string
}
export interface DocumentExcerpt {
  text: string
  runs: Run[]
  table: boolean
}
const cache = new WeakMap<
  DocPage,
  { source: string; format: DocPage['format']; blocks: DocumentExcerpt[] }
>()
const inlineTags = new Set([
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'sub',
  'sup',
  'small',
  'mark',
  'abbr',
  'code',
  'kbd',
  'samp',
  'var',
  'q'
])
const blockTags = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'li',
  'dt',
  'dd',
  'pre',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'tr',
  'caption'
])

/** 缓存安全预览的一段正文或一行表格，所有高亮下标都按可见文字计算。 */
export function documentExcerpts(doc: DocPage): DocumentExcerpt[] {
  const cached = cache.get(doc)
  if (cached?.source === doc.markdown && cached.format === doc.format) return cached.blocks
  const blocks: DocumentExcerpt[] = []
  let block: DocumentExcerpt = { text: '', runs: [], table: false }
  let pendingBreak = false
  const flush = (): void => {
    if (block.text.trim()) blocks.push(block)
    block = { text: '', runs: [], table: false }
    pendingBreak = false
  }
  const append = (s: string, tags: string[]): void => {
    if (!s) return
    if (pendingBreak && block.text && !/\s$/.test(block.text) && !/^\s/.test(s)) s = '\n' + s
    pendingBreak = false
    const prefix = tags.map((t) => '<' + t + '>').join(''),
      suffix = tags
        .toReversed()
        .map((t) => '</' + t + '>')
        .join('')
    block.runs.push({ text: s, start: block.text.length, prefix, suffix })
    block.text += s
  }
  function walk(node: Node, tags: string[], inRow: boolean, depth: number): void {
    if (depth > 128) return
    if (node.nodeName === '#text') {
      append((node as Tree.TextNode).value, tags)
      return
    }
    if (!('tagName' in node)) return
    const tag = node.tagName
    if (tag === 'br') {
      append('\n', tags)
      return
    }
    if (tag === 'tr' && !inRow) {
      flush()
      block.table = true
      for (const cell of node.childNodes)
        if ('tagName' in cell && (cell.tagName === 'td' || cell.tagName === 'th')) {
          if (block.runs.length) append(' ', [])
          const start = block.runs.length
          for (const child of cell.childNodes) walk(child, [], true, depth + 1)
          pendingBreak = false
          if (block.runs.length === start)
            block.runs.push({ text: '', start: block.text.length, prefix: '', suffix: '' })
          block.runs[start].prefix = '<' + cell.tagName + '>' + block.runs[start].prefix
          block.runs[block.runs.length - 1].suffix += '</' + cell.tagName + '>'
        }
      flush()
      return
    }
    const boundary = !inRow && blockTags.has(tag)
    const cellBlock = inRow && (blockTags.has(tag) || tag === 'td' || tag === 'th')
    if (cellBlock) pendingBreak = true
    if (boundary) flush()
    const style = inlineTags.has(tag)
      ? tag
      : /^h[1-6]$/.test(tag)
        ? 'strong'
        : tag === 'pre'
          ? 'code'
          : ''
    for (const child of node.childNodes)
      walk(child, style ? [...tags, style] : tags, inRow, depth + 1)
    if (boundary) flush()
    if (cellBlock) pendingBreak = true
  }
  for (const n of parseFragment(renderDocument(doc)).childNodes) walk(n, [], false, 0)
  flush()
  cache.set(doc, { source: doc.markdown, format: doc.format, blocks })
  return blocks
}

export function highlightedExcerpt(
  block: DocumentExcerpt,
  spans: readonly { start: number; end: number }[]
): string {
  // 命中按正文顺序排列；跨粗体/斜体边界的词只遍历它实际覆盖的文本段。
  let spanIndex = 0
  const content = block.runs
    .map((run) => {
      let offset = 0,
        html = ''
      while (spanIndex < spans.length && spans[spanIndex].end <= run.start) spanIndex++
      for (let i = spanIndex; i < spans.length; i++) {
        const span = spans[i]
        if (span.start >= run.start + run.text.length) break
        const start = Math.max(offset, span.start - run.start),
          end = Math.min(run.text.length, span.end - run.start)
        if (start >= end) continue
        html +=
          escapeDocumentText(run.text.slice(offset, start)) +
          '<mark>' +
          escapeDocumentText(run.text.slice(start, end)) +
          '</mark>'
        offset = end
      }
      return run.prefix + html + escapeDocumentText(run.text.slice(offset)) + run.suffix
    })
    .join('')
  return block.table ? '<table><tbody><tr>' + content + '</tr></tbody></table>' : content
}
