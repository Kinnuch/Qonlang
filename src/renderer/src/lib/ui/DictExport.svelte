<script lang="ts">
  /** 词典导出面板：HTML / Markdown / PDF，或按用户模板逐条渲染。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { platform } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import { newId } from '$lib/core/factory'
  import type { Language } from '$lib/core/model'
  import {
    dictionaryHtml,
    dictionaryMarkdown,
    renderEntries,
    type DictOptions
  } from '$lib/export/dictionary'
  import { Download, Check, Trash2, X, Copy } from '@lucide/svelte'

  let { language, onclose }: { language: Language; onclose: () => void } = $props()
  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)

  let title = $state('')
  let includeForms = $state(true)
  let includeEtymology = $state(true)
  let includeScript = $state(true)
  let includeNotes = $state(false)
  let groupByInitial = $state(true)
  let senseLangs = $state<string[]>([])
  let templateId = $state('')
  let templateDraft = $state({ name: '', template: '{{lemma}} {{ipa}} {{pos}} — {{definition}}' })
  $effect(() => {
    if (!title) title = `${language.name}`
  })
  const templates = $derived(project.settings.exportTemplates.filter((x) => x.kind === 'entry'))
  const opts = $derived((): DictOptions => ({
    title,
    glossLangs,
    senseLangs,
    includeForms,
    includeEtymology,
    includeScript,
    includeNotes,
    groupByInitial,
    fontFamily: project.settings.dataFont || undefined
  }))
  const preview = $derived(
    renderEntries(project, language, templateDraft.template, opts())
      .split('\n')
      .slice(0, 6)
      .join('\n')
  )

  async function doExport(kind: 'html' | 'md' | 'pdf' | 'template'): Promise<void> {
    const o = opts()
    const base = `${language.name}-dictionary`
    let ok = false
    if (kind === 'html')
      ok = await platform.saveTextFile(`${base}.html`, dictionaryHtml(project, language, o))
    else if (kind === 'md')
      ok = await platform.saveTextFile(`${base}.md`, dictionaryMarkdown(project, language, o))
    else if (kind === 'pdf')
      ok = await platform.exportPdf(dictionaryHtml(project, language, o), `${base}.pdf`)
    else
      ok = await platform.saveTextFile(
        `${base}.txt`,
        renderEntries(project, language, templateDraft.template, o)
      )
    if (ok) ui.toast(t('dict.exported'))
  }
  async function copyTemplateOut(): Promise<void> {
    await navigator.clipboard.writeText(
      renderEntries(project, language, templateDraft.template, opts())
    )
    ui.toast(t('soundChanges.copied'))
  }
  function saveTemplate(): void {
    const name = templateDraft.name.trim()
    if (!name) return
    const existing = project.settings.exportTemplates.find(
      (x) => x.kind === 'entry' && x.name === name
    )
    if (existing) existing.template = templateDraft.template
    else
      project.settings.exportTemplates.push({
        id: newId(),
        name,
        kind: 'entry',
        template: templateDraft.template
      })
    templateId = (
      existing ?? project.settings.exportTemplates[project.settings.exportTemplates.length - 1]
    ).id
    projectState.touch()
  }
  function loadTemplate(id: string): void {
    templateId = id
    const tp = templates.find((x) => x.id === id)
    if (tp) templateDraft = { name: tp.name, template: tp.template }
  }
  function deleteTemplate(): void {
    const i = project.settings.exportTemplates.findIndex((x) => x.id === templateId)
    if (i >= 0) project.settings.exportTemplates.splice(i, 1)
    templateId = ''
    projectState.touch()
  }
  function toggleSenseLang(g: string): void {
    senseLangs = senseLangs.includes(g) ? senseLangs.filter((x) => x !== g) : [...senseLangs, g]
  }
</script>

<div class="card panel">
  <div class="row head">
    <strong>{t('dict.title')}</strong>
    <span class="small muted grow">{t('dict.hint')}</span>
    <button class="btn ghost icon sm" onclick={onclose}><X size={14} /></button>
  </div>
  <div class="two">
    <section>
      <h4>{t('dict.options')}</h4>
      <div class="field">
        <label for="dx-title">{t('dict.docTitle')}</label><input
          id="dx-title"
          class="input"
          bind:value={title}
        />
      </div>
      <div class="row wrap gap">
        <label class="row small"
          ><input type="checkbox" bind:checked={includeForms} />{t('dict.includeForms')}</label
        >
        <label class="row small"
          ><input type="checkbox" bind:checked={includeEtymology} />{t(
            'dict.includeEtymology'
          )}</label
        >
        <label class="row small"
          ><input type="checkbox" bind:checked={includeScript} />{t('dict.includeScript')}</label
        >
        <label class="row small"
          ><input type="checkbox" bind:checked={includeNotes} />{t('dict.includeNotes')}</label
        >
        <label class="row small"
          ><input type="checkbox" bind:checked={groupByInitial} />{t('dict.groupByInitial')}</label
        >
      </div>
      <div class="row wrap gap">
        <span class="small muted">{t('dict.senseLangs')}</span>
        {#each glossLangs as g (g)}<label class="row small"
            ><input
              type="checkbox"
              checked={senseLangs.length === 0 || senseLangs.includes(g)}
              onchange={() => toggleSenseLang(g)}
            />{g}</label
          >{/each}
      </div>
      <div class="row wrap gap">
        <button class="btn sm" onclick={() => doExport('html')}><Download size={14} />HTML</button>
        <button class="btn sm" onclick={() => doExport('md')}><Download size={14} />Markdown</button
        >
        <button class="btn primary sm" onclick={() => doExport('pdf')}
          ><Download size={14} />PDF</button
        >
      </div>
    </section>
    <section>
      <h4>{t('dict.template')}</h4>
      <div class="row kv">
        <select
          class="select grow"
          value={templateId}
          onchange={(e) => loadTemplate((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">{t('corpus.templateNew')}</option>
          {#each templates as tp (tp.id)}<option value={tp.id}>{tp.name}</option>{/each}
        </select>
        {#if templateId}<button class="btn ghost icon sm danger" onclick={deleteTemplate}
            ><Trash2 size={14} /></button
          >{/if}
      </div>
      <input class="input" placeholder={t('corpus.templateName')} bind:value={templateDraft.name} />
      <textarea class="textarea mono" rows="4" bind:value={templateDraft.template}></textarea>
      <p class="tiny muted">{t('dict.templateHint')}</p>
      <pre class="out">{preview}</pre>
      <div class="row wrap gap">
        <button class="btn sm" onclick={saveTemplate}
          ><Check size={14} />{t('corpus.saveTemplate')}</button
        >
        <button class="btn ghost sm" onclick={copyTemplateOut}
          ><Copy size={14} />{t('corpus.copy')}</button
        >
        <button class="btn sm" onclick={() => doExport('template')}
          ><Download size={14} />{t('dict.exportTemplate')}</button
        >
      </div>
    </section>
  </div>
</div>

<style>
  .panel {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    gap: 10px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h4 {
    margin: 0;
  }
  .gap {
    gap: 12px;
  }
  .gap label {
    white-space: nowrap;
  }
  .kv {
    gap: 6px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .out {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    max-height: 140px;
    overflow: auto;
  }
  .tiny {
    font-size: 11px;
  }
</style>
