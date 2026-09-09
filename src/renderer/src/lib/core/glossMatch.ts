/**
 * gloss 与释义是不是说的同一件事。
 * 同一个写法常常既是某个名词的格形又是某个动词的焦点形，光按形式查会挂错词，
 * 所以拿标注里的意思再核一遍。
 */
import type { Lexeme } from './model'

const CJK = /[一-鿿぀-ヿ가-힯]/

/** 切出可比较的片段：去掉编号、【】标记与各种语法符号 */
export function glossPieces(text: string): string[] {
  return (text ?? '')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\d+/g, ' ')
    .split(/[-=<>·.．,，、;；:：()（）[\]\s“”"'…/|]+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** 两段文字有没有共同的意思片段（任一方包含另一方即可） */
export function textsOverlap(a: string, b: string): boolean {
  const pa = glossPieces(a)
  const pb = glossPieces(b)
  if (!pa.length || !pb.length) return false
  for (const x of pa) for (const y of pb) if (x.includes(y) || y.includes(x)) return true
  return false
}

/** gloss 里没有意思成分（纯缩写、纯拉丁）时无从核对，按「不反对」处理 */
export function glossHasMeaning(gloss: string): boolean {
  return CJK.test(gloss ?? '')
}

/** 这个词条的释义能不能对上这条 gloss */
export function lexemeMatchesGloss(l: Lexeme, gloss: string): boolean {
  if (!glossHasMeaning(gloss)) return true
  const def = l.senses
    .flatMap((s) => Object.values(s.definition))
    .filter(Boolean)
    .join('；')
  return textsOverlap(def, gloss)
}
