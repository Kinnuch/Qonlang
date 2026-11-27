/**
 * CSV / TSV 解析（RFC 4180：引号、转义引号、引号内换行），自动识别分隔符与 BOM。
 */

import { isTextLineBreak, stripTextBom } from './textLines'

export type Delimiter = ',' | ';' | '\t' | '|'

export interface CsvTable {
  rows: string[][]
  delimiter: Delimiter
}

export function detectDelimiter(text: string): Delimiter {
  const candidates: Delimiter[] = [',', '\t', ';', '|']
  let best: Delimiter = ','
  let bestScore = -1
  for (const d of candidates) {
    const counts = scanRows(stripTextBom(text), d, 20).map((row) => row.length - 1)
    if (!counts.length) continue
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    // 每行数量一致且不为 0 的分隔符得分最高
    const score = min === 0 ? 0 : min * 10 - (max - min)
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function scanRows(text: string, d: Delimiter, limit = Infinity): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === d) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (isTextLineBreak(c)) {
      row.push(field)
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
      field = ''
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
      if (rows.length >= limit) return rows
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // 去掉全空行
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function parseCsv(text: string, delimiter?: Delimiter): CsvTable {
  text = stripTextBom(text)
  const d = delimiter ?? detectDelimiter(text)
  return { rows: scanRows(text, d), delimiter: d }
}

export function toCsv(rows: string[][], delimiter: Delimiter = ','): string {
  const esc = (s: string): string =>
    // 与读取端一致：包含VT/FF等行界的字段必须带引号。
    // eslint-disable-next-line no-control-regex
    /[",\n\r\u000B\u000C\u0085\u2028\u2029\t;|]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  return rows.map((r) => r.map(esc).join(delimiter)).join('\n') + '\n'
}
