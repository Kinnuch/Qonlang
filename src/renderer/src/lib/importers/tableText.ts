/** 导入主输入、选择文件和测试预览共用同一解析；结构化表格不按物理行拆字段。 */
import { detectDelimiter, parseCsv, type Delimiter } from '$lib/core/csv'
import { splitTextLines, stripTextBom } from '$lib/core/textLines'

export type TableTextSplit = Delimiter | 'line'
export type TableTextChoice = TableTextSplit | 'auto'

export function parseTableText(
  text: string,
  choice: TableTextChoice = 'auto'
): { split: TableTextSplit; rows: string[][] } {
  if (choice === 'line') return { split: 'line', rows: splitTextLines(text).map((line) => [line]) }
  const delimiter = choice === 'auto' ? detectDelimiter(text) : choice,
    rows = parseCsv(text, delimiter).rows
  if (
    choice === 'auto' &&
    (!rows.length || rows.filter((row) => row.length > 1).length / rows.length < 0.8)
  )
    return { split: 'line', rows: splitTextLines(text).map((line) => [line]) }
  return { split: delimiter, rows }
}

/** 有明确文件类型时尊重该格式；单列 CSV 中的引号内换行仍是同一字段。 */
export function splitForTableFile(name: string, text: string): TableTextChoice {
  return /\.txt$/i.test(name)
    ? 'line'
    : /\.tsv$/i.test(name)
      ? '\t'
      : /\.csv$/i.test(name)
        ? detectDelimiter(text)
        : 'auto'
}

export const looksLikeJson = (text: string): boolean => /^\s*\{/.test(stripTextBom(text))
