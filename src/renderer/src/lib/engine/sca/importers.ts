/**
 * 把其他工具的规则格式转换成千语集规则文本。
 * 转换只求覆盖常见写法；转不动的行原样保留并加注释提示。
 */

/** 音变姬四文件：Category / Replace / Rule 直接拼接（Lexicon 另行导入） */
export function fromYinbianji(category: string, replace: string, rule: string): string {
  const parts: string[] = []
  const cat = category.trim()
  const rep = replace.trim()
  if (cat) parts.push('; 音类', cat, '')
  if (rep) parts.push('; 多合字母', rep, '')
  parts.push(rule.trim())
  return parts.join('\n')
}

/**
 * Lexicanter 发音规则：
 *   th > θ            同形
 *   {a,e} > x         联合 → 临时音类 / 交替
 *   ^ 或 # 词界        → #
 *   ∅ / ⦰             → 空
 *   a > b / _c        环境同形
 */
export function fromLexicanter(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim()
      if (!t) return ''
      if (t.startsWith('//')) return '; ' + t.slice(2).trim()
      let out = t.replace(/[∅⦰]/g, '').replace(/\^/g, '#')
      out = out.replace(/\{([^}]+)\}/g, (_m, inner: string) => {
        const items = inner.split(/\s*,\s*/).filter(Boolean)
        if (items.every((x) => Array.from(x).length === 1)) return '[' + items.join('') + ']'
        return '(' + items.join('|') + ')'
      })
      return out
    })
    .join('\n')
}

/**
 * Zompist SCA²：`目标/替换/环境/排除`，四个斜杠字段，后两个可省。
 *   V=aeiou               音类同形
 *   s/z/V_V               → s > z / V_V
 *   a//_#                 空替换 → a > / _#
 *   x/y/_z/_w             第四字段是排除 → - _w
 *   `*` 通配 → ?；行首 * 是注释
 */
export function fromSca2(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim()
      if (!t) return ''
      if (t.startsWith('*')) return '; ' + t.slice(1).trim()
      if (/^[A-Z]=/.test(t)) return t
      const parts = t.split('/')
      if (parts.length < 2) return '; 未能转换: ' + t
      const [target, replacement, env = '_', exception = ''] = parts
      const rep = replacement.trim()
      let out = `${target.trim()} > ${rep ? rep + ' ' : ''}/ ${env.trim().replace(/\*/g, '?')}`
      if (exception.trim()) out += ` - ${exception.trim()}`
      return out
    })
    .join('\n')
}
