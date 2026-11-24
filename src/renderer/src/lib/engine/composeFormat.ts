/** 工作台的表面排版：不改词头、词干、绑定或构形，只处理最终原文。 */
import { canonicalG, gLiteralPattern } from '$lib/ipa/equivalence'

export interface FormatWord {
  id: string
  form: string
  hostId?: string
  sourceAt?: number
  sourceEnd?: number
}
export interface ComposeLayout {
  leading: string
  trailing: string
  before: Record<string, string>
  after: Record<string, string>
  caseForms?: Record<string, { from: string; form: string }>
  review?: boolean
  order?: string[]
  automatic?: boolean
  unplaced?: string
}
export interface ComposeFormatOptions {
  capitalize: boolean
  punctuation: 'auto' | 'preserve' | 'latin' | 'fullwidth'
  defaultPeriod: boolean
}
export const emptyLayout = (): ComposeLayout => ({
  leading: '',
  trailing: '',
  before: {},
  after: {}
})
const fold = (text: string): string =>
  canonicalG(text.normalize('NFC')).replace(/\s+/g, ' ').trim().toUpperCase()
const TERMINAL = /[\p{Sentence_Terminal}…]/u
const OPEN = /[\p{Ps}\p{Pi}¿¡]/u
const CLOSE = /[\p{Pe}\p{Pf}]/u
const PUNCTUATION = /\p{P}/u
const LATIN: Record<string, string> = {
  '，': ',',
  '。': '.',
  '！': '!',
  '？': '?',
  '؛': ';',
  '،': ',',
  '؟': '?',
  '۔': '.',
  '；': ';',
  '：': ':',
  '（': '(',
  '）': ')',
  '、': ','
}
const FULL: Record<string, string> = {
  ',': '，',
  '.': '。',
  '!': '！',
  '?': '？',
  ';': '；',
  ':': '：',
  '(': '（',
  ')': '）'
}
const separator = (tokenizer?: string): string => (tokenizer === 'character' ? '' : ' ')

/** 待定位的标点若仍少于译文所保留的数目，提交前须让用户明确决定。 */
export function unplacedPunctuationMissing(
  baseText: string,
  unplaced: string,
  finalText: string
): string {
  const counts = (text: string): Map<string, number> => {
    const map = new Map<string, number>()
    for (const c of Array.from(text)) {
      const key = LATIN[c] ?? c
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }
  const wanted = counts(baseText + unplaced),
    got = counts(finalText),
    seen = new Set<string>()
  return Array.from(unplaced)
    .filter((c) => {
      const key = LATIN[c] ?? c
      if (seen.has(key)) return false
      seen.add(key)
      return (got.get(key) ?? 0) < (wanted.get(key) ?? 0)
    })
    .join('')
}

/** 只给语句起点的第一个字母变大写；无大小写文字会原样通过。 */
function capitalizeForm(
  form: string,
  start: boolean,
  enabled: boolean
): { form: string; start: boolean } {
  let output = '',
    atStart = start
  const characters = Array.from(form)
  for (let i = 0; i < characters.length; i++) {
    const character = characters[i]
    if (/\p{L}/u.test(character)) {
      output += atStart && enabled ? character.toUpperCase() : character
      atStart = false
    } else {
      output += character
      if (
        TERMINAL.test(character) &&
        !(
          character === '.' &&
          /\d/u.test(characters[i - 1] ?? '') &&
          /\d/u.test(characters[i + 1] ?? '')
        )
      )
        atStart = true
    }
  }
  return { form: output, start: atStart }
}

/** 严格对齐词块；最终编辑框允许改标点、空白与大小写，不能悄悄错配词条 ID。 */
export function parseComposedText(
  text: string,
  words: readonly FormatWord[],
  letters = ''
): { valid: boolean; layout: ComposeLayout; words: FormatWord[] } {
  const layout = emptyLayout(),
    matched: FormatWord[] = [],
    spans: { start: number; end: number }[] = []
  layout.order = words.map((word) => word.id)
  const kept = new Set(Array.from(letters))
  const gapOkay = (gap: string): boolean =>
    !/[\p{L}\p{N}\p{M}]/u.test(gap) && !Array.from(gap).some((c) => kept.has(c) && !/\s/u.test(c))
  let at = 0
  for (const word of words) {
    const pattern = word.form.trim().split(/\s+/u).map(gLiteralPattern).join('\\s+')
    if (!pattern) return { valid: false, layout, words: [] }
    const re = new RegExp(pattern, 'giu')
    re.lastIndex = at
    const match = re.exec(text)
    if (!match || !gapOkay(text.slice(at, match.index))) return { valid: false, layout, words: [] }
    matched.push({ ...word, form: match[0] })
    spans.push({ start: match.index, end: match.index + match[0].length })
    at = match.index + match[0].length
  }
  if (!gapOkay(text.slice(at)) || (!words.length && text.trim()))
    return { valid: false, layout, words: [] }
  if (!words.length) return { valid: true, layout, words: [] }
  layout.leading = text.slice(0, spans[0].start)
  layout.trailing = text.slice(at)
  layout.caseForms = {}
  let quoted = (layout.leading.match(/"/g)?.length ?? 0) % 2 === 1
  for (let i = 0; i < words.length; i++) {
    layout.caseForms[words[i].id] = { from: words[i].form, form: matched[i].form }
    if (!i) continue
    const gap = text.slice(spans[i - 1].end, spans[i].start)
    let opening = -1
    for (let p = 0; p < gap.length; p++) {
      const c = gap[p]
      if (OPEN.test(c) && opening < 0) opening = p
      if (c === '"') {
        if (!quoted && opening < 0) opening = p
        quoted = !quoted
      }
    }
    if (opening < 0) layout.after[words[i - 1].id] = gap
    else {
      layout.after[words[i - 1].id] = gap.slice(0, opening)
      layout.before[words[i].id] = gap.slice(opening)
    }
  }
  return { valid: true, layout, words: matched }
}

/** 译文标点按候选的原译文位置锚到词块；无可靠锚点或语序改变时要求用户核对。 */
export function layoutFromTranslation(
  translation: string,
  words: readonly FormatWord[],
  tokenizer?: string
): ComposeLayout {
  const layout = emptyLayout()
  layout.automatic = true
  layout.order = words.map((word) => word.id)
  if (!words.length) return layout
  const lexical = [...translation.matchAll(/[\p{L}\p{N}\p{M}]/gu)]
  if (!lexical.length) return layout
  const first = lexical[0].index!,
    last = lexical.at(-1)!.index! + lexical.at(-1)![0].length
  const anchors = words
    .map((word, index) => ({ word, index, at: word.sourceAt }))
    .filter(
      (x): x is { word: FormatWord; index: number; at: number } =>
        typeof x.at === 'number' && x.at >= 0 && x.at < translation.length
    )
  layout.review =
    anchors.length !== words.filter((w) => !w.hostId).length ||
    anchors.some((anchor, index) => index > 0 && anchor.at < anchors[index - 1].at)
  const marks: { at: number; end: number; text: string }[] = [],
    afterAtoms = new Map<string, { at: number; text: string }[]>(),
    beforeAtoms = new Map<string, { at: number; text: string }[]>()
  const atom = (map: typeof afterAtoms, id: string, at: number, text: string): void => {
    const values = map.get(id) ?? []
    values.push({ at, text })
    map.set(id, values)
  }
  let quoted = false
  for (let at = 0; at < translation.length; at++) {
    const c = translation[at]
    if (!PUNCTUATION.test(c)) continue
    const left = translation[at - 1] ?? '',
      right = translation[at + 1] ?? ''
    if (/[-'’‘‐‑_]/u.test(c) && /[\p{L}\p{N}]/u.test(left) && /[\p{L}\p{N}]/u.test(right)) continue
    if (c === '.' && /[\p{L}\p{N}]/u.test(left) && /[\p{L}\p{N}]/u.test(right)) continue
    if (at < first) {
      layout.leading += c
      if (c === '"') quoted = !quoted
      continue
    }
    if (at >= last) {
      layout.trailing += c
      continue
    }
    if (TERMINAL.test(c) || /[,;:，；：،؛、—–]/u.test(c)) {
      const previous = marks.at(-1)
      if (previous && at === previous.end) {
        previous.text += c
        previous.end = at + 1
      } else marks.push({ at, end: at + 1, text: c })
      continue
    }
    const opening = OPEN.test(c) || (c === '"' && !quoted)
    if (c === '"') quoted = !quoted
    const completed = anchors.filter((anchor) => (anchor.word.sourceEnd ?? anchor.at + 1) <= at)
    const leaves = completed.filter(
      (anchor) =>
        !completed.some(
          (other) =>
            other !== anchor &&
            other.at >= anchor.at &&
            (other.word.sourceEnd ?? other.at + 1) <= (anchor.word.sourceEnd ?? anchor.at + 1) &&
            (other.at > anchor.at ||
              (other.word.sourceEnd ?? other.at + 1) < (anchor.word.sourceEnd ?? anchor.at + 1))
        )
    )
    const pool = opening
      ? anchors.filter((anchor) => anchor.at > at)
      : leaves.length
        ? leaves
        : anchors.filter((anchor) => anchor.at < at)
    if (!opening && !leaves.length) layout.review = true
    const candidates = pool.sort((a, b) =>
      opening ? a.at - b.at || a.index - b.index : b.at - a.at || b.index - a.index
    )
    let target = candidates[0]?.word
    if (!target) {
      target =
        words[
          Math.max(
            0,
            Math.min(words.length - 1, Math.round((at / translation.length) * words.length) - 1)
          )
        ]
      layout.review = true
    }
    atom(opening ? beforeAtoms : afterAtoms, target.id, at, c)
  }
  const anchorById = new Map(anchors.map((anchor) => [anchor.word.id, anchor]))
  const runs: { clause: number; last: number }[] = []
  words.forEach((word, index) => {
    const anchor =
      anchorById.get(word.id) ?? (word.hostId ? anchorById.get(word.hostId) : undefined)
    if (!anchor) {
      layout.review = true
      return
    }
    const clause = marks.filter((mark) => mark.end <= anchor.at).length
    if (runs.at(-1)?.clause === clause) runs[runs.length - 1].last = index
    else runs.push({ clause, last: index })
    if (
      marks.some(
        (mark) => anchor.at < mark.at && (anchor.word.sourceEnd ?? anchor.at + 1) > mark.at
      )
    )
      layout.review = true
  })
  const interleaved = new Set(runs.map((run) => run.clause)).size !== runs.length
  marks.forEach((mark, index) => {
    if (interleaved || index >= runs.length - 1) {
      layout.unplaced = (layout.unplaced ?? '') + mark.text
      layout.review = true
      return
    }
    atom(afterAtoms, words[runs[index].last].id, mark.at, mark.text)
  })
  for (const [id, atoms] of beforeAtoms)
    layout.before[id] = atoms
      .sort((a, b) => a.at - b.at)
      .map((atom) => atom.text)
      .join('')
  for (const [id, atoms] of afterAtoms)
    layout.after[id] =
      atoms
        .sort((a, b) => a.at - b.at)
        .map((atom) => atom.text)
        .join('') + separator(tokenizer)
  return layout
}

export function formatComposedText(
  words: readonly FormatWord[],
  layout: ComposeLayout,
  options: ComposeFormatOptions,
  tokenizer?: string
): { text: string; words: FormatWord[]; review: boolean } {
  const active = words.filter((word) => word.form.trim())
  if (!active.length) return { text: '', words: [], review: false }
  const hasCase = active.some((word) =>
    Array.from(word.form).some((c) => c.toLowerCase() !== c.toUpperCase())
  )
  const style =
    options.punctuation === 'auto'
      ? hasCase && tokenizer !== 'character'
        ? 'latin'
        : 'preserve'
      : options.punctuation
  const map = (text: string): string =>
    Array.from(text)
      .map((c) =>
        style === 'latin' ? (LATIN[c] ?? c) : style === 'fullwidth' ? (FULL[c] ?? c) : c
      )
      .join('')
  const starts = new Map<string, number>(),
    ends = new Map<string, number>()
  active.forEach((word, index) => {
    const id = word.hostId ?? word.id
    starts.set(id, Math.min(starts.get(id) ?? index, index))
    ends.set(id, Math.max(ends.get(id) ?? index, index))
  })
  const before = new Map<number, string>(),
    after = new Map<number, string>()
  active.forEach((word, index) => {
    const first = starts.get(word.id) ?? index,
      last = ends.get(word.id) ?? index
    if (layout.before[word.id])
      before.set(first, (before.get(first) ?? '') + map(layout.before[word.id]))
    if (layout.after[word.id]) after.set(last, (after.get(last) ?? '') + map(layout.after[word.id]))
  })
  let movedBoundary = false
  const lastAfter = after.get(active.length - 1)
  if (active.length > 1 && lastAfter && /^[,;:，；：،؛、—–]+\s*$/u.test(lastAfter)) {
    after.delete(active.length - 1)
    after.set(active.length - 2, (after.get(active.length - 2) ?? '').trimEnd() + lastAfter)
    movedBoundary = true
  }
  let trailing = map(layout.trailing)
  const nonClosing = Array.from(trailing)
    .filter((c) => !CLOSE.test(c) && c !== '"' && c !== "'" && !/\s/u.test(c))
    .join('')
  if (options.defaultPeriod && !nonClosing) {
    const final =
      style === 'fullwidth' || (style === 'preserve' && tokenizer === 'character') ? '。' : '.'
    trailing = final + trailing
  }
  let text = map(layout.leading),
    sentenceStart = true
  const formatted: FormatWord[] = []
  for (let i = 0; i < active.length; i++) {
    const word = active[i],
      lead = before.get(i) ?? '',
      previous = after.get(i - 1) ?? ''
    if (i && !previous && (!lead || (layout.automatic && !/^\s/u.test(lead))))
      text += separator(tokenizer)
    text += lead
    if (TERMINAL.test(lead) || (OPEN.test(lead) && /[:：]/u.test(previous))) sentenceStart = true
    const override = layout.caseForms?.[word.id],
      surface = override && fold(override.from) === fold(word.form) ? override.form : word.form
    const capitalized = capitalizeForm(surface, sentenceStart, options.capitalize)
    sentenceStart = capitalized.start
    formatted.push({ ...word, form: capitalized.form })
    text += capitalized.form
    const tail = after.get(i) ?? ''
    text += tail
    if (TERMINAL.test(tail)) sentenceStart = true
  }
  text += trailing
  return {
    text,
    words: formatted,
    review:
      movedBoundary ||
      !!layout.review ||
      (!!layout.order && layout.order.join('\0') !== active.map((word) => word.id).join('\0'))
  }
}
