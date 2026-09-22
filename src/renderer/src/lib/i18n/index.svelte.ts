import zh from './zh'
import en from './en'
import zhHant from './zh-Hant'
import ja from './ja'

export const LOCALES = [
  { code: 'zh', label: '中文' },
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' }
] as const

export type LocaleCode = (typeof LOCALES)[number]['code']

const dicts: Record<LocaleCode, typeof zh> = { zh, en, 'zh-Hant': zhHant, ja }
/** 这一种没有的条目往哪找：繁体回落简体，日语回落英文，最后都兜到简体 */
const FALLBACK: Record<LocaleCode, LocaleCode[]> = {
  zh: [],
  en: [],
  'zh-Hant': ['zh'],
  ja: ['en']
}
/** 文档语言标记（浏览器按它挑字体、断行） */
const HTML_LANG: Record<LocaleCode, string> = {
  zh: 'zh-CN',
  'zh-Hant': 'zh-Hant',
  en: 'en',
  ja: 'ja'
}

let locale = $state<LocaleCode>('zh')

export const i18n = {
  get locale(): LocaleCode {
    return locale
  },
  set locale(v: LocaleCode) {
    locale = dicts[v] ? v : 'zh'
    if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[locale]
  }
}

function lookup(dict: unknown, path: string): string | undefined {
  let cur: unknown = dict
  for (const seg of path.split('.')) {
    if (cur && typeof cur === 'object' && seg in (cur as object))
      cur = (cur as Record<string, unknown>)[seg]
    else return undefined
  }
  return typeof cur === 'string' ? cur : undefined
}

/** 取文案。找不到时回退中文，再找不到就原样返回键，方便发现漏译。 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = lookup(dicts[locale], key)
  for (const f of FALLBACK[locale]) if (s === undefined) s = lookup(dicts[f], key)
  s ??= lookup(zh, key) ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

/** 多语言字段取值：按项目的释义语言顺序，再按界面语言，最后任意一个 */
export function pickText(text: Record<string, string> | undefined, order: string[] = []): string {
  if (!text) return ''
  // 界面语言优先，其次按项目的释义语言顺序
  for (const l of [locale, ...order]) if (text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}
