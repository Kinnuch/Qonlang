/**
 * 极简 Markdown → HTML：标题、段落、无序 / 有序列表、引用、代码块、行内代码 / 粗体 / 斜体 / 链接、表格。
 * `[[词头]]` 视为词库链接，交给 resolve 回调决定是否可点。
 */
export interface MdOptions {
  /** 返回词位 id 则渲染为可点链接，null 则原样加虚线下划线 */
  resolve?: (name: string) => string | null
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(text: string, opts: MdOptions): string {
  let s = esc(text)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, name: string, label?: string) => {
    const id = opts.resolve?.(name.trim()) ?? null
    const txt = label ?? name
    return id ? `<a class="wl" data-lexeme="${id}" href="#">${txt}</a>` : `<span class="wl missing">${txt}</span>`
  })
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
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
    out.push('<thead><tr>' + head.map((c) => `<th>${inline(c, opts)}</th>`).join('') + '</tr></thead>')
    if (body.length) out.push('<tbody>' + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c, opts)}</td>`).join('') + '</tr>').join('') + '</tbody>')
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
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim())
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
