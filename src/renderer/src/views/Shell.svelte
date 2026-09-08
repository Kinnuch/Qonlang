<script lang="ts">
  import type { Component } from 'svelte'
  import { ui, SECTIONS, type Section } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import {
    Globe,
    AudioLines,
    PenTool,
    GitBranch,
    Puzzle,
    BookOpen,
    Table2,
    MessageSquareQuote,
    FileText,
    Settings,
    Save,
    PanelRight,
    X,
    Keyboard,
    Shirt
  } from '@lucide/svelte'
  import { chars } from '$lib/state/chars.svelte'
  import CharPanel from '$lib/ui/CharPanel.svelte'
  import WordPopover from '$lib/ui/WordPopover.svelte'
  import ScriptView from './ScriptView.svelte'
  import Skin from './Skin.svelte'
  import { ensureScriptFont } from '$lib/script/fonts'
  import Languages from './Languages.svelte'
  import SoundChanges from './SoundChanges.svelte'
  import Morphemes from './Morphemes.svelte'
  import Lexicon from './Lexicon.svelte'
  import Phonology from './Phonology.svelte'
  import Paradigms from './Paradigms.svelte'
  import Corpus from './Corpus.svelte'
  import SettingsView from './Settings.svelte'
  import Placeholder from './Placeholder.svelte'

  const icons: Record<Section, Component<{ size?: number }>> = {
    languages: Globe,
    phonology: AudioLines,
    script: PenTool,
    soundChanges: GitBranch,
    morphemes: Puzzle,
    lexicon: BookOpen,
    paradigms: Table2,
    corpus: MessageSquareQuote,
    docs: FileText,
    skin: Shirt,
    settings: Settings
  }

  let inspectorTitle = $state('')
  // 注册各语言内嵌的文字字体
  $effect(() => {
    for (const l of projectState.project?.languages ?? []) for (const sc of l.scripts) ensureScriptFont(sc)
  })

  // 拖动分隔条调整检视器宽度
  const MIN_W = 280
  const MAX_W = 900
  let dragging = $state(false)
  function startDrag(e: PointerEvent): void {
    e.preventDefault()
    dragging = true
    const startX = e.clientX
    const startW = ui.prefs.inspectorWidth
    const move = (ev: PointerEvent): void => {
      ui.prefs.inspectorWidth = Math.min(MAX_W, Math.max(MIN_W, startW + (startX - ev.clientX)))
    }
    const up = (): void => {
      dragging = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      void ui.savePrefs()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function closeProject(): void {
    if (projectState.dirty) {
      ui.toast(t('dialog.unsavedBody'), {
        timeout: 0,
        action: {
          label: t('dialog.saveAndClose'),
          run: async () => {
            if (await projectState.save()) projectState.close()
          }
        },
        secondary: { label: t('dialog.discardAndClose'), run: () => projectState.close() }
      })
      return
    }
    projectState.close()
  }
</script>

<div class="shell" class:no-inspector={!ui.inspectorOpen} class:dragging style:--inspector-w={`${ui.prefs.inspectorWidth}px`}>
  <nav class="nav">
    <button class="nav-logo" title={t('nav.home')} onclick={closeProject}>千</button>
    {#each SECTIONS.filter((s) => s !== 'settings' && s !== 'skin') as s (s)}
      {@const Icon = icons[s]}
      <button class="nav-btn" class:active={ui.section === s} title={ui.section === s && ui.previousSection ? t('nav.backTo', { name: t(`nav.${ui.previousSection}`) }) : t(`nav.${s}`)} onclick={() => ui.go(s)}>
        <Icon size={20} />
        <span class="nav-label">{t(`nav.${s}`)}</span>
      </button>
    {/each}
    <div class="grow"></div>
    <button class="nav-btn" class:active={ui.section === 'skin'} title={ui.section === 'skin' && ui.previousSection ? t('nav.backTo', { name: t(`nav.${ui.previousSection}`) }) : t('nav.skin')} onclick={() => ui.go('skin')}>
      <Shirt size={20} />
      <span class="nav-label">{t('nav.skin')}</span>
    </button>
    <button class="nav-btn" class:active={chars.open} title={t('chars.tooltip')} onmousedown={(e) => e.preventDefault()} onclick={() => chars.toggle()}>
      <Keyboard size={20} />
      <span class="nav-label">{t('chars.title')}</span>
    </button>
    <button class="nav-btn" class:active={ui.section === 'settings'} title={ui.section === 'settings' && ui.previousSection ? t('nav.backTo', { name: t(`nav.${ui.previousSection}`) }) : t('nav.settings')} onclick={() => ui.go('settings')}>
      <Settings size={20} />
      <span class="nav-label">{t('nav.settings')}</span>
    </button>
  </nav>

  <header class="topbar">
    <div class="row grow">
      <strong class="pname">{projectState.project?.meta.name || t('app.untitled')}</strong>
      {#if projectState.dirty}
        <span class="badge">{t('common.unsaved')}</span>
      {:else if projectState.lastSavedAt}
        <span class="badge">{t('common.saved')}</span>
      {/if}
    </div>
    <label class="row small muted">
      {t('topbar.currentLanguage')}
      <select class="select lang-select" bind:value={projectState.currentLanguageId}>
        <option value={null}>{t('topbar.allLanguages')}</option>
        {#each projectState.project?.languages ?? [] as l (l.id)}
          <option value={l.id}>{l.name}</option>
        {/each}
      </select>
    </label>
    <button class="btn icon" title={t('topbar.saveShortcut')} disabled={projectState.saving} onclick={() => projectState.save()}>
      <Save size={16} />
    </button>
    <button class="btn ghost icon" title={t('nav.inspector')} class:active={ui.inspectorOpen} onclick={() => (ui.inspectorOpen = !ui.inspectorOpen)}>
      <PanelRight size={16} />
    </button>
    <button class="btn ghost icon" title={t('dialog.closeProject')} onclick={closeProject}><X size={16} /></button>
  </header>

  <main class="main">
    {#if ui.section === 'languages'}
      <Languages bind:inspectorTitle />
    {:else if ui.section === 'soundChanges'}
      <SoundChanges bind:inspectorTitle />
    {:else if ui.section === 'script'}
      <ScriptView bind:inspectorTitle />
    {:else if ui.section === 'phonology'}
      <Phonology bind:inspectorTitle />
    {:else if ui.section === 'paradigms'}
      <Paradigms bind:inspectorTitle />
    {:else if ui.section === 'corpus'}
      <Corpus bind:inspectorTitle />
    {:else if ui.section === 'morphemes'}
      <Morphemes bind:inspectorTitle />
    {:else if ui.section === 'lexicon'}
      <Lexicon bind:inspectorTitle />
    {:else if ui.section === 'skin'}
      <Skin bind:inspectorTitle />
    {:else if ui.section === 'settings'}
      <SettingsView bind:inspectorTitle />
    {:else}
      <Placeholder section={ui.section} bind:inspectorTitle />
    {/if}
  </main>

  <aside class="inspector" hidden={!ui.inspectorOpen}>
    <div class="resizer" role="separator" aria-orientation="vertical" onpointerdown={startDrag}></div>
    <div class="inspector-head">
      <h3>{inspectorTitle || t('nav.inspector')}</h3>
    </div>
    <div class="inspector-body" id="inspector-slot"></div>
  </aside>
</div>
<CharPanel />
<WordPopover />

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-columns: var(--nav-w) 1fr var(--inspector-w);
    grid-template-rows: var(--topbar-h) 1fr;
    grid-template-areas:
      'nav top top'
      'nav main insp';
  }
  .shell.no-inspector {
    grid-template-columns: var(--nav-w) 1fr 0;
  }
  .nav {
    grid-area: nav;
    background: var(--bg-elev);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 8px 6px;
    gap: 2px;
  }
  .nav-logo {
    height: 36px;
    margin: 0 0 8px;
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 18px;
    color: var(--accent);
    border: 0;
    background: transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .nav-logo:hover {
    background: var(--accent-soft);
  }
  .nav-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 7px 0 5px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }
  .nav-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .nav-btn.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .nav-label {
    font-size: 10px;
    line-height: 1;
  }
  .topbar {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .pname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lang-select {
    width: 180px;
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .btn.active {
    color: var(--accent-text);
  }
  .main {
    grid-area: main;
    overflow: auto;
    min-width: 0;
  }
  .inspector {
    grid-area: insp;
    position: relative;
    border-left: 1px solid var(--border);
    background: var(--bg-elev);
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .resizer {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: col-resize;
    z-index: 5;
  }
  .resizer:hover,
  .dragging .resizer {
    background: var(--accent-soft);
  }
  .dragging {
    user-select: none;
    cursor: col-resize;
  }
  .inspector[hidden] {
    display: none;
  }
  .inspector-head {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .inspector-head h3 {
    text-transform: none;
    letter-spacing: 0;
    font-size: 14px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inspector-body {
    flex: 1;
    overflow: auto;
    padding: 16px;
  }
</style>
