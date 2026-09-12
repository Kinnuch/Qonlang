<script lang="ts">
  /**
   * 板块标题：右边有个平时不显示、鼠标放上来才出现的三角，点一下把整块收起来。
   * 收起状态按 id 记在本机偏好里；页面自己按 `sectionCollapsed(id)` 决定内容画不画。
   */
  import type { Snippet } from 'svelte'
  import { ChevronDown, ChevronRight } from '@lucide/svelte'
  import { t } from '$lib/i18n/index.svelte'
  import HelpDot from './HelpDot.svelte'
  import { sectionCollapsed, toggleSection } from './section.svelte'

  let {
    id,
    title,
    tip = '',
    count = '',
    children
  }: {
    id: string
    title: string
    /** 标题旁的「?」说明 */
    tip?: string
    /** 标题后面的小字（条数之类） */
    count?: string
    /** 标题右边的按钮 */
    children?: Snippet
  } = $props()

  const collapsed = $derived(sectionCollapsed(id))
</script>

<div class="row head sec-head">
  <h3 class="grow">
    {title}{#if count}<span class="small muted n">{count}</span>{/if}{#if tip}<HelpDot
        {tip}
      />{/if}<button
      class="fold"
      class:on={collapsed}
      title={collapsed ? t('common.expand') : t('common.collapse')}
      onclick={() => toggleSection(id)}
      >{#if collapsed}<ChevronRight size={13} />{:else}<ChevronDown size={13} />{/if}</button
    >
  </h3>
  {@render children?.()}
</div>

<style>
  .sec-head {
    margin-bottom: 8px;
  }
  .n {
    margin-left: 6px;
    font-weight: normal;
  }
  .fold {
    border: 0;
    background: none;
    padding: 0 2px;
    margin-left: 4px;
    color: var(--text-3);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s;
    vertical-align: middle;
  }
  .sec-head:hover .fold,
  .fold.on,
  .fold:focus-visible {
    opacity: 1;
  }
</style>
