<script lang="ts">
  import { onMount } from 'svelte'
  import { platform, type AppInfo } from '$lib/platform'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, LOCALES } from '$lib/i18n/index.svelte'
  import { FolderOutput } from '@lucide/svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()
  $effect(() => {
    inspectorTitle = t('settings.about')
  })

  const project = $derived(projectState.project!)
  let info = $state<AppInfo | null>(null)
  onMount(async () => {
    info = await platform.info()
  })

  let glossLangs = $state('')
  let boundaries = $state('')
  $effect(() => {
    glossLangs = project.settings.glossLanguages.join(', ')
    boundaries = project.settings.morphemeBoundaries.join(' ')
  })
  function commitGlossLangs(): void {
    project.settings.glossLanguages = glossLangs
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    projectState.touch()
  }
  function commitBoundaries(): void {
    project.settings.morphemeBoundaries = boundaries.split(/\s+/).filter(Boolean)
    projectState.touch()
  }
</script>

<div class="page">
  <h1>{t('settings.title')}</h1>

  <section>
    <h3>{t('settings.app')}</h3>
    <div class="grid">
      <div class="field">
        <label for="s-locale">{t('settings.uiLanguage')}</label>
        <select id="s-locale" class="select" bind:value={ui.prefs.locale} onchange={() => ui.savePrefs()}>
          {#each LOCALES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="s-theme">{t('settings.theme')}</label>
        <select id="s-theme" class="select" bind:value={ui.prefs.theme} onchange={() => ui.savePrefs()}>
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
        </select>
      </div>
      <div class="field">
        <label for="s-autosave">{t('settings.autosave')}</label>
        <input id="s-autosave" type="number" min="0" step="5" class="input" bind:value={ui.prefs.autosaveSeconds} onchange={() => ui.savePrefs()} />
      </div>
      <div class="field">
        <label for="s-backups">{t('settings.backupCount')}</label>
        <input id="s-backups" type="number" min="0" class="input" bind:value={ui.prefs.backupCount} onchange={() => ui.savePrefs()} />
      </div>
      <label class="row check">
        <input type="checkbox" bind:checked={ui.prefs.reopenLast} onchange={() => ui.savePrefs()} />
        {t('settings.reopenLast')}
      </label>
    </div>
  </section>

  <section>
    <h3>{t('settings.project')}</h3>
    <div class="grid">
      <div class="field">
        <label for="p-name">{t('settings.projectName')}</label>
        <input id="p-name" class="input" bind:value={project.meta.name} oninput={() => projectState.touch()} />
      </div>
      <div class="field">
        <label for="p-author">{t('settings.author')}</label>
        <input id="p-author" class="input" bind:value={project.meta.author} oninput={() => projectState.touch()} />
      </div>
      <div class="field wide">
        <label for="p-desc">{t('settings.description')}</label>
        <textarea id="p-desc" class="textarea" bind:value={project.meta.description} oninput={() => projectState.touch()}></textarea>
      </div>
      <div class="field">
        <label for="p-default">{t('settings.defaultLanguage')}</label>
        <select id="p-default" class="select" bind:value={project.settings.defaultLanguageId} onchange={() => projectState.touch()}>
          <option value={null}>{t('common.none')}</option>
          {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="p-font">{t('settings.dataFont')}</label>
        <input id="p-font" class="input" bind:value={project.settings.dataFont} oninput={() => projectState.touch()} placeholder="Gentium Plus" />
      </div>
      <div class="field">
        <label for="p-gloss">{t('settings.glossLanguages')}</label>
        <input id="p-gloss" class="input" bind:value={glossLangs} onchange={commitGlossLangs} />
      </div>
      <div class="field">
        <label for="p-bound">{t('settings.morphemeBoundaries')}</label>
        <input id="p-bound" class="input data" bind:value={boundaries} onchange={commitBoundaries} />
      </div>
    </div>
  </section>

  <section>
    <h3>{t('common.export')}</h3>
    <div class="row">
      <button class="btn" onclick={() => projectState.exportFolder()}><FolderOutput size={16} />{t('settings.exportFolder')}</button>
      <span class="small muted">{t('settings.exportFolderDesc')}</span>
    </div>
  </section>

  <section class="about">
    <h3>{t('settings.about')}</h3>
    <p>{t('app.name')} · {t('settings.version')} {info?.version ?? ''} · {t('settings.license')}</p>
    {#if info?.userDataPath}
      <p class="small muted">{t('settings.userData')}: {info.userDataPath}</p>
    {/if}
  </section>
</div>

<style>
  .page {
    padding: 24px 28px;
    max-width: 880px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  section h3 {
    margin-bottom: 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 20px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .check {
    gap: 8px;
    margin-bottom: 12px;
  }
</style>
