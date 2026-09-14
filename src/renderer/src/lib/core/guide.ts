import { i18n } from '$lib/i18n/index.svelte'

/** 各页面的使用指南链接（托管在作者个人网站）；英文界面打开英文版（/en/ 下，页面地址与锚点跟中文版一一对应） */
export const GUIDE_BASE = 'https://kinnuch.github.io/cerf/qonlang/'

const SLUGS: Record<string, string> = {
  languages: 'languages',
  phonology: 'phonology',
  script: 'script',
  soundChanges: 'sound-changes',
  morphemes: 'morphemes',
  lexicon: 'lexicon',
  paradigms: 'paradigms',
  corpus: 'corpus',
  phrasebook: 'phrasebook',
  docs: 'docs',
  skin: 'skin',
  settings: 'settings',
  chars: 'chars',
  welcome: ''
}

/** 指南首页：中文界面是中文版，其余是英文版 */
export function guideBase(locale: string = i18n.locale): string {
  return GUIDE_BASE + (locale === 'zh' ? '' : 'en/')
}

export function guideUrl(section: string, anchor = '', locale: string = i18n.locale): string {
  const slug = SLUGS[section] ?? ''
  return guideBase(locale) + (slug ? slug + '/' : '') + (anchor ? '#' + anchor : '')
}
