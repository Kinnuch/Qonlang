<script lang="ts">
  /** 板块标题旁的「?」小标记：悬浮给一句用法说明。可在设置里整体关掉。 */
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'

  let { tip, key = '' }: { tip?: string; key?: string } = $props()
  const text = $derived(tip ?? (key ? t(`tips.${key}`) : ''))
</script>

{#if ui.prefs.showHelpDots && text && text !== `tips.${key}`}
  <span class="help" tabindex="-1" role="note" aria-label={text}>
    ?
    <span class="bubble">{text}</span>
  </span>
{/if}

<style>
  .help {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex: none;
    border-radius: 50%;
    border: 1px solid var(--border);
    color: var(--text-3);
    font-size: 10px;
    line-height: 1;
    cursor: help;
    user-select: none;
  }
  .help:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .bubble {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 6px);
    transform: translateX(-50%);
    width: max-content;
    max-width: 280px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--bg-3, var(--bg-2));
    border: 1px solid var(--border);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.18);
    color: var(--text);
    font-size: 12px;
    line-height: 1.5;
    text-align: left;
    white-space: normal;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
    z-index: 40;
  }
  .help:hover .bubble {
    opacity: 1;
  }
</style>
