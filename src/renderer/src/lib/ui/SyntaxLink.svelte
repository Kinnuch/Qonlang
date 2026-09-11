<script lang="ts">
  /** 「查语法」按钮：在右侧检视器打开规则语法说明；anchor 指定滚到哪一节 */
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { BookText } from '@lucide/svelte'

  let { anchor = '' }: { anchor?: string } = $props()
</script>

<button class="btn ghost sm" title={t('syntax.hint')} onclick={() => ui.openSyntax(anchor)}
  ><BookText size={14} />{t('syntax.open')}</button
>
