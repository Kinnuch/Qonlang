/** 各页面的使用指南链接（托管在作者个人网站） */
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

export function guideUrl(section: string, anchor = ''): string {
  const slug = SLUGS[section] ?? ''
  return GUIDE_BASE + (slug ? slug + '/' : '') + (anchor ? '#' + anchor : '')
}
