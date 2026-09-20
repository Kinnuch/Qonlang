/**
 * 极简 Markdown → HTML：标题、段落、无序 / 有序列表、引用、代码块、行内代码 / 粗体 / 斜体 / 链接、表格。
 * `[[目标]]` 视为项目内链接，交给 resolve 回调决定链到哪一条、找没找到。
 */

/** 一条 `[[…]]` 解析出来的样子 */
export interface MdLink {
  /** 找到了：跳到哪个模块的哪一条（sub 再细一层，如阶段、槽位）；没找到就不填 */
  target?: { kind: string; id: string; sub?: string }
  /** 没写 `|显示文字` 时链接上写什么 */
  text: string
  /** 鼠标停上去的说明 */
  title?: string
  /** 词条、语素这些用数据字体 */
  data?: boolean
}

export interface MdOptions {
  /** 解析 `[[…]]` 里面那一截（含 `|显示文字`）；不给就一律画成「没找到」 */
  resolve?: (inner: string) => MdLink
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 放进属性里：再把引号也挡掉 */
const attr = (s: string): string => esc(s).replace(/"/g, '&quot;')

/** esc 的反操作：传给 resolve 的是用户原样写的字 */
const unesc = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** 表格一行拆成格子：写成 \\| 的竖线是格子里的内容，不当分隔 */
function splitRow(row: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (c === '\\' && row[i + 1] === '|') {
      cur += '|'
      i++
    } else if (c === '|') {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  out.push(cur.trim())
  return out
}

function inline(text: string, opts: MdOptions): string {
  let s = esc(text)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, name: string, label?: string) => {
    const inner = unesc(name.trim()) + (label ? `|${unesc(label)}` : '')
    const link = opts.resolve?.(inner) ?? { text: unesc(name.trim()) }
    const txt = esc(label ? unesc(label) : link.text)
    const cls = `wl${link.data ? ' data' : ''}`
    const title = link.title ? ` title="${attr(link.title)}"` : ''
    if (!link.target) return `<span class="${cls} missing"${title}>${txt}</span>`
    const sub = link.target.sub ? ` data-sub="${attr(link.target.sub)}"` : ''
    return `<a class="${cls}" data-kind="${attr(link.target.kind)}" data-id="${attr(link.target.id)}"${sub}${title} href="#">${txt}</a>`
  })
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  )
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return s
}

export function mdToHtml(md: string, opts: MdOptions = {}): string {
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let inCode = false
  let codeBuf: string[] = []
  let table: string[][] | null = null
  let quote: string[] = []

  const closeList = (): void => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }
  const flushTable = (): void => {
    if (!table) return
    const [head, ...body] = table
    out.push('<table>')
    out.push(
      '<thead><tr>' + head.map((c) => `<th>${inline(c, opts)}</th>`).join('') + '</tr></thead>'
    )
    if (body.length)
      out.push(
        '<tbody>' +
          body
            .map((r) => '<tr>' + r.map((c) => `<td>${inline(c, opts)}</td>`).join('') + '</tr>')
            .join('') +
          '</tbody>'
      )
    out.push('</table>')
    table = null
  }
  const flushQuote = (): void => {
    if (quote.length) {
      out.push(`<blockquote>${quote.map((q) => `<p>${inline(q, opts)}</p>`).join('')}</blockquote>`)
      quote = []
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (inCode) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`)
        codeBuf = []
        inCode = false
      } else codeBuf.push(raw)
      continue
    }
    if (/^```/.test(line)) {
      closeList()
      flushTable()
      flushQuote()
      inCode = true
      continue
    }
    // 表格：以 | 开头
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList()
      flushQuote()
      const cells = splitRow(line.trim().slice(1, -1))
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue // 分隔行
      if (!table) table = []
      table.push(cells)
      continue
    }
    flushTable()
    const h = /^(#{1,5})\s+(.*)$/.exec(line)
    if (h) {
      closeList()
      flushQuote()
      const lv = h[1].length + 1
      out.push(`<h${lv}>${inline(h[2], opts)}</h${lv}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      closeList()
      flushQuote()
      out.push('<hr>')
      continue
    }
    const q = /^>\s?(.*)$/.exec(line)
    if (q) {
      closeList()
      quote.push(q[1])
      continue
    }
    flushQuote()
    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol'
      if (list !== kind) {
        closeList()
        out.push(`<${kind}>`)
        list = kind
      }
      out.push(`<li>${inline((ul ?? ol)![1], opts)}</li>`)
      continue
    }
    closeList()
    if (line.trim()) out.push(`<p>${inline(line, opts)}</p>`)
  }
  if (inCode) out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`)
  closeList()
  flushTable()
  flushQuote()
  return out.join('')
}
