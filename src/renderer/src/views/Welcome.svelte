<script lang="ts">
  import { onMount } from 'svelte'
  import { platform, type RecentEntry } from '$lib/platform'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { i18n, t, LOCALES } from '$lib/i18n/index.svelte'
  import type { ProjectTemplate } from '$lib/core/model'
  import { createLanguage } from '$lib/core/factory'
  import { FolderOpen, FilePlus2, Clock, Trash2 } from '@lucide/svelte'

  let { snapshot, onsnapshothandled }: { snapshot: string | null; onsnapshothandled: () => void } = $props()

  let recent = $state<RecentEntry[]>([])
  let template = $state<ProjectTemplate | null>(null)
  let name = $state('')
  let proto = $state('')
  let daughters = $state('')
  let version = $state('')

  onMount(async () => {
    recent = await platform.getRecent()
    version = (await platform.info()).version
  })

  const templates: { id: ProjectTemplate; available: boolean }[] = [
    { id: 'blank', available: true },
    { id: 'family', available: true },
    { id: 'lexicanter', available: true },
    { id: 'csv', available: true }
  ]
  let definitionLang = $state('')

  async function create(): Promise<void> {
    if (!template) return
    const n = name.trim() || t('app.untitled')
    if (template === 'lexicanter') {
      const [f] = await platform.readTextFiles({ multiple: false, extensions: ['lexc', 'json'] })
      if (!f) return
      try {
        const { parseLexc, lexicanterToProject } = await import('$lib/importers/lexicanter')
        const { project, report } = lexicanterToProject(parseLexc(f.content), {
          definitionLang: definitionLang.trim() || (i18n.locale.startsWith('zh') ? 'zh' : 'en'),
          uiLocale: i18n.locale,
          appVersion: version
        })
        if (name.trim()) project.meta.name = name.trim()
        projectState.load(project, null)
        projectState.touch()
        ui.toast(t('lexicon.lexicanterDone', { lexemes: report.lexemes, languages: report.languages.length }))
      } catch (e) {
        ui.error((e as Error).message)
      }
      return
    }
    if (template === 'csv') {
      projectState.create({ name: n, template: 'csv', appVersion: version, uiLocale: i18n.locale })
      projectState.project!.languages.push(createLanguage({ name: n }))
      projectState.project!.settings.defaultLanguageId = projectState.project!.languages[0].id
      projectState.currentLanguageId = projectState.project!.languages[0].id
      ui.pendingImport = 'csv'
      ui.section = 'lexicon'
      return
    }
    projectState.create({
      name: n,
      template,
      appVersion: version,
      uiLocale: i18n.locale,
      familyNames:
        template === 'family'
          ? { proto: proto.trim() || `Proto-${n}`, daughters: daughters.split('\n').map((s) => s.trim()) }
          : undefined
    })
  }

  async function openRecent(r: RecentEntry): Promise<void> {
    const ok = await projectState.openRecent(r)
    if (!ok) recent = await platform.getRecent()
  }

  async function clearRecent(): Promise<void> {
    await platform.clearRecent()
    recent = []
  }

  function restore(): void {
    if (snapshot && projectState.restoreSnapshot(snapshot)) onsnapshothandled()
  }
  async function discard(): Promise<void> {
    await platform.saveSnapshot(null)
    onsnapshothandled()
  }
</script>

<div class="welcome">
  <aside class="side">
    <div class="brand">
      <div class="logo">千</div>
      <div>
        <h1>{t('app.name')}</h1>
        <p class="muted small">{t('app.tagline')}</p>
      </div>
    </div>

    <div class="actions">
      <button class="btn primary" onclick={() => (template = template ?? 'blank')}><FilePlus2 size={16} />{t('welcome.newProject')}</button>
      <button class="btn" onclick={() => projectState.open()}><FolderOpen size={16} />{t('welcome.openProject')}</button>
    </div>

    <div class="recent">
      <div class="row">
        <h3 class="grow">{t('welcome.recent')}</h3>
        {#if recent.length}
          <button class="btn ghost icon sm" title={t('welcome.clearRecent')} onclick={clearRecent}><Trash2 size={14} /></button>
        {/if}
      </div>
      {#if recent.length === 0}
        <p class="muted small">{t('welcome.noRecent')}</p>
      {:else}
        <ul>
          {#each recent as r (r.path ?? r.handleKey ?? r.name)}
            <li>
              <button class="recent-item" onclick={() => openRecent(r)}>
                <Clock size={14} />
                <span class="grow">
                  <span class="rname">{r.name}</span>
                  {#if r.path}<span class="rpath muted small">{r.path}</span>{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="foot row">
      <select class="select locale" bind:value={ui.prefs.locale} onchange={() => ui.savePrefs()}>
        {#each LOCALES as l (l.code)}
          <option value={l.code}>{l.label}</option>
        {/each}
      </select>
      <span class="muted small">v{version}</span>
    </div>
  </aside>

  <main class="main">
    {#if snapshot}
      <div class="card restore">
        <p>{t('welcome.restoreSnapshot')}</p>
        <div class="row">
          <button class="btn primary" onclick={restore}>{t('welcome.restore')}</button>
          <button class="btn" onclick={discard}>{t('welcome.discard')}</button>
        </div>
      </div>
    {/if}

    <h2>{t('welcome.templates.title')}</h2>
    <div class="templates">
      {#each templates as tp (tp.id)}
        <button class="tpl card" class:active={template === tp.id} disabled={!tp.available} onclick={() => (template = tp.id)}>
          <strong>{t(`welcome.templates.${tp.id}`)}</strong>
          <span class="muted small">{t(`welcome.templates.${tp.id}Desc`)}</span>
        </button>
      {/each}
    </div>

    {#if template}
      <form
        class="form card"
        onsubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <div class="field">
          <label for="pname">{t('welcome.projectName')}</label>
          <input id="pname" class="input" bind:value={name} placeholder={t('app.untitled')} />
        </div>
        {#if template === 'lexicanter'}
          <div class="field">
            <label for="deflang">{t('welcome.definitionLang')}</label>
            <input id="deflang" class="input" bind:value={definitionLang} placeholder={i18n.locale.startsWith('zh') ? 'zh' : 'en'} />
          </div>
        {/if}
        {#if template === 'family'}
          <div class="field">
            <label for="proto">{t('welcome.protoName')}</label>
            <input id="proto" class="input" bind:value={proto} />
          </div>
          <div class="field">
            <label for="daughters">{t('welcome.daughterNames')}</label>
            <textarea id="daughters" class="textarea" bind:value={daughters}></textarea>
          </div>
        {/if}
        <div class="row">
          <button class="btn primary" type="submit">{template === 'lexicanter' ? t('welcome.lexicanterPick') : t('welcome.create')}</button>
          <button class="btn ghost" type="button" onclick={() => (template = null)}>{t('common.cancel')}</button>
        </div>
      </form>
    {/if}
  </main>
</div>

<style>
  .welcome {
    height: 100%;
    display: grid;
    grid-template-columns: 320px 1fr;
  }
  .side {
    background: var(--bg-elev);
    border-right: 1px solid var(--border);
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .brand {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .logo {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 22px;
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .actions .btn {
    justify-content: flex-start;
    padding: 9px 12px;
  }
  .recent {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .recent ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .recent-item {
    width: 100%;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .recent-item:hover {
    background: var(--bg-hover);
  }
  .recent-item .grow {
    display: flex;
    flex-direction: column;
  }
  .rpath {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .foot {
    justify-content: space-between;
  }
  .locale {
    width: auto;
  }
  .main {
    padding: 40px 48px;
    overflow: auto;
    max-width: 880px;
  }
  .restore {
    padding: 14px 16px;
    margin-bottom: 24px;
    border-color: var(--warn);
    background: var(--warn-soft);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  h2 {
    margin-bottom: 12px;
  }
  .templates {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }
  .tpl {
    text-align: left;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: pointer;
    transition: border-color 0.12s;
  }
  .tpl:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .tpl.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .tpl:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .form {
    padding: 20px;
    max-width: 520px;
  }
</style>
