/**
 * 顶栏搜索的小语法（各模块通用）：
 * - 普通文字：在本页默认的字段里找，忽略大小写；搜的词里没写附加符时，被搜的文字也忽略附加符
 * - 字段=内容：只在这个字段里找，如 gloss=PL、word=kam（本页有哪些字段见搜索框旁的「?」）
 * - 字段==内容：整个字段完全相等
 * - /正则/ 或 字段=/正则/：按正则找，默认忽略大小写；写了标志就按写的来，如 /^Ka/u
 * - 多个条件用空格隔开，要全部满足；内容里有空格就加引号："a b"、tr="你 好"
 * 不认识的字段名不当字段，整段按普通文字找（造语里 = 常作附着边界）。
 */

/** 全是 ASCII 字符 */
function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false
  return true
}

export interface SearchField {
  /** 写在查询里的字段名 */
  key: string
  /** 别名：中文名、缩写 */
  aliases: string[]
}

export interface QueryTerm {
  /** 字段名；null 表示本页的默认字段 */
  field: string | null
  /** 这个条件的原文 */
  raw: string
  test: (value: string) => boolean
}

export interface ParsedQuery {
  terms: QueryTerm[]
  /** 写错的正则：界面上提示一下，条件退回按普通文字找 */
  errors: string[]
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')

function textTest(needle: string, exact: boolean): (value: string) => boolean {
  const n = needle.normalize('NFC').toLowerCase()
  // 搜的词里没写附加符：被搜的文字也去掉附加符再比（kam 能搜到 kâm）
  const loose = fold(n) === n
  return (value) => {
    // 纯 ASCII 的文字没有附加符可去，省掉规范化（每敲一个字要比几万次）
    const ascii = isAscii(value)
    const v = ascii ? value.toLowerCase() : value.normalize('NFC').toLowerCase()
    if (exact) return v === n || (loose && !ascii && fold(v) === n)
    return v.includes(n) || (loose && !ascii && fold(v).includes(n))
  }
}

/** 从 i 处读一个 /正则/标志；后面不是空白或结尾就不算 */
function readRegex(s: string, i: number): { source: string; flags: string; end: number } | null {
  if (s[i] !== '/') return null
  let j = i + 1
  let inClass = false
  for (; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') {
      j++
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) break
  }
  if (j >= s.length || j === i + 1) return null
  let k = j + 1
  while (k < s.length && /[dimsuvgy]/.test(s[k])) k++
  if (k < s.length && !/\s/.test(s[k])) return null
  return { source: s.slice(i + 1, j), flags: s.slice(j + 1, k), end: k }
}

function readValue(s: string, i: number): { text: string; end: number } {
  const close = s[i] === '"' ? '"' : s[i] === '“' ? '”' : ''
  if (close) {
    const j = s.indexOf(close, i + 1)
    return j < 0 ? { text: s.slice(i + 1), end: s.length } : { text: s.slice(i + 1, j), end: j + 1 }
  }
  let j = i
  while (j < s.length && !/\s/.test(s[j])) j++
  return { text: s.slice(i, j), end: j }
}

const FIELD_HEAD = /^([^\s=＝"“/]+)(==|＝＝|=|＝)/u

export function parseQuery(input: string, fields: SearchField[] = []): ParsedQuery {
  const byName = new Map<string, string>()
  for (const f of fields) for (const n of [f.key, ...f.aliases]) byName.set(n.toLowerCase(), f.key)
  const terms: QueryTerm[] = []
  const errors: string[] = []
  const s = input
  let i = 0
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++
      continue
    }
    const start = i
    let field: string | null = null
    let exact = false
    const head = FIELD_HEAD.exec(s.slice(i))
    if (head && byName.has(head[1].toLowerCase())) {
      field = byName.get(head[1].toLowerCase())!
      exact = head[2].length === 2
      i += head[0].length
      // 「gloss=」还没写内容：先不过滤
      if (i >= s.length || /\s/.test(s[i])) continue
    }
    const re = readRegex(s, i)
    if (re) {
      const raw = s.slice(start, re.end)
      // g、y 会让 test() 带状态，去掉
      const tries = re.flags ? [re.flags.replace(/[gy]/g, '')] : ['iu', 'i']
      let rx: RegExp | null = null
      for (const f of tries) {
        try {
          rx = new RegExp(re.source, f)
          break
        } catch {
          rx = null
        }
      }
      if (rx) {
        const r = rx
        terms.push({ field, raw, test: (v) => r.test(v) })
      } else {
        errors.push(raw)
        terms.push({ field, raw, test: textTest(re.source, exact) })
      }
      i = re.end
      continue
    }
    const v = readValue(s, i)
    if (v.text) terms.push({ field, raw: s.slice(start, v.end), test: textTest(v.text, exact) })
    i = Math.max(v.end, i + 1)
  }
  return { terms, errors }
}

/** values(field) 给出一条记录在某个字段（null = 默认字段）里的全部文字；条件要全部满足 */
export function matchQuery(q: ParsedQuery, values: (field: string | null) => string[]): boolean {
  return q.terms.every((term) => values(term.field).some((v) => !!v && term.test(v)))
}

/** 没有字段的页面：一组文字里任意一段满足每个条件即可 */
export function matchText(q: ParsedQuery, texts: string[]): boolean {
  return matchQuery(q, () => texts)
}
