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
  let query = $state('')
  const found = $derived(showAll ? findExamples(project, lexeme, glossLangs) : [])
  const all = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return found
    return found.filter((h) =>
      [h.text, h.translation, h.where].some((v) => v?.toLowerCase().includes(q))
    )
  })

  function onScroll(e: Event): void {
    const el = e.currentTarget as HTMLElement
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240 && visible < all.length)
      visible += 30
  }
  function open(): void {
    visible = 30
    query = ''
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
  <!-- 例句跟上面的词条卡用一条分割线隔开，不另写标题 -->
  <div class="examples">
    {#each preview.slice(0, perEntry) as h, i (h.kind + h.id + i)}
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
        <h2>{t('lexicon.examplesFor', { lemma: lexeme.lemma })}</h2>
        <input
          class="input grow"
          placeholder={t('lexicon.examplesSearch')}
          bind:value={query}
          oninput={() => (visible = 30)}
        />
        <span class="small muted">{t('lexicon.count', { n: all.length })}</span>
        <button class="btn ghost icon" onclick={() => (showAll = false)}><X size={16} /></button>
      </div>
      <div class="list" onscroll={onScroll}>
        {#each all.slice(0, visible) as h, i (h.kind + h.id + i)}
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
  .examples {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }
  .examples > .btn {
    align-self: flex-start;
  }
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
    background: var(--bg-sunken);
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
