<script lang="ts">
  /**
   * 小游戏面板：先挑项目（最近打开 / 示例工程），再挑语言，然后进玩法。
   * 项目只是读进来出题用，不会打开、也不会改动。
   */
  import type { Id, Project } from '$lib/core/model'
  import type { RecentEntry } from '$lib/platform/types'
  import { platform } from '$lib/platform'
  import { parseProject, readProjectText } from '$lib/core/serialize'
  import { t } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { alphabetUnits } from './letters'
  import Flashcard from './Flashcard.svelte'
  import Wordle from './Wordle.svelte'
  import Sage from './Sage.svelte'
  import CrosswordGame from './Crossword.svelte'
  import { X, ArrowLeft, Loader } from '@lucide/svelte'

  export type GameId = 'flashcard' | 'sage' | 'wordle' | 'crossword'

  let {
    game,
    recent = [],
    examples = [],
    onclose
  }: {
    game: GameId
    recent?: RecentEntry[]
    /** 示例工程：名字 + 怎么读进来 */
    examples?: { id: string; name: string; load: () => Promise<{ default: string }> }[]
    onclose: () => void
  } = $props()

  let project = $state.raw<Project | null>(null)
  let projectName = $state('')
  let languageId = $state<Id | null>(null)
  let loading = $state('')
  let error = $state('')

  const language = $derived(project?.languages.find((l) => l.id === languageId) ?? null)
  const units = $derived(alphabetUnits(language))

  async function pickRecent(entry: RecentEntry): Promise<void> {
    if (loading) return
    loading = entry.path ?? entry.name
    error = ''
    try {
      const r = await platform.openRecent(entry)
      if (!r) throw new Error(t('games.cantOpen'))
      use(parseProject(await readProjectText(r.content)), entry.name)
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = ''
    }
  }

  async function pickExample(ex: {
    id: string
    name: string
    load: () => Promise<{ default: string }>
  }): Promise<void> {
    if (loading) return
    loading = ex.id
    error = ''
    try {
      use(parseProject((await ex.load()).default), ex.name)
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = ''
    }
  }

  function use(p: Project, name: string): void {
    project = p
    projectName = p.meta.name || name
    // 只有一门语言就直接进
    const langs = p.languages
    languageId = langs.length === 1 ? langs[0].id : null
  }

  function back(): void {
    if (languageId) languageId = null
    else if (project) project = null
    else onclose()
  }
</script>

<div class="overlay" role="dialog" tabindex="-1">
  <div class="sheet card">
    <div class="row head sticky">
      <button class="btn ghost icon sm" title={t('common.back')} onclick={back}
        ><ArrowLeft size={16} /></button
      >
      <h2 class="grow">
        {t(`games.${game}.name`)}
        {#if projectName}<span class="small muted">· {projectName}</span>{/if}
        {#if language}<span class="small muted">· {language.name}</span>{/if}
      </h2>
      <button class="btn ghost icon sm" title={t('common.close')} onclick={onclose}
        ><X size={16} /></button
      >
    </div>

    {#if !project}
      <p class="small muted">{t('games.pickProject')}</p>
      {#if error}<p class="small warn">{error}</p>{/if}
      <div class="picks">
        {#each recent.filter((r) => r.path) as r (r.path)}
          <button class="pick card" disabled={!!loading} onclick={() => pickRecent(r)}>
            <strong>{r.name}</strong>
            <span class="tiny muted path">{r.path}</span>
            {#if loading === (r.path ?? r.name)}<Loader size={13} class="spin" />{/if}
          </button>
        {/each}
        {#each examples as ex (ex.id)}
          <button class="pick card" disabled={!!loading} onclick={() => pickExample(ex)}>
            <strong>{ex.name}</strong>
            <span class="tiny muted">{t('games.example')}</span>
            {#if loading === ex.id}<Loader size={13} class="spin" />{/if}
          </button>
        {/each}
      </div>
    {:else if !languageId}
      <p class="small muted">{t('games.pickLanguage')}</p>
      <div class="picks">
        {#each project.languages as l (l.id)}
          {@const n = project.lexemes.filter((x) => x.languageId === l.id).length}
          <button class="pick card" onclick={() => (languageId = l.id)}>
            <strong>{l.name}</strong>
            <span class="tiny muted">{t('games.wordCount', { n })}</span>
          </button>
        {/each}
      </div>
    {:else if language}
      {#if game === 'flashcard'}
        <Flashcard {project} {language} {units} />
      {:else if game === 'wordle'}
        <Wordle {project} {language} {units} />
      {:else if game === 'sage'}
        <Sage {project} {language} {units} />
      {:else}
        <CrosswordGame {project} {language} {units} onerror={(m) => ui.error(m)} />
      {/if}
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    z-index: 60;
    padding: 24px;
  }
  .sheet {
    width: min(960px, 100%);
    max-height: min(86vh, 900px);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* 卡片自带的内边距在这里太窄：挑项目那一屏四周留出点地方 */
    padding: 18px 22px 22px;
  }
  .head {
    gap: 8px;
  }
  /* 玩法里内容长时，标题这一行留在上面 */
  .head.sticky {
    position: sticky;
    top: -18px;
    z-index: 1;
    background: var(--bg-elev);
    padding: 2px 0 6px;
  }
  .head h2 {
    margin: 0;
    font-size: 18px;
  }
  .picks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    margin-bottom: 4px;
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
    text-align: left;
    padding: 12px 14px;
    min-height: 62px;
    justify-content: center;
    cursor: pointer;
  }
  .pick:hover {
    border-color: var(--accent);
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .warn {
    color: var(--warn);
  }
</style>
