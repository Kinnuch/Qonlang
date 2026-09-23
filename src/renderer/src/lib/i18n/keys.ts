/**
 * 界面上所有能翻译的文案：按模块归类、拍平成「点号路径 → 原文」，给「界面翻译」插件用。
 * 以简体那份（zh.ts）的结构为准——它是原文，别的语言文件结构都跟它一样（有自检测试）。
 * 纯函数，不碰界面状态（可以单独测）。
 */
import zh from './zh'

export interface TextEntry {
  /** 点号路径，数组项写成 `key.0` */
  key: string
  /** 归到哪一类（按模块：一般是键的第一段，见 groupOfKey） */
  group: string
  /** 原文（简体） */
  source: string
  /** 文案里的占位符（`{name}` 这种），译文里必须原样留着 */
  params: string[]
}

/** 把一份文案对象拍平成 键 → 文字 */
export function flattenDict(dict: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      out[path] = node
      return
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i)))
      return
    }
    if (node && typeof node === 'object')
      for (const [k, v] of Object.entries(node as Record<string, unknown>))
        walk(v, path ? `${path}.${k}` : k)
  }
  walk(dict, prefix)
  return out
}

/** 文案里的占位符 */
export const paramsOf = (s: string): string[] => [...new Set(s.match(/\{[^{}]+\}/g) ?? [])].sort()

/**
 * 键的第一段不都是一个模块：taxonomy、glyphPad 这些是某个模块里的一块，对话框、报错、顶栏这些是各处共用的零碎。
 * 翻译台按模块分类，把它们并进所属的那一类；没列在这里的，第一段本身就是一类（名字在 uiTranslate.groups 里）
 */
const GROUP_OF: Record<string, string> = {
  taxonomy: 'lexicon',
  newLexeme: 'lexicon',
  images: 'lexicon',
  evolve: 'lexicon',
  tips: 'lexicon',
  stressSettings: 'lexicon',
  glyphPad: 'script',
  stressRule: 'soundChanges',
  consistency: 'paradigms',
  example: 'welcome',
  update: 'settings',
  mcp: 'extending',
  plugins: 'extending',
  csv: 'io',
  projectCsv: 'io',
  importPreview: 'io',
  dict: 'io',
  stats: 'common',
  tabGroups: 'common',
  readonly: 'common',
  syntax: 'common',
  search: 'common',
  table: 'common',
  palette: 'common',
  placeholder: 'common',
  topbar: 'common',
  errors: 'common',
  dialog: 'common'
}

/** 这一条归到翻译台的哪一类 */
export function groupOfKey(key: string): string {
  const top = key.split('.')[0]
  return GROUP_OF[top] ?? top
}

/** 全部可翻译的条目，按键排好 */
export function allTextEntries(): TextEntry[] {
  const flat = flattenDict(zh)
  return Object.entries(flat).map(([key, source]) => ({
    key,
    group: groupOfKey(key),
    source,
    params: paramsOf(source)
  }))
}

/** 每一类有多少条（翻译台左边列出来用） */
export function groupsOf(entries: TextEntry[]): { group: string; count: number }[] {
  const m = new Map<string, number>()
  for (const e of entries) m.set(e.group, (m.get(e.group) ?? 0) + 1)
  return [...m].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count)
}

/** 译文里占位符对不对得上原文（少一个界面上就会露出 `{name}` 或者少一块信息） */
export function paramsMatch(source: string, target: string): boolean {
  if (!target.trim()) return true
  return paramsOf(source).join('|') === paramsOf(target).join('|')
}
