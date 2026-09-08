/**
 * CSV / TSV 解析（RFC 4180：引号、转义引号、引号内换行），自动识别分隔符与 BOM。
 */

export type Delimiter = ',' | ';' | '\t' | '|'

export interface CsvTable {
  rows: string[][]
  delimiter: Delimiter
}

export function detectDelimiter(text: string): Delimiter {
  const sample = text.split(/\r?\n/).slice(0, 20)
  const candidates: Delimiter[] = [',', '\t', ';', '|']
  let best: Delimiter = ','
  let bestScore = -1
  for (const d of candidates) {
    const counts = sample.filter((l) => l.trim()).map((l) => countOutsideQuotes(l, d))
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

function countOutsideQuotes(line: string, d: string): number {
  let n = 0
  let q = false
  for (const c of line) {
    if (c === '"') q = !q
    else if (c === d && !q) n++
  }
  return n
}

export function parseCsv(text: string, delimiter?: Delimiter): CsvTable {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const d = delimiter ?? detectDelimiter(text)
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
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
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
  return { rows: rows.filter((r) => r.some((c) => c.trim() !== '')), delimiter: d }
}

export function toCsv(rows: string[][], delimiter: Delimiter = ','): string {
  const esc = (s: string): string => (/[",\n\r\t;|]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
  return rows.map((r) => r.map(esc).join(delimiter)).join('\n') + '\n'
}
