import { t } from '$lib/i18n/index.svelte'

/** 表格导入里字段的显示名（译文字段带上释义语言） */
export function ioFieldLabel(key: string): string {
  return key.startsWith('tr:') ? t('io.fields.tr', { lang: key.slice(3) }) : t(`io.fields.${key}`)
}
