<script lang="ts" module>
  export const CANDIDATE_TRAY_DRAG = 'text/x-qonlang-tray'
  export interface CandidateFlight {
    id: string
    surface: string
    matched: string
    morph: boolean
    x: number
    y: number
    width: number
    height: number
  }
  export interface CandidateFlightRequest {
    id: number
    items: CandidateFlight[]
  }
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import type { ComposeTrayCandidate } from '$lib/engine/composeTray'
  import { t } from '$lib/i18n/index.svelte'
  import { Trash2, X, Undo2, GripVertical } from '@lucide/svelte'

  let {
    items,
    translation,
    onrestore,
    motion = null,
    button = $bindable(null)
  }: {
    items: readonly ComposeTrayCandidate[]
    translation: string
    onrestore: (id: string, translation: string) => void
    motion?: CandidateFlightRequest | null
    button?: HTMLButtonElement | null
  } = $props()
  let open = $state(false),
    popup = $state<HTMLElement | null>(null),
    style = $state('')
  let flying = $state<CandidateFlight[]>([])
  let dragging = $state(false)
  let draggedId = $state<string | null>(null)
  let active = true,
    lastMotion = -1,
    previousTranslation = untrack(() => translation)
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  let reduced = $state(media?.matches ?? false)
  onDestroy(() => {
    active = false
  })

  function portal(node: HTMLElement): { destroy(): void } {
    document.body.append(node)
    return { destroy: () => node.remove() }
  }
  function position(): void {
    if (!button) return
    const r = button.getBoundingClientRect(),
      width = Math.min(320, innerWidth - 16),
      height = Math.min(360, innerHeight - 16)
    const left = Math.max(8, Math.min(r.right - width, innerWidth - width - 8))
    const below = innerHeight - r.bottom - 12,
      top = below >= Math.min(160, height) ? r.bottom + 6 : Math.max(8, r.top - height - 6)
    style = `left:${left}px;top:${top}px;width:${width}px;max-height:${Math.max(80, Math.min(height, innerHeight - top - 8))}px`
  }
  function close(focus = false): void {
    open = false
    if (focus) button?.focus()
  }
  function toggle(): void {
    if (open) close()
    else {
      position()
      open = true
      void tick().then(() => popup?.focus())
    }
  }
  function restore(item: ComposeTrayCandidate): void {
    onrestore(item.id, item.translation)
    void tick().then(() => popup?.focus())
  }
  function dragStart(e: DragEvent, item: ComposeTrayCandidate): void {
    if (!e.dataTransfer) return
    dragging = true
    draggedId = item.id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(
      CANDIDATE_TRAY_DRAG,
      JSON.stringify({ id: item.id, translation: item.translation })
    )
  }
  $effect(() => {
    const change = (): void => {
      reduced = media?.matches ?? false
      if (reduced) flying = []
    }
    media?.addEventListener('change', change)
    return () => media?.removeEventListener('change', change)
  })
  $effect(() => {
    if (translation !== previousTranslation) {
      previousTranslation = translation
      open = false
      flying = []
      dragging = false
      draggedId = null
    }
  })
  // 成功drop会先移除源行，原生dragend可能晚于DOM撤除；仍应立即恢复浮层交互。
  $effect(() => {
    if (dragging && draggedId && !items.some((item) => item.id === draggedId)) {
      dragging = false
      draggedId = null
    }
  })
  $effect(() => {
    const request = motion
    if (!request || request.id === lastMotion) return
    lastMotion = request.id
    if (!reduced) flying = [...untrack(() => flying), ...request.items]
  })
  $effect(() => {
    if (!open) return
    position()
    const outside = (e: PointerEvent): void => {
      const target = e.target as Node
      if (!dragging && !popup?.contains(target) && !button?.contains(target)) close()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(true)
      }
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  })
  function fly(node: HTMLElement, item: CandidateFlight): { destroy(): void } {
    let gone = false,
      animation: Animation | null = null
    void tick().then(() => {
      if (gone || !active) return
      const target = button?.getBoundingClientRect()
      if (!target || reduced) {
        flying = flying.filter((f) => f.id !== item.id)
        return
      }
      const dx = target.left + target.width / 2 - item.x - item.width / 2,
        dy = target.top + target.height / 2 - item.y - item.height / 2
      animation = node.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          {
            transform: `translate(${dx * 0.55}px,${dy * 0.45 - 32}px) scale(.72) rotate(-5deg)`,
            opacity: 0.9,
            offset: 0.55
          },
          { transform: `translate(${dx}px,${dy}px) scale(.04)`, opacity: 0 }
        ],
        { duration: 520, easing: 'cubic-bezier(.4,0,.8,.7)', fill: 'forwards' }
      )
      void animation.finished
        .then(() => {
          if (active && !gone) flying = flying.filter((f) => f.id !== item.id)
        })
        .catch(() => {})
    })
    return {
      destroy() {
        gone = true
        animation?.cancel()
      }
    }
  }
</script>

<button
  class="btn ghost icon sm trash-toggle"
  class:filled={items.length > 0}
  bind:this={button}
  data-candidate-trash-toggle
  title={t('bench.trashTitle', { n: items.length })}
  aria-label={t('bench.trashTitle', { n: items.length })}
  aria-expanded={open}
  onclick={toggle}><Trash2 size={18} /></button
>
<span class="sr-only" role="status"
  >{items.length ? t('bench.trashTitle', { n: items.length }) : ''}</span
>

{#if open}
  <div
    class="candidate-trash card"
    class:candidate-dragging={dragging}
    use:portal
    bind:this={popup}
    {style}
    role="dialog"
    aria-label={t('bench.trashTitle', { n: items.length })}
    tabindex="-1"
    data-candidate-trash
  >
    <div class="trash-head">
      <strong class="grow">{t('bench.trashTitle', { n: items.length })}</strong><button
        class="btn ghost icon sm"
        title={t('common.close')}
        aria-label={t('common.close')}
        onclick={() => close(true)}><X size={15} /></button
      >
    </div>
    <p class="small muted hint">{t('bench.trashHint')}</p>
    <div class="trash-items" role="list">
      {#each items as item (item.id)}
        <div
          class="trash-item"
          role="listitem"
          class:morph={!!item.morphemeId}
          class:drag-source={dragging && draggedId === item.id}
          data-stashed-key={item.id}
          draggable="true"
          ondragstart={(e) => dragStart(e, item)}
          ondragend={() => {
            dragging = false
            draggedId = null
          }}
        >
          <GripVertical size={13} />
          <div class="item-text grow">
            <span class="data">{item.surface}</span><span class="small muted"
              >{item.matched} · {t('bench.candidateLocation', {
                n: [...item.translation.slice(0, item.at)].length + 1
              })}</span
            >
          </div>
          <button
            class="btn ghost icon sm"
            data-candidate-restore={item.id}
            title={t('bench.restoreCandidate')}
            aria-label={`${t('bench.restoreCandidate')} · ${item.surface}`}
            onclick={() => restore(item)}><Undo2 size={15} /></button
          >
        </div>
      {:else}<p class="small muted empty">{t('bench.trashEmpty')}</p>{/each}
    </div>
  </div>
{/if}
{#each flying as item (item.id)}
  <div
    class="candidate-flight"
    class:morph={item.morph}
    data-candidate-flight
    aria-hidden="true"
    use:portal
    use:fly={item}
    style:left={`${item.x}px`}
    style:top={`${item.y}px`}
    style:width={`${item.width}px`}
    style:height={`${item.height}px`}
  >
    <span class="data">{item.surface}</span><span class="small muted">{item.matched}</span>
  </div>
{/each}

<style>
  .trash-toggle {
    flex: none;
    position: relative;
  }
  .trash-toggle.filled {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .candidate-trash {
    position: fixed;
    z-index: 800;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    overflow: hidden;
    background: var(--bg-elev);
    color: var(--text);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    text-align: start;
  }
  .trash-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hint,
  .empty {
    margin: 0;
  }
  .trash-items {
    overflow: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .candidate-trash.candidate-dragging {
    pointer-events: none;
    opacity: 0.45;
  }
  /* 不把原生dragstart的源行从命中树移除；其他弹层区域仍允许穿透到待选区。 */
  .trash-item.drag-source {
    pointer-events: auto;
  }
  .trash-item {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 7px;
    background: var(--bg-sunken);
    cursor: grab;
  }
  .trash-item.morph {
    border-style: dashed;
  }
  .item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .item-text > .data {
    font-size: 16px;
  }
  .item-text > .small {
    font-size: 11px;
  }
  .candidate-flight {
    position: fixed;
    z-index: 900;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    overflow: hidden;
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-soft) 60%, var(--bg-elev));
    color: var(--text);
    box-shadow: var(--shadow);
    transform-origin: center;
    will-change: transform, opacity;
  }
  .candidate-flight.morph {
    border-style: dashed;
  }
  .candidate-flight > .data {
    font-size: 16px;
  }
  .candidate-flight > .small {
    font-size: 11px;
    white-space: nowrap;
  }
</style>
