import { ui } from '$lib/state/ui.svelte'
import { wordHover } from '$lib/state/wordHover.svelte'
import { t } from '$lib/i18n/index.svelte'
import { clearPronounceCache } from '$lib/core/pronounce'
import { clearScriptCache } from '$lib/script/render'
import { clearMutationCache } from '$lib/engine/morph/mutation'
import { clearGlossCaches } from '$lib/engine/gloss'

/**
 * 刷新当前页（顶栏重做右边的按钮、F5）：清掉按内容缓存的规则程序与对照表，主区整页重新挂一遍。
 * 导入、新增之后哪里没跟上时手动点一下；筛选、选中这些页面状态从记忆里读回来，不会丢。
 */
export function refreshPage(): void {
  wordHover.hide(true)
  clearPronounceCache()
  clearScriptCache()
  clearMutationCache()
  clearGlossCaches()
  ui.pageNonce++
  ui.toast(t('common.refreshed', { page: t(`nav.${ui.section}`) }))
}
