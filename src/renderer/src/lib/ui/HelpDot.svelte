<script lang="ts">
  /**
   * 板块标题旁的「?」小标记：悬浮给一句用法说明。可在设置里整体关掉。
   * 气泡用定位到视口的浮层，免得被检视器的滚动区裁掉。
   */
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { onDestroy } from 'svelte'
  import { anchoredFloating } from './anchoredFloating'
  import { helpTooltipDismiss } from './helpTooltip'

  let { tip, key = '' }: { tip?: string; key?: string } = $props()
  const text = $derived(tip ?? (key ? t(`tips.${key}`) : ''))
  const eligible = $derived(ui.prefs.showHelpDots && !!text && text !== `tips.${key}`)

  let dot = $state<HTMLElement | null>(null)
  let open = $state(false)
  let focused = false
  let hovered = false
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  const id = $props.id()
  function show(): void {
    clearTimeout(hideTimer)
    open = true
  }
  function hideSoon(): void {
    clearTimeout(hideTimer)
    if (!focused && !hovered) hideTimer = setTimeout(() => (open = false), 100)
  }
  function enter(): void {
    hovered = true
    show()
  }
  function leave(): void {
    hovered = false
    hideSoon()
  }
  $effect(() => {
    if (!eligible) {
      clearTimeout(hideTimer)
      focused = false
      hovered = false
      open = false
      return
    }
    if (!open) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      clearTimeout(hideTimer)
      hovered = false
      open = false
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  })
  onDestroy(() => clearTimeout(hideTimer))
</script>

{#if eligible}
  <button
    type="button"
    class="help"
    bind:this={dot}
    data-help-dot
    aria-label={text}
    aria-describedby={open ? id : undefined}
    onmouseenter={enter}
    onmouseleave={leave}
    onfocus={() => {
      focused = true
      show()
    }}
    onblur={() => {
      focused = false
      hideSoon()
    }}
    onclick={(event) => {
      event.preventDefault()
      event.stopPropagation()
      show()
    }}
  >
    ?
  </button>
  {#if open}
    <span
      class="bubble"
      {id}
      role="tooltip"
      data-help-tooltip
      use:helpTooltipDismiss={() => {
        clearTimeout(hideTimer)
        hovered = false
        open = false
      }}
      use:anchoredFloating={{
        anchor: dot,
        width: 280,
        align: 'center',
        placement: 'above',
        gap: 6,
        track: true,
        onAnchorHidden: () => (open = false)
      }}
      onmouseenter={enter}
      onmouseleave={leave}>{text}</span
    >
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
    padding: 0;
    background: transparent;
    font-family: inherit;
    vertical-align: middle;
    border-radius: 50%;
    border: 1px solid var(--border);
    color: var(--text-3);
    font-size: 10px;
    line-height: 1;
    cursor: help;
    user-select: none;
  }
  .help:hover,
  .help:focus-visible {
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
    text-align: start;
    white-space: pre-line;
    overflow-wrap: anywhere;
    overflow: auto;
    z-index: 1600;
  }
</style>
