<script lang="ts">
  import { deletable } from '$lib/ui/deletable'
  import type { PageView } from '$lib/state/ui.svelte'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  /** 文档页：项目内 Markdown / HTML 页面，编辑 / 分栏 / 预览，[[…]] 链到项目里的各种东西。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui, type Section } from '$lib/state/ui.svelte'
  import { platform } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import { createDoc, now } from '$lib/core/factory'
  import type { MdLink } from '$lib/core/markdown'
  import {
    documentFormat,
    renderDocument,
    documentHtmlPage,
    documentMarkdown
  } from '$lib/core/documentFormat'
  import { tick } from 'svelte'
  import { flashOn } from '$lib/ui/flash'
  import { hasSentenceTextMention } from '$lib/core/docReferences'
  import { docLink, DOC_LINK_TARGET, type DocLinkKind } from '$lib/core/docLinks'
  import type { DocPage, Id, Project } from '$lib/core/model'
  import { docFolderOf, docFoldersFor, validDocFolder, moveDocs } from '$lib/core/docFolders'
  import { DOC_PAGE_DRAG } from '$lib/ui/DocFolders.svelte'
  import RecordClipboardTools from '$lib/ui/RecordClipboardTools.svelte'
  import ProjectDirectory from '$lib/ui/ProjectDirectory.svelte'
  import { copyProjectRecords, pasteProjectRecords } from '$lib/state/recordClipboard.svelte'
  import Portal from '$lib/ui/Portal.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import DocLinkPicker from '$lib/ui/DocLinkPicker.svelte'
  import { Plus, Trash2, Upload, Eye, Pencil, Columns2, FileText, Link } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const langId = $derived(projectState.currentLanguageId)
  /** 回到这一页时接着看上次那篇文档、上次的视图 */
  const memo = ui.memo<{
    lang: Id | null
    selectedId: Id | null
    view: 'edit' | 'split' | 'preview'
    folderId: Id
    folderView: boolean
    directoryRoot: boolean
    sidebarOpen: boolean
  }>('docs')
  let selectedId = $state<Id | null>(
    memo.lang === projectState.currentLanguageId ? (memo.selectedId ?? null) : null
  )
  // 打开文档页默认看预览；新建文档时自动切到编辑
  let view = $state<'edit' | 'split' | 'preview'>(memo.view ?? 'preview')
  let folderId = $state<Id>(memo.folderId ?? '')
  let folderView = $state(memo.folderView ?? false)
  let directoryRoot = $state(memo.directoryRoot ?? false)
  let sidebarOpen = $state(memo.sidebarOpen ?? false)
  const folders = $derived(docFoldersFor(project, langId))
  const folderPaths = $derived(new Map(folders.map((folder) => [folder.id, folder.path])))
  const folderIds = $derived(new Set(folders.map((folder) => folder.id)))
  const folderOf = (doc: Pick<DocPage, 'folderId'>): Id =>
    doc.folderId && folderIds.has(doc.folderId) ? doc.folderId : ''

  const list = $derived.by(() => {
    const pq = parseQuery(ui.search, SEARCH_FIELDS.docs)
    return project.docs.filter(
      (d) =>
        (ui.search.trim() || folderOf(d) === folderId) &&
        (!langId || d.languageId === langId || d.languageId === null) &&
        matchQuery(pq, (f) =>
          f === 'title' ? [d.title] : f === 'body' ? [d.markdown] : [d.title, d.markdown]
        )
    )
  })
  const selected = $derived(project.docs.find((d) => d.id === selectedId) ?? null)
  const allDocTags = $derived([...new Set(project.docs.flatMap((doc) => doc.tags ?? []))].sort())
  $effect(() => {
    if (!validDocFolder(project, folderId)) folderId = ''
    if (selected && langId && selected.languageId && selected.languageId !== langId)
      selectedId = null
  })
  function pick(d: DocPage): void {
    folderId = folderOf(d)
    selectedId = d.id
    folderView = false
    directoryRoot = false
  }
  function openFolder(id: Id): void {
    if (!validDocFolder(project, id)) return
    folderId = id
    folderView = false
    directoryRoot = false
    ui.search = ''
    if (selected && folderOf(selected) !== id) selectedId = null
  }
  function browseFolder(id: Id): void {
    openFolder(id)
    selectedId = null
    folderView = true
  }
  function browseRoot(): void {
    openFolder('')
    selectedId = null
    folderView = true
    directoryRoot = true
  }
  /** 这几类用数据字体（词头、语素形式这些） */
  const DATA_KINDS = new Set<DocLinkKind>(['lexeme', 'morpheme', 'sentence', 'phrase'])
  /** `[[…]]`：找得到就画成能点的链接，找不到画成「没找到」的样子，悬浮说清楚缺的是哪一类 */
  function resolveLink(inner: string): MdLink {
    const { ref, hit } = docLink(project, inner, selected?.languageId ?? null)
    const shown = ref.name + (ref.sub ? ` › ${ref.sub}` : '')
    if (!hit)
      return {
        text: shown,
        data: DATA_KINDS.has(ref.kind),
        title: t('docs.linkMissing', { kind: t(`docs.kinds.${ref.kind}`), name: ref.name })
      }
    return {
      target: { kind: hit.kind, id: hit.id, sub: hit.sub },
      text: shown,
      data: DATA_KINDS.has(hit.kind),
      title: hit.subMissing
        ? t('docs.linkSubMissing', { name: hit.name, sub: ref.sub })
        : `${t(`docs.kinds.${hit.kind}`)} · ${hit.name}${hit.subLabel ? ` › ${hit.subLabel}` : ''}`
    }
  }
  const html = $derived(selected ? renderDocument(selected, { resolve: resolveLink }) : '')
  let reference = $state<string | null>(null)

  $effect(() => {
    inspectorTitle = selected ? t('docs.page') : t('docs.title')
  })
  $effect(() => {
    const id = ui.takePending('doc')
    if (id) {
      const target = project.docs.find((doc) => doc.id === id)
      if (!target) return
      if (target.languageId && langId && target.languageId !== langId)
        projectState.currentLanguageId = target.languageId
      ui.search = ''
      pick(target)
      ui.cancelScrollRestore('docs')
      reference = ui.takePendingSub()
      if (reference) view = 'preview'
    }
  })
  $effect(() => {
    const ref = reference
    if (!ref || !selected || view === 'edit') return
    const id = ref.slice(ref.indexOf(':') + 1)
    const text = project.sentences
      .find((s) => s.id === id)
      ?.text.trim()
      .replace(/\s+/g, ' ')
    void html
    void tick().then(() => {
      const preview = document.querySelector('[data-tour="docs-preview"]')
      const plain = (node: Node): string =>
        node.nodeType === Node.TEXT_NODE
          ? (node.textContent ?? '')
          : node instanceof Element && ['PRE', 'CODE'].includes(node.tagName)
            ? '\0'
            : [...node.childNodes].map(plain).join('')
      const target = ref.startsWith('text:')
        ? [...(preview?.querySelectorAll('q,p,li,blockquote,div') ?? [])].find((e) =>
            hasSentenceTextMention(plain(e), text ?? '')
          )
        : [...(preview?.querySelectorAll('a[data-kind="sentence"]') ?? [])].find(
            (e) => (e as HTMLElement).dataset.id === id
          )
      if (target) {
        target.scrollIntoView({ block: 'center' })
        flashOn(target as HTMLElement, false).update(true)
      }
      reference = null
    })
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('docs', {
      kind: 'doc',
      lang: projectState.currentLanguageId,
      id: selectedId,
      docView: view,
      docFolder: folderId,
      root: directoryRoot ? '1' : '',
      folders: folderView ? '1' : ''
    })
  })
  $effect(() => {
    const r = ui.takeRestore('docs')
    if (!r) return
    const v: PageView = r.view ?? {}
    selectedId = v.id ?? null
    directoryRoot = v.root === '1'
    folderView = v.folders === '1'
    folderId = selectedId
      ? docFolderOf(
          project,
          project.docs.find((doc) => doc.id === selectedId) ?? ({ folderId: undefined } as DocPage)
        )
      : (v.docFolder ?? '')
    if (v.docView === 'edit' || v.docView === 'split' || v.docView === 'preview') view = v.docView
  })
  $effect(() => {
    Object.assign(memo, {
      lang: projectState.currentLanguageId,
      selectedId,
      view,
      folderId,
      folderView,
      directoryRoot,
      sidebarOpen
    })
  })

  function pasteHere(): void {
    const owner = project,
      target = folderId
    void pasteProjectRecords(
      owner,
      target,
      undefined,
      () => projectState.project === owner && folderId === target && !folderView,
      { allowFolders: !!target }
    )
  }
  function touch(d?: DocPage): void {
    if (projectState.readOnly) return
    if (d) d.updatedAt = now()
    projectState.touch()
  }
  function add(): void {
    if (projectState.readOnly) return
    const d = createDoc(langId, t('docs.untitled'))
    if (folderId && validDocFolder(project, folderId)) d.folderId = folderId
    if (ui.prefs.defaultDocFormat === 'html') d.format = 'html'
    project.docs.unshift(d)
    selectedId = d.id
    folderView = false
    directoryRoot = false
    view = 'edit'
    touch()
    queueMicrotask(() => document.getElementById('doc-title')?.focus())
  }
  function remove(d: DocPage): void {
    if (projectState.readOnly) return
    const owner = project
    const idx = project.docs.indexOf(d)
    if (idx < 0) return
    const snap = $state.snapshot(d) as DocPage
    project.docs.splice(idx, 1)
    if (selectedId === d.id) selectedId = null
    touch()
    ui.toast(t('docs.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          if (
            projectState.project !== owner ||
            projectState.readOnly ||
            owner.docs.some((doc) => doc.id === snap.id)
          )
            return
          project.docs.splice(Math.min(idx, project.docs.length), 0, snap)
          pick(snap)
          touch()
        }
      }
    })
  }
  let moving = $state<{ kind: 'doc' | 'folder'; ids: Id[]; target: Id } | null>(null)
  let movingOwner: Project | null = null
  const moveOptions = $derived(folders)
  function movePages(ids: Id[], target?: Id): void {
    if (projectState.readOnly) return
    if (target === undefined) {
      movingOwner = project
      moving = { kind: 'doc', ids, target: folderId }
      return
    }
    if (moveDocs(project, ids, target)) {
      folderId = target
      touch()
    }
  }
  function applyMove(): void {
    if (!moving || movingOwner !== project || projectState.readOnly) return
    const choice = moving
    moving = null
    if (choice.kind === 'doc') movePages(choice.ids, choice.target)
  }
  function pageDrag(event: DragEvent, id: Id): void {
    if (projectState.readOnly || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(DOC_PAGE_DRAG, JSON.stringify({ projectId: project.meta.id, id }))
  }
  function changeLanguage(d: DocPage): void {
    if (langId && d.languageId) projectState.currentLanguageId = d.languageId
    touch(d)
  }
  async function exportMd(d: DocPage): Promise<void> {
    await platform.saveTextFile(`${d.title || 'doc'}.md`, `# ${d.title}\n\n${documentMarkdown(d)}`)
  }
  async function exportHtml(d: DocPage): Promise<void> {
    await platform.saveTextFile(
      `${d.title || 'doc'}.html`,
      documentHtmlPage(d, { resolve: resolveLink })
    )
  }
  async function exportPdf(d: DocPage): Promise<void> {
    // 链接照样解析：导出的纸面上不该留着 `语素:` 这样的前缀
    const page = documentHtmlPage(d, { resolve: resolveLink })
    await platform.exportPdf(page, `${d.title || 'doc'}.pdf`)
  }
  /** 点链接：跳到对应模块并定位、高亮那一条（各页面自己认 pendingSelect） */
  function onPreviewClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest('a[data-kind]') as HTMLElement | null
    if (!a) return
    e.preventDefault()
    const kind = a.dataset.kind as DocLinkKind
    const id = a.dataset.id!
    const to = DOC_LINK_TARGET[kind]
    if (!to) return
    ui.jump(to.section as Section, to.pending, id, linkLanguage(kind, id), a.dataset.sub)
  }
  /** 目标在哪门语言：跳之前先切过去，「返回」才回得到原来那门 */
  function linkLanguage(kind: DocLinkKind, id: Id): Id | null | undefined {
    if (kind === 'language') return id
    if (kind === 'lexeme') return project.lexemes.find((x) => x.id === id)?.languageId
    if (kind === 'morpheme') return project.morphemes.find((x) => x.id === id)?.languageId
    if (kind === 'sentence') return project.sentences.find((x) => x.id === id)?.languageId
    if (kind === 'phrase') return project.phrasebook.find((x) => x.id === id)?.languageId
    if (kind === 'doc') return project.docs.find((x) => x.id === id)?.languageId ?? undefined
    return undefined
  }
  /** 插入链接的选择器开着没有 */
  let pickerOpen = $state(false)
  function insertAtCursor(text: string): void {
    if (projectState.readOnly) return
    const ta = document.getElementById('doc-md') as HTMLTextAreaElement | null
    if (!ta || !selected) return
    const s = ta.selectionStart
    const e = ta.selectionEnd
    selected.markdown = selected.markdown.slice(0, s) + text + selected.markdown.slice(e)
    touch(selected)
    queueMicrotask(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = s + text.length
    })
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('docs.title')}</h1>
    <GuideLink section="docs" />
    <span class="grow"></span>
    {#if selected && !folderView}
      <div class="seg" data-tour="docs-views">
        <button class:active={view === 'edit'} onclick={() => (view = 'edit')}
          ><Pencil size={14} />{t('docs.edit')}</button
        >
        <button class:active={view === 'split'} onclick={() => (view = 'split')}
          ><Columns2 size={14} />{t('docs.split')}</button
        >
        <button class:active={view === 'preview'} onclick={() => (view = 'preview')}
          ><Eye size={14} />{t('docs.preview')}</button
        >
      </div>
    {/if}
    <button class="btn primary" data-tour="docs-add" disabled={projectState.readOnly} onclick={add}
      ><Plus size={16} />{t('docs.add')}</button
    >
  </div>
  <ProjectDirectory
    kind="doc"
    navigationOnly
    currentId={folderId}
    rootView={directoryRoot}
    {sidebarOpen}
    ontoggleSidebar={() => (sidebarOpen = !sidebarOpen)}
    onroot={browseRoot}
    onbrowse={browseFolder}
    onopen={openFolder}
  />
  <Hint id="docs" text={t('docs.hint')} />
  {#if !folderView}<RecordClipboardTools
      controls={false}
      {project}
      kind="doc"
      ids={selectedId ? [selectedId] : []}
      {folderId}
      enabled={!pickerOpen}
      onpasted={(ids) => {
        selectedId = ids[0] ?? null
      }}
    />{/if}

  <div class="body">
    {#if sidebarOpen}<aside
        class="pages"
        id="docs-sidebar"
        data-page-sidebar="docs"
        data-tour="docs-list"
      >
        <ProjectDirectory
          kind="doc"
          currentId={folderId}
          compact
          rootView={directoryRoot}
          onroot={browseRoot}
          onopen={openFolder}
          onbrowse={browseFolder}
        />
        <div class="small muted folder-path" data-doc-folder-path>
          {folderPaths.get(folderId) ?? 'Default'}
        </div>
        {#each list as d (d.id)}
          <button
            class="pg"
            class:active={selectedId === d.id}
            onclick={() => pick(d)}
            data-doc-page={d.id}
            draggable={!projectState.readOnly}
            ondragstart={(event) => pageDrag(event, d.id)}
            use:deletable={{
              selected: selectedId === d.id,
              select: () => {
                pick(d)
              },
              actions: [
                {
                  label: t('sharedFolders.copy'),
                  run: () => copyProjectRecords(project, [{ kind: 'doc', id: d.id }], 'copy')
                },
                {
                  label: t('sharedFolders.cut'),
                  disabled: projectState.readOnly,
                  run: () => copyProjectRecords(project, [{ kind: 'doc', id: d.id }], 'cut')
                },
                {
                  label: t('sharedFolders.paste'),
                  disabled: projectState.readOnly,
                  run: pasteHere
                },
                {
                  label: t('docFolders.movePage'),
                  disabled: projectState.readOnly,
                  run: () => movePages([d.id])
                }
              ],
              remove: () => remove(d)
            }}
          >
            <FileText size={14} />
            <span class="grow ellip">{d.title || t('docs.untitled')}</span>
            {#if ui.search.trim()}<span
                class="tiny muted"
                title={folderPaths.get(folderOf(d)) ?? 'Default'}
                >{folderPaths.get(folderOf(d)) ?? 'Default'}</span
              >{/if}
            {#if d.languageId}<span class="tiny muted"
                >{project.languages.find((l) => l.id === d.languageId)?.abbr || ''}</span
              >{/if}
          </button>
        {/each}
        {#if list.length === 0}<p class="small muted">{t('docs.empty')}</p>{/if}
      </aside>{/if}
    {#if folderView}<div class="directory-scroll">
        <ProjectDirectory
          kind="doc"
          hideNavigation
          currentId={folderId}
          rootView={directoryRoot}
          onroot={browseRoot}
          onopen={openFolder}
          onbrowse={browseFolder}
        />
      </div>{:else if selected}
      {@const d = selected}
      <div class="editor" class:split={view === 'split'}>
        {#if view !== 'preview'}
          <div class="pane">
            <div class="row toolbar" data-tour="docs-toolbar">
              {#each documentFormat(d) === 'html' ? [['<strong>', '</strong>', 'B'], ['<em>', '</em>', 'I'], ['<h2>', '</h2>', 'H'], ['<ul><li>', '</li></ul>', '•'], ['<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>', '', '⊞'], ['<pre><code>', '</code></pre>', '</>']] : [['**', '**', 'B'], ['*', '*', 'I'], ['## ', '', 'H'], ['- ', '', '•'], ['| a | b |\n| --- | --- |\n| 1 | 2 |', '', '⊞'], ['```\n', '\n```', '</>']] as [a, b, label] (label)}
                <button
                  class="btn ghost sm mono"
                  title={label}
                  onclick={() => insertAtCursor(a + b)}>{label}</button
                >
              {/each}
              <button
                class="btn ghost sm"
                title={t('docs.insertLink')}
                onclick={() => (pickerOpen = true)}><Link size={14} />{t('docs.insertLink')}</button
              >
              <HelpDot tip={t('docs.linkHelp')} />
            </div>
            <textarea
              id="doc-md"
              class="textarea md"
              bind:value={d.markdown}
              readonly={projectState.readOnly}
              oninput={() => touch(d)}
              data-document-source={documentFormat(d)}
              placeholder={t(
                documentFormat(d) === 'html' ? 'docs.htmlPlaceholder' : 'docs.placeholder'
              )}
            ></textarea>
          </div>
        {/if}
        {#if view !== 'edit'}
          <div
            class="pane preview md-body"
            data-tour="docs-preview"
            role="presentation"
            onclick={onPreviewClick}
          >
            <h1>{d.title}</h1>
            {@html html}
          </div>
        {/if}
      </div>
    {:else}
      <div class="grow center muted">{t('docs.select')}</div>
    {/if}
  </div>
</div>

{#if moving}<div class="overlay" role="dialog" aria-modal="true" tabindex="-1" data-doc-move-dialog>
    <div class="move-dialog card">
      <h3>{t(moving.kind === 'doc' ? 'docFolders.movePage' : 'docFolders.moveFolder')}</h3>
      <label
        >{t('docFolders.destination')}<select
          class="select"
          data-doc-move-target
          bind:value={moving.target}
          >{#each moveOptions as folder (folder.id)}<option value={folder.id}>{folder.path}</option
            >{/each}</select
        ></label
      >
      <div class="row">
        <span class="grow"></span><button class="btn" onclick={() => (moving = null)}
          >{t('common.cancel')}</button
        ><button
          class="btn primary"
          data-doc-move-confirm
          disabled={projectState.readOnly ||
            !moveOptions.some((folder) => folder.id === moving?.target)}
          onclick={applyMove}>{t('docFolders.move')}</button
        >
      </div>
    </div>
  </div>{/if}

{#if pickerOpen && selected}
  <DocLinkPicker onpick={(text) => insertAtCursor(text)} onclose={() => (pickerOpen = false)} />
{/if}

{#if selected}
  {@const d = selected}
  <Portal>
    <div class="field">
      <label for="doc-title">{t('docs.pageTitle')}</label><input
        id="doc-title"
        class="input"
        bind:value={d.title}
        readonly={projectState.readOnly}
        oninput={() => touch(d)}
      />
    </div>
    <div class="field">
      <label for="doc-lang">{t('docs.language')}</label>
      <select
        id="doc-lang"
        class="select"
        bind:value={d.languageId}
        disabled={projectState.readOnly}
        onchange={() => changeLanguage(d)}
      >
        <option value={null}>{t('docs.projectWide')}</option>
        {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="doc-folder">{t('docFolders.title')}</label><select
        id="doc-folder"
        class="select"
        data-doc-page-folder
        value={folderOf(d)}
        disabled={projectState.readOnly}
        onchange={(event) => movePages([d.id], event.currentTarget.value)}
        >{#each folders as folder (folder.id)}<option value={folder.id}>{folder.path}</option
          >{/each}</select
      >
    </div>
    <p class="small muted">{t('docs.updated')}: {d.updatedAt.slice(0, 16).replace('T', ' ')}</p>
    <div class="field" data-doc-tags>
      <span class="small muted">{t('common.tags')}</span>
      {#if projectState.readOnly}<div>
          {(d.tags ?? []).join(', ') || '—'}
        </div>{:else}{#key d.id}<TagInput
            tags={[...(d.tags ?? [])]}
            suggestions={allDocTags}
            onchange={(tags) => {
              if (projectState.readOnly) return
              d.tags = [...tags]
              touch(d)
            }}
          />{/key}{/if}
    </div>

    <div class="field">
      <label for="doc-format">{t('docs.format')}<HelpDot tip={t('docs.formatHint')} /></label>
      <select
        id="doc-format"
        class="select"
        data-document-format
        value={documentFormat(d)}
        disabled={projectState.readOnly}
        onchange={(e) => {
          d.format = e.currentTarget.value === 'html' ? 'html' : 'markdown'
          touch(d)
        }}
      >
        <option value="markdown">Markdown</option><option value="html">HTML</option>
      </select>
    </div>
    <div class="row wrap">
      <button class="btn sm" onclick={() => exportMd(d)}><Upload size={14} />Markdown</button>
      <button class="btn sm" data-document-export-html onclick={() => exportHtml(d)}
        ><Upload size={14} />HTML</button
      >
      <button class="btn sm" onclick={() => exportPdf(d)}><Upload size={14} />PDF</button>
    </div>
    <p class="small muted">{t(documentFormat(d) === 'html' ? 'docs.htmlSyntax' : 'docs.syntax')}</p>
    <button class="btn sm danger" disabled={projectState.readOnly} onclick={() => remove(d)}
      ><Trash2 size={14} />{t('common.delete')}</button
    >
  </Portal>
{/if}

<style>
  .directory-scroll {
    overflow: auto;
    flex: 1;
    min-height: 0;
  }
  .page {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .page-head {
    flex-wrap: wrap;
    gap: 10px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 14px;
  }
  .pages {
    width: 250px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: auto;
  }
  .folder-path {
    padding: 4px 8px;
    overflow-wrap: anywhere;
  }
  .move-dialog {
    width: min(420px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
  }
  .move-dialog label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pg {
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: start;
    border: 0;
    background: none;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-2);
    font-size: 13px;
    width: 100%;
  }
  .pg:hover {
    background: var(--bg-hover);
  }
  .pg.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ellip {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .editor.split {
    grid-template-columns: 1fr 1fr;
  }
  .pane {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .toolbar {
    gap: 2px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .md {
    flex: 1;
    min-height: 200px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.55;
    resize: none;
  }
  .preview {
    overflow: auto;
    padding: 14px 18px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: var(--font-corpus-tr);
  }
  .preview h1 {
    margin: 0 0 10px;
    font-size: 22px;
  }
  .preview :global(h2) {
    font-size: 18px;
    margin: 16px 0 6px;
  }
  .preview :global(h3) {
    font-size: 15px;
    margin: 12px 0 4px;
  }
  .preview :global(p) {
    margin: 6px 0;
  }
  .preview :global(table) {
    border-collapse: collapse;
    margin: 8px 0;
  }
  .preview :global(td),
  .preview :global(th) {
    border: 1px solid var(--border);
    padding: 3px 8px;
  }
  .preview :global(code) {
    font-family: var(--font-mono);
    background: var(--bg-sunken);
    padding: 0 4px;
    border-radius: 3px;
  }
  .preview :global(pre) {
    background: var(--bg-sunken);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    overflow: auto;
  }
  .preview :global(blockquote) {
    border-inline-start: 3px solid var(--border-strong);
    margin: 6px 0;
    padding-inline-start: 10px;
    color: var(--text-2);
  }
  .preview :global(a.wl) {
    color: var(--accent-text);
    text-decoration: none;
    border-bottom: 1px solid var(--accent);
  }
  /* 词条、语素这些用数据字体，语言名、文档标题照正文 */
  .preview :global(.wl.data) {
    font-family: var(--font-data);
  }
  .preview :global(.wl.missing) {
    color: var(--text-3);
    border-bottom: 1px dashed var(--border-strong);
    cursor: help;
  }
  .center {
    display: grid;
    place-items: center;
  }
  .tiny {
    font-size: 11px;
  }
  @media (max-width: 900px) {
    .pages {
      width: 180px;
    }
  }
</style>
