<script lang="ts">
  /** 词条下方的例句：默认只列几条，「全部」打开后滚动到底再加载下一批 */
  import { t } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { findExamples, type ExampleHit } from '$lib/core/examples'
  import type { Lexeme, Project } from '$lib/core/model'
  import { X, Quote } from '@lucide/svelte'

  let {
    lexeme,
    project,
    glossLangs = []
  }: { lexeme: Lexeme; project: Project; glossLangs?: string[] } = $props()

  const perEntry = $derived(Math.max(0, ui.prefs.examplesPerEntry ?? 3))
  /** 预览时只找 n+1 条，多的那条只用来判断要不要显示「全部」 */
  const preview = $derived(findExamples(project, lexeme, glossLangs, perEntry + 1))

  let showAll = $state(false)
  let visible = $state(30)
  const all = $derived(showAll ? findExamples(project, lexeme, glossLangs) : [])

  function onScroll(e: Event): void {
    const el = e.currentTarget as HTMLElement
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240 && visible < all.length)
      visible += 30
  }
  function open(): void {
    visible = 30
    showAll = true
  }
  const jump = (h: ExampleHit): void => {
    showAll = false
    if (h.kind === 'sentence') ui.jump('corpus', 'sentence', h.id)
    else if (h.kind === 'phrase') ui.jump('phrasebook', 'phrase', h.id)
    else ui.jump('docs', 'doc', h.id)
  }
</script>

{#if preview.length}
  <div class="field">
    <span class="small muted">{t('lexicon.examples')}</span>
    {#each preview.slice(0, perEntry) as h (h.kind + h.id + h.text)}
      <button class="ex" onclick={() => jump(h)}>
        <span class="badge">{t(`lexicon.exampleKinds.${h.kind}`)}</span>
        <span class="text data">{h.text}</span>
        {#if h.translation}<span class="tr small muted">{h.translation}</span>{/if}
      </button>
    {/each}
    {#if preview.length > perEntry}
      <button class="btn ghost sm" onclick={open}
        ><Quote size={13} />{t('lexicon.examplesAll')}</button
      >
    {/if}
  </div>
{/if}

{#if showAll}
  <div class="overlay" role="dialog" tabindex="-1">
    <div class="sheet">
      <div class="row head">
        <h2 class="grow">{t('lexicon.examplesFor', { lemma: lexeme.lemma })}</h2>
        <span class="small muted">{t('lexicon.count', { n: all.length })}</span>
        <button class="btn ghost icon" onclick={() => (showAll = false)}><X size={16} /></button>
      </div>
      <div class="list" onscroll={onScroll}>
        {#each all.slice(0, visible) as h (h.kind + h.id + h.text)}
          <button class="ex" onclick={() => jump(h)}>
            <span class="badge">{t(`lexicon.exampleKinds.${h.kind}`)}</span>
            <span class="text data">{h.text}</span>
            {#if h.translation}<span class="tr small muted">{h.translation}</span>{/if}
            {#if h.where}<span class="tiny muted">{h.where}</span>{/if}
          </button>
        {/each}
        {#if visible < all.length}<p class="small muted center">{t('common.loading')}</p>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .ex {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    text-align: left;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-2);
    cursor: pointer;
    color: inherit;
  }
  .ex:hover {
    border-color: var(--accent);
  }
  .ex .text {
    font-weight: 600;
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, #000 45%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }
  .sheet {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: min(860px, 92vw);
    height: min(80vh, 900px);
    display: flex;
    flex-direction: column;
    padding: 12px 16px;
    gap: 8px;
  }
  .list {
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .center {
    text-align: center;
  }
</style>
