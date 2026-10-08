/**
 * 把各种报错变成给人看的一句话。Svelte 的内部错误只带一个链接（https://svelte.dev/e/each_key_duplicate），
 * 翻译成能看懂的说法（界面文案 errors.svelte.*，跟着界面语言），链接留在后面方便查。
 */
import { t } from '$lib/i18n/index.svelte'

const SVELTE_ERRORS = [
  'each_key_duplicate',
  'state_unsafe_mutation',
  'effect_update_depth_exceeded'
]

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const code = /svelte\.dev\/e\/([a-z_]+)/.exec(raw)?.[1] ?? /^([a-z_]+)\b/.exec(raw)?.[1] ?? ''
  if (SVELTE_ERRORS.includes(code)) return `${t(`errors.svelte.${code}`)}（${code}）`
  return raw || t('errors.unknown')
}
