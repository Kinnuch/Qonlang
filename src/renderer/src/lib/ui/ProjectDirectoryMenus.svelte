<script lang="ts">
  import type { Project, Id } from '$lib/core/model'
  import type { ProjectRecordRef, ProjectRecordKind } from '$lib/core/projectFolders'
  import { projectState } from '$lib/state/project.svelte'
  import { copyProjectRecords } from '$lib/state/recordClipboard.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import { completeContextActions, type ContextAction } from './contextActions'
  let {
    project,
    currentId,
    rootView,
    kind,
    formats,
    recursive = $bindable(true),
    menu = $bindable(null),
    fileMenu = $bindable(null),
    onroot,
    onbrowse,
    onopen,
    create,
    rename,
    tags,
    chooseMove,
    clipboard,
    paste,
    onimport,
    onexport,
    remove,
    openFile,
    moveFile,
    removeFile
  }: {
    project: Project
    currentId: Id
    rootView: boolean
    kind: ProjectRecordKind
    formats: string[]
    recursive?: boolean
    menu?: { id: string | null; x: number; y: number; root?: boolean } | null
    fileMenu?: { ref: ProjectRecordRef; x: number; y: number } | null
    onroot: () => void
    onbrowse: (id: Id) => void
    onopen: (id: Id) => void
    create: (id: Id) => unknown
    rename: (id: Id) => unknown
    tags: (id: Id) => unknown
    chooseMove: (id: Id) => unknown
    clipboard: (id: Id, mode: 'copy' | 'cut') => unknown
    paste: (id: Id, root?: boolean) => unknown
    onimport?: (id: Id, json: boolean) => unknown
    onexport?: (id: Id | null, format: string, recursive: boolean) => unknown
    remove: (id: Id) => unknown
    openFile: (ref: ProjectRecordRef) => unknown
    moveFile: (ref: ProjectRecordRef) => unknown
    removeFile: (ref: ProjectRecordRef) => unknown
  } = $props()
  function folderActions(context: NonNullable<typeof menu>): ContextAction[] {
    const owner = project,
      at = currentId,
      atRoot = rootView,
      root = context.root ?? (context.id === null && rootView),
      target = context.id ?? (root ? '' : currentId)
    const valid = (): boolean =>
      projectState.project === owner && project === owner && currentId === at && rootView === atRoot
    const run =
      (fn: () => unknown, writable = false): (() => void) =>
      () => {
        if (valid() && (!writable || !projectState.readOnly)) void fn()
      }
    const items: ContextAction[] = [
      {
        id: 'browse',
        label: t('sharedFolders.browse'),
        run: run(() => (root ? onroot() : onbrowse(target)))
      },
      { id: 'open', label: t(`sharedFolders.open.${kind}`), run: run(() => onopen(target)) },
      {
        id: 'create',
        label: t('sharedFolders.create'),
        enabled: !projectState.readOnly && (root || !!target),
        run: run(() => create(target), true)
      }
    ]
    if (target)
      items.push(
        {
          id: 'rename',
          label: t('sharedFolders.rename'),
          shortcut: 'F2',
          enabled: !projectState.readOnly,
          run: run(() => rename(target), true)
        },
        {
          id: 'tags',
          label: t('sharedFolders.tags'),
          enabled: !projectState.readOnly,
          run: run(() => tags(target), true)
        },
        {
          id: 'move',
          label: t('sharedFolders.move'),
          enabled: !projectState.readOnly,
          run: run(() => chooseMove(target), true)
        },
        {
          id: 'copy',
          label: t('clipboard.copy'),
          shortcut: 'CmdOrCtrl+C',
          enabled: !projectState.readOnly,
          run: run(() => clipboard(target, 'copy'), true)
        },
        {
          id: 'cut',
          label: t('clipboard.cut'),
          shortcut: 'CmdOrCtrl+X',
          enabled: !projectState.readOnly,
          run: run(() => clipboard(target, 'cut'), true)
        }
      )
    items.push({
      id: 'paste',
      label: t('clipboard.paste'),
      shortcut: 'CmdOrCtrl+V',
      enabled: !projectState.readOnly,
      run: run(() => paste(target, root), true)
    })
    if (onimport)
      items.push(
        {
          id: 'import-table',
          label: t('io.importTable'),
          enabled: !projectState.readOnly,
          run: run(() => onimport?.(target, false), true)
        },
        {
          id: 'import-json',
          label: t('io.importJson'),
          enabled: !projectState.readOnly,
          run: run(() => onimport?.(target, true), true)
        }
      )
    if (onexport) {
      if (!root && target)
        items.push({
          id: 'recursive',
          label: t('sharedFolders.includeChildren'),
          type: 'checkbox',
          checked: recursive,
          run: () => (recursive = !recursive)
        })
      for (const format of formats)
        items.push({
          id: 'export:' + format,
          label: t('common.export') + ' ' + format.toUpperCase(),
          enabled: !projectState.readOnly,
          run: run(
            () =>
              onexport?.(root ? null : target, format, root ? true : target ? recursive : false),
            true
          )
        })
    }
    return completeContextActions(
      items,
      target
        ? {
            id: 'delete',
            label: t('sharedFolders.remove'),
            shortcut: 'Delete',
            enabled: !projectState.readOnly,
            danger: true,
            run: run(() => remove(target), true)
          }
        : undefined
    )
  }
  function fileActions(context: NonNullable<typeof fileMenu>): ContextAction[] {
    const owner = project,
      at = currentId,
      atRoot = rootView,
      ref = context.ref
    const valid = (): boolean =>
      projectState.project === owner && project === owner && currentId === at && rootView === atRoot
    const run =
      (fn: () => unknown, writable = false): (() => void) =>
      () => {
        if (valid() && (!writable || !projectState.readOnly)) void fn()
      }
    return completeContextActions(
      [
        {
          id: 'open',
          label: t('sharedFolders.openFile'),
          shortcut: 'Enter',
          run: run(() => openFile(ref))
        },
        {
          id: 'copy',
          label: t('clipboard.copy'),
          shortcut: 'CmdOrCtrl+C',
          enabled: !projectState.readOnly,
          run: run(() => copyProjectRecords(owner, [ref], 'copy'), true)
        },
        {
          id: 'cut',
          label: t('clipboard.cut'),
          shortcut: 'CmdOrCtrl+X',
          enabled: !projectState.readOnly,
          run: run(() => copyProjectRecords(owner, [ref], 'cut'), true)
        },
        {
          id: 'move',
          label: t('sharedFolders.move'),
          enabled: !projectState.readOnly,
          run: run(() => moveFile(ref), true)
        },
        {
          id: 'paste',
          label: t('clipboard.paste'),
          shortcut: 'CmdOrCtrl+V',
          enabled: !projectState.readOnly,
          run: run(() => paste(at), true)
        }
      ],
      {
        id: 'delete',
        label: t('common.delete'),
        shortcut: 'Delete',
        enabled: !projectState.readOnly,
        danger: true,
        run: run(() => removeFile(ref), true)
      }
    )
  }
</script>

{#if menu}{#key menu}<ContextMenu
      mark="folder"
      x={menu.x}
      y={menu.y}
      items={folderActions(menu)}
      onclose={() => (menu = null)}
    />{/key}{/if}
{#if fileMenu}{#key fileMenu}<ContextMenu
      mark="file"
      x={fileMenu.x}
      y={fileMenu.y}
      items={fileActions(fileMenu)}
      onclose={() => (fileMenu = null)}
    />{/key}{/if}
