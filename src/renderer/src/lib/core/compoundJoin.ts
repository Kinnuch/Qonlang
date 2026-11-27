/** 复合词连接处的临时流水线。只处理草稿字串，不回写来源，也不作IPA往返转换。 */
import type { Language } from './model'
import { canonicalG } from '$lib/ipa/equivalence'
import { segment, spellingUnits } from '$lib/engine/phon'

export type CompoundJoinStep =
  | { id: string; kind: 'drop-left' | 'drop-right'; count: number; times: number }
  | { id: string; kind: 'insert'; side: 'left' | 'right'; text: string }
  | { id: string; kind: 'separator'; text: string }
export type CompoundJoinIssue = 'invalidCount' | 'invalidText' | 'invalidStep' | 'tooMany'
export interface CompoundJoinState {
  left: string
  right: string
  separator: string
  surface: string
}
export interface CompoundJoinTrace {
  id: string
  kind: CompoundJoinStep['kind']
  before: CompoundJoinState
  after: CompoundJoinState
  removed: string[]
  issue?: CompoundJoinIssue
}
export interface CompoundJoinResult extends CompoundJoinState {
  initialUnits: { left: string[]; right: string[] }
  trace: CompoundJoinTrace[]
  valid: boolean
  issue?: CompoundJoinIssue
}
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 沿用构形的拼写单位，另用完整字素边界兜底未知组合，保留原始大小写和Unicode写法。 */
export function prepareCompoundJoin(
  language: Language
): (left: string, right: string, steps: readonly CompoundJoinStep[]) => CompoundJoinResult {
  const primary =
      language.orthographies.find((ortho) => ortho.isPrimary) ?? language.orthographies[0],
    ignoreCase = primary?.caseInsensitive !== false
  const normalized = (text: string): string =>
    canonicalG((ignoreCase ? text.toLowerCase() : text).normalize('NFC'))
  const inventory = [
      ...new Set(
        [...spellingUnits(language).units, ...language.alphabet].filter(Boolean).map(normalized)
      )
    ],
    known = new Set(inventory)
  function split(text: string): string[] {
    const boundaries = new Map<number, number>([[0, 0]])
    let folded = '',
      rawOffset = 0
    for (const part of graphemes.segment(text)) {
      folded += normalized(part.segment)
      rawOffset += part.segment.length
      boundaries.set(folded.length, rawOffset)
    }
    const chunks: string[] = []
    let at = 0,
      rawStart = 0
    for (const unit of segment(folded, inventory)) {
      at += unit.length
      const rawEnd = boundaries.get(at)
      if (rawEnd !== undefined) {
        chunks.push(text.slice(rawStart, rawEnd))
        rawStart = rawEnd
      }
    }
    if (rawStart < text.length) chunks.push(text.slice(rawStart))
    const safe: string[] = []
    for (const chunk of chunks) {
      const previous = safe[safe.length - 1]
      // 未单独定义的长度/送气等修饰符、明确的连音附标不能被留成半截。
      if (
        previous &&
        (/[\u035c\u0361]\p{M}*$/u.test(previous) ||
          (/^[\p{M}\p{Lm}]+$/u.test(chunk) && !known.has(normalized(chunk))))
      )
        safe[safe.length - 1] += chunk
      else safe.push(chunk)
    }
    return safe
  }
  function boundary(
    text: string,
    side: 'left' | 'right'
  ): { text: string; marker: string; units: string[] } {
    const units = split(text)
    let start = 0,
      end = units.length
    const notation = (unit: string): boolean => /^-+$/u.test(unit) && !known.has(normalized(unit))
    if (side === 'left') while (end > start && notation(units[end - 1])) end--
    else while (start < end && notation(units[start])) start++
    // 整个来源就是符号时，没有可识别的词缀词干，不能擅自丢掉这个来源字形。
    if (start === end) return { text, marker: '', units }
    return {
      text: units.slice(start, end).join(''),
      marker: side === 'left' ? units.slice(end).join('') : units.slice(0, start).join(''),
      units: units.slice(start, end)
    }
  }
  return (left, right, steps) => {
    const leftBoundary = boundary(left, 'left'),
      rightBoundary = boundary(right, 'right')
    const initialUnits = { left: leftBoundary.units, right: rightBoundary.units },
      trace: CompoundJoinTrace[] = []
    let state: CompoundJoinState = { left, right, separator: '', surface: left + right },
      issue: CompoundJoinIssue | undefined
    let opened = false
    const openJunction = (): void => {
      if (opened) return
      opened = true
      state.left = leftBoundary.text
      state.right = rightBoundary.text
      state.separator = leftBoundary.marker + rightBoundary.marker
    }
    for (const step of steps.slice(0, 100)) {
      const before = { ...state }
      let removed: string[] = []
      let local: CompoundJoinIssue | undefined
      if (step.kind === 'drop-left' || step.kind === 'drop-right') {
        if (
          !Number.isSafeInteger(step.count) ||
          step.count < 1 ||
          !Number.isSafeInteger(step.times) ||
          step.times < 1
        )
          local = 'invalidCount'
        else {
          openJunction()
          const side = step.kind === 'drop-left' ? 'left' : 'right',
            units = split(state[side]),
            amount =
              step.count >= units.length || step.times >= Math.ceil(units.length / step.count)
                ? units.length
                : step.count * step.times
          if (side === 'left') {
            removed = units.slice(units.length - amount)
            state.left = units.slice(0, units.length - amount).join('')
          } else {
            removed = units.slice(0, amount)
            state.right = units.slice(amount).join('')
          }
        }
      } else if (step.kind === 'insert') {
        if (typeof step.text !== 'string' || !['left', 'right'].includes(step.side))
          local = 'invalidText'
        else {
          openJunction()
          if (step.side === 'left') state.left += step.text
          else state.right = step.text + state.right
        }
      } else if (step.kind === 'separator') {
        if (typeof step.text !== 'string') local = 'invalidText'
        else {
          openJunction()
          state.separator = step.text
        }
      } else local = 'invalidStep'
      state = { ...state, surface: state.left + state.separator + state.right }
      if (local) issue ??= local
      trace.push({
        id: step.id,
        kind: step.kind,
        before,
        after: { ...state },
        removed,
        ...(local ? { issue: local } : {})
      })
    }
    if (steps.length > 100) issue = 'tooMany'
    return { ...state, initialUnits, trace, valid: !issue, ...(issue ? { issue } : {}) }
  }
}
