<script lang="ts">
  /** 标题旁的「使用指南」按钮：在浏览器打开个人网站上对应模块的指南 */
  import { guideUrl } from '$lib/core/guide'
  import { platform } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import { BookOpen } from '@lucide/svelte'

  let { section, anchor = '' }: { section: string; anchor?: string } = $props()
</script>

<button
  class="guide"
  title={t('common.guideTitle', { name: t(`nav.${section}`) })}
  onclick={() => void platform.openExternal(guideUrl(section, anchor))}
>
  <BookOpen size={14} />
  <span>{t('common.guide')}</span>
</button>

<style>
  .guide {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-2);
    font-size: 12px;
    cursor: pointer;
    margin-left: 4px;
    white-space: nowrap;
    flex: none;
  }
  .guide:hover {
    color: var(--accent-text);
    border-color: var(--accent);
  }
</style>
