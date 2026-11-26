<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { projectState } from '$lib/state/project.svelte'
  import type { Project } from '$lib/core/model'
  import ContextMenu from './ContextMenu.svelte'
  import { completeContextActions, actionShortcut, type ContextAction } from './contextActions'
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
  let busy = false
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
  $effect(() => {
    // 页面/语言或工程切换后，不保留指向此前对象的菜单。
    void ui.section
    void projectState.project
    menu = null
    active = null
  })
  onMount(() => {
    const point = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[data-selection-menu]')) return
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
            x: event.clientX,
            y: event.clientY
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
  function menuActions(current: NonNullable<typeof menu>): ContextAction[] {
    const valid = (): boolean =>
      current.project === projectState.project &&
      current.target.node.isConnected &&
      current.identity === current.target.options.identity &&
      !modal()
    const items = (current.target.options.actions ?? []).map((action, index) => ({
      id: 'custom:' + index,
      label: action.label,
      enabled: !action.disabled,
      shortcut: actionShortcut(action.label),
      run: () => {
        if (valid() && !action.disabled) action.run()
      }
    }))
    return completeContextActions(items, {
      id: 'delete',
      label: current.target.options.label || t('common.delete'),
      shortcut: 'Delete',
      enabled: available(current.target, current.project, current.identity),
      danger: true,
      run: () => {
        if (valid()) void remove(current.target, current.project, current.identity)
      }
    })
  }
</script>

{#if menu}{@const current = menu}{#key current}
    <ContextMenu
      x={current.x}
      y={current.y}
      items={menuActions(current)}
      onclose={() => (menu = null)}
    />
  {/key}{/if}
