/**
 * 粘贴进来的字符表：一行一个字形，用空格或制表符分成「字符 转写 名称」。
 * 导入样例与测试台都走这一条，看到的跟真导入一致。
 */
export interface GlyphLine {
  char: string
  value: string
  name: string
}

export function parseGlyphLines(text: string): GlyphLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [char, value = '', ...rest] = line.split(/\t+| +/)
      return { char, value, name: rest.join(' ') }
    })
}
