/**
 * 顶栏搜出来的结果，把命中的那几个字标出来。
 * 用浏览器的 CSS 高亮（::highlight）画，不动 DOM——表格是虚拟滚动的，插标签会跟界面打架。
 * 样式在 app.css 的 ::highlight(q-hit)。
 */
import { parseQuery, foldMarks, type QueryTerm } from '$lib/core/query'

const NAME = 'q-hit'
/** 命中太多就不再标了：一屏也看不过来，白费时间 */
const MAX_HITS = 4000
/** 搜一个字母能命中半页，太碎；两个字起标（中日韩字一个也算） */
const MIN_LEN = 2
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

interface Needle {
  text: string
  /** 搜的词里没写附加符：被搜的文字也去掉附加符再比 */
  loose: boolean
}

function needlesOf(terms: QueryTerm[]): { needles: Needle[]; regexes: RegExp[] } {
  const needles: Needle[] = []
  const regexes: RegExp[] = []
  for (const t of terms) {
    if (t.regex) {
      const src = t.regex.source
      // 全角匹配（^$）没法在一段文字里划范围，跳过
      if (src === '' || src === '^' || src === '$') continue
      try {
        regexes.push(new RegExp(src, t.regex.flags.replace(/[gy]/g, '') + 'g'))
      } catch {
        /* 用不了就不标 */
      }
      continue
    }
    if (t.exact || !t.needle) continue
    const text = t.needle.normalize('NFC').toLowerCase()
    if (text.length < MIN_LEN && !CJK.test(text)) continue
    needles.push({ text, loose: foldMarks(text) === text })
  }
  return { needles, regexes }
}

/** 逐字去附加符，顺带记下每个字在原文里的位置（kâm 能搜到、也能标对） */
function foldedWithMap(s: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < s.length; i++) {
    const f = foldMarks(s[i])
    if (!f) continue
    folded += f
    for (let k = 0; k < f.length; k++) map.push(i)
  }
  map.push(s.length)
  return { folded, map }
}

function hitsIn(text: string, needles: Needle[], regexes: RegExp[]): [number, number][] {
  const out: [number, number][] = []
  const lower = text.toLowerCase()
  let folded: { folded: string; map: number[] } | null = null
  for (const n of needles) {
    let at = lower.indexOf(n.text)
    while (at >= 0) {
      out.push([at, at + n.text.length])
      at = lower.indexOf(n.text, at + n.text.length)
    }
    if (!n.loose) continue
    folded ??= foldedWithMap(lower)
    if (folded.folded === lower) continue
    let fa = folded.folded.indexOf(n.text)
    while (fa >= 0) {
      out.push([folded.map[fa], folded.map[fa + n.text.length]])
      fa = folded.folded.indexOf(n.text, fa + n.text.length)
    }
  }
  for (const re of regexes) {
    re.lastIndex = 0
    let m = re.exec(text)
    let guard = 0
    while (m && guard++ < 200) {
      if (m[0]) out.push([m.index, m.index + m[0].length])
      else re.lastIndex++
      m = re.exec(text)
    }
  }
  return out
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'])

/** 把一块区域里命中的字算成一串范围 */
export function hitRanges(root: Node, q: string): Range[] {
  const { needles, regexes } = needlesOf(parseQuery(q ?? '').terms)
  if (!needles.length && !regexes.length) return []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement
      if (!p || SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT
      // 搜索框自己、不参与搜索的装饰文字不标
      if (p.closest('.bar, [data-no-mark]')) return NodeFilter.FILTER_REJECT
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  const ranges: Range[] = []
  let node = walker.nextNode()
  while (node && ranges.length < MAX_HITS) {
    for (const [a, b] of hitsIn(node.nodeValue ?? '', needles, regexes)) {
      const r = document.createRange()
      r.setStart(node, a)
      r.setEnd(node, b)
      ranges.push(r)
      if (ranges.length >= MAX_HITS) break
    }
    node = walker.nextNode()
  }
  return ranges
}

type HL = { new (...ranges: Range[]): unknown }
interface HLRegistry {
  set(name: string, hl: unknown): void
  delete(name: string): void
}
const registry = (): HLRegistry | null =>
  (globalThis.CSS as unknown as { highlights?: HLRegistry })?.highlights ?? null

/**
 * 区域里的搜索命中跟着查询词走。
 * 页面重画（翻页、虚拟滚动、改一条）后要重标，所以盯着 DOM 变化，合到下一帧一起算。
 */
export function searchMark(
  node: HTMLElement,
  q: string
): { update(v: string): void; destroy(): void } {
  const Ctor = (globalThis as unknown as { Highlight?: HL }).Highlight
  const reg = registry()
  if (!Ctor || !reg) return { update: () => {}, destroy: () => {} }
  let query = q
  let timer: ReturnType<typeof setTimeout> | null = null
  const apply = (): void => {
    timer = null
    if (!query.trim()) {
      reg.delete(NAME)
      return
    }
    const ranges = hitRanges(node, query)
    if (!ranges.length) reg.delete(NAME)
    else reg.set(NAME, new Ctor(...ranges))
  }
  /** 翻页、虚拟滚动会一直改 DOM；隔一会儿合起来算一次就够，别每帧走一遍整页 */
  const schedule = (): void => {
    if (!timer) timer = setTimeout(apply, 120)
  }
  const mo = new MutationObserver(() => {
    if (query.trim()) schedule()
  })
  mo.observe(node, { childList: true, subtree: true, characterData: true })
  schedule()
  return {
    update(v: string) {
      query = v
      schedule()
    },
    destroy() {
      mo.disconnect()
      if (timer) clearTimeout(timer)
      reg.delete(NAME)
    }
  }
}
