/**
 * 从 IPA 表推一个音位的默认特征。维度名是普通字符串，用户可以改、删、加。
 */
import { PULMONIC, PLACES, MANNERS, VOWELS, HEIGHTS, BACKNESS, OTHER_PULMONIC, NON_PULMONIC, OTHER_VOWELS } from './data'

export const DEFAULT_DIMENSIONS = ['type', 'voice', 'place', 'manner', 'height', 'backness', 'round', 'syllabic'] as const

export function defaultFeatures(symbol: string): Record<string, string> {
  const base = symbol.normalize('NFD').replace(/\p{M}/gu, '').replace(/[ʰʲʷˠˤː]/g, '')
  for (let mi = 0; mi < PULMONIC.length; mi++) {
    for (let pi = 0; pi < PULMONIC[mi].length; pi++) {
      const cell = PULMONIC[mi][pi]
      if (cell[0] === base) return { type: 'consonant', voice: 'voiceless', place: PLACES[pi].en, manner: MANNERS[mi].en, syllabic: 'no' }
      if (cell[1] === base) return { type: 'consonant', voice: 'voiced', place: PLACES[pi].en, manner: MANNERS[mi].en, syllabic: 'no' }
    }
  }
  for (let hi = 0; hi < VOWELS.length; hi++) {
    for (let bi = 0; bi < VOWELS[hi].length; bi++) {
      const cell = VOWELS[hi][bi]
      if (cell[0] === base) return { type: 'vowel', height: HEIGHTS[hi].en, backness: BACKNESS[bi].en, round: 'no', syllabic: 'yes' }
      if (cell[1] === base) return { type: 'vowel', height: HEIGHTS[hi].en, backness: BACKNESS[bi].en, round: 'yes', syllabic: 'yes' }
    }
  }
  if (OTHER_VOWELS.some((v) => v.s === base)) return { type: 'vowel', syllabic: 'yes' }
  if (OTHER_PULMONIC.some((v) => v.s === base)) return { type: 'consonant', syllabic: 'no' }
  for (const g of NON_PULMONIC) if (g.items.some((v) => v.s === base)) return { type: 'consonant', manner: g.en.toLowerCase(), syllabic: 'no' }
  // 常见附加特征
  const extra: Record<string, string> = {}
  if (/ʰ/.test(symbol)) extra.aspirated = 'yes'
  if (/ː/.test(symbol)) extra.long = 'yes'
  return extra
}

/** 附加特征：送气、长、鼻化等，从附标推得，叠加在基础特征上 */
export function diacriticFeatures(symbol: string): Record<string, string> {
  const f: Record<string, string> = {}
  if (/ʰ/.test(symbol)) f.aspirated = 'yes'
  if (/ː/.test(symbol)) f.long = 'yes'
  if (/̃/.test(symbol.normalize('NFD'))) f.nasal = 'yes'
  if (/ʲ/.test(symbol)) f.palatalized = 'yes'
  if (/ʷ/.test(symbol)) f.labialized = 'yes'
  if (/̥/.test(symbol.normalize('NFD'))) f.voice = 'voiceless'
  if (/̩/.test(symbol.normalize('NFD'))) f.syllabic = 'yes'
  return f
}

export function inferFeatures(symbol: string): Record<string, string> {
  return { ...defaultFeatures(symbol), ...diacriticFeatures(symbol) }
}
