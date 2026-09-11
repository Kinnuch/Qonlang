/**
 * 语域标签的简写（词条卡里方框里那一个字）：
 * 汉字、假名、谚文取第一个字（文学 → 文）；拉丁这类字母文字取到第一个元音后面跟着的辅音为止再加点
 * （archaic → arch.、literary → lit.），本身就短（不超过 4 个字母）或截不短的原样。
 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

const base = (ch: string): string => ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const isVowel = (ch: string): boolean => /^[aeiouyæøœ]$/.test(base(ch))

export function registerShort(text: string): string {
  const s = text.trim()
  if (!s) return ''
  const first = Array.from(s)[0]
  if (CJK.test(first)) return first
  const word = s.split(/[\s/,，、;；]+/)[0]
  const letters = Array.from(word)
  if (letters.length <= 4) return word
  let i = 0
  while (i < letters.length && !isVowel(letters[i])) i++
  while (i < letters.length && isVowel(letters[i])) i++
  let j = i
  while (j < letters.length && !isVowel(letters[j]) && /\p{L}/u.test(letters[j])) j++
  if (j === i) return word
  let abbr = letters.slice(0, j)
  // 末尾双写的辅音只留一个（written → writ.）
  if (abbr.length >= 2 && base(abbr[abbr.length - 1]) === base(abbr[abbr.length - 2]))
    abbr = abbr.slice(0, -1)
  if (abbr.length >= letters.length - 1) return word
  return abbr.join('') + '.'
}
