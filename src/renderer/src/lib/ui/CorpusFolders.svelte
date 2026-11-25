<script lang="ts" module>
  export const CORPUS_SENTENCE_DRAG = 'text/x-qonlang-sentence'
  const CORPUS_FOLDER_DRAG = 'text/x-qonlang-corpus-folder'
  export type CorpusExportKind = 'csv' | 'json' | 'leipzig' | 'markdown' | 'html' | 'latex'
</script>

<script lang="ts">
  import { t } from '$lib/i18n/index.svelte'
  import { Folder, FolderPlus, FileDown, FileUp, Pencil, Trash2 } from '@lucide/svelte'
  import type { CorpusFolderItem } from '$lib/core/corpusFolders'
  let {
    projectId,
    languageId,
    folders,
    readOnly = false,
    compact = false,
    onopen,
    oncreate,
    onrename,
    onremove,
    onreorder,
    onmove,
    onimport,
    onexport
  }: {
    projectId: string
    languageId: string
    folders: CorpusFolderItem[]
    readOnly?: boolean
    compact?: boolean
    onopen: (id: string) => void
    oncreate: () => void
    onrename: (id: string) => void
    onremove: (id: string) => void
    onreorder: (from: string, to: string) => void
    onmove: (ids: string[], folder: string) => void
    onimport: (folder: string, json: boolean) => void
    onexport: (folder: string | null, kind: CorpusExportKind) => void
  } = $props()
  let menu = $state<{ x: number; y: number; folder: string | null } | null>(null),
    over = $state<string | null>(null)
  const kinds: CorpusExportKind[] = ['csv', 'json', 'leipzig', 'markdown', 'html', 'latex']
  $effect(() => {
    void projectId
    void languageId
    menu = null
    over = null
  })
  function context(e: MouseEvent, folder: string | null): void {
    e.preventDefault()
    e.stopPropagation()
    menu = {
      x: Math.max(8, Math.min(e.clientX, innerWidth - 268)),
      y: Math.max(8, Math.min(e.clientY, innerHeight - 420)),
      folder
    }
  }
  $effect(() => {
    if (!menu) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.target instanceof Element && e.target.closest('[data-corpus-folder-menu]')) return
      menu = null
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
    }
  })
  function run(action: () => void): void {
    action()
    menu = null
  }
  function dragStart(e: DragEvent, id: string): void {
    if (readOnly || !id || !e.dataTransfer) {
      e.preventDefault()
      return
    }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(CORPUS_FOLDER_DRAG, JSON.stringify({ projectId, languageId, id }))
  }
  function dragOver(e: DragEvent, id: string): void {
    if (
      readOnly ||
      !e.dataTransfer ||
      ![CORPUS_FOLDER_DRAG, CORPUS_SENTENCE_DRAG].some((type) =>
        e.dataTransfer!.types.includes(type)
      )
    )
      return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    over = id
  }
  function drop(e: DragEvent, id: string): void {
    over = null
    if (readOnly || !e.dataTransfer) return
    e.preventDefault()
    e.stopPropagation()
    for (const type of [CORPUS_SENTENCE_DRAG, CORPUS_FOLDER_DRAG]) {
      const raw = e.dataTransfer.getData(type)
      if (!raw) continue
      try {
        const value = JSON.parse(raw)
        if (
          !value ||
          value.projectId !== projectId ||
          value.languageId !== languageId ||
          typeof value.id !== 'string'
        )
          return
        if (type === CORPUS_SENTENCE_DRAG) onmove([value.id], id)
        else if (id) onreorder(value.id, id)
      } catch {
        /* 外部拖动不改归属。 */
      }
      return
    }
  }
  function portal(node: HTMLElement): { destroy: () => void } {
    document.body.append(node)
    return { destroy: () => node.remove() }
  }
</script>

<section
  class="folder-panel"
  class:compact
  data-corpus-folders
  aria-label={t('corpus.folders.title')}
  oncontextmenu={(e) => context(e, null)}
>
  {#if !compact}<div class="row">
      <h2 class="grow">{t('corpus.folders.title')}</h2>
      <button class="btn sm" data-corpus-folder-create disabled={readOnly} onclick={oncreate}
        ><FolderPlus size={15} />{t('corpus.folders.create')}</button
      >
    </div>{/if}
  <div class="folder-grid" role="list">
    {#each folders as folder (folder.id)}
      <div
        class="folder-slot"
        role="listitem"
        class:over={over === folder.id}
        data-corpus-folder={folder.id}
        draggable={!readOnly && !folder.default}
        ondragstart={(e) => dragStart(e, folder.id)}
        ondragend={() => (over = null)}
        ondragover={(e) => dragOver(e, folder.id)}
        ondragleave={() => (over = null)}
        ondrop={(e) => drop(e, folder.id)}
        oncontextmenu={(e) => context(e, folder.id)}
      >
        <button
          class="folder-open"
          data-corpus-folder-open={folder.id}
          onclick={() => onopen(folder.id)}
          ><Folder size={compact ? 20 : 46} /><strong>{folder.name}</strong><span
            class="small muted">{t('corpus.folders.count', { n: folder.count })}</span
          ></button
        >
      </div>
    {/each}
  </div>
  {#if !compact}<p class="small muted">{t('corpus.folders.hint')}</p>{/if}
</section>
{#if menu}
  {@const target = menu.folder}
  <div
    class="folder-menu card"
    role="menu"
    data-corpus-folder-menu
    use:portal
    style:left={menu.x + 'px'}
    style:top={menu.y + 'px'}
  >
    <button role="menuitem" disabled={readOnly} onclick={() => run(oncreate)}
      ><FolderPlus size={14} />{t('corpus.folders.create')}</button
    >
    {#if target}<button
        role="menuitem"
        disabled={readOnly}
        onclick={() => run(() => onrename(target))}
        ><Pencil size={14} />{t('corpus.folders.rename')}</button
      ><button
        role="menuitem"
        class="danger"
        disabled={readOnly}
        onclick={() => run(() => onremove(target))}
        ><Trash2 size={14} />{t('corpus.folders.remove')}</button
      >{/if}
    <hr />
    <button
      role="menuitem"
      disabled={readOnly}
      onclick={() => run(() => onimport(target ?? '', false))}
      ><FileDown size={14} />{t('io.importTable')}</button
    >
    <button
      role="menuitem"
      disabled={readOnly}
      onclick={() => run(() => onimport(target ?? '', true))}
      ><FileDown size={14} />{t('io.importJson')}</button
    >
    <hr />
    <span class="small muted"
      >{target === null ? t('corpus.folders.exportAll') : t('corpus.folders.exportFolder')}</span
    >
    {#each kinds as kind (kind)}<button
        role="menuitem"
        disabled={readOnly}
        data-corpus-folder-export={kind}
        onclick={() => run(() => onexport(target, kind))}
        ><FileUp size={14} />{kind === 'csv'
          ? t('io.exportCsv')
          : kind === 'json'
            ? t('io.exportJson')
            : t(`corpus.formats.${kind}`)}</button
      >{/each}
  </div>
{/if}

<style>
  .folder-panel {
    padding: 16px;
    min-height: 220px;
  }
  .folder-panel.compact {
    min-height: 0;
    padding: 6px;
    border: 1px dashed var(--accent);
    border-radius: var(--radius);
    background: var(--bg-elev);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .folder-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
    gap: 12px;
    align-content: start;
  }
  .folder-slot {
    border: 1px solid transparent;
    border-radius: var(--radius);
    min-width: 0;
  }
  .folder-slot.over {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .folder-open {
    border: 0;
    background: none;
    color: var(--text);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding: 16px 8px;
    width: 100%;
    border-radius: var(--radius);
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .folder-open:hover {
    background: var(--bg-hover);
  }
  .folder-open :global(svg) {
    color: var(--accent);
  }
  .compact .folder-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 4px;
  }
  .compact .folder-open {
    padding: 5px;
    gap: 2px;
  }
  .folder-menu {
    position: fixed;
    z-index: 800;
    display: flex;
    flex-direction: column;
    min-width: 240px;
    max-height: calc(100vh - 16px);
    overflow: auto;
    padding: 8px;
    box-shadow: var(--shadow-lg);
  }
  .folder-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: none;
    padding: 6px 9px;
    text-align: start;
    border-radius: var(--radius-sm);
    color: var(--text);
    cursor: pointer;
  }
  .folder-menu button:hover {
    background: var(--bg-hover);
  }
  .folder-menu button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .folder-menu .danger {
    color: var(--danger);
  }
  h2 {
    margin: 0 0 12px;
  }
  .folder-menu hr {
    width: 100%;
    border: 0;
    border-top: 1px solid var(--border);
  }
</style>
