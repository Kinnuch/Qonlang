<script lang="ts" module>
  export const DOC_PAGE_DRAG = 'text/x-qonlang-doc'
  export const DOC_FOLDER_DRAG = 'text/x-qonlang-doc-folder'
</script>

<script lang="ts">
  import { t } from '$lib/i18n/index.svelte'
  import { untrack } from 'svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { Folder, FolderPlus, ChevronDown, ChevronRight, MoreHorizontal } from '@lucide/svelte'
  import type { DocFolderItem } from '$lib/core/docFolders'
  let {
    projectId,
    folders,
    current,
    readOnly = false,
    onopen,
    oncreate,
    onrename,
    onremove,
    onmoveFolder,
    onmovePages
  }: {
    projectId: string
    folders: DocFolderItem[]
    current: string
    readOnly?: boolean
    onopen: (id: string) => void
    oncreate: (parent: string) => void
    onrename: (id: string) => void
    onremove: (id: string) => void
    onmoveFolder: (id: string, parent?: string) => void
    onmovePages: (ids: string[], folder: string) => void
  } = $props()
  const memo = ui.memo<{ folderCollapsedIds: string[] }>('docs')
  let collapsed = $state.raw(new Set<string>(untrack(() => memo.folderCollapsedIds ?? []))),
    over = $state<string | null>(null),
    menu = $state<{ id: string; x: number; y: number } | null>(null)
  $effect(() => {
    memo.folderCollapsedIds = [...collapsed]
  })
  const visible = $derived.by(() => {
    if (!collapsed.size) return folders
    const result: DocFolderItem[] = []
    let hiddenDepth: number | null = null
    for (const folder of folders) {
      const depth = folder.ancestors.length
      if (hiddenDepth !== null && depth > hiddenDepth) continue
      hiddenDepth = null
      result.push(folder)
      if (folder.children && collapsed.has(folder.id)) hiddenDepth = depth
    }
    return result
  })
  $effect(() => {
    const selected = folders.find((folder) => folder.id === current)
    if (selected?.ancestors.some((id) => collapsed.has(id))) {
      const next = new Set(collapsed)
      for (const id of selected.ancestors) next.delete(id)
      collapsed = next
    }
  })
  $effect(() => {
    void projectId
    menu = null
    over = null
  })
  $effect(() => {
    if (!menu) return
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (
        event.type === 'pointerdown' &&
        event.target instanceof Element &&
        event.target.closest('[data-doc-folder-menu]')
      )
        return
      menu = null
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
    }
  })
  function toggle(id: string): void {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsed = next
  }
  function context(event: MouseEvent, id: string): void {
    event.preventDefault()
    event.stopPropagation()
    menu = {
      id,
      x: Math.max(8, Math.min(innerWidth - 250, event.clientX)),
      y: Math.max(8, Math.min(innerHeight - 225, event.clientY))
    }
  }
  function run(action: () => void): void {
    action()
    menu = null
  }
  function portal(node: HTMLElement): { destroy(): void } {
    document.body.append(node)
    return { destroy: () => node.remove() }
  }
  function start(event: DragEvent, id: string): void {
    if (readOnly || !id || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(DOC_FOLDER_DRAG, JSON.stringify({ projectId, id }))
  }
  function dragOver(event: DragEvent, id: string): void {
    if (
      readOnly ||
      !event.dataTransfer ||
      ![DOC_PAGE_DRAG, DOC_FOLDER_DRAG].some((type) => event.dataTransfer!.types.includes(type))
    )
      return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    over = id
  }
  function drop(event: DragEvent, id: string): void {
    over = null
    if (readOnly || !event.dataTransfer) return
    event.preventDefault()
    event.stopPropagation()
    for (const type of [DOC_PAGE_DRAG, DOC_FOLDER_DRAG]) {
      const raw = event.dataTransfer.getData(type)
      if (!raw) continue
      try {
        const value: unknown = JSON.parse(raw)
        if (
          !value ||
          typeof value !== 'object' ||
          !('projectId' in value) ||
          value.projectId !== projectId ||
          !('id' in value) ||
          typeof value.id !== 'string'
        )
          return
        if (type === DOC_PAGE_DRAG) onmovePages([value.id], id)
        else onmoveFolder(value.id, id)
      } catch {
        /* 非本工程的拖动不改变数据。 */
      }
      return
    }
  }
</script>

<section class="doc-folders" data-doc-folders aria-label={t('docFolders.title')}>
  <div class="row folder-head">
    <strong class="grow">{t('docFolders.title')}</strong><button
      class="btn ghost icon sm"
      data-doc-folder-create
      disabled={readOnly}
      title={t('docFolders.create')}
      onclick={() => oncreate(current)}><FolderPlus size={14} /></button
    >
  </div>
  <div role="tree">
    {#each visible as folder (folder.id)}
      <div
        class="folder-row"
        class:active={current === folder.id}
        class:over={over === folder.id}
        style:padding-inline-start={folder.ancestors.length * 12 + 'px'}
        role="treeitem"
        aria-expanded={folder.children ? !collapsed.has(folder.id) : undefined}
        aria-selected={current === folder.id}
        tabindex="-1"
        data-doc-folder={folder.id}
        draggable={!readOnly && !folder.default}
        ondragstart={(event) => start(event, folder.id)}
        ondragover={(event) => dragOver(event, folder.id)}
        ondragleave={() => (over = null)}
        ondrop={(event) => drop(event, folder.id)}
        ondragend={() => (over = null)}
        oncontextmenu={(event) => context(event, folder.id)}
      >
        {#if folder.children}<button
            class="twisty"
            title={t(collapsed.has(folder.id) ? 'docFolders.expand' : 'docFolders.collapse')}
            onclick={() => toggle(folder.id)}
            >{#if collapsed.has(folder.id)}<ChevronRight size={13} />{:else}<ChevronDown
                size={13}
              />{/if}</button
          >{:else}<span class="twisty"></span>{/if}
        <button
          class="folder-open"
          data-doc-folder-open={folder.id}
          title={folder.path}
          onclick={() => onopen(folder.id)}
          onkeydown={(event) => {
            if (event.key === 'Delete') {
              event.preventDefault()
              event.stopPropagation()
              if (!readOnly && !folder.default) onremove(folder.id)
            }
          }}
          ><Folder size={14} /><span class="grow ellip">{folder.name}</span><span class="tiny muted"
            >{folder.count}</span
          ></button
        >
        <button
          class="twisty"
          title={t('docFolders.actions')}
          data-doc-folder-actions={folder.id}
          onclick={(event) => {
            const r = event.currentTarget.getBoundingClientRect()
            menu = {
              id: folder.id,
              x: Math.max(8, Math.min(innerWidth - 250, r.right)),
              y: Math.max(8, Math.min(innerHeight - 225, r.bottom))
            }
          }}><MoreHorizontal size={13} /></button
        >
      </div>
    {/each}
  </div>
</section>
{#if menu}
  {@const id = menu.id}
  <div
    class="folder-menu card"
    role="menu"
    data-doc-folder-menu
    use:portal
    style:left={menu.x + 'px'}
    style:top={menu.y + 'px'}
  >
    <button role="menuitem" disabled={readOnly} onclick={() => run(() => oncreate(id))}
      >{t('docFolders.createChild')}</button
    >
    {#if id}<button role="menuitem" disabled={readOnly} onclick={() => run(() => onrename(id))}
        >{t('docFolders.rename')}</button
      ><button role="menuitem" disabled={readOnly} onclick={() => run(() => onmoveFolder(id))}
        >{t('docFolders.moveFolder')}</button
      ><button
        class="danger"
        role="menuitem"
        disabled={readOnly}
        onclick={() => run(() => onremove(id))}>{t('docFolders.remove')}</button
      >{/if}
  </div>{/if}

<style>
  .folder-head {
    gap: 5px;
    margin-bottom: 4px;
  }
  .doc-folders {
    padding-block-end: 8px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 6px;
  }
  .folder-row {
    display: flex;
    align-items: center;
    min-width: 0;
    border-radius: var(--radius-sm);
    min-height: 29px;
  }
  .folder-row.active {
    background: var(--accent-soft);
  }
  .folder-row.over {
    outline: 2px solid var(--accent);
  }
  .twisty {
    width: 18px;
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .folder-open {
    display: flex;
    gap: 5px;
    align-items: center;
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: start;
    padding: 4px 2px;
    cursor: pointer;
    font-size: 12px;
  }
  .ellip {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .folder-menu {
    position: fixed;
    z-index: 650;
    width: 240px;
    display: flex;
    flex-direction: column;
    padding: 5px;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
  }
  .folder-menu button {
    border: 0;
    background: none;
    color: var(--text);
    padding: 8px;
    text-align: start;
    cursor: pointer;
  }
  .folder-menu button:hover {
    background: var(--bg-hover);
  }
  .folder-menu button.danger {
    color: var(--danger);
  }
  .folder-menu button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
