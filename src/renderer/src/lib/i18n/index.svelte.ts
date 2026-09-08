import zh from './zh'
import en from './en'

export const LOCALES = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' }
] as const

export type LocaleCode = (typeof LOCALES)[number]['code']

const dicts: Record<LocaleCode, typeof zh> = { zh, en }

let locale = $state<LocaleCode>('zh')

export const i18n = {
  get locale(): LocaleCode {
    return locale
  },
  set locale(v: LocaleCode) {
    locale = dicts[v] ? v : 'zh'
    if (typeof document !== 'undefined')
      document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
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
  let s = lookup(dicts[locale], key) ?? lookup(zh, key) ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

/** 多语言字段取值：按项目的释义语言顺序，再按界面语言，最后任意一个 */
export function pickText(text: Record<string, string> | undefined, order: string[] = []): string {
  if (!text) return ''
  for (const l of [...order, locale]) if (text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}
