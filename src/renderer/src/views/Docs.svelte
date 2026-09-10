<script lang="ts">
  /** 文档页：项目内 Markdown 页面，编辑 / 分栏 / 预览，[[词头]] 链到词库。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { platform } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import { createDoc, now } from '$lib/core/factory'
  import { mdToHtml } from '$lib/core/markdown'
  import type { DocPage, Id } from '$lib/core/model'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import { Plus, Trash2, Download, Eye, Pencil, Columns2, FileText } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const langId = $derived(projectState.currentLanguageId)
  let selectedId = $state<Id | null>(null)
  // 打开文档页默认看预览；新建文档时自动切到编辑
  let view = $state<'edit' | 'split' | 'preview'>('preview')

  const list = $derived.by(() => {
    const q = ui.search.trim().toLowerCase()
    return project.docs.filter(
      (d) =>
        (!langId || d.languageId === langId || d.languageId === null) &&
        (!q || d.title.toLowerCase().includes(q) || d.markdown.toLowerCase().includes(q))
    )
  })
  const selected = $derived(project.docs.find((d) => d.id === selectedId) ?? null)
  const lemmaIndex = $derived.by(() => {
    const m = new Map<string, Id>()
    for (const l of project.lexemes) if (l.lemma && !m.has(l.lemma)) m.set(l.lemma, l.id)
    return m
  })
  const html = $derived(
    selected ? mdToHtml(selected.markdown, { resolve: (n) => lemmaIndex.get(n) ?? null }) : ''
  )

  $effect(() => {
    inspectorTitle = selected ? t('docs.page') : t('docs.title')
  })
  $effect(() => {
    const id = ui.takePending('doc')
    if (id) selectedId = id
  })

  function touch(d?: DocPage): void {
    if (d) d.updatedAt = now()
    projectState.touch()
  }
  function add(): void {
    const d = createDoc(langId, t('docs.untitled'))
    project.docs.unshift(d)
    selectedId = d.id
    view = 'edit'
    touch()
    queueMicrotask(() => document.getElementById('doc-title')?.focus())
  }
  function remove(d: DocPage): void {
    const idx = project.docs.indexOf(d)
    const snap = $state.snapshot(d) as DocPage
    project.docs.splice(idx, 1)
    if (selectedId === d.id) selectedId = null
    touch()
    ui.toast(t('docs.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.docs.splice(Math.min(idx, project.docs.length), 0, snap)
          selectedId = snap.id
          touch()
        }
      }
    })
  }
  async function exportMd(d: DocPage): Promise<void> {
    await platform.saveTextFile(`${d.title || 'doc'}.md`, `# ${d.title}\n\n${d.markdown}`)
  }
  async function exportPdf(d: DocPage): Promise<void> {
    const body = mdToHtml(d.markdown)
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>${d.title}</title><style>@page{size:A4;margin:20mm}body{font-family:'Gentium Plus','Noto Serif SC',serif;font-size:11pt;line-height:1.6;padding:24px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:3px 8px}code{font-family:Consolas,monospace;background:#f2f2f2;padding:0 3px}pre{background:#f4f4f4;padding:8px}blockquote{border-left:3px solid #bbb;margin:0;padding-left:10px;color:#555}</style></head><body><h1>${d.title}</h1>${body}</body></html>`
    await platform.exportPdf(page, `${d.title || 'doc'}.pdf`)
  }
  function onPreviewClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest('a[data-lexeme]') as HTMLElement | null
    if (!a) return
    e.preventDefault()
    const id = a.dataset.lexeme!
    const lx = project.lexemes.find((l) => l.id === id)
    if (lx) projectState.currentLanguageId = lx.languageId
    ui.jump('lexicon', 'lexeme', id)
  }
  function insertAtCursor(text: string): void {
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
    {#if selected}
      <div class="seg">
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
    <button class="btn primary" onclick={add}><Plus size={16} />{t('docs.add')}</button>
  </div>
  <Hint id="docs" text={t('docs.hint')} />

  <div class="body">
    <aside class="pages">
      {#each list as d (d.id)}
        <button class="pg" class:active={selectedId === d.id} onclick={() => (selectedId = d.id)}>
          <FileText size={14} />
          <span class="grow ellip">{d.title || t('docs.untitled')}</span>
          {#if d.languageId}<span class="tiny muted"
              >{project.languages.find((l) => l.id === d.languageId)?.abbr || ''}</span
            >{/if}
        </button>
      {/each}
      {#if list.length === 0}<p class="small muted">{t('docs.empty')}</p>{/if}
    </aside>
    {#if selected}
      {@const d = selected}
      <div class="editor" class:split={view === 'split'}>
        {#if view !== 'preview'}
          <div class="pane">
            <div class="row toolbar">
              {#each [['**', '**', 'B'], ['*', '*', 'I'], ['## ', '', 'H'], ['- ', '', '•'], ['[[', ']]', '[[ ]]'], ['| a | b |\n| --- | --- |\n| 1 | 2 |', '', '⊞'], ['```\n', '\n```', '</>']] as [a, b, label] (label)}
                <button
                  class="btn ghost sm mono"
                  title={label}
                  onclick={() => insertAtCursor(a + b)}>{label}</button
                >
              {/each}
            </div>
            <textarea
              id="doc-md"
              class="textarea md"
              bind:value={d.markdown}
              oninput={() => touch(d)}
              placeholder={t('docs.placeholder')}
            ></textarea>
          </div>
        {/if}
        {#if view !== 'edit'}
          <div class="pane preview md-body" role="presentation" onclick={onPreviewClick}>
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

{#if selected}
  {@const d = selected}
  <Portal>
    <div class="field">
      <label for="doc-title">{t('docs.pageTitle')}</label><input
        id="doc-title"
        class="input"
        bind:value={d.title}
        oninput={() => touch(d)}
      />
    </div>
    <div class="field">
      <label for="doc-lang">{t('docs.language')}</label>
      <select id="doc-lang" class="select" bind:value={d.languageId} onchange={() => touch(d)}>
        <option value={null}>{t('docs.projectWide')}</option>
        {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </div>
    <p class="small muted">{t('docs.updated')}: {d.updatedAt.slice(0, 16).replace('T', ' ')}</p>
    <div class="row wrap">
      <button class="btn sm" onclick={() => exportMd(d)}><Download size={14} />Markdown</button>
      <button class="btn sm" onclick={() => exportPdf(d)}><Download size={14} />PDF</button>
    </div>
    <p class="small muted">{t('docs.syntax')}</p>
    <button class="btn sm danger" onclick={() => remove(d)}
      ><Trash2 size={14} />{t('common.delete')}</button
    >
  </Portal>
{/if}

<style>
  .page {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .page-head {
    gap: 10px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 14px;
  }
  .pages {
    width: 200px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: auto;
  }
  .pg {
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: left;
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
    border-left: 3px solid var(--border-strong);
    margin: 6px 0;
    padding-left: 10px;
    color: var(--text-2);
  }
  .preview :global(a.wl) {
    color: var(--accent-text);
    text-decoration: none;
    border-bottom: 1px solid var(--accent);
    font-family: var(--font-data);
  }
  .preview :global(.wl.missing) {
    border-bottom: 1px dashed var(--border-strong);
    font-family: var(--font-data);
  }
  .center {
    display: grid;
    place-items: center;
  }
  .tiny {
    font-size: 11px;
  }
</style>
