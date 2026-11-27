/** 仅用于外部纯文本的行界；不改原有记录或结构化字段中的文字。 */
export const stripTextBom = (text: string): string => text.replace(/^\uFEFF/, '')

export const isTextLineBreak = (character: string): boolean =>
  character === '\r' ||
  character === '\n' ||
  character === '\u000B' ||
  character === '\u000C' ||
  character === '\u0085' ||
  character === '\u2028' ||
  character === '\u2029'

/** CRLF 算一个行界；空白行不生成条目，行内字符与空格不重写。 */
export function splitTextLines(text: string): string[] {
  return (
    stripTextBom(text)
      // VT/FF 是明确支持的外部文本行界。
      // eslint-disable-next-line no-control-regex
      .split(/\r\n|[\r\n\u000B\u000C\u0085\u2028\u2029]/)
      .map((line) => line.trim())
      .filter(Boolean)
  )
}
