/**
 * 把各种报错变成给人看的一句话。Svelte 的内部错误只带一个链接（https://svelte.dev/e/each_key_duplicate），
 * 翻译成能看懂的说法，链接留在后面方便查。
 */
const SVELTE_ERRORS: Record<string, { zh: string; en: string }> = {
  each_key_duplicate: {
    zh: '列表里有两项的标识重复了（常见于两条同名的内容）',
    en: 'Two items in a list share the same key (often two entries with the same name)'
  },
  state_unsafe_mutation: {
    zh: '显示过程中改动了数据',
    en: 'Data was changed while the page was being drawn'
  },
  effect_update_depth_exceeded: {
    zh: '数据来回互相更新，停不下来',
    en: 'Data kept updating itself in a loop'
  }
}

export function errorMessage(error: unknown, locale = 'zh'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const code = /svelte\.dev\/e\/([a-z_]+)/.exec(raw)?.[1] ?? /^([a-z_]+)\b/.exec(raw)?.[1] ?? ''
  const known = SVELTE_ERRORS[code]
  if (known) return `${locale.startsWith('zh') ? known.zh : known.en}（${code}）`
  return raw || (locale.startsWith('zh') ? '未知错误' : 'Unknown error')
}
