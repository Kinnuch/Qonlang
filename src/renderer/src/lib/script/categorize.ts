/**
 * 字形自动分类。先看转写值：读发音的文字直接当音，其余按主正字法转成音，用音位表切开——
 * 全是元音算元音符号、全是辅音算辅音、辅音元音都有算音节；转写值本身是标点、数字的照算。
 * 转写值空着或看不出是什么音的，退回按字符本身的 Unicode 类别（字母、附标、私用区字形……）。
 * 元音、辅音全由这门语言自己的音位表与音类决定，不预设任何语言。
 */
import type { Glyph, Language, Script } from '$lib/core/model'
import { nucleusSet, phonemeKind, segment, SUPRASEGMENTAL_IGNORE } from '$lib/engine/phon'
import { transcribe } from '$lib/core/pronounce'
import { inferFeatures } from '$lib/ipa/features'
import { guessCategory } from './fontParse'
import { glyphValues } from './render'

/** 软件自带的分类（界面上有译名）；别的名字是用户自己起的，自动分类不动它们 */
export const BUILTIN_GLYPH_CATEGORIES = [
  'letter',
  'vowel',
  'consonant',
  'syllable',
  'mark',
  'number',
  'punct',
  'glyph',
  'space',
  'other'
]

const words = (t?: string): string[] => (t ?? '').split(/[\s,，]+/).filter(Boolean)

/** 给一套文字做一个分类函数（音位表、正字法只准备一次） */
export function glyphCategorizer(
  lang: Language | null | undefined,
  script: Script
): (g: Pick<Glyph, 'char' | 'value'>) => string {
  const packing = script.packing
  const inventory = packing?.letters?.trim()
    ? words(packing.letters)
    : (lang?.phonemes.map((p) => p.symbol) ?? [])
  const nuclei = packing?.vowels?.trim()
    ? new Set(words(packing.vowels))
    : lang
      ? nucleusSet(lang)
      : new Set<string>()
  const kinds = new Map(lang ? lang.phonemes.map((p) => [p.symbol, phonemeKind(lang, p)]) : [])
  const fromPron = (script.from ?? '').trim().startsWith('pron:')
  const ortho =
    lang && !fromPron
      ? (lang.orthographies.find((o) => o.isPrimary) ?? lang.orthographies[0])
      : undefined

  const kindOf = (seg: string): 'vowel' | 'consonant' | null => {
    if (nuclei.has(seg)) return 'vowel'
    const k = kinds.get(seg)
    if (k) return k
    const f = inferFeatures(seg)
    return f.syllabic === 'yes' || f.type === 'vowel'
      ? 'vowel'
      : f.type === 'consonant'
        ? 'consonant'
        : null
  }

  return (g) => {
    const byChar = g.char ? guessCategory(g.char) : 'other'
    const value = (glyphValues(g)[0] ?? g.value.trim()).normalize('NFC')
    if (!value) return byChar
    // 标点与符号算标点；声调字母、重音号这类修饰符号（\p{Sk}）不算，往下按音看
    if (/^[\p{P}\p{Sm}\p{Sc}\p{So}]+$/u.test(value)) return 'punct'
    if (/^\s+$/u.test(value)) return 'space'
    if (/^\p{N}+$/u.test(value)) return 'number'
    const lower = value.toLowerCase()
    const sound = (lang && ortho ? transcribe(lang, ortho, lower) : null) ?? lower
    const found = new Set(
      segment(sound.normalize('NFC'), inventory)
        .filter((s) => !SUPRASEGMENTAL_IGNORE.has(s) && /\p{L}/u.test(s))
        .map(kindOf)
        .filter((k) => k !== null)
    )
    if (found.has('vowel') && found.has('consonant')) return 'syllable'
    if (found.has('vowel')) return 'vowel'
    if (found.has('consonant')) return 'consonant'
    return byChar
  }
}
