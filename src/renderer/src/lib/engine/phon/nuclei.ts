import { inferFeatures } from '$lib/ipa/features'
import { canonicalG } from '$lib/ipa/equivalence'

// 裸 N 常用来表示鼻音，不是核声明；模板中的 N 语法另由模板解析器处理。
export const NUCLEUS_CLASS = /^(V|Vowel|Vowels|元音|Nucleus)$/i
export const CONSONANT_CLASS = /^(C|Consonant|Consonants|辅音)$/i

export function stripMarks(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** 每次分析的局部比较索引；原成员、原音段均不改，也不缓存可变项目数据。 */
export function prepareUnitMatcher(
  values: Iterable<string>,
  equivalent?: (a: string, b: string) => boolean
): { members: ReadonlySet<string>; has: (s: string) => boolean } {
  const members = new Set(values)
  const key = (s: string): string => canonicalG(s.normalize('NFC'))
  const keys = new Set([...members].map(key))
  return {
    members,
    has: (s) => {
      const k = key(s)
      return keys.has(k) || (!!equivalent && [...keys].some((value) => equivalent(value, k)))
    }
  }
}

/** 完整单位优先；再看长度变体、成音节附标，最后才忽略普通组合附标。 */
export function syllableNucleusMatch(
  segment: string,
  nuclei: ReadonlySet<string>,
  consonants?: ReadonlySet<string>
): boolean | undefined {
  return createNucleusMatcher(nuclei, consonants).declared(segment)
}

export function createNucleusMatcher(
  nuclei: Iterable<string>,
  consonants: Iterable<string> = [],
  equivalent?: (a: string, b: string) => boolean
): { declared: (s: string) => boolean | undefined; isNucleus: (s: string) => boolean } {
  const nucleus = prepareUnitMatcher(nuclei, equivalent)
  const consonant = prepareUnitMatcher(consonants, equivalent)
  const match = (segment: string): boolean | undefined => {
    const suffix = /[ːˑ\p{M}]+$/u.exec(segment)
    const withoutLength =
      suffix && /[ːˑ]/u.test(suffix[0])
        ? segment.slice(0, suffix.index) + suffix[0].replace(/[ːˑ]/gu, '')
        : segment
    const lookup = (form: string): boolean | undefined => {
      if (!form) return undefined
      if (nucleus.has(form)) return true
      if (consonant.has(form)) return false
      return undefined
    }
    for (const form of new Set([segment, withoutLength])) {
      const hit = lookup(form)
      if (hit !== undefined) return hit
    }
    // n̩ 不能因基础 n 是辅音而失去核；i̯ 也不能因基础 i 是元音而被提升。
    const decomposed = segment.normalize('NFD')
    if (!/[^\p{M}\p{Lm}]/u.test(decomposed)) return undefined
    if (/\u032f/u.test(decomposed)) return false
    if (/\u0329/u.test(decomposed)) return true
    for (const form of new Set([stripMarks(segment), stripMarks(withoutLength)])) {
      const hit = lookup(form)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  return { declared: match, isNucleus: (s) => match(s) ?? inferredNucleus(s) }
}

/** 未声明的单位按 IPA 推断；未知自定义符号不凭空作核。 */
export function inferredNucleus(segment: string): boolean {
  if (!/[^\p{M}\p{Lm}]/u.test(segment.normalize('NFD'))) return false
  const f = inferFeatures(segment)
  if (f.syllabic === 'yes') return true
  if (f.syllabic === 'no') return false
  if (f.type === 'vowel') return true
  // 未声明的多字母单位只有每个基础字母都是元音时才算核。
  const letters = Array.from(stripMarks(segment)).filter((ch) => !/\p{Lm}/u.test(ch))
  return letters.length > 0 && letters.every((ch) => inferFeatures(ch).syllabic === 'yes')
}

export function isSyllableNucleus(
  segment: string,
  nuclei: ReadonlySet<string>,
  consonants?: ReadonlySet<string>
): boolean {
  return createNucleusMatcher(nuclei, consonants).isNucleus(segment)
}
