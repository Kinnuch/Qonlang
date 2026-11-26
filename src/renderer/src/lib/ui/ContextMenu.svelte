<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { platform } from '$lib/platform'
  import { newId } from '$lib/core/factory'
  import type { ContextAction } from './contextActions'
  let {
    items,
    x,
    y,
    onclose,
    mark = 'selection'
  }: {
    items: ContextAction[]
    x: number
    y: number
    onclose: () => void
    mark?: 'selection' | 'folder' | 'file'
  } = $props()
  let node = $state<HTMLDivElement>()
  const initial = untrack(() => ({ items, x, y })),
    id = newId()
  const labelShortcut = (value: string): string =>
    value
      .replace('CmdOrCtrl+', /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+')
      .replace('Alt+Left', 'Alt+←')
  function choose(item: ContextAction): void {
    if (item.enabled === false || item.type === 'separator') return
    onclose()
    item.run?.()
  }
  $effect(() => {
    if (platform.kind !== 'electron') return
    let live = true
    void platform
      .showContextMenu({
        id,
        x: initial.x,
        y: initial.y,
        items: initial.items.map(({ id, label, enabled, shortcut, type, checked }) => ({
          id,
          label,
          enabled,
          shortcut,
          type,
          checked
        }))
      })
      .then((selected) => {
        if (!live) return
        const action = initial.items.find((item) => item.id === selected)
        if (action) choose(action)
        else onclose()
      })
      .catch(() => {
        if (live) onclose()
      })
    return () => {
      live = false
      void platform.closeContextMenu(id)
    }
  })
  $effect(() => {
    if (platform.kind === 'electron') return
    let live = true
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void tick().then(() => {
      if (live) node?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
    const close = (e: PointerEvent): void => {
      if (e.target instanceof Node && !node?.contains(e.target)) onclose()
    }
    const keys = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onclose()
        opener?.focus()
        return
      }
      if (e.key === 'Tab') {
        onclose()
        return
      }
      // 普通 Enter 交给当前聚焦按钮的原生激活，不抢走高亮项的选择。
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) return
      const shortcut = items.find(
        (item) =>
          item.enabled !== false &&
          item.shortcut &&
          (item.shortcut === 'F2'
            ? e.key === 'F2'
            : item.shortcut === 'Alt+Left'
              ? e.altKey && e.key === 'ArrowLeft'
              : item.shortcut === 'Delete'
                ? e.key === 'Delete'
                : item.shortcut === 'CmdOrCtrl+Enter'
                  ? (e.ctrlKey || e.metaKey) && e.key === 'Enter'
                  : item.shortcut.startsWith('CmdOrCtrl+') &&
                    (e.ctrlKey || e.metaKey) &&
                    item.shortcut.split('+').at(-1)?.toLowerCase() === e.key.toLowerCase() &&
                    item.shortcut.includes('Shift') === e.shiftKey)
      )
      if (shortcut) {
        e.preventDefault()
        e.stopImmediatePropagation()
        choose(shortcut)
        return
      }
      const controls = Array.from(
          node?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
        ),
        at = controls.indexOf(document.activeElement as HTMLButtonElement)
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        controls[
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? controls.length - 1
              : (at + (e.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
        ]?.focus()
        return
      }
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', keys, true)
    return () => {
      live = false
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', keys, true)
    }
  })
  function portal(el: HTMLElement): { destroy: () => void } {
    document.body.appendChild(el)
    const place = (): void => {
      el.style.left = Math.max(4, Math.min(x, innerWidth - el.offsetWidth - 4)) + 'px'
      el.style.top = Math.max(4, Math.min(y, innerHeight - el.offsetHeight - 4)) + 'px'
    }
    const ro = new ResizeObserver(place)
    ro.observe(el)
    place()
    window.addEventListener('resize', place)
    return {
      destroy: () => {
        ro.disconnect()
        window.removeEventListener('resize', place)
        el.remove()
      }
    }
  }
</script>

{#if platform.kind !== 'electron'}
  <div
    class="context-menu card"
    role="menu"
    tabindex="-1"
    bind:this={node}
    use:portal
    data-selection-menu={mark === 'selection' ? true : undefined}
    data-project-folder-menu={mark === 'folder' ? true : undefined}
    data-directory-file-menu={mark === 'file' ? true : undefined}
    style:left={`${Math.max(4, Math.min(x, innerWidth - 270))}px`}
    style:top={`${Math.max(4, Math.min(y, innerHeight - 60))}px`}
  >
    {#each items as item (item.id)}
      {#if item.type === 'separator'}<div class="separator" role="separator"></div>{:else}
        <button
          type="button"
          role={item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
          aria-checked={item.type === 'checkbox' ? item.checked : undefined}
          disabled={item.enabled === false}
          class:danger={item.danger}
          data-context-item={item.id}
          onclick={() => choose(item)}
          ><span>{item.type === 'checkbox' ? (item.checked ? '✓ ' : '　') : ''}{item.label}</span
          >{#if item.shortcut}<kbd>{labelShortcut(item.shortcut)}</kbd>{/if}</button
        >
      {/if}
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 1400;
    min-width: 250px;
    max-width: calc(100vw - 8px);
    max-height: calc(100vh - 8px);
    overflow: auto;
    padding: 4px;
    background: var(--bg-elev);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }
  button {
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 6px 10px;
    border-radius: 3px;
    font: inherit;
    text-align: start;
    cursor: pointer;
    white-space: nowrap;
  }
  button span {
    flex: 1;
  }
  button.danger {
    color: var(--danger);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:hover:not(:disabled),
  button:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }
  kbd {
    font: inherit;
    font-size: 11px;
    color: var(--text-3);
  }
  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 3px;
  }
</style>
