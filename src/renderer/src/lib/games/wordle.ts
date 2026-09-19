/** 猜词（wordle）：按这门语言的字母表判字母对错 */
import { sameLetter } from './letters'

export type LetterMark = 'hit' | 'near' | 'miss'

/**
 * 一次猜测的判定：位置对的记 hit，词里有但位置不对的记 near，其余 miss。
 * 重复字母按「答案里还剩几个」算（跟原版一样：多猜的那几个记 miss）
 */
export function judgeGuess(answer: readonly string[], guess: readonly string[]): LetterMark[] {
  const marks: LetterMark[] = guess.map(() => 'miss')
  const left = new Map<string, number>()
  answer.forEach((a, i) => {
    if (i < guess.length && sameLetter(a, guess[i])) {
      marks[i] = 'hit'
      return
    }
    const k = a.toLocaleLowerCase()
    left.set(k, (left.get(k) ?? 0) + 1)
  })
  guess.forEach((g, i) => {
    if (marks[i] === 'hit') return
    const k = g.toLocaleLowerCase()
    const n = left.get(k) ?? 0
    if (n > 0) {
      marks[i] = 'near'
      left.set(k, n - 1)
    }
  })
  return marks
}

/** 键盘上每个字母的状态：hit > near > miss（猜过几次取最好的那次） */
export function keyboardMarks(
  rows: { letters: readonly string[]; marks: readonly LetterMark[] }[]
): Map<string, LetterMark> {
  const rank: Record<LetterMark, number> = { miss: 0, near: 1, hit: 2 }
  const out = new Map<string, LetterMark>()
  for (const r of rows)
    r.letters.forEach((l, i) => {
      const k = l.toLocaleLowerCase()
      const m = r.marks[i]
      const cur = out.get(k)
      if (!cur || rank[m] > rank[cur]) out.set(k, m)
    })
  return out
}

export const isWin = (marks: readonly LetterMark[]): boolean =>
  marks.length > 0 && marks.every((m) => m === 'hit')
