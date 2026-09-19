/**
 * 按这门语言的字母表拆词：th、ll 这类多字母的字母算一个格子。
 * 猜词、拼词、填字都按这个拆，不然 th 会被拆成 t 和 h。
 */
import type { Language } from '$lib/core/model'

/** 字母表里的字母，长的排前面（拆词时先试长的） */
export function alphabetUnits(lang: Language | null | undefined): string[] {
  const units = new Set<string>()
  for (const a of lang?.alphabet ?? []) {
    const s = a.trim()
    if (s) units.add(s)
  }
  for (const d of lang?.digraphs ?? []) {
    const s = d.from?.trim()
    if (s) units.add(s)
  }
  return [...units].sort((a, b) => b.length - a.length)
}

/** 把词拆成一个个字母；字母表里没写的按单个字符算 */
export function splitLetters(word: string, units: readonly string[]): string[] {
  const out: string[] = []
  const lower = word
  let i = 0
  outer: while (i < lower.length) {
    for (const u of units) {
      if (u.length > 1 && lower.startsWith(u, i)) {
        out.push(lower.slice(i, i + u.length))
        i += u.length
        continue outer
      }
      if (u.length === 1 && lower[i] === u) {
        out.push(u)
        i += 1
        continue outer
      }
    }
    // 字母表里没有的字符：按一个 Unicode 码点算（带附加符的合成字符一起算）
    const cp = [...lower.slice(i)][0] ?? lower[i]
    out.push(cp)
    i += cp.length
  }
  return out
}

/** 比字母时忽略大小写（字母表里怎么写就怎么显示，比的时候统一小写） */
export const sameLetter = (a: string, b: string): boolean =>
  a.toLocaleLowerCase() === b.toLocaleLowerCase()
