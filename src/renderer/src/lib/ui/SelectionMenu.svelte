<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { Trash2 } from '@lucide/svelte'
  import { projectState } from '$lib/state/project.svelte'
  import type { Project } from '$lib/core/model'
  import type { MenuAction } from '$lib/platform'
  import { runMenuAction } from '$lib/state/menuActions'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import {
    deleteKeyAllowed,
    deleteTargetFor,
    editingDeleteTarget,
    type DeleteTarget
  } from './deletable'

  let active: DeleteTarget | null = null
  let activeIdentity: unknown
  let owner: Project | null = null
  let menu = $state.raw<{
    target: DeleteTarget
    identity: unknown
    project: Project | null
    x: number
    y: number
  } | null>(null)
  let menuElement = $state<HTMLDivElement | null>(null)
  let busy = false
  const modifier =
    typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'
  const commands: { action: MenuAction; label: string; shortcut?: string; separator?: boolean }[] =
    [
      { action: 'undo', label: 'undoChange', shortcut: modifier + 'Z', separator: true },
      { action: 'redo', label: 'redo', shortcut: modifier + 'Y' },
      { action: 'back', label: 'back', shortcut: 'Alt+←' },
      { action: 'palette', label: 'palette', shortcut: modifier + 'K', separator: true },
      { action: 'chars', label: 'chars', shortcut: modifier + 'I' },
      { action: 'save', label: 'save', shortcut: modifier + 'S' },
      { action: 'saveAs', label: 'saveAs', shortcut: modifier + 'Shift+S' },
      { action: 'guide', label: 'guide', separator: true }
    ]
  const modal = (): boolean =>
    !!(ui.confirmReq || ui.chooseReq || ui.promptReq || ui.paletteOpen) ||
    [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].some(
      (node) => node.getClientRects().length > 0
    )
  const textSelection = (): boolean => !!window.getSelection()?.toString()
  function available(
    target: DeleteTarget | null,
    project: Project | null = owner,
    identity = target?.options.identity
  ): boolean {
    return (
      !!target &&
      target.node.isConnected &&
      target.node.getClientRects().length > 0 &&
      project === projectState.project &&
      !projectState.readOnly &&
      target.options.enabled !== false &&
      target.options.selected !== false &&
      target.options.identity === identity
    )
  }
  async function remove(
    target: DeleteTarget,
    project: Project | null,
    identity: unknown
  ): Promise<void> {
    if (busy || modal() || !available(target, project, identity)) return
    menu = null
    busy = true
    const existingToasts = new Set(ui.toasts.map((toast) => toast.id))
    try {
      const result = target.options.remove()
      for (const toast of ui.toasts)
        if (!existingToasts.has(toast.id) && toast.action?.label === t('common.undo')) {
          const undo = toast.action.run
          toast.action.run = () => {
            if (project === projectState.project && !projectState.readOnly) undo()
          }
        }
      await result
    } catch (error) {
      ui.error(error instanceof Error ? error.message : String(error))
    } finally {
      busy = false
    }
  }
  function focusMenu(node: HTMLDivElement): void {
    queueMicrotask(() => node.querySelector<HTMLButtonElement>('button')?.focus())
  }
  $effect(() => {
    // 页面/语言或工程切换后，不保留指向此前对象的菜单。
    void ui.section
    void projectState.project
    menu = null
    active = null
  })
  onMount(() => {
    const point = (event: Event): void => {
      if (menuElement?.contains(event.target as Node)) return
      menu = null
      active = editingDeleteTarget(event.target) ? null : deleteTargetFor(event.target)
      activeIdentity = active?.options.identity
      owner = projectState.project
    }
    const context = (event: MouseEvent): void => {
      if (event.defaultPrevented || editingDeleteTarget(event.target) || textSelection() || modal())
        return
      const target = deleteTargetFor(event.target)
      if (!target || target.options.context === false) return
      event.preventDefault()
      target.options.select?.()
      active = target
      activeIdentity = target.options.identity
      owner = projectState.project
      const project = owner
      void tick().then(() => {
        if (target.node.isConnected && project === projectState.project && !modal())
          menu = {
            target,
            identity: target.options.identity,
            project,
            x: Math.max(4, Math.min(event.clientX, innerWidth - 270)),
            y: Math.max(
              4,
              Math.min(
                event.clientY,
                innerHeight - 370 - (target.options.actions?.length ?? 0) * 38
              )
            )
          }
      })
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && menu) {
        event.preventDefault()
        menu = null
        return
      }
      const target = menu?.target ?? active,
        project = menu?.project ?? owner,
        identity = menu ? menu.identity : activeIdentity
      if (
        !deleteKeyAllowed(event, {
          editable: editingDeleteTarget(event.target),
          textSelection: textSelection(),
          readOnly: projectState.readOnly,
          modal: modal(),
          selected: !busy && available(target, project, identity)
        })
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (target) void remove(target, project, identity)
    }
    document.addEventListener('pointerdown', point, true)
    document.addEventListener('focusin', point)
    document.addEventListener('contextmenu', context)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', point, true)
      document.removeEventListener('focusin', point)
      document.removeEventListener('contextmenu', context)
      window.removeEventListener('keydown', key)
    }
  })
</script>

{#if menu}
  {@const current = menu}
  <div
    class="selection-menu card"
    style:left={`${current.x}px`}
    style:top={`${current.y}px`}
    role="menu"
    tabindex="-1"
    bind:this={menuElement}
    use:focusMenu
    data-selection-menu
  >
    {#each current.target.options.actions ?? [] as action (action.label)}
      <button
        disabled={action.disabled}
        role="menuitem"
        onclick={() => {
          const snapshot = current
          const command = action
          menu = null
          if (
            !command.disabled &&
            snapshot.project === projectState.project &&
            snapshot.target.node.isConnected &&
            snapshot.identity === snapshot.target.options.identity
          )
            command.run()
        }}>{action.label}</button
      >
    {/each}
    <button
      class="delete"
      role="menuitem"
      disabled={!available(current.target, current.project, current.identity)}
      onclick={() => void remove(current.target, current.project, current.identity)}
      ><Trash2 size={15} /><span>{current.target.options.label || t('common.delete')}</span><kbd
        >Delete</kbd
      ></button
    >
    {#each commands as command (command.action)}
      {#if command.separator}<div class="separator" role="separator"></div>{/if}
      <button
        role="menuitem"
        data-context-command={command.action}
        onclick={() => {
          menu = null
          runMenuAction(command.action)
        }}
        ><span>{t(`native.${command.label}`)}</span>{#if command.shortcut}<kbd
            >{command.shortcut}</kbd
          >{/if}</button
      >
    {/each}
  </div>
{/if}

<style>
  .selection-menu {
    position: fixed;
    z-index: 1400;
    min-width: 250px;
    max-width: calc(100vw - 8px);
    max-height: calc(100vh - 8px);
    overflow: auto;
    padding: 4px;
    box-shadow: var(--shadow-lg);
  }
  .selection-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    color: var(--text);
    background: none;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .selection-menu button.delete {
    color: var(--danger);
  }
  .selection-menu button:hover:not(:disabled),
  .selection-menu button:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }
  .selection-menu span {
    flex: 1;
  }
  kbd {
    font: inherit;
    font-size: 11px;
    opacity: 0.75;
  }
  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 2px;
  }
</style>
