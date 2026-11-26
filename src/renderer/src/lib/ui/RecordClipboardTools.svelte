<script lang="ts">
  import type { Project, Id } from '$lib/core/model'
  import type { RecordClipboardKind } from '$lib/core/recordClipboard'
  import type { ProjectRecordKind } from '$lib/core/projectFolders'
  import {
    clipboardRecordEventAllowed,
    copyRecords,
    pasteRecords,
    copyProjectRecords,
    pasteProjectRecords
  } from '$lib/state/recordClipboard.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { Copy, Scissors, ClipboardPaste } from '@lucide/svelte'
  let {
    project,
    kind,
    ids,
    targetLanguageId = null,
    folderId = '',
    enabled = true,
    onpasted = () => {},
    onconfirm
  }: {
    project: Project
    kind: RecordClipboardKind | ProjectRecordKind
    ids: Id[]
    targetLanguageId?: Id | null
    folderId?: Id
    enabled?: boolean
    onpasted?: (ids: Id[]) => void
    onconfirm?: () => void
  } = $props()
  const writable = $derived(enabled && projectState.project === project && !projectState.readOnly)
  async function copy(mode: 'copy' | 'cut', event?: ClipboardEvent): Promise<void> {
    if (!writable || !ids.length) return
    if (kind === 'sentence' || kind === 'phrase' || kind === 'doc')
      await copyProjectRecords(
        project,
        ids.map((id) => ({ kind: kind as ProjectRecordKind, id })),
        mode,
        event
      )
    else await copyRecords(project, kind, ids, mode, event)
  }
  async function paste(event?: ClipboardEvent): Promise<void> {
    if (!writable) return
    const owner = project
    const targetKind = kind,
      targetFolder = folderId,
      targetLanguage = targetLanguageId
    const stillValid = (): boolean =>
      writable &&
      project === owner &&
      kind === targetKind &&
      folderId === targetFolder &&
      targetLanguageId === targetLanguage
    if (kind === 'sentence' || kind === 'phrase' || kind === 'doc') {
      const result = await pasteProjectRecords(owner, folderId, event, stillValid)
      if (result?.ok && projectState.project === owner)
        onpasted(result.refs.filter((r) => r.kind === kind).map((r) => r.id))
    } else {
      const result = await pasteRecords(owner, kind, targetLanguageId, event, stillValid)
      if (result?.ok && projectState.project === owner) onpasted(result.ids)
    }
  }
  function eventCopy(e: ClipboardEvent, mode: 'copy' | 'cut'): void {
    if (clipboardRecordEventAllowed(e)) void copy(mode, e)
  }
</script>

<svelte:document
  onkeydowncapture={(e) => {
    if (
      onconfirm &&
      writable &&
      ids.length &&
      (e.ctrlKey || e.metaKey) &&
      e.key === 'Enter' &&
      clipboardRecordEventAllowed(e)
    ) {
      e.preventDefault()
      e.stopPropagation()
      onconfirm()
    }
  }}
  oncopy={(e) => eventCopy(e, 'copy')}
  oncut={(e) => eventCopy(e, 'cut')}
  onpaste={(e) => {
    if (clipboardRecordEventAllowed(e)) void paste(e)
  }}
/>
<span class="clipboard-tools" data-record-clipboard={kind}>
  <button
    class="btn ghost sm"
    data-record-copy
    disabled={!writable || !ids.length}
    title="Ctrl/⌘+C"
    onclick={() => void copy('copy')}><Copy size={13} />{t('clipboard.copy')}</button
  >
  <button
    class="btn ghost sm"
    data-record-cut
    disabled={!writable || !ids.length}
    title="Ctrl/⌘+X"
    onclick={() => void copy('cut')}><Scissors size={13} />{t('clipboard.cut')}</button
  >
  <button
    class="btn ghost sm"
    data-record-paste
    disabled={!writable}
    title="Ctrl/⌘+V"
    onclick={() => void paste()}><ClipboardPaste size={13} />{t('clipboard.paste')}</button
  >
</span>

<style>
  .clipboard-tools {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    max-width: 100%;
  }
</style>
