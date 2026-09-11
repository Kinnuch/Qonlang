<script lang="ts">
  /** 各模块统一的搜索条：放在标题上面，占位文字带模块名；help 是紧贴在输入框后面的「?」说明 */
  import { Search, X } from '@lucide/svelte'
  import HelpDot from './HelpDot.svelte'

  let {
    value = $bindable(''),
    placeholder = '',
    compact = false,
    help = ''
  }: { value: string; placeholder?: string; compact?: boolean; help?: string } = $props()
</script>

<div class="bar" class:compact>
  <Search size={14} class="ico" />
  <input class="input" {placeholder} bind:value />
  {#if value}
    <button class="btn ghost icon sm" onclick={() => (value = '')}><X size={13} /></button>
  {/if}
  {#if help}<HelpDot tip={help} />{/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }
  .bar :global(.ico) {
    color: var(--text-3);
    flex: none;
  }
  .bar .input {
    flex: 1;
    max-width: 520px;
  }
  .bar.compact {
    margin: 0 0 0 8px;
    flex: 1;
    min-width: 0;
  }
  .bar.compact .input {
    max-width: 360px;
    min-width: 120px;
    height: 28px;
    font-size: 13px;
  }
</style>
