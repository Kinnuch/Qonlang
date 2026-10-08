/**
 * 第一次打开（还没存过设置）时按浏览器 / 系统的语言挑界面语言；九种里对不上的用英文。
 * 桌面版在主进程里挑（src/main/locale.ts 同一套规则），网页版用这里的。
 */
export function pickLocale(languages: readonly string[]): string {
  for (const raw of languages) {
    const l = raw.toLowerCase().replace(/_/g, '-')
    if (/^zh-(hant|tw|hk|mo)(-|$)/.test(l)) return 'zh-Hant'
    if (l === 'zh' || l.startsWith('zh-')) return 'zh'
    const base = l.split('-')[0]
    if (['en', 'ja', 'ko', 'fr', 'es', 'ru', 'ar'].includes(base)) return base
  }
  return 'en'
}
