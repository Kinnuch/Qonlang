/**
 * 释义、译文这类多语言字段给哪几种语言输入框（纯函数，可以单独测）。
 * 默认只给**当前界面语言**一个框；要同时写几种语言，在「设置 → 当前项目」里列出来（glossInputs）。
 * 已经写了内容的语言不在这里决定——输入框那边会把有内容的都照样摆出来，免得看不见、改不了。
 */
import type { ProjectSettings } from './model'

/** 界面语言对应的释义语言代码：繁体跟简体算同一种（项目里中文释义一直记在 zh 下） */
export function uiGlossCode(locale: string, customBase?: string): string {
  const code = customBase || locale || 'zh'
  return code === 'zh-Hant' ? 'zh' : code
}

export function glossInputLanguages(
  settings: Pick<ProjectSettings, 'glossInputs'> | undefined | null,
  locale: string,
  customBase?: string
): string[] {
  const set = (settings?.glossInputs ?? []).map((s) => s.trim()).filter(Boolean)
  return set.length ? [...new Set(set)] : [uiGlossCode(locale, customBase)]
}
