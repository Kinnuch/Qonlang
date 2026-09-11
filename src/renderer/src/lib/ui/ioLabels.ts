import { t } from '$lib/i18n/index.svelte'

/** 表格导入里字段的显示名（译文字段带上释义语言） */
export function ioFieldLabel(key: string): string {
  if (key.startsWith('tr:')) return t('io.fields.tr', { lang: key.slice(3) })
  // ortho:<id>、script:<id>、pron:<id>、extra:<列名> 按冒号前的种类显示
  return t(`io.fields.${key.split(':')[0]}`)
}
