<script lang="ts">
  import { tick, type Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'
  import { anchoredFloating } from './anchoredFloating'
  import HelpDot from './HelpDot.svelte'
  import { dismissOwnedHelpTooltip, ownedHelpTooltip } from './helpTooltip'

  let {
    name,
    owner,
    label,
    hint = '',
    open,
    onchange,
    children
  }: {
    name: string
    owner: string
    label: string
    hint?: string
    open: boolean
    onchange: (value: boolean) => void
    children: Snippet
  } = $props()
  const uid = $props.id()
  let anchor = $state<HTMLButtonElement>()
  let popup = $state<HTMLElement>()

  function close(focus = false): void {
    // 先提交原生 change，再卸载浮层，避免外点关闭时丢掉尚未失焦的数字输入。
    const active = document.activeElement
    if (active instanceof HTMLElement && popup?.contains(active)) active.blur()
    onchange(false)
    if (focus)
      void tick().then(() => {
        if (anchor?.isConnected) anchor.focus()
      })
  }
  $effect(() => {
    if (!open) return
    let live = true
    void tick().then(() => {
      if (live)
        (
          popup?.querySelector<HTMLElement>(
            'input:not(:disabled),select:not(:disabled),button:not(:disabled):not([data-help-dot])'
          ) ?? popup
        )?.focus()
    })
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (!!anchor?.contains(target) || !!popup?.contains(target) || !!ownedHelpTooltip(popup, target))
    const outside = (event: PointerEvent): void => {
      if (!inside(event.target)) close()
    }
    const focus = (event: FocusEvent): void => {
      if (!inside(event.target)) close()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (dismissOwnedHelpTooltip(popup)) return
        close(true)
      } else if (event.key === 'Tab') {
        const controls = Array.from(
          popup?.querySelectorAll<HTMLElement>(
            'input:not(:disabled),select:not(:disabled),button:not(:disabled),[tabindex="0"]'
          ) ?? []
        ).filter((el) => el.getClientRects().length)
        const index = controls.indexOf(document.activeElement as HTMLElement)
        if (
          !controls.length ||
          (event.shiftKey && index <= 0) ||
          (!event.shiftKey && index === controls.length - 1)
        ) {
          event.preventDefault()
          event.stopImmediatePropagation()
          close(true)
        }
      } else if (
        ((event.ctrlKey || event.metaKey) && ['z', 'y', 'a'].includes(event.key.toLowerCase())) ||
        ['Delete', 'Backspace'].includes(event.key)
      ) {
        // 输入框仍用浏览器的文本编辑；不能把浮层里的按键交给画板或项目撤销。
        const target = event.target as HTMLElement | null
        event.stopImmediatePropagation()
        if (!target?.matches('input,textarea,[contenteditable="true"]')) event.preventDefault()
      }
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('focusin', focus, true)
    window.addEventListener('keydown', key, true)
    return () => {
      live = false
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('focusin', focus, true)
      window.removeEventListener('keydown', key, true)
    }
  })
</script>

<button
  class="btn sm trigger"
  bind:this={anchor}
  id={uid + '-trigger'}
  data-editor-panel-trigger={name}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-controls={open ? uid : undefined}
  title={hint || label}
  onclick={() => onchange(!open)}
>
  {label}<ChevronDown size={13} class={open ? 'expanded' : ''} />
</button>
{#if open && anchor}
  <div
    class="popover card"
    bind:this={popup}
    id={uid}
    role="dialog"
    tabindex="-1"
    aria-modal="false"
    aria-labelledby={uid + '-trigger'}
    data-glyph-popover
    data-glyph-popover-owner={owner}
    data-editor-panel-popup={name}
    use:anchoredFloating={{ anchor, width: 380, gap: 6, onAnchorHidden: () => close() }}
  >
    <div class="popover-head">
      <strong>{label}</strong>{#if hint}<HelpDot tip={hint} />{/if}
    </div>
    {@render children()}
  </div>
{/if}

<style>
  .trigger {
    flex: none;
    gap: 5px;
  }
  .popover-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-block-end: 6px;
    font-size: 12px;
  }
  .trigger :global(.expanded) {
    transform: rotate(180deg);
  }
  .popover {
    position: fixed;
    z-index: 430;
    padding: 10px;
    max-width: calc(100vw - 16px);
    overflow: auto;
    overscroll-behavior: contain;
    box-sizing: border-box;
    background: var(--bg-elev);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    isolation: isolate;
  }
  @media (prefers-reduced-motion: no-preference) {
    .trigger :global(svg) {
      transition: transform 0.12s ease;
    }
  }
</style>
