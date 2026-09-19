/**
 * Sage（拼词）：上面列出几条释义，下面给一堆字母——这些字母正好能拼出那几个词。
 * 点字母组词，拼对一个就把它对上的释义填掉，用掉的字母从池子里划走。
 */
import { splitLetters, sameLetter } from './letters'
import { shuffle, type GameWord } from './words'

export interface SageAnswer {
  word: string
  gloss: string
  letters: string[]
  /** 已经拼出来了 */
  done: boolean
}

export interface SageRound {
  answers: SageAnswer[]
  /** 打乱的字母池（拼对的词会划掉自己那几个） */
  pool: { letter: string; usedBy: number | null }[]
}

export function makeSageRound(
  words: readonly GameWord[],
  units: readonly string[],
  count: number,
  rand: () => number
): SageRound {
  const picked = shuffle(words, rand).slice(0, count)
  const answers: SageAnswer[] = picked.map((w) => ({
    word: w.word,
    gloss: w.gloss,
    letters: splitLetters(w.word, units),
    done: false
  }))
  const flat: { letter: string; usedBy: number | null }[] = []
  answers.forEach((a) => a.letters.forEach((l) => flat.push({ letter: l, usedBy: null })))
  return { answers, pool: shuffle(flat, rand) }
}

/**
 * 拼出来的这串字母对上了哪一条（还没拼出来的里面找）；没对上返回 -1。
 * 对上之后把池子里的字母标成这一条用掉的
 */
export function submitSage(round: SageRound, chosen: readonly number[]): number {
  const letters = chosen.map((i) => round.pool[i]?.letter ?? '')
  const at = round.answers.findIndex(
    (a) =>
      !a.done &&
      a.letters.length === letters.length &&
      a.letters.every((l, i) => sameLetter(l, letters[i]))
  )
  if (at < 0) return -1
  round.answers[at].done = true
  for (const i of chosen) if (round.pool[i]) round.pool[i].usedBy = at
  return at
}

export const sageDone = (round: SageRound): boolean => round.answers.every((a) => a.done)
