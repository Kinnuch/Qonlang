<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronDown, ChevronUp } from '@lucide/svelte'
  import { t } from '$lib/i18n/index.svelte'

  let { children }: { children: Snippet } = $props()
  let expanded = $state(false)
  let overflowing = $state(false)
  let content: HTMLDivElement
  let cap: HTMLDivElement
  const id = $props.id()

  $effect(() => {
    const el = content,
      meter = cap
    if (!el || !meter) return
    const measure = (): void => {
      overflowing = el.scrollHeight > meter.getBoundingClientRect().height + 2
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(meter)
    measure()
    return () => ro.disconnect()
  })
</script>

<div class="record-excerpt" class:expanded class:overflowing data-record-overflow={overflowing}>
  <div class="cap-meter" aria-hidden="true" bind:this={cap}></div>
  <div class="record-content" bind:this={content} {id}>{@render children()}</div>
  {#if overflowing}
    {#if !expanded}<div class="omission" aria-hidden="true">…</div>{/if}
    <button
      type="button"
      class="fold"
      data-record-expand
      aria-expanded={expanded}
      aria-controls={id}
      title={expanded ? t('recordViews.collapse') : t('recordViews.expand')}
      aria-label={expanded ? t('recordViews.collapse') : t('recordViews.expand')}
      onclick={(e) => {
        e.stopPropagation()
        expanded = !expanded
      }}
      onkeydown={(e) => e.stopPropagation()}
      onmousedown={(e) => e.stopPropagation()}
    >
      {#if expanded}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
    </button>
  {/if}
</div>

<style>
  .record-excerpt {
    --record-cap: min(
      42vh,
      calc(
        280px *
          max(
            var(--font-scale-corpus-text, 1),
            var(--font-scale-corpus-tr, 1),
            var(--font-scale-gloss, 1),
            var(--font-scale-script, 1)
          ) *
          var(--corpus-text-scale, 1)
      )
    );
    position: relative;
    min-width: 0;
  }
  .record-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-wrap: anywhere;
  }
  .cap-meter {
    position: absolute;
    height: var(--record-cap);
    width: 0;
    visibility: hidden;
    pointer-events: none;
  }
  .overflowing:not(.expanded) {
    max-height: var(--record-cap);
    overflow: clip;
    padding-bottom: 22px;
    box-sizing: border-box;
  }
  .overflowing.expanded {
    padding-bottom: 22px;
  }
  .omission {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    height: 34px;
    padding-inline-start: 2px;
    display: flex;
    align-items: end;
    background: linear-gradient(transparent, var(--bg-elev) 65%);
    pointer-events: none;
  }
  .fold {
    position: absolute;
    inset-inline-end: 0;
    bottom: 0;
    width: 24px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .fold:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .fold:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
