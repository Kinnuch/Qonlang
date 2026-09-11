<script lang="ts">
  /**
   * 板块标题旁的「?」小标记：悬浮给一句用法说明。可在设置里整体关掉。
   * 气泡用定位到视口的浮层，免得被检视器的滚动区裁掉。
   */
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'

  let { tip, key = '' }: { tip?: string; key?: string } = $props()
  const text = $derived(tip ?? (key ? t(`tips.${key}`) : ''))

  let dot = $state<HTMLElement | null>(null)
  let open = $state(false)
  let style = $state('')

  const W = 280
  function place(): void {
    if (!dot) return
    const r = dot.getBoundingClientRect()
    const left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), window.innerWidth - W - 8)
    // 上方放不下就翻到下面
    const above = r.top > 130
    const vert = above ? `bottom:${window.innerHeight - r.top + 6}px` : `top:${r.bottom + 6}px`
    style = `left:${left}px;${vert};width:${W}px`
    open = true
  }
</script>

{#if ui.prefs.showHelpDots && text && text !== `tips.${key}`}
  <span
    class="help"
    bind:this={dot}
    role="note"
    aria-label={text}
    onmouseenter={place}
    onmouseleave={() => (open = false)}
  >
    ?
  </span>
  {#if open}
    <span class="bubble" {style}>{text}</span>
  {/if}
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
    position: fixed;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    color: var(--text);
    font-size: 12px;
    line-height: 1.6;
    text-align: left;
    white-space: pre-line;
    pointer-events: none;
    z-index: 90;
  }
</style>
