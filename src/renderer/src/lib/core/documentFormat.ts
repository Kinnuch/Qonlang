/** 项目文档的格式与安全预览。parse5 只生成普通数据树，不创建 DOM、执行脚本或加载资源。 */
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import type { DocPage } from './model'
import { mdToHtml, type MdOptions } from './markdown'

type Node = DefaultTreeAdapterTypes.ChildNode
const tags = new Set(
  'p div section article header footer h1 h2 h3 h4 h5 h6 span strong b em i u s del sub sup small mark abbr br hr pre code kbd samp var q blockquote ul ol li dl dt dd table thead tbody tfoot tr td th caption a'.split(
    ' '
  )
)
const dropped = new Set(
  'script style iframe frame frameset object embed template noscript noembed noframes xmp plaintext svg math head title base link meta img picture source audio video track canvas form input button select textarea option'.split(
    ' '
  )
)
export const escapeDocumentText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const documentFormat = (doc: Pick<DocPage, 'format'>): 'markdown' | 'html' =>
  doc.format === 'html' ? 'html' : 'markdown'

function textWithLinks(text: string, opts: MdOptions): string {
  const out: string[] = []
  let at = 0
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    out.push(
      escapeDocumentText(text.slice(at, match.index)),
      mdToHtml(match[0], opts).replace(/^<p>|<\/p>$/g, '')
    )
    at = match.index! + match[0].length
  }
  out.push(escapeDocumentText(text.slice(at)))
  return out.join('')
}

/** 只输出本模块写死的标签与属性。输入的 class/id/data-*、CSS、URL资源和所有事件属性都不复制。 */
export function safeDocumentHtml(source: string, opts: MdOptions = {}): string {
  const root = parseFragment(source)
  const walk = (node: Node, links = true, depth = 0): string => {
    if (depth > 128) return ''
    if (node.nodeName === '#text')
      return links
        ? textWithLinks((node as DefaultTreeAdapterTypes.TextNode).value, opts)
        : escapeDocumentText((node as DefaultTreeAdapterTypes.TextNode).value)
    if (!('tagName' in node)) return ''
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || dropped.has(node.tagName)) return ''
    const tag = node.tagName
    const children = node.childNodes
      .map((child) =>
        walk(child, links && tag !== 'code' && tag !== 'pre' && tag !== 'a', depth + 1)
      )
      .join('')
    if (!tags.has(tag)) return children
    const value = (name: string): string =>
      node.attrs.find((attr) => attr.name === name)?.value ?? ''
    let attrs = ''
    if (tag === 'a') {
      const href = value('href')
      try {
        const url = new URL(href)
        if (
          (url.protocol === 'https:' || url.protocol === 'http:') &&
          !url.username &&
          !url.password
        )
          attrs = ` href="${escapeDocumentText(url.href)}" target="_blank" rel="noopener noreferrer"`
      } catch {
        /* 相对路径、文件与内部伪链接都不导出为可导航地址。 */
      }
    }
    if (tag === 'td' || tag === 'th')
      for (const name of ['colspan', 'rowspan']) {
        const n = value(name)
        if (/^[1-9]\d?$/.test(n)) attrs += ` ${name}="${n}"`
      }
    if (tag === 'ol' && /^-?\d{1,6}$/.test(value('start'))) attrs += ` start="${value('start')}"`
    if (/^(?:ltr|rtl|auto)$/.test(value('dir'))) attrs += ` dir="${value('dir')}"`
    return tag === 'br' || tag === 'hr' ? `<${tag}>` : `<${tag}${attrs}>${children}</${tag}>`
  }
  return root.childNodes.map((node) => walk(node)).join('')
}

export function renderDocument(
  doc: Pick<DocPage, 'format' | 'markdown'>,
  opts: MdOptions = {}
): string {
  return documentFormat(doc) === 'html'
    ? safeDocumentHtml(doc.markdown, opts)
    : mdToHtml(doc.markdown, opts)
}

/** HTML 导出只含净化过的正文；标题也转义，不让文档标题进入HTML语法。 */
export function documentHtmlPage(
  doc: Pick<DocPage, 'title' | 'format' | 'markdown'>,
  opts: MdOptions = {}
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeDocumentText(doc.title)}</title><style>@page{size:A4;margin:20mm}body{font-family:'Gentium Plus','Noto Serif SC',serif;font-size:11pt;line-height:1.6;padding:24px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:3px 8px}code{font-family:Consolas,monospace;background:#f2f2f2;padding:0 3px}pre{background:#f4f4f4;padding:8px;white-space:pre-wrap}blockquote{border-inline-start:3px solid #bbb;margin:0;padding-inline-start:10px;color:#555}a{color:inherit}.wl{text-decoration:none;border-bottom:1px solid #bbb}</style></head><body><h1>${escapeDocumentText(doc.title)}</h1>${renderDocument(doc, opts)}</body></html>`
}

/** HTML 页导出 Markdown：按安全正文的结构转换，项目链接原样留下；不执行用户HTML。 */
export function documentMarkdown(doc: Pick<DocPage, 'format' | 'markdown'>): string {
  if (documentFormat(doc) === 'markdown') return doc.markdown
  const walk = (node: Node, depth = 0): string => {
    if (depth > 128) return ''
    if (node.nodeName === '#text') return (node as DefaultTreeAdapterTypes.TextNode).value
    if (
      !('tagName' in node) ||
      node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      dropped.has(node.tagName)
    )
      return ''
    const body = node.childNodes.map((child) => walk(child, depth + 1)).join('')
    if (/^h[1-6]$/.test(node.tagName)) return `\n${'#'.repeat(Number(node.tagName[1]))} ${body}\n`
    if (node.tagName === 'strong' || node.tagName === 'b') return `**${body}**`
    if (node.tagName === 'em' || node.tagName === 'i') return `*${body}*`
    if (node.tagName === 'pre') return `\n\`\`\`\n${body}\n\`\`\`\n`
    if (node.tagName === 'code') return body
    if (node.tagName === 'li') return `- ${body}\n`
    if (node.tagName === 'br') return '\n'
    if (['p', 'div', 'blockquote', 'tr', 'section', 'article'].includes(node.tagName))
      return `${body}\n\n`
    if (node.tagName === 'td' || node.tagName === 'th') return `${body} | `
    return body
  }
  return parseFragment(doc.markdown)
    .childNodes.map((node) => walk(node))
    .join('')
    .trim()
}

/** 词条例句检索只读HTML可见文字，不把标签或属性误当作造语正文。 */
export function documentTextLines(doc: Pick<DocPage, 'format' | 'markdown'>): string[] {
  if (documentFormat(doc) === 'markdown') return doc.markdown.split(/\n+/)
  const root = parseFragment(safeDocumentHtml(doc.markdown))
  const text = (node: Node): string =>
    node.nodeName === '#text'
      ? (node as DefaultTreeAdapterTypes.TextNode).value
      : 'childNodes' in node
        ? node.childNodes.map(text).join('') +
          ('tagName' in node &&
          [
            'p',
            'div',
            'li',
            'tr',
            'section',
            'article',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'br'
          ].includes(node.tagName)
            ? '\n'
            : '')
        : ''
  return root.childNodes.map(text).join('').split(/\n+/)
}
