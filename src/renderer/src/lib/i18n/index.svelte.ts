import zh from './zh'
import en from './en'
import zhHant from './zh-Hant'
import ja from './ja'
import ko from './ko'
import fr from './fr'
import es from './es'
import ru from './ru'
import ar from './ar'

export const LOCALES = [
  { code: 'zh', label: '中文' },
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' }
] as const

export type LocaleCode = (typeof LOCALES)[number]['code']

const dicts: Record<LocaleCode, typeof zh> = {
  zh,
  'zh-Hant': zhHant,
  en,
  ja,
  ko,
  fr,
  es,
  ru,
  ar
}
/** 这一种没有的条目往哪找：繁体回落简体，其余回落英文，最后都兜到简体 */
const FALLBACK: Record<LocaleCode, LocaleCode[]> = {
  zh: [],
  'zh-Hant': ['zh'],
  en: [],
  ja: ['en'],
  ko: ['en'],
  fr: ['en'],
  es: ['en'],
  ru: ['en'],
  ar: ['en']
}
/** 文档语言标记（浏览器按它挑字体、断行） */
const HTML_LANG: Record<LocaleCode, string> = {
  zh: 'zh-CN',
  'zh-Hant': 'zh-Hant',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  es: 'es',
  ru: 'ru',
  ar: 'ar'
}
/** 从右往左排版的界面语言 */
const RTL = new Set<LocaleCode>(['ar'])

let locale = $state<LocaleCode>('zh')

export const i18n = {
  get locale(): LocaleCode {
    return locale
  },
  set locale(v: LocaleCode) {
    locale = dicts[v] ? v : 'zh'
    if (typeof document === 'undefined') return
    document.documentElement.lang = HTML_LANG[locale]
    // 阿拉伯语：整套界面镜像过去（各处的左右边距用的是 CSS 逻辑属性，跟着这里翻）
    document.documentElement.dir = RTL.has(locale) ? 'rtl' : 'ltr'
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
