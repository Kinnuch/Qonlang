/**
 * 键盘 g 与 IPA ɡ 是同一个音的两种字形。只在匹配键中折叠；原文、输出、ID 与规则语法不改。
 * 两者都是单个 UTF-16 单位，折叠后的位置仍可直接对应原文。
 */
export const canonicalG = (text: string): string => text.replace(/ɡ/g, 'g')

export const gEquivalent = (a: string, b: string): boolean => canonicalG(a) === canonicalG(b)

export function hasEquivalentG(values: ReadonlySet<string>, value: string): boolean {
  if (values.has(value)) return true
  if (!/[gɡ]/.test(value)) return false
  const key = canonicalG(value)
  for (const member of values) if (canonicalG(member) === key) return true
  return false
}

/** 只接收已解析出的字面文本；不能用于整段正则或规则源码。 */
export const gLiteralPattern = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[gɡ]/g, '[gɡ]')

/** 同一字形来源按原顺序取首条；即使两种写法并存，也不会按码位产生不同映射。 */
export function gMemberIndex(members: readonly string[], value: string): number {
  const key = canonicalG(value)
  return members.findIndex((member) => canonicalG(member) === key)
}

const GLYPH_ESCAPE = /^\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2}))/i
const escapedGlyph = (escape: RegExpExecArray): string => {
  const point = Number.parseInt(escape[1] ?? escape[2] ?? escape[3], 16)
  return point === 0x67 || point === 0x261 ? 'g' : escape[0]
}

/** v 模式字符类的字符串分支也是字面值；转义后的反斜杠不当作新的 Unicode 转义。 */
function foldClassStrings(source: string): string {
  return source.replace(/\\q\{(?:\\u\{[\da-f]+\}|\\.|[^}])*\}/gi, (block) => {
    let out = '\\q{'
    for (let i = 3; i < block.length - 1;) {
      if (block[i] !== '\\') {
        out += canonicalG(block[i++])
        continue
      }
      const escape = GLYPH_ESCAPE.exec(block.slice(i))
      out += escape ? escapedGlyph(escape) : block.slice(i, i + 2)
      i += escape ? escape[0].length : 2
    }
    return out + '}'
  })
}

/**
 * 搜索正则在 canonicalG(text) 上执行。只处理字面字符，保留组名、回指、属性名和字符范围的语法。
 * 不用于产生替换结果；命中位置与原文等长，界面仍可高亮原来的字形。
 */
export function gSearchRegex(regex: RegExp): RegExp {
  const source = regex.source
  let out = ''
  for (let i = 0; i < source.length;) {
    if (source[i] === '[') {
      const start = i++
      let depth = 1
      for (; i < source.length; i++) {
        if (source[i] === '\\') {
          i++
          continue
        }
        if (regex.flags.includes('v') && source[i] === '[') depth++
        if (source[i] === ']' && --depth === 0) break
      }
      const cls = source.slice(start, Math.min(source.length, ++i))
      const folded = regex.flags.includes('v') ? foldClassStrings(cls) : cls
      const probe = new RegExp(`^(?:${cls})$`, regex.flags.replace(/[dgy]/g, ''))
      const g = probe.test('g'),
        ipa = probe.test('ɡ')
      if (cls[1] === '^') out += !g || !ipa ? `(?!g)${folded}` : folded
      else out += g || !ipa ? folded : `(?:${folded}|g)`
      continue
    }
    if (source.startsWith('(?<', i) && !/[=!]/.test(source[i + 3] ?? '')) {
      const end = source.indexOf('>', i + 3)
      if (end >= 0) {
        out += source.slice(i, end + 1)
        i = end + 1
        continue
      }
    }
    if (source[i] === '\\') {
      const tail = source.slice(i)
      const named = /^\\(?:k<[^>]*>|[pP]\{[^}]*\})/u.exec(tail)
      if (named) {
        out += named[0]
        i += named[0].length
        continue
      }
      const escaped = GLYPH_ESCAPE.exec(tail)
      if (escaped) {
        out += escapedGlyph(escaped)
        i += escaped[0].length
        continue
      }
      // 非 Unicode 模式允许的旧式无效控制转义：不让其后的 ɡ 折叠后误变成 \cg 控制字符。
      if (source.startsWith('\\cɡ', i)) {
        out += '\\c(?:g)'
        i += 3
        continue
      }
      if (source[i + 1] === 'g' || source[i + 1] === 'ɡ') out += 'g'
      else out += source.slice(i, i + 2)
      i += 2
      continue
    }
    out += canonicalG(source[i++])
  }
  return new RegExp(out, regex.flags)
}
