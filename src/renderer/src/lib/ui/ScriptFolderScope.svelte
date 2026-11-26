<script lang="ts">
  import type { Project, Script, Id } from '$lib/core/model'
  import { projectFolders } from '$lib/core/projectFolders'
  import { createFolderIndex } from '$lib/core/folderTree'
  import { normalizeScriptFolderScope } from '$lib/core/scriptScope'
  import { t } from '$lib/i18n/index.svelte'
  import HelpDot from './HelpDot.svelte'
  let {
    project,
    script,
    readOnly = false,
    onchange
  }: { project: Project; script: Script; readOnly?: boolean; onchange: () => void } = $props()
  const uid = $props.id(),
    scope = $derived(normalizeScriptFolderScope(script.folderScope)),
    index = $derived(createFolderIndex(projectFolders(project)))
  const rows = $derived.by(() => {
    const out = [{ id: '', name: 'Default', depth: 0, path: 'Default' }],
      queue = [...[...(index.children.get('') ?? [])].reverse()].map((folder) => ({
        folder,
        depth: 0,
        path: folder.name
      }))
    while (queue.length) {
      const { folder, depth, path } = queue.pop()!
      out.push({ id: folder.id, name: folder.name, depth, path })
      for (const child of [...(index.children.get(folder.id) ?? [])].reverse())
        queue.push({ folder: child, depth: depth + 1, path: path + ' / ' + child.name })
    }
    return out
  })
  const missing = $derived(
    scope?.mode === 'selected'
      ? [...new Set([...scope.folderIds, ...(scope.excludedFolderIds ?? [])])].filter(
          (id) => id && !index.has(id)
        )
      : []
  )
  function mode(value: string): void {
    if (readOnly) return
    if (value === 'all') delete script.folderScope
    else if (value === 'none') script.folderScope = { mode: 'none', folderIds: [] }
    else
      script.folderScope = scope?.mode === 'selected' ? scope : { mode: 'selected', folderIds: [] }
    onchange()
  }
  function toggle(id: Id, exclude: boolean, on: boolean): void {
    if (readOnly || scope?.mode !== 'selected') return
    const includes = new Set(scope.folderIds),
      excludes = new Set(scope.excludedFolderIds ?? []),
      target = exclude ? excludes : includes
    if (on) target.add(id)
    else target.delete(id)
    script.folderScope = {
      mode: 'selected',
      folderIds: [...includes],
      ...(excludes.size ? { excludedFolderIds: [...excludes] } : {})
    }
    onchange()
  }
  function forget(id: Id): void {
    if (readOnly || scope?.mode !== 'selected') return
    script.folderScope = {
      mode: 'selected',
      folderIds: scope.folderIds.filter((value) => value !== id),
      ...(scope.excludedFolderIds
        ? { excludedFolderIds: scope.excludedFolderIds.filter((value) => value !== id) }
        : {})
    }
    onchange()
  }
</script>

<div class="field" data-script-folder-scope={script.id}>
  <label for={uid}>{t('scriptScope.title')}<HelpDot tip={t('scriptScope.hint')} /></label>
  <select
    class="select"
    id={uid}
    data-script-scope-mode={script.id}
    disabled={readOnly}
    value={scope?.mode ?? 'all'}
    onchange={(event) => mode(event.currentTarget.value)}
    ><option value="all">{t('scriptScope.all')}</option><option value="none"
      >{t('scriptScope.none')}</option
    ><option value="selected">{t('scriptScope.selected')}</option></select
  >
  {#if scope?.mode === 'selected'}
    <div class="folder-choices" data-script-scope-folders>
      <div class="choice-head">
        <span class="grow">{t('scriptScope.folder')}</span><span>{t('scriptScope.include')}</span
        ><span>{t('scriptScope.exclude')}</span>
      </div>
      {#each rows as folder (folder.id)}<div class="folder-choice">
          <span
            class="folder-name grow"
            style:padding-inline-start={folder.depth * 10 + 'px'}
            title={folder.path}>{folder.name}</span
          >
          <input
            type="checkbox"
            disabled={readOnly}
            data-script-scope-include={folder.id}
            aria-label={`${folder.path} · ${t('scriptScope.include')}`}
            checked={scope.folderIds.includes(folder.id)}
            onchange={(event) => toggle(folder.id, false, event.currentTarget.checked)}
          />
          <input
            type="checkbox"
            disabled={readOnly}
            data-script-scope-exclude={folder.id}
            aria-label={`${folder.path} · ${t('scriptScope.exclude')}`}
            checked={scope.excludedFolderIds?.includes(folder.id) ?? false}
            onchange={(event) => toggle(folder.id, true, event.currentTarget.checked)}
          />
        </div>{/each}
    </div>
    {#each missing as id (id)}<div class="row small muted">
        <span class="grow">{t('scriptScope.missing', { id })}</span><button
          class="btn ghost sm"
          disabled={readOnly}
          onclick={() => forget(id)}>{t('scriptScope.forget')}</button
        >
      </div>{/each}
  {/if}
</div>

<style>
  .folder-choices {
    max-height: 250px;
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .folder-choice,
  .choice-head {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 5px 7px;
    font-size: 12px;
  }
  .choice-head {
    position: sticky;
    top: 0;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
  }
  .choice-head span:not(.grow) {
    width: 48px;
    text-align: center;
    font-size: 10px;
  }
  .folder-choice input {
    margin-inline: 15px;
    flex: none;
  }
  .folder-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }
</style>
