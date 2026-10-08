/**
 * 界面上显示引擎的报错、推导轨迹时用：按当前界面语言写出来（句式表见 lib/i18n/engineText.ts）。
 * 在模板里调用，换界面语言时跟着重画。
 */
import { t } from '$lib/i18n/index.svelte'
import { localizeRuleMessage, localizeTraceLine } from '$lib/i18n/engineText'

/** 规则（音变、正字法、文字映射、重音、构形微调）的一条报错或提示 */
export const ruleMsg = (message: string): string => localizeRuleMessage(message, (k) => t(k))

/** 构形推导轨迹的一行 */
export const traceLine = (line: string): string => localizeTraceLine(line, (k) => t(k))
