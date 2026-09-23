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
/** 某一种自带语言的整份文案（「界面翻译」拿它当原文对照） */
export const localeDict = (code: LocaleCode): unknown => dicts[code] ?? zh

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
/** 文字本身从右往左写的界面语言（页面布局不跟着翻，见下面 set locale） */
const RTL = new Set<LocaleCode>(['ar'])

/**
 * 用户自己翻出来的界面语言（「界面翻译」自带插件做的，存在本机偏好里）。
 * 条目是扁平的「点号路径 → 译文」，没译到的按 base 那种语言显示。
 */
export interface CustomLocale {
  code: string
  name: string
  /** 没译到的条目用哪种语言兜底，翻译台里默认也拿它当原文 */
  base: LocaleCode
  /** 这门语言的文字从右往左写 */
  rtl: boolean
  /** 界面用哪套字：留空就跟软件走；自己的文字填字体名（装进字体库的或者系统里的） */
  font?: string
  /**
   * 开始页、「关于」里软件名那块字标换成什么：文字（用上面的字体写）或者一张图（data URL）。
   * 只换文字那部分，左边的 Q 标志不换；两个都空就用软件自带的字标
   */
  wordmarkText?: string
  wordmarkImage?: string
  values: Record<string, string>
  /**
   * 每条译文写下时的简体原文。软件更新改了文案，翻译台拿它跟现在的原文比，
   * 标出「原文改过了」的那几条，免得译文还是旧意思
   */
  seen?: Record<string, string>
}

let customs = $state<CustomLocale[]>([])
let locale = $state<string>('zh')

/** 现在用的是不是用户自己翻的那种 */
const customOf = (code: string): CustomLocale | undefined => customs.find((c) => c.code === code)

/** 语言选单里列出来的：软件自带的九种 + 用户自己翻的 */
export function localeOptions(): { code: string; label: string; custom?: boolean }[] {
  return [
    ...LOCALES.map((l) => ({ code: l.code as string, label: l.label as string })),
    ...customs.map((c) => ({ code: c.code, label: c.name || c.code, custom: true }))
  ]
}

function applyDocument(): void {
  if (typeof document === 'undefined') return
  const c = customOf(locale)
  const base = (c?.base ?? locale) as LocaleCode
  document.documentElement.lang = HTML_LANG[base] ?? 'en'
  // 阿拉伯语这类：**只有文字本身**从右往左排（app.css 里按这个标记给文字开 unicode-bidi: plaintext），
  // 导航、检视器这些位置照旧从左往右——整页镜像过去反而不好认（0.12.2 改回来的）
  document.documentElement.dir = 'ltr'
  document.documentElement.toggleAttribute('data-rtl-text', c ? c.rtl : RTL.has(base))
  // 自己翻的语言可以指定界面字体（用自造文字写界面时要）
  if (c?.font?.trim())
    document.documentElement.style.setProperty('--font-ui-locale', `"${c.font.trim()}"`)
  else document.documentElement.style.removeProperty('--font-ui-locale')
}

export const i18n = {
  get locale(): string {
    return locale
  },
  set locale(v: string) {
    locale = dicts[v as LocaleCode] || customOf(v) ? v : 'zh'
    applyDocument()
  },
  /** 当前这种是用户自己翻的话，给出它本身 */
  get custom(): CustomLocale | undefined {
    return customOf(locale)
  },
  get customLocales(): CustomLocale[] {
    return customs
  },
  /** 偏好读进来 / 翻译台改完都调一次：换一份用户自己翻的语言 */
  setCustomLocales(list: CustomLocale[]): void {
    customs = list
    // 正用着的那种被删了就退回它的兜底语言
    if (locale && !dicts[locale as LocaleCode] && !customOf(locale)) locale = 'zh'
    applyDocument()
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
  const mine = customOf(locale)
  // 用户自己翻的：先看他译了没有，没译的按兜底语言显示（界面不会露键名）
  const code = (mine?.base ?? locale) as LocaleCode
  let s = mine?.values[key]?.trim() || lookup(dicts[code], key)
  for (const f of FALLBACK[code] ?? []) if (s === undefined) s = lookup(dicts[f], key)
  s ??= lookup(zh, key) ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

/** 多语言字段取值：按项目的释义语言顺序，再按界面语言，最后任意一个 */
export function pickText(text: Record<string, string> | undefined, order: string[] = []): string {
  if (!text) return ''
  // 界面语言优先（自己翻的那种按它的兜底语言算），其次按项目的释义语言顺序
  for (const l of [locale, customOf(locale)?.base, ...order]) if (l && text[l]) return text[l]
  return Object.values(text).find(Boolean) ?? ''
}
