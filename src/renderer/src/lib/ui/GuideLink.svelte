<script lang="ts">
  /**
   * 标题旁的「使用指南」按钮：先在界面上一步步指着讲（每个模块默认讲一次），
   * 讲完问要不要去个人网站看完整教程。
   */
  import { tour } from '$lib/state/tour.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { BookOpen } from '@lucide/svelte'

  let { section, anchor = '' }: { section: string; anchor?: string } = $props()
</script>

<button
  class="guide"
  title={t('common.guideTitle', { name: t(`nav.${section}`) })}
  onclick={() => tour.request(section, anchor)}
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
