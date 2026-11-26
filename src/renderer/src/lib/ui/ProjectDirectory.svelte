<script lang="ts">
  import {
    Folder,
    FolderPlus,
    ChevronRight,
    ChevronDown,
    ArrowUp,
    LayoutGrid,
    List,
    MoreHorizontal,
    FileText,
    Quote,
    MessageCircle,
    HardDrive
  } from '@lucide/svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import ProjectDirectoryMenus from './ProjectDirectoryMenus.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { newId } from '$lib/core/factory'
  import {
    projectFolders,
    ensureProjectFolders,
    projectFolderOf,
    createProjectFolder,
    renameProjectFolder,
    moveProjectFolder,
    removeProjectFolder,
    projectFolderMoveTargets,
    reorderProjectFolder,
    moveProjectRecords,
    type ProjectRecordKind,
    type ProjectRecordRef
  } from '$lib/core/projectFolders'
  import { lazy, lazyMore } from '$lib/ui/lazy.svelte'
  import { createProjectDirectoryProjection } from '$lib/core/projectDirectory'
  import { createFolderIndex } from '$lib/core/folderTree'
  import {
    copyProjectRecords,
    pasteProjectRecords,
    clipboardRecordEventAllowed
  } from '$lib/state/recordClipboard.svelte'

  let {
    kind,
    currentId = '',
    compact = false,
    rootView = false,
    onroot,
    onbrowse,
    onopen,
    onimport,
    onexport
  }: {
    kind: ProjectRecordKind
    currentId?: string
    compact?: boolean
    rootView?: boolean
    onroot: () => void
    onbrowse: (id: string) => void
    onopen: (id: string) => void
    onimport?: (id: string, json: boolean) => void
    onexport?: (id: string | null, format: string, recursive: boolean) => void
  } = $props()
  const project = $derived(projectState.project!)
  const lz = lazy(80)
  const metadata = $derived(project.settings.folderMetadata ?? ['tags', 'createdAt', 'size'])
  const mode = $derived(project.settings.folderView ?? 'icons')
  const projection = $derived(
    createProjectDirectoryProjection(project, {
      sizes: !compact && mode === 'details' && metadata.includes('size')
    })
  )
  const rows = $derived(projection.rows)
  const folders = $derived(rows.filter((folder) => !folder.default))
  const index = $derived(createFolderIndex(folders))
  const path = $derived(index.path(currentId))
  const treeMemo = ui.memo<{ directoryCollapsed: string[] }>('docs')
  let collapsed = $state.raw(new Set<string>(treeMemo.directoryCollapsed ?? []))
  $effect(() => {
    treeMemo.directoryCollapsed = [...collapsed]
  })
  const visibleRows = $derived.by(() => {
    const out = [] as typeof rows
    let hiddenDepth: number | null = null
    for (const row of rows) {
      if (row.default) {
        out.push(row)
        continue
      }
      if (hiddenDepth !== null && row.depth > hiddenDepth) continue
      hiddenDepth = null
      out.push(row)
      if (collapsed.has(row.id)) hiddenDepth = row.depth
    }
    return out
  })
  const shown = $derived(
    compact
      ? visibleRows
      : rootView
        ? rows.filter((row) => row.default || !row.parentId)
        : currentId
          ? rows.filter((row) => !row.default && row.parentId === currentId)
          : []
  )
  const detailColumns = $derived(
    '24px minmax(140px,1fr) 48px ' +
      ['type', 'tags', 'createdAt', 'size']
        .filter((key) => metadata.includes(key as 'type' | 'tags' | 'createdAt' | 'size'))
        .map(() => 'minmax(80px,auto)')
        .join(' ') +
      ' 40px'
  )
  let menu = $state<{ id: string | null; x: number; y: number; root?: boolean } | null>(null),
    recursive = $state(true),
    over = $state<string | null>(null),
    overRoot = $state(false)
  const effectiveFolder = (record: { folderId?: string }): string =>
    project.folders !== undefined
      ? index.has(record.folderId ?? '')
        ? (record.folderId ?? '')
        : ''
      : projectFolderOf(project, record)
  const files = $derived.by(() => {
    if (compact || rootView) return []
    const out: {
      kind: ProjectRecordKind
      id: string
      name: string
      tags: string[]
      createdAt?: string
      languageId: string | null
      bytes: number
    }[] = []
    for (const [recordKind, list] of [
      ['sentence', project.sentences],
      ['phrase', project.phrasebook],
      ['doc', project.docs]
    ] as const)
      for (const record of list)
        if (effectiveFolder(record) === currentId)
          out.push({
            kind: recordKind,
            id: record.id,
            name: 'title' in record ? record.title : record.text,
            tags: record.tags ?? [],
            createdAt: record.createdAt,
            languageId: record.languageId,
            bytes:
              mode === 'details' && metadata.includes('size')
                ? new TextEncoder().encode(JSON.stringify(record)).length
                : 0
          })
    return out
  })
  function toggleBranch(id: string): void {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsed = next
  }
  let clipboardRef = $state<import('$lib/core/projectFolders').ProjectClipboardRef | null>(null)
  function clipboardEvent(event: ClipboardEvent, operation: 'copy' | 'cut' | 'paste'): void {
    if (compact || !clipboardRecordEventAllowed(event) || projectState.readOnly) return
    if (operation === 'paste') {
      void paste(currentId, rootView, event)
    } else if (clipboardRef) void copyProjectRecords(project, [clipboardRef], operation, event)
  }
  $effect(() => {
    void currentId
    void rootView
    void project.meta.id
    lz.reset()
    clipboardRef = null
  })
  let fileMenu = $state<{ ref: ProjectRecordRef; x: number; y: number } | null>(null)
  function fileContext(event: MouseEvent, ref: ProjectRecordRef): void {
    event.preventDefault()
    event.stopPropagation()
    menu = null
    fileMenu = {
      ref,
      x: event.clientX,
      y: event.clientY
    }
  }
  $effect(() => {
    void project.meta.id
    void currentId
    void rootView
    fileMenu = null
  })
  $effect(() => {
    if (!fileMenu) return
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') fileMenu = null
        return
      }
      if (event.target instanceof Element && event.target.closest('[data-directory-file-menu]'))
        return
      fileMenu = null
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
    }
  })
  function openFile(ref: ProjectRecordRef): void {
    const list =
      ref.kind === 'sentence'
        ? project.sentences
        : ref.kind === 'phrase'
          ? project.phrasebook
          : project.docs
    const record = list.find((item) => item.id === ref.id)
    if (!record) return
    ui.jump(
      ref.kind === 'sentence' ? 'corpus' : ref.kind === 'phrase' ? 'phrasebook' : 'docs',
      ref.kind,
      ref.id,
      record.languageId ?? undefined
    )
  }
  async function moveFile(ref: ProjectRecordRef): Promise<void> {
    if (projectState.readOnly) return
    const owner = project,
      target = await ui.choose(
        t('sharedFolders.move'),
        currentId,
        rows.map((row) => ({
          value: row.id,
          label:
            index
              .path(row.id)
              .map((folder) => folder.name)
              .join(' / ') || 'Default'
        }))
      )
    if (target === null || projectState.project !== owner || projectState.readOnly) return
    if (moveProjectRecords(owner, [ref], target)) projectState.touch()
  }
  function fileStart(event: DragEvent, ref: ProjectRecordRef): void {
    if (projectState.readOnly || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    const mime =
      ref.kind === 'sentence'
        ? 'text/x-qonlang-sentence'
        : ref.kind === 'phrase'
          ? 'text/x-qonlang-phrase'
          : 'text/x-qonlang-doc'
    event.dataTransfer.setData(mime, JSON.stringify({ projectId: project.meta.id, id: ref.id }))
    event.dataTransfer.effectAllowed = 'move'
  }
  const formats = $derived(
    kind === 'sentence' ? ['csv', 'json', 'leipzig', 'markdown', 'html', 'latex'] : ['csv', 'json']
  )
  $effect(() => {
    void project.meta.id
    void currentId
    void rootView
    menu = null
    over = null
    overRoot = false
  })
  $effect(() => {
    if (!menu) return
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') menu = null
        return
      }
      if (event.target instanceof Element && event.target.closest('[data-project-folder-menu]'))
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
  function context(event: MouseEvent, id: string | null, root?: boolean): void {
    event.preventDefault()
    event.stopPropagation()
    menu = {
      id,
      ...(root === undefined ? {} : { root }),
      x: event.clientX,
      y: event.clientY
    }
    fileMenu = null
  }
  async function create(parent: string): Promise<void> {
    if (projectState.readOnly) return
    const owner = project,
      name = await ui.prompt(t('sharedFolders.create'), '')
    if (name === null || owner !== projectState.project || projectState.readOnly) return
    if (createProjectFolder(owner, name, newId(), parent)) {
      projectState.touch()
      if (!parent && !rootView) onroot()
    } else ui.toast(t('sharedFolders.invalid'))
  }
  async function rename(id: string): Promise<void> {
    const folder = folders.find((item) => item.id === id)
    if (!folder || projectState.readOnly) return
    const owner = project,
      name = await ui.prompt(t('sharedFolders.rename'), folder.name)
    if (name === null || owner !== projectState.project || projectState.readOnly) return
    if (renameProjectFolder(owner, id, name)) projectState.touch()
    else ui.toast(t('sharedFolders.invalid'))
  }
  async function tags(id: string): Promise<void> {
    const folder = folders.find((item) => item.id === id)
    if (!folder || projectState.readOnly) return
    const owner = project,
      value = await ui.prompt(t('sharedFolders.tags'), (folder.tags ?? []).join(', '))
    if (value === null || owner !== projectState.project || projectState.readOnly) return
    const stored = ensureProjectFolders(owner).find((item) => item.id === id)
    if (stored) {
      stored.tags = value
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
      projectState.touch()
    }
  }
  async function remove(id: string): Promise<void> {
    if (!id || projectState.readOnly) return
    const owner = project
    if (
      !(await ui.confirm(
        t('sharedFolders.remove'),
        t('sharedFolders.removeHint'),
        t('common.delete')
      ))
    )
      return
    if (owner !== projectState.project || projectState.readOnly) return
    const tree = ensureProjectFolders(owner),
      at = tree.findIndex((folder) => folder.id === id)
    if (at < 0) return
    const old = $state.snapshot(tree[at]),
      parent = index.parent(id),
      children = tree
        .filter((folder) => index.parent(folder.id) === id)
        .map((folder) => ({ id: folder.id, name: folder.name }))
    const records: ProjectRecordRef[] = []
    for (const [kind, list] of [
      ['sentence', owner.sentences],
      ['phrase', owner.phrasebook],
      ['doc', owner.docs]
    ] as const)
      for (const record of list) if (record.folderId === id) records.push({ kind, id: record.id })
    if (!removeProjectFolder(owner, id)) return
    const after = new Map(projectFolders(owner).map((folder) => [folder.id, folder.name]))
    if (currentId === id) {
      if (parent) onbrowse(parent)
      else onroot()
    }
    projectState.touch()
    ui.toast(t('sharedFolders.removed'), {
      action: {
        label: t('common.undo'),
        run: () => {
          if (projectState.project !== owner || projectState.readOnly) return
          const tree = ensureProjectFolders(owner)
          if (tree.some((folder) => folder.id === id)) return
          const names = new Set(
            tree.filter((folder) => (folder.parentId ?? '') === parent).map((folder) => folder.name)
          )
          let restoredName = old.name,
            serial = 2
          while (names.has(restoredName) || (!parent && restoredName.toLowerCase() === 'default'))
            restoredName = `${old.name} (${serial++})`
          const restored = { ...old, name: restoredName }
          owner.folders = [...tree.slice(0, at), restored, ...tree.slice(at)]
          for (const child of owner.folders) {
            const before = children.find((item) => item.id === child.id)
            if (before && (child.parentId ?? '') === parent) {
              child.parentId = id
              if (child.name === after.get(child.id)) child.name = before.name
            }
          }
          const restore = records.filter((ref) => {
            const list =
              ref.kind === 'sentence'
                ? owner.sentences
                : ref.kind === 'phrase'
                  ? owner.phrasebook
                  : owner.docs
            const record = list.find((item) => item.id === ref.id)
            return record && projectFolderOf(owner, record) === parent
          })
          moveProjectRecords(owner, restore, id)
          projectState.touch()
        }
      }
    })
  }
  async function chooseMove(id: string): Promise<void> {
    if (projectState.readOnly) return
    const owner = project,
      targets = projectFolderMoveTargets(owner, id)
    const target = await ui.choose(
      t('sharedFolders.move'),
      '',
      rows
        .filter((row) => targets.has(row.id))
        .map((row) => ({
          value: row.id,
          label:
            index
              .path(row.id)
              .map((folder) => folder.name)
              .join(' / ') || t('sharedFolders.root')
        }))
    )
    if (target === null || owner !== projectState.project || projectState.readOnly) return
    if (moveProjectFolder(owner, id, target)) projectState.touch()
    else ui.toast(t('sharedFolders.invalid'))
  }
  function dragStart(event: DragEvent, id: string): void {
    if (!id || projectState.readOnly || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(
      'text/x-qonlang-project-folder',
      JSON.stringify({ projectId: project.meta.id, id })
    )
  }
  function dragOver(event: DragEvent, id: string, rootTarget = false): void {
    if (
      projectState.readOnly ||
      !event.dataTransfer ||
      ![...event.dataTransfer.types].some((type) => type.startsWith('text/x-qonlang-'))
    )
      return
    if (!id && !rootTarget && event.dataTransfer.types.includes('text/x-qonlang-project-folder'))
      return
    overRoot = rootTarget
    event.preventDefault()
    event.stopPropagation()
    over = id
  }
  function drop(event: DragEvent, id: string, rootTarget = false): void {
    over = null
    overRoot = false
    if (projectState.readOnly || !event.dataTransfer) return
    event.preventDefault()
    event.stopPropagation()
    for (const [mime, recordKind] of [
      ['text/x-qonlang-project-folder', null],
      ['text/x-qonlang-sentence', 'sentence'],
      ['text/x-qonlang-doc', 'doc'],
      ['text/x-qonlang-phrase', 'phrase']
    ] as const) {
      const raw = event.dataTransfer.getData(mime)
      if (!raw) continue
      try {
        const value = JSON.parse(raw)
        if (!value || value.projectId !== project.meta.id || typeof value.id !== 'string') return
        let changed: boolean | number
        if (recordKind) {
          const ids =
            Array.isArray(value.ids) && value.ids.every((key: unknown) => typeof key === 'string')
              ? value.ids
              : [value.id]
          changed = moveProjectRecords(
            project,
            ids.map((key: string) => ({ kind: recordKind, id: key })),
            id
          )
        } else {
          if (!id && !rootTarget) {
            ui.toast(t('sharedFolders.defaultHint'))
            return
          }
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
          changed =
            id && event.clientX < rect.left + rect.width * 0.2
              ? reorderProjectFolder(project, value.id, id)
              : moveProjectFolder(project, value.id, id)
        }
        if (changed) projectState.touch()
        else ui.toast(t('sharedFolders.invalid'))
      } catch {
        /* 外部或旧的拖动不改工程。 */
      }
      return
    }
  }
  function clipboard(id: string, mode: 'copy' | 'cut'): void {
    void copyProjectRecords(project, [{ kind: 'folder', id }], mode)
  }
  async function paste(id: string, rootTarget = false, event?: ClipboardEvent): Promise<void> {
    const owner = project,
      at = currentId,
      wasRoot = rootView
    const result = await pasteProjectRecords(
      owner,
      id,
      event,
      () => projectState.project === owner && currentId === at && rootView === wasRoot,
      { allowFolders: !!id || rootTarget }
    )
    if (result?.ok && rootTarget && result.refs.length && projectState.project === owner) {
      const wanted = new Map<ProjectRecordKind, Set<string>>()
      for (const ref of result.refs) {
        if (!wanted.has(ref.kind)) wanted.set(ref.kind, new Set())
        wanted.get(ref.kind)!.add(ref.id)
      }
      for (const [recordKind, list] of [
        ['sentence', owner.sentences],
        ['phrase', owner.phrasebook],
        ['doc', owner.docs]
      ] as const)
        if (list.some((record) => wanted.get(recordKind)?.has(record.id) && !record.folderId)) {
          onbrowse('')
          break
        }
    }
  }
  function removeFile(ref: ProjectRecordRef): void {
    if (projectState.readOnly) return
    const owner = project,
      key = ref.kind === 'sentence' ? 'sentences' : ref.kind === 'phrase' ? 'phrasebook' : 'docs',
      list = owner[key],
      at = list.findIndex((row) => row.id === ref.id)
    if (at < 0) return
    const saved = JSON.parse(JSON.stringify(list[at]))
    const label = 'title' in saved ? saved.title : saved.text
    ;(owner[key] as { id: string }[]) = (list as { id: string }[]).filter(
      (row) => row.id !== ref.id
    )
    projectState.touch()
    ui.toast(t('sharedFolders.removed', { name: label || '—' }), {
      action: {
        label: t('common.undo'),
        run: () => {
          if (
            projectState.project !== owner ||
            projectState.readOnly ||
            owner[key].some((row) => row.id === saved.id)
          )
            return
          ;(owner[key] as { id: string }[]).splice(Math.min(at, owner[key].length), 0, saved)
          projectState.touch()
        }
      }
    })
  }
</script>

<svelte:window
  ondragend={() => {
    over = null
    overRoot = false
  }}
/>
<svelte:document
  oncopy={(event) => clipboardEvent(event, 'copy')}
  oncut={(event) => clipboardEvent(event, 'cut')}
  onpaste={(event) => clipboardEvent(event, 'paste')}
/>
<section
  role="group"
  aria-label={t('sharedFolders.title')}
  class="directory"
  class:compact
  data-project-directory={kind}
  data-root-view={rootView}
  oncontextmenu={(event) => context(event, null)}
>
  {#if compact}
    <div class="tree-root-row">
      <button
        class="folder-open root-open"
        class:active={rootView}
        data-project-root-open
        class:root-drop={overRoot}
        oncontextmenu={(event) => context(event, null, true)}
        ondragover={(event) => dragOver(event, '', true)}
        ondragleave={() => {
          overRoot = false
          over = null
        }}
        ondrop={(event) => drop(event, '', true)}
        onclick={onroot}
        ><HardDrive size={18} /><strong>{t('sharedFolders.root')}</strong><span
          class="folder-count"
          title={t('sharedFolders.rootHint')}>{projection.rootCount}</span
        ></button
      ><span class="menu-slot"></span>
    </div>
  {:else}
    <div class="row toolbar">
      <h2 class="grow row">
        {#if rootView}<HardDrive size={21} />{:else}<Folder size={21} />{/if}<span
          class="directory-title"
          title={rootView
            ? t('sharedFolders.root')
            : currentId
              ? (projection.byId.get(currentId)?.name ?? 'Default')
              : 'Default'}
          >{rootView
            ? t('sharedFolders.root')
            : currentId
              ? (projection.byId.get(currentId)?.name ?? 'Default')
              : 'Default'}</span
        >
      </h2>
      <div class="seg">
        <button
          data-folder-view="icons"
          class:active={mode === 'icons'}
          title={t('sharedFolders.icons')}
          onclick={() => {
            if (!projectState.readOnly) {
              project.settings.folderView = 'icons'
              projectState.touch()
            }
          }}><LayoutGrid size={16} /></button
        ><button
          data-folder-view="details"
          class:active={mode === 'details'}
          title={t('sharedFolders.details')}
          onclick={() => {
            if (!projectState.readOnly) {
              project.settings.folderView = 'details'
              projectState.touch()
            }
          }}><List size={16} /></button
        >
      </div>
      <button
        class="btn sm"
        data-project-folder-create
        disabled={projectState.readOnly || (!rootView && !currentId)}
        title={!rootView && !currentId ? t('sharedFolders.defaultHint') : undefined}
        onclick={() => create(rootView ? '' : currentId)}
        ><FolderPlus size={15} />{t('sharedFolders.create')}</button
      >
    </div>
    <nav class="row crumbs" aria-label={t('sharedFolders.path')}>
      <button
        class="btn ghost sm"
        data-project-root-open
        class:root-drop={overRoot}
        oncontextmenu={(event) => context(event, null, true)}
        ondragover={(event) => dragOver(event, '', true)}
        ondragleave={() => {
          overRoot = false
          over = null
        }}
        ondrop={(event) => drop(event, '', true)}
        onclick={onroot}><HardDrive size={14} />{t('sharedFolders.root')}</button
      >
      {#if !rootView}{#if !currentId}<ChevronRight size={13} /><button
            class="btn ghost sm"
            data-project-breadcrumb=""
            onclick={() => onbrowse('')}>Default</button
          >{:else}{#each path as part (part.id)}<ChevronRight size={13} /><button
              class="btn ghost sm"
              data-project-breadcrumb={part.id}
              onclick={() => onbrowse(part.id)}>{part.name}</button
            >{/each}{/if}{/if}
      <span class="grow"></span>{#if !rootView}<button
          class="btn sm"
          data-project-parent
          onclick={() =>
            currentId && index.parent(currentId) ? onbrowse(index.parent(currentId)) : onroot()}
          ><ArrowUp size={14} />{t('sharedFolders.parent')}</button
        ><button class="btn sm" data-project-open-records onclick={() => onopen(currentId)}
          >{t(`sharedFolders.open.${kind}`)}</button
        >{/if}
    </nav>
  {/if}
  <div
    class="folder-grid"
    class:details={mode === 'details' && !compact}
    role="list"
    style:--detail-columns={detailColumns}
  >
    {#if !compact && mode === 'details'}<div class="detail-heading" role="listitem">
        <span></span><span>{t('common.name')}</span><span title={t('sharedFolders.countHint')}
          >{t('sharedFolders.count')}</span
        >{#each ['type', 'tags', 'createdAt', 'size'].filter( (key) => metadata.includes(key as 'type' | 'tags' | 'createdAt' | 'size') ) as key (key)}<span
            >{t(`sharedFolders.${key}`)}</span
          >{/each}<span></span>
      </div>{/if}
    {#each shown as folder (folder.id)}
      <div
        class="folder-row"
        role="listitem"
        class:over={!overRoot && over === folder.id}
        data-project-folder={folder.id}
        data-folder-depth={folder.depth}
        data-folder-total={folder.count}
        style:--depth={compact ? folder.depth + 1 : 0}
        onfocusin={() => (clipboardRef = folder.id ? { kind: 'folder', id: folder.id } : null)}
        draggable={!projectState.readOnly && !!folder.id}
        ondragstart={(event) => dragStart(event, folder.id)}
        ondragover={(event) => dragOver(event, folder.id)}
        ondragleave={() => (over = null)}
        ondrop={(event) => drop(event, folder.id)}
        oncontextmenu={(event) => context(event, folder.id)}
      >
        {#if compact}{#if folder.children}<button
              class="tree-fold"
              data-folder-branch={folder.id}
              aria-expanded={!collapsed.has(folder.id)}
              title={t(
                collapsed.has(folder.id)
                  ? 'sharedFolders.expandBranch'
                  : 'sharedFolders.collapseBranch'
              )}
              onclick={() => toggleBranch(folder.id)}
              >{#if collapsed.has(folder.id)}<ChevronRight size={13} />{:else}<ChevronDown
                  size={13}
                />{/if}</button
            >{:else}<span class="tree-fold-placeholder"></span>{/if}{/if}
        <button
          class="folder-open"
          data-project-folder-open={folder.id}
          class:active={!rootView && currentId === folder.id}
          onclick={() => onbrowse(folder.id)}
          ><Folder size={compact ? 17 : mode === 'details' ? 21 : 34} /><strong
            >{folder.name}</strong
          ><span
            class="folder-count"
            title={t(folder.default ? 'sharedFolders.defaultHint' : 'sharedFolders.countHint')}
            >{folder.count}</span
          >
          {#if !compact && mode === 'details'}{#if metadata.includes('type')}<span
                >{t('sharedFolders.folder')}</span
              >{/if}{#if metadata.includes('tags')}<span
                >{(folder.tags ?? []).join(', ') || '—'}</span
              >{/if}{#if metadata.includes('createdAt')}<time
                >{folder.createdAt ? new Date(folder.createdAt).toLocaleDateString() : '—'}</time
              >{/if}{#if metadata.includes('size')}<span title={t('sharedFolders.sizeHint')}
                >{(folder.bytes / 1024).toFixed(1)} KB</span
              >{/if}<span></span>{/if}
        </button><button
          class="btn ghost sm more"
          title={t('sharedFolders.actions')}
          onclick={(event) => context(event, folder.id)}><MoreHorizontal size={15} /></button
        >
      </div>
    {/each}
    {#if !compact}{#each files.slice(0, lz.shown) as file (JSON.stringify([file.kind, file.id]))}
        <div
          class="folder-row file-row"
          role="listitem"
          data-directory-file={file.id}
          data-directory-kind={file.kind}
          onfocusin={() => (clipboardRef = { kind: file.kind, id: file.id })}
          draggable={!projectState.readOnly}
          ondragstart={(event) => fileStart(event, file)}
          oncontextmenu={(event) => fileContext(event, file)}
        >
          <button class="folder-open" onclick={() => openFile(file)}
            >{#if file.kind === 'sentence'}<Quote
                size={mode === 'details' ? 21 : 32}
              />{:else if file.kind === 'phrase'}<MessageCircle
                size={mode === 'details' ? 21 : 32}
              />{:else}<FileText size={mode === 'details' ? 21 : 32} />{/if}<strong
              >{file.name || '—'}</strong
            >
            {#if mode === 'details'}<span>—</span>{#if metadata.includes('type')}<span
                  >{t(`sharedFolders.kinds.${file.kind}`)}</span
                >{/if}{#if metadata.includes('tags')}<span>{file.tags.join(', ') || '—'}</span
                >{/if}{#if metadata.includes('createdAt')}<time
                  >{file.createdAt ? new Date(file.createdAt).toLocaleDateString() : '—'}</time
                >{/if}{#if metadata.includes('size')}<span title={t('sharedFolders.sizeHint')}
                  >{(file.bytes / 1024).toFixed(1)} KB</span
                >{/if}{/if}<small
              >{project.languages.find((language) => language.id === file.languageId)?.abbr ??
                ''}</small
            >
          </button><button
            class="btn ghost sm more"
            title={t('sharedFolders.actions')}
            onclick={(event) => fileContext(event, file)}><MoreHorizontal size={15} /></button
          >
        </div>
      {/each}{#if files.length > lz.shown}<div use:lazyMore={lz}></div>{/if}{/if}
  </div>
  {#if !compact && !shown.length && !files.length}<p class="directory-empty muted">
      {t('sharedFolders.empty')}
    </p>{/if}
</section>
<ProjectDirectoryMenus
  {project}
  {currentId}
  {rootView}
  {kind}
  {formats}
  bind:recursive
  bind:menu
  bind:fileMenu
  {onroot}
  {onbrowse}
  {onopen}
  {create}
  {rename}
  {tags}
  {chooseMove}
  {clipboard}
  {paste}
  {onimport}
  {onexport}
  {remove}
  {openFile}
  {moveFile}
  {removeFile}
/>

<style>
  .directory {
    min-width: 0;
    padding: 8px;
    color: var(--text);
  }
  .directory :global(svg) {
    stroke-width: 1.5;
    flex: none;
  }
  .toolbar,
  .crumbs {
    flex-wrap: wrap;
    margin-block-end: 10px;
    gap: 8px;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
    font-weight: 600;
    min-width: 0;
    flex: 1 0 160px;
  }
  .directory-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 9px;
  }
  .folder-row {
    position: relative;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 8px);
    min-width: 0;
    background: var(--bg-elev);
    color: var(--text);
  }
  .folder-row:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }
  .root-drop {
    outline: 2px solid var(--accent);
    background: var(--accent-soft);
  }
  .folder-row.over {
    outline: 2px solid var(--accent);
    background: var(--accent-soft);
  }
  .folder-open {
    border: 0;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    width: 100%;
    display: flex;
    min-height: 106px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 7px;
    padding: 14px;
  }
  .folder-open :global(svg) {
    color: var(--accent);
  }
  .folder-open strong {
    overflow-wrap: anywhere;
    font-size: 0.9rem;
    font-weight: 500;
  }
  .folder-open.active {
    background: var(--accent-soft);
  }
  .folder-open:focus-visible,
  .tree-fold:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .folder-count {
    color: var(--text-3);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .more {
    position: absolute;
    inset-inline-end: 2px;
    inset-block-start: 2px;
    color: var(--text-2);
  }
  .details {
    grid-template-columns: 1fr;
    overflow-x: auto;
  }
  .details .folder-open,
  .detail-heading {
    display: grid;
    grid-template-columns: var(--detail-columns);
    align-items: center;
    min-height: 44px;
    gap: 12px;
    padding: 12px 34px 12px 14px;
    text-align: start;
  }
  .detail-heading {
    color: var(--text-2);
    font-size: 0.8rem;
  }
  .details .folder-open strong {
    min-width: 0;
  }
  .details span,
  .details time {
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .compact {
    padding: 4px;
  }
  .compact .folder-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .compact .folder-row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 24px;
    align-items: center;
    border: 0;
    border-radius: var(--radius-sm, 5px);
    margin: 0;
    padding-inline-start: calc(var(--depth) * 16px);
    background: transparent;
  }
  .compact .folder-row:hover {
    background: var(--bg-hover);
  }
  .compact .folder-open,
  .tree-root-row .folder-open {
    min-height: 32px;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    justify-content: start;
    padding: 5px 4px;
    gap: 6px;
    text-align: start;
    border-radius: var(--radius-sm, 5px);
  }
  .compact .folder-open strong {
    font-size: 0.82rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    overflow-wrap: normal;
  }
  .compact .more {
    position: static;
    width: 24px;
    padding: 4px;
  }
  .tree-fold,
  .tree-fold-placeholder {
    width: 18px;
    height: 24px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 0;
    color: var(--text-2);
    padding: 0;
  }
  .tree-fold {
    cursor: pointer;
  }
  .tree-root-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 24px;
    align-items: center;
    margin-block-end: 3px;
  }
  .tree-root-row strong {
    font-weight: 600;
  }
  .menu-slot {
    width: 24px;
  }
  .directory-empty {
    padding: 12px;
    font-size: 0.85rem;
  }
</style>
