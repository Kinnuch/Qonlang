<script lang="ts" generics="T extends { id: string }">
  import { tick, type Snippet } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { lazyMore, type Lazy } from './lazy.svelte'
  import { galleryIndex, masonryLayout, type RecordViewMode } from './recordViews'

  let {
    items,
    mode,
    activeId,
    onactive,
    lazy,
    children,
    preview
  }: {
    items: T[]
    mode: RecordViewMode
    activeId: string | null
    onactive: (id: string) => void
    lazy: Lazy
    children: Snippet<[T, number]>
    preview?: Snippet<[T]>
  } = $props()
  let width = $state(1)
  let container: HTMLElement | undefined
  const heights = new SvelteMap<string, number>()
  const index = $derived(
    galleryIndex(
      items.map((item) => item.id),
      activeId
    )
  )
  const visible = $derived(
    mode === 'gallery' ? items.slice(index, index + 1) : items.slice(0, lazy.shown)
  )
  const layout = $derived(
    masonryLayout(
      visible.map((item) => heights.get(item.id) ?? 100),
      width
    )
  )
  function observeWidth(
    node: HTMLElement,
    enabled: boolean
  ): { update(enabled: boolean): void; destroy(): void } {
    container = node
    let ro: ResizeObserver | undefined
    const keyboard = (e: KeyboardEvent): void => {
      if (mode === 'gallery') keys(e)
    }
    node.addEventListener('keydown', keyboard)
    function observe(on: boolean): void {
      ro?.disconnect()
      if (on) {
        ro ??= new ResizeObserver(([entry]) => {
          if (mode === 'masonry') width = entry.contentRect.width
        })
        ro.observe(node)
      }
    }
    observe(enabled)
    return {
      update: observe,
      destroy: () => {
        ro?.disconnect()
        node.removeEventListener('keydown', keyboard)
        if (container === node) container = undefined
      }
    }
  }
  function measure(
    node: HTMLElement,
    input: { id: string; enabled: boolean }
  ): { update(input: { id: string; enabled: boolean }): void; destroy(): void } {
    let current = input
    let ro: ResizeObserver | undefined
    function observe(): void {
      ro?.disconnect()
      if (current.enabled) {
        ro ??= new ResizeObserver(([entry]) => {
          if (!current.enabled) return
          const height = entry.borderBoxSize[0]?.blockSize ?? node.getBoundingClientRect().height
          if (Math.abs((heights.get(current.id) ?? 0) - height) > 0.5)
            heights.set(current.id, height)
        })
        ro.observe(node)
      }
    }
    observe()
    return {
      update: (input) => {
        if (input.id === current.id && input.enabled === current.enabled) return
        current = input
        observe()
      },
      destroy: () => ro?.disconnect()
    }
  }
  function move(delta: number, focusCard = false): void {
    const next = items[index + delta]
    if (!next) return
    onactive(next.id)
    if (focusCard)
      void tick().then(() => {
        if (mode === 'gallery' && container?.isConnected)
          container
            .querySelector<HTMLElement>('[data-record-cell] [tabindex="0"]')
            ?.focus({ preventScroll: true })
      })
  }
  function keys(e: KeyboardEvent): void {
    if (
      e.target instanceof HTMLElement &&
      e.target.closest('input,textarea,select,button,[contenteditable="true"],.editor')
    )
      return
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      move(e.key === 'ArrowLeft' ? -1 : 1, true)
    }
  }
</script>

{#if mode === 'gallery'}
  <div class="gallery-nav" role="group" aria-label={t('recordViews.gallery')}>
    <button
      class="btn ghost icon sm"
      type="button"
      data-record-previous
      disabled={index <= 0}
      aria-label={t('recordViews.previous')}
      title={t('recordViews.previous')}
      onclick={() => move(-1)}><ChevronLeft size={18} /></button
    >
    <span class="small" aria-live="polite" data-record-position
      >{t('recordViews.position', { n: index + 1, total: items.length })}</span
    >
    <button
      class="btn ghost icon sm"
      type="button"
      data-record-next
      disabled={index < 0 || index >= items.length - 1}
      aria-label={t('recordViews.next')}
      title={t('recordViews.next')}
      onclick={() => move(1)}><ChevronRight size={18} /></button
    >
  </div>
{/if}
<div
  class="records"
  class:masonry={mode === 'masonry'}
  class:gallery={mode === 'gallery'}
  data-record-browser={mode}
  use:observeWidth={mode === 'masonry'}
  style:height={mode === 'masonry' ? `${layout.height}px` : undefined}
  role={mode === 'gallery' ? 'region' : undefined}
  aria-label={mode === 'gallery' ? t('recordViews.gallery') : undefined}
>
  {#if mode === 'gallery' && preview}
    {#if index > 0}<div
        class="gallery-neighbor previous"
        data-record-neighbor="previous"
        aria-hidden="true"
        inert
      >
        {@render preview(items[index - 1])}
      </div>{/if}
    {#if index >= 0 && index < items.length - 1}<div
        class="gallery-neighbor next"
        data-record-neighbor="next"
        aria-hidden="true"
        inert
      >
        {@render preview(items[index + 1])}
      </div>{/if}
  {/if}
  {#each visible as item, i (item.id)}
    <div
      class="record-cell"
      data-record-cell={item.id}
      use:measure={{ id: item.id, enabled: mode === 'masonry' }}
      style:position={mode === 'masonry' ? 'absolute' : undefined}
      style:left={mode === 'masonry' ? `${layout.positions[i].left}px` : undefined}
      style:top={mode === 'masonry' ? `${layout.positions[i].top}px` : undefined}
      style:width={mode === 'masonry' ? `${layout.positions[i].width}px` : undefined}
    >
      {@render children(item, mode === 'gallery' ? index : i)}
    </div>
  {/each}
</div>
{#if mode !== 'gallery' && items.length > lazy.shown}<div
    class="more-mark"
    use:lazyMore={lazy}
  ></div>{/if}

<style>
  .records {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .records.masonry {
    display: block;
    position: relative;
  }
  .record-cell {
    min-width: 0;
  }
  .record-cell > :global(.editor) {
    margin-bottom: 6px;
  }
  .gallery-nav {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 14px;
    margin-bottom: 8px;
  }
  .gallery {
    position: relative;
    max-width: 100%;
    flex: 1 0 auto;
    min-height: min(420px, 60vh);
    overflow-x: clip;
    outline-offset: 3px;
  }
  .gallery .record-cell {
    position: relative;
    z-index: 1;
    width: 82%;
    margin-inline: auto;
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .gallery .record-cell > :global(.item) {
    flex: 1;
    padding: clamp(12px, 2vw, 28px);
  }
  .gallery-neighbor {
    position: absolute;
    inset-block: 24px;
    width: 82%;
    overflow: clip;
    border-radius: var(--radius);
    filter: blur(2px);
    opacity: 0.3;
    pointer-events: none;
    user-select: none;
  }
  .gallery-neighbor.previous {
    left: -76%;
  }
  .gallery-neighbor.next {
    left: 94%;
  }
  .gallery-neighbor > :global(*) {
    min-height: 100%;
  }
  .gallery-neighbor.previous > :global(*) {
    text-align: end;
  }
  .more-mark {
    height: 1px;
  }
</style>
