<script lang="ts">
  import { onMount } from 'svelte'
  import lockupSvg from '../assets/brand/lockup-full.svg?raw'
  import { platform, type AppInfo } from '$lib/platform'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, LOCALES } from '$lib/i18n/index.svelte'
  import { TOKENIZER_MODES } from '$lib/core/model'
  import {
    Eye,
    FileSpreadsheet,
    FileText,
    FolderOutput,
    Languages,
    Palette,
    RefreshCw,
    Save,
    Scissors,
    Trash2
  } from '@lucide/svelte'
  import { updates } from '$lib/state/updates.svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import { filterRows } from '$lib/ui/filterRows'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()
  $effect(() => {
    inspectorTitle = t('settings.about')
  })

  const project = $derived(projectState.project!)
  let info = $state<AppInfo | null>(null)
  /** 在这一页点过「立即检查」才显示结果（后台自动检查的结果不在这里出） */
  let checkedNow = $state(false)
  /** Release 上的最新版本：后台自动检查或手动检查问到过才有 */
  const latest = $derived(updates.last?.latest ?? '')
  async function checkNow(): Promise<void> {
    checkedNow = true
    await updates.check(true)
  }
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
  /** 可以整块清掉的内容：清之前问一次，清完能撤销 */
  const CLEAR_KINDS = [
    'lexemes',
    'morphemes',
    'sentences',
    'phrasebook',
    'docs',
    'ruleSets',
    'paradigms',
    'posList',
    'categories',
    'customFields',
    'abbreviations',
    'scripts',
    'images'
  ] as const
  type ClearKind = (typeof CLEAR_KINDS)[number]
  let clearKind = $state<'' | ClearKind>('')
  function clearCount(k: ClearKind): number {
    if (k === 'scripts') return project.languages.reduce((n, l) => n + l.scripts.length, 0)
    if (k === 'images') return project.lexemes.reduce((n, l) => n + (l.images?.length ?? 0), 0)
    return ((project as unknown as Record<string, unknown[]>)[k] ?? []).length
  }
  async function doClear(): Promise<void> {
    const k = clearKind
    if (!k) return
    const name = t(`settings.clearKinds.${k}`)
    const n = clearCount(k)
    const ok = await ui.confirm(
      t('settings.clearConfirm', { name }),
      t('settings.clearConfirmBody', { n }),
      t('settings.clearBtn')
    )
    if (!ok) return
    if (k === 'scripts') for (const l of project.languages) l.scripts = []
    else if (k === 'images') for (const l of project.lexemes) l.images = []
    else (project as unknown as Record<string, unknown[]>)[k] = []
    projectState.touch()
    ui.toast(t('settings.cleared', { name, n }))
    clearKind = ''
  }

  function commitBoundaries(): void {
    project.settings.morphemeBoundaries = boundaries.split(/\s+/).filter(Boolean)
    projectState.touch()
  }
</script>

<div class="page">
  <div class="row">
    <h1>{t('settings.title')}</h1>
    <GuideLink section="settings" />
  </div>

  <h2 class="cat">{t('settings.app')}</h2>
  <div class="groups">
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Palette size={15} />{t('settings.groups.ui')}</h3>
      <div class="grid">
        <div class="field">
          <label for="s-locale">{t('settings.uiLanguage')}</label>
          <select
            id="s-locale"
            class="select"
            bind:value={ui.prefs.locale}
            onchange={() => ui.savePrefs()}
          >
            {#each LOCALES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="s-theme">{t('settings.theme')}</label>
          <select
            id="s-theme"
            class="select"
            bind:value={ui.prefs.theme}
            onchange={() => ui.savePrefs()}
          >
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        </div>
        <label class="row check">
          <input
            type="checkbox"
            bind:checked={ui.prefs.showHelpDots}
            onchange={() => ui.savePrefs()}
          />
          {t('settings.showHelpDots')}
        </label>
        <label class="row check">
          <input
            type="checkbox"
            bind:checked={ui.prefs.guideTourAlways}
            onchange={() => ui.savePrefs()}
          />
          {t('settings.guideTourAlways')}
        </label>
      </div>
    </section>
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Save size={15} />{t('settings.groups.saving')}</h3>
      <div class="grid">
        <div class="field">
          <label for="s-autosave">{t('settings.autosave')}</label>
          <input
            id="s-autosave"
            type="number"
            min="0"
            step="5"
            class="input"
            bind:value={ui.prefs.autosaveSeconds}
            onchange={() => ui.savePrefs()}
          />
        </div>
        <div class="field">
          <label for="s-backups">{t('settings.backupCount')}</label>
          <input
            id="s-backups"
            type="number"
            min="0"
            class="input"
            bind:value={ui.prefs.backupCount}
            onchange={() => ui.savePrefs()}
          />
        </div>
        <label class="row check">
          <input
            type="checkbox"
            bind:checked={ui.prefs.reopenLast}
            onchange={() => ui.savePrefs()}
          />
          {t('settings.reopenLast')}
        </label>
      </div>
    </section>
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><RefreshCw size={15} />{t('settings.groups.updates')}</h3>
      <div class="grid">
        <label class="row check">
          <input
            type="checkbox"
            bind:checked={ui.prefs.checkUpdates}
            onchange={() => {
              ui.prefs.skippedVersion = ''
              void ui.savePrefs()
            }}
          />
          {t('settings.checkUpdates')}
        </label>
        <div class="field">
          <label for="s-update-minutes">{t('settings.updateCheckMinutes')}</label>
          <input
            id="s-update-minutes"
            type="number"
            min="1"
            max="1440"
            class="input"
            disabled={!ui.prefs.checkUpdates}
            bind:value={ui.prefs.updateCheckMinutes}
            onchange={() => ui.savePrefs()}
          />
        </div>
      </div>
    </section>
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Eye size={15} />{t('settings.groups.display')}</h3>
      <div class="grid">
        <div class="field">
          <label for="s-register">{t('settings.registerDisplay')}</label>
          <select
            id="s-register"
            class="select"
            bind:value={ui.prefs.registerDisplay}
            onchange={() => ui.savePrefs()}
          >
            <option value="short">{t('settings.registerDisplayShort')}</option>
            <option value="full">{t('settings.registerDisplayFull')}</option>
          </select>
        </div>
        <div class="field">
          <label for="s-pron">{t('settings.pronBrackets')}</label>
          <select
            id="s-pron"
            class="select"
            bind:value={ui.prefs.pronBrackets}
            onchange={() => ui.savePrefs()}
          >
            <option value="slash">{t('settings.pronBracketsSlash')}</option>
            <option value="bracket">{t('settings.pronBracketsBracket')}</option>
            <option value="none">{t('settings.pronBracketsNone')}</option>
          </select>
        </div>
        <div class="field">
          <label for="s-examples">{t('settings.examplesPerEntry')}</label>
          <input
            id="s-examples"
            type="number"
            min="0"
            max="20"
            class="input"
            bind:value={ui.prefs.examplesPerEntry}
            onchange={() => ui.savePrefs()}
          />
        </div>
        <label class="row check">
          <input
            type="checkbox"
            bind:checked={ui.prefs.highlightDuplicates}
            onchange={() => ui.savePrefs()}
          />
          {t('settings.highlightDuplicates')}
        </label>
        <label class="row check">
          <input
            type="checkbox"
            bind:checked={ui.prefs.showDerivedMark}
            onchange={() => ui.savePrefs()}
          />
          {t('settings.showDerivedMark')}
        </label>
      </div>
    </section>
  </div>

  <h2 class="cat">{t('settings.project')}</h2>
  <div class="groups">
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><FileText size={15} />{t('settings.groups.info')}</h3>
      <div class="grid">
        <div class="field">
          <label for="p-name">{t('settings.projectName')}</label>
          <input
            id="p-name"
            class="input"
            bind:value={project.meta.name}
            oninput={() => projectState.touch()}
          />
        </div>
        <div class="field">
          <label for="p-author">{t('settings.author')}</label>
          <input
            id="p-author"
            class="input"
            bind:value={project.meta.author}
            oninput={() => projectState.touch()}
          />
        </div>
        <div class="field wide">
          <label for="p-desc">{t('settings.description')}</label>
          <textarea
            id="p-desc"
            class="textarea"
            bind:value={project.meta.description}
            oninput={() => projectState.touch()}
          ></textarea>
        </div>
      </div>
    </section>
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Languages size={15} />{t('settings.groups.languages')}</h3>
      <div class="grid">
        <div class="field">
          <label for="p-default">{t('settings.defaultLanguage')}</label>
          <select
            id="p-default"
            class="select"
            bind:value={project.settings.defaultLanguageId}
            onchange={() => projectState.touch()}
          >
            <option value={null}>{t('common.none')}</option>
            {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="p-gloss">{t('settings.glossLanguages')}</label>
          <input id="p-gloss" class="input" bind:value={glossLangs} onchange={commitGlossLangs} />
        </div>
        <div class="field">
          <label for="p-font">{t('settings.dataFont')}</label>
          <input
            id="p-font"
            class="input"
            bind:value={project.settings.dataFont}
            oninput={() => projectState.touch()}
            placeholder="Gentium Plus"
          />
        </div>
        <div class="field">
          <label for="p-imgw">{t('settings.imageSize')}</label>
          <div class="row">
            <input
              id="p-imgw"
              type="number"
              min="32"
              step="8"
              class="input"
              bind:value={project.settings.imageSize.width}
              onchange={() => projectState.touch()}
            />
            <span class="muted">×</span>
            <input
              type="number"
              min="32"
              step="8"
              class="input"
              bind:value={project.settings.imageSize.height}
              onchange={() => projectState.touch()}
            />
          </div>
        </div>
      </div>
    </section>
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Scissors size={15} />{t('settings.groups.words')}</h3>
      <div class="grid">
        <div class="field">
          <label for="p-bound">{t('settings.morphemeBoundaries')}</label>
          <input
            id="p-bound"
            class="input data"
            bind:value={boundaries}
            onchange={commitBoundaries}
          />
        </div>
        <div class="field">
          <label for="p-token">{t('settings.tokenizer')}</label>
          <select
            id="p-token"
            class="select"
            bind:value={project.settings.tokenizer}
            onchange={() => projectState.touch()}
          >
            {#each TOKENIZER_MODES as m (m)}
              <option value={m}>{t(`settings.tokenizers.${m}`)}</option>
            {/each}
          </select>
          <span class="small muted">{t('settings.tokenizerHint')}</span>
        </div>
        <div class="field">
          <label for="p-token-letters"
            >{t('settings.tokenizerLetters')}
            <HelpDot tip={t('settings.tokenizerLettersHint')} /></label
          >
          <input
            id="p-token-letters"
            class="input data"
            value={project.settings.tokenizerLetters ?? ''}
            placeholder={t('settings.tokenizerLettersPlaceholder')}
            oninput={(e) => {
              project.settings.tokenizerLetters = (e.currentTarget as HTMLInputElement).value
              projectState.touch()
            }}
          />
        </div>
        {#if project.settings.tokenizer === 'custom'}
          <div class="field">
            <label for="p-token-pat">{t('settings.tokenizerPattern')}</label>
            <input
              id="p-token-pat"
              class="input mono"
              placeholder="[\\s·]+"
              bind:value={project.settings.tokenizerPattern}
              onchange={() => projectState.touch()}
            />
            <span class="small muted">{t('settings.tokenizerPatternHint')}</span>
          </div>
        {/if}
      </div>
    </section>
  </div>

  <h2 class="cat">{t('settings.groups.data')}</h2>
  <div class="groups">
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><FolderOutput size={15} />{t('common.export')}</h3>
      <div class="row">
        <button class="btn" onclick={() => projectState.exportFolder()}
          ><FolderOutput size={16} />{t('settings.exportFolder')}</button
        >
        <span class="small muted">{t('settings.exportFolderDesc')}</span>
      </div>
      <div class="row">
        <button class="btn" onclick={() => projectState.exportCsv()}
          ><FileSpreadsheet size={16} />{t('settings.exportCsv')}</button
        >
        <span class="small muted">{t('settings.exportCsvDesc')}</span>
      </div>
      <div class="row">
        <button class="btn" onclick={() => projectState.exportReadOnly()}
          ><Eye size={16} />{t('readonly.export')}</button
        >
        <span class="small muted">{t('readonly.exportDesc')}</span>
      </div>
    </section>

    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Trash2 size={15} />{t('settings.clear')} <HelpDot tip={t('settings.clearHint')} /></h3>
      <div class="row">
        <select class="select" bind:value={clearKind}>
          <option value="">{t('settings.clearPick')}</option>
          {#each CLEAR_KINDS as k (k)}<option value={k}
              >{t(`settings.clearKinds.${k}`)}（{clearCount(k)}）</option
            >{/each}
        </select>
        <button class="btn sm danger" disabled={!clearKind} onclick={doClear}
          ><Trash2 size={14} />{t('settings.clearBtn')}</button
        >
        <span class="small muted">{t('settings.clearHint')}</span>
      </div>
    </section>
  </div>

  <h2 class="cat">{t('settings.about')}</h2>
  <section class="card group about" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
    <div class="lockup" aria-label={t('app.name')}>{@html lockupSvg}</div>
    <p class="versions">
      {t('settings.version')}
      {info?.version ?? ''}
      {#if platform.kind === 'electron'}
        ·
        <span
          class:newer={latest &&
            info &&
            latest !== info.version &&
            updates.last?.status === 'newer'}
          >{latest ? t('settings.latestVersion', { v: latest }) : t('settings.latestUnknown')}</span
        >
      {/if}
      · {t('settings.license')}
    </p>
    {#if platform.kind === 'electron'}
      <div class="row update-now">
        <button class="btn sm" disabled={updates.checking} onclick={checkNow}
          ><RefreshCw size={14} />{t('settings.checkNow')}</button
        >
        {#if updates.checking}
          <span class="small muted">{t('settings.updateChecking')}</span>
        {:else if checkedNow && updates.last}
          {@const r = updates.last}
          <span class="small" class:muted={r.status === 'latest'} class:bad={r.status === 'failed'}
            >{r.status === 'newer'
              ? t('settings.updateNewer', { v: r.latest ?? '' })
              : r.status === 'latest'
                ? t('settings.updateLatest', { v: r.latest ?? info?.version ?? '' })
                : t(`settings.updateFailed.${r.error ?? 'offline'}`)}</span
          >
        {/if}
      </div>
    {/if}
    {#if info?.userDataPath}
      <p class="small muted">{t('settings.userData')}: {info.userDataPath}</p>
    {/if}
  </section>
</div>

<style>
  .page {
    padding: 24px 28px;
    max-width: 920px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  /* 大类（应用 / 项目 / 数据 / 关于）下面是一张张小卡片，每张一类设置 */
  .cat {
    margin: 14px 0 0;
    font-size: 15px;
    color: var(--text-2);
    letter-spacing: 0.02em;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .group {
    padding: 14px 18px 4px;
  }
  .group.about {
    padding-bottom: 14px;
  }
  .group h3 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 12px;
    font-size: 14px;
  }
  .group h3 :global(svg) {
    color: var(--accent-text);
  }
  .group > .row {
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
  /* 关于：整套标志（图标 + Qonlang + 千语集） */
  .lockup {
    margin: 10px 0 16px;
    color: var(--brand-mark);
    line-height: 0;
  }
  .lockup :global(svg) {
    height: 52px;
    max-width: 100%;
    width: auto;
  }
  .versions .newer {
    color: var(--accent-text);
    font-weight: 600;
  }
  .update-now {
    margin: 4px 0 10px;
  }
  .update-now {
    gap: 10px;
    flex-wrap: wrap;
  }
  .update-now .bad {
    color: var(--danger);
  }
</style>
