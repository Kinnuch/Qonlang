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
    MessageCircle
  } from '@lucide/svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { newId } from '$lib/core/factory'
  import {
    projectFolders,
    ensureProjectFolders,
    projectFolderPath,
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
    forceExpanded = false,
    onbrowse,
    onopen,
    onimport,
    onexport
  }: {
    kind: ProjectRecordKind
    currentId?: string
    compact?: boolean
    forceExpanded?: boolean
    onbrowse: (id: string) => void
    onopen: (id: string) => void
    onimport?: (id: string, json: boolean) => void
    onexport?: (id: string | null, format: string, recursive: boolean) => void
  } = $props()
  const project = $derived(projectState.project!)
  const folders = $derived(projectFolders(project))
  const lz = lazy(80)
  const index = $derived(createFolderIndex(folders))
  const path = $derived(projectFolderPath(project, currentId))
  const metadata = $derived(project.settings.folderMetadata ?? ['tags', 'createdAt', 'size'])
  const mode = $derived(project.settings.folderView ?? 'icons')
  const detailColumns = $derived(
    '28px minmax(150px,1fr) 48px ' +
      ['type', 'tags', 'createdAt', 'size']
        .filter((key) => metadata.includes(key as 'type' | 'tags' | 'createdAt' | 'size'))
        .map(() => 'minmax(80px,auto)')
        .join(' ') +
      ' 40px'
  )
  let expanded = $state(false),
    menu = $state<{ id: string | null; x: number; y: number } | null>(null),
    recursive = $state(true),
    over = $state<string | null>(null)
  const rows = $derived.by(() => {
    const out = [
      {
        id: '',
        name: 'Default',
        parentId: '',
        tags: [] as string[],
        createdAt: undefined as string | undefined,
        depth: 0
      }
    ]
    const queue = [...(index.children.get('') ?? [])]
      .reverse()
      .map((folder) => ({ folder, depth: 0 }))
    while (queue.length) {
      const { folder, depth } = queue.pop()!
      out.push({
        ...folder,
        parentId: index.parent(folder.id),
        tags: folder.tags ?? [],
        createdAt: folder.createdAt,
        depth
      })
      for (const child of [...(index.children.get(folder.id) ?? [])].reverse())
        queue.push({ folder: child, depth: depth + 1 })
    }
    return out
  })
  const shown = $derived(
    compact ? rows : rows.filter((row) => (row.id ? row.parentId === currentId : !currentId))
  )
  const effectiveFolder = (record: { folderId?: string }): string =>
    project.folders !== undefined
      ? index.has(record.folderId ?? '')
        ? (record.folderId ?? '')
        : ''
      : projectFolderOf(project, record)
  const counts = $derived.by(() => {
    const result = new Map<string, { count: number; bytes: number }>()
    for (const item of [...project.sentences, ...project.phrasebook, ...project.docs]) {
      const id = effectiveFolder(item),
        old = result.get(id) ?? { count: 0, bytes: 0 }
      old.count++
      if (!compact && mode === 'details' && metadata.includes('size'))
        old.bytes += new TextEncoder().encode(JSON.stringify(item)).length
      result.set(id, old)
    }
    return result
  })
  const files = $derived.by(() => {
    if (compact) return []
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
              !compact && mode === 'details' && metadata.includes('size')
                ? new TextEncoder().encode(JSON.stringify(record)).length
                : 0
          })
    return out
  })
  let clipboardRef = $state<import('$lib/core/projectFolders').ProjectClipboardRef | null>(null)
  function clipboardEvent(event: ClipboardEvent, operation: 'copy' | 'cut' | 'paste'): void {
    if (compact || !clipboardRecordEventAllowed(event) || projectState.readOnly) return
    if (operation === 'paste') {
      const owner = project,
        at = currentId
      void pasteProjectRecords(
        owner,
        at,
        event,
        () => projectState.project === owner && currentId === at
      )
    } else if (clipboardRef) void copyProjectRecords(project, [clipboardRef], operation, event)
  }
  $effect(() => {
    void currentId
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
      x: Math.max(8, Math.min(innerWidth - 250, event.clientX)),
      y: Math.max(8, Math.min(innerHeight - 270, event.clientY))
    }
  }
  $effect(() => {
    void project.meta.id
    void currentId
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
    menu = null
    over = null
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
  function context(event: MouseEvent, id: string | null): void {
    event.preventDefault()
    event.stopPropagation()
    menu = {
      id,
      x: Math.max(8, Math.min(innerWidth - 260, event.clientX)),
      y: Math.max(8, Math.min(innerHeight - 470, event.clientY))
    }
    recursive = true
    fileMenu = null
  }
  function run(action: () => unknown): void {
    action()
    menu = null
  }
  async function create(parent: string): Promise<void> {
    if (projectState.readOnly) return
    const owner = project,
      name = await ui.prompt(t('sharedFolders.create'), '')
    if (name === null || owner !== projectState.project || projectState.readOnly) return
    if (createProjectFolder(owner, name, newId(), parent)) projectState.touch()
    else ui.toast(t('sharedFolders.invalid'))
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
    if (currentId === id) onbrowse(parent)
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
              .join(' / ') || 'Default'
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
  function dragOver(event: DragEvent, id: string): void {
    if (
      projectState.readOnly ||
      !event.dataTransfer ||
      ![...event.dataTransfer.types].some((type) => type.startsWith('text/x-qonlang-'))
    )
      return
    event.preventDefault()
    event.stopPropagation()
    over = id
  }
  function drop(event: DragEvent, id: string): void {
    over = null
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
  function paste(id: string): void {
    const owner = project,
      at = currentId
    void pasteProjectRecords(
      owner,
      id,
      undefined,
      () => projectState.project === owner && currentId === at
    )
  }
  function portal(node: HTMLElement): { destroy(): void } {
    document.body.append(node)
    return { destroy: () => node.remove() }
  }
</script>

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
  oncontextmenu={(event) => context(event, null)}
  ondragenter={(event) => {
    if (
      event.dataTransfer &&
      [...event.dataTransfer.types].some((type) => type.startsWith('text/x-qonlang-'))
    )
      expanded = true
  }}
>
  {#if compact}
    <button
      class="btn ghost tree-toggle"
      data-folder-sidebar-toggle
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
      >{#if expanded}<ChevronDown size={15} />{:else}<ChevronRight size={15} />{/if}<Folder
        size={16}
      />{t('sharedFolders.title')}</button
    >
  {:else}
    <div class="row toolbar">
      <h2 class="grow">{t('sharedFolders.title')}</h2>
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
        disabled={projectState.readOnly}
        onclick={() => create(currentId)}
        ><FolderPlus size={15} />{t('sharedFolders.create')}</button
      >
    </div>
    <nav class="row crumbs" aria-label={t('sharedFolders.path')}>
      <button class="btn ghost sm" data-project-breadcrumb="" onclick={() => onbrowse('')}
        >Default</button
      >{#each path as part (part.id)}<ChevronRight size={13} /><button
          class="btn ghost sm"
          data-project-breadcrumb={part.id}
          onclick={() => onbrowse(part.id)}>{part.name}</button
        >{/each}<span class="grow"></span>{#if currentId}<button
          class="btn sm"
          onclick={() => onbrowse(index.parent(currentId))}
          ><ArrowUp size={14} />{t('sharedFolders.parent')}</button
        >{/if}<button class="btn sm" data-project-open-records onclick={() => onopen(currentId)}
        >{t(`sharedFolders.open.${kind}`)}</button
      >
    </nav>
  {/if}
  {#if !compact || expanded || forceExpanded}
    <div
      class="folder-grid"
      class:details={mode === 'details' && !compact}
      style:--detail-columns={detailColumns}
      role="list"
    >
      {#if !compact && mode === 'details'}<div class="detail-heading" role="listitem">
          <span></span><span>{t('common.name')}</span><span title={t('sharedFolders.count')}
            >{t('sharedFolders.count')}</span
          >{#each ['type', 'tags', 'createdAt', 'size'].filter( (key) => metadata.includes(key as 'type' | 'tags' | 'createdAt' | 'size') ) as key (key)}<span
              >{t(`sharedFolders.${key}`)}</span
            >{/each}<span></span>
        </div>{/if}
      {#each shown as folder (folder.id)}
        <div
          class="folder-row"
          role="listitem"
          class:over={over === folder.id}
          data-project-folder={folder.id}
          onfocusin={() => (clipboardRef = folder.id ? { kind: 'folder', id: folder.id } : null)}
          style:--depth={compact ? folder.depth : 0}
          draggable={!projectState.readOnly && !!folder.id}
          ondragstart={(event) => dragStart(event, folder.id)}
          ondragover={(event) => dragOver(event, folder.id)}
          ondragleave={() => (over = null)}
          ondrop={(event) => drop(event, folder.id)}
          oncontextmenu={(event) => context(event, folder.id)}
        >
          <button
            class="folder-open"
            data-project-folder-open={folder.id}
            class:active={currentId === folder.id}
            onclick={() => (folder.id ? onbrowse(folder.id) : onopen(''))}
            ><Folder size={compact ? 18 : mode === 'details' ? 24 : 44} /><strong
              >{folder.name}</strong
            ><span class="small muted">{counts.get(folder.id)?.count ?? 0}</span>
            {#if !compact && mode === 'details'}{#if metadata.includes('type')}<span
                  >{t('sharedFolders.folder')}</span
                >{/if}{#if metadata.includes('tags')}<span>{folder.tags.join(', ') || '—'}</span
                >{/if}{#if metadata.includes('createdAt')}<time
                  >{folder.createdAt ? new Date(folder.createdAt).toLocaleDateString() : '—'}</time
                >{/if}{#if metadata.includes('size')}<span title={t('sharedFolders.sizeHint')}
                  >{((counts.get(folder.id)?.bytes ?? 0) / 1024).toFixed(1)} KB</span
                >{/if}<span></span>{/if}
          </button><button
            class="btn ghost sm more"
            title={t('sharedFolders.actions')}
            onclick={(event) => context(event, folder.id)}><MoreHorizontal size={16} /></button
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
                  size={mode === 'details' ? 24 : 40}
                />{:else if file.kind === 'phrase'}<MessageCircle
                  size={mode === 'details' ? 24 : 40}
                />{:else}<FileText size={mode === 'details' ? 24 : 40} />{/if}<strong
                >{file.name || '—'}</strong
              >
              {#if mode === 'details'}<span>—</span>{#if metadata.includes('type')}<span
                    >{t(`sharedFolders.kinds.${file.kind}`)}</span
                  >{/if}{#if metadata.includes('tags')}<span>{file.tags.join(', ') || '—'}</span
                  >{/if}{#if metadata.includes('createdAt')}<time
                    >{file.createdAt ? new Date(file.createdAt).toLocaleDateString() : '—'}</time
                  >{/if}{#if metadata.includes('size')}<span title={t('sharedFolders.sizeHint')}
                    >{(file.bytes / 1024).toFixed(1)} KB</span
                  >{/if}{/if}
              <small
                >{project.languages.find((language) => language.id === file.languageId)?.abbr ??
                  ''}</small
              >
            </button><button
              class="btn ghost sm more"
              title={t('sharedFolders.actions')}
              onclick={(event) => fileContext(event, file)}><MoreHorizontal size={16} /></button
            >
          </div>
        {/each}{#if files.length > lz.shown}<div use:lazyMore={lz}></div>{/if}{/if}
    </div>
  {/if}
</section>
{#if menu}{@const target = menu.id ?? currentId}
  <div
    class="folder-menu card"
    data-project-folder-menu
    style:left={`${menu.x}px`}
    style:top={`${menu.y}px`}
    use:portal
  >
    <button onclick={() => run(() => onbrowse(target))}>{t('sharedFolders.browse')}</button>
    <button onclick={() => run(() => onopen(target))}>{t(`sharedFolders.open.${kind}`)}</button>
    <button disabled={projectState.readOnly} onclick={() => run(() => create(target))}
      >{t('sharedFolders.create')}</button
    >
    {#if target}<button disabled={projectState.readOnly} onclick={() => run(() => rename(target))}
        >{t('sharedFolders.rename')}</button
      ><button disabled={projectState.readOnly} onclick={() => run(() => tags(target))}
        >{t('sharedFolders.tags')}</button
      ><button disabled={projectState.readOnly} onclick={() => run(() => chooseMove(target))}
        >{t('sharedFolders.move')}</button
      ><button
        disabled={projectState.readOnly}
        title={t('clipboard.scope')}
        onclick={() => run(() => clipboard(target, 'copy'))}>{t('sharedFolders.copy')}</button
      ><button disabled={projectState.readOnly} onclick={() => run(() => clipboard(target, 'cut'))}
        >{t('sharedFolders.cut')}</button
      >{/if}
    <button disabled={projectState.readOnly} onclick={() => run(() => paste(target))}
      >{t('sharedFolders.paste')}</button
    >
    {#if onimport}<button
        disabled={projectState.readOnly}
        onclick={() => run(() => onimport?.(target, false))}>{t('io.importTable')}</button
      ><button disabled={projectState.readOnly} onclick={() => run(() => onimport?.(target, true))}
        >{t('io.importJson')}</button
      >{/if}
    {#if onexport}<label class="check"
        ><input type="checkbox" bind:checked={recursive} />{t(
          'sharedFolders.includeChildren'
        )}</label
      >{#each formats as format (format)}<button
          disabled={projectState.readOnly}
          onclick={() =>
            run(() =>
              onexport?.(menu?.id === null && !currentId ? null : target, format, recursive)
            )}>{t('common.export')} {format.toUpperCase()}</button
        >{/each}{/if}
    {#if target}<button
        class="danger"
        disabled={projectState.readOnly}
        onclick={() => run(() => remove(target))}>{t('sharedFolders.remove')}</button
      >{/if}
  </div>{/if}

{#if fileMenu}{@const ref = fileMenu.ref}
  <div
    class="folder-menu card"
    data-directory-file-menu
    style:left={`${fileMenu.x}px`}
    style:top={`${fileMenu.y}px`}
    use:portal
  >
    <button
      onclick={() => {
        const picked = ref
        fileMenu = null
        openFile(picked)
      }}>{t('sharedFolders.openFile')}</button
    >
    <button
      onclick={() => {
        const picked = ref
        fileMenu = null
        void copyProjectRecords(project, [picked], 'copy')
      }}>{t('sharedFolders.copy')}</button
    >
    <button
      disabled={projectState.readOnly}
      onclick={() => {
        const picked = ref
        fileMenu = null
        void copyProjectRecords(project, [picked], 'cut')
      }}>{t('sharedFolders.cut')}</button
    >
    <button
      disabled={projectState.readOnly}
      onclick={() => {
        const picked = ref
        fileMenu = null
        void moveFile(picked)
      }}>{t('sharedFolders.move')}</button
    >
    <button
      disabled={projectState.readOnly}
      onclick={() => {
        fileMenu = null
        paste(currentId)
      }}>{t('sharedFolders.paste')}</button
    >
  </div>{/if}

<style>
  .directory {
    min-width: 0;
    padding: 8px;
  }
  .toolbar,
  .crumbs {
    flex-wrap: wrap;
    margin-block-end: 10px;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .tree-toggle {
    width: 100%;
    justify-content: start;
  }
  .folder-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 9px;
  }
  .folder-row {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 8px;
    min-width: 0;
  }
  .folder-row.over {
    outline: 2px solid var(--accent);
    background: var(--accent-soft);
  }
  .folder-open {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    width: 100%;
    display: flex;
    min-height: 116px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
  }
  .folder-open strong {
    overflow-wrap: anywhere;
  }
  .more {
    position: absolute;
    inset-inline-end: 1px;
    inset-block-start: 1px;
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
    color: var(--muted);
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
  .compact .folder-grid {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .compact .folder-row {
    border: 0;
    margin-inline-start: calc(var(--depth) * 12px);
  }
  .compact .folder-open {
    min-height: 30px;
    flex-direction: row;
    justify-content: start;
    padding: 5px 28px 5px 5px;
    gap: 6px;
    text-align: start;
  }
  .compact .folder-open strong {
    flex: 1;
    font-weight: 500;
    font-size: 0.85rem;
  }
  .folder-menu {
    position: fixed;
    z-index: 1400;
    width: 250px;
    max-height: calc(100vh - 20px);
    overflow: auto;
    padding: 5px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 6px 25px #0003;
  }
  .folder-menu button {
    background: transparent;
    border: 0;
    color: inherit;
    padding: 6px 10px;
    text-align: start;
    cursor: pointer;
  }
  .folder-menu button:hover {
    background: var(--hover);
  }
  .folder-menu button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .folder-menu .danger {
    color: var(--danger);
  }
</style>
