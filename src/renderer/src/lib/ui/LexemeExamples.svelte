<script lang="ts">
  /** 词条下方的例句：默认只列几条，「全部」打开后滚动到底再加载下一批 */
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { findExamples, markParts, type ExampleHit } from '$lib/core/examples'
  import { ensureScriptFont, fontCss } from '$lib/script/fonts'
  import { sentenceScriptText, textScript } from '$lib/script/lexiconScript'
  import type { Id, Lexeme, Project, Script, Sentence } from '$lib/core/model'
  import { X, Quote } from '@lucide/svelte'

  let {
    lexeme,
    project,
    glossLangs = []
  }: { lexeme: Lexeme; project: Project; glossLangs?: string[] } = $props()

  const perEntry = $derived(Math.max(0, ui.prefs.examplesPerEntry ?? 3))
  /** 预览时只找 n+1 条，多的那条只用来判断要不要显示「全部」 */
  const preview = $derived(findExamples(project, lexeme, glossLangs, perEntry + 1, pickText))

  let showAll = $state(false)
  let visible = $state(30)
  let query = $state('')
  const found = $derived(
    showAll ? findExamples(project, lexeme, glossLangs, Infinity, pickText) : []
  )
  const all = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return found
    return found.filter((h) =>
      [h.text, h.translation, h.where].some((v) => v?.toLowerCase().includes(q))
    )
  })

  /** 设置里开了才多写一行文字、一行出处（像语料页那样） */
  const showScript = $derived(ui.prefs.examplesShowScript === true)
  const lang = $derived(project.languages.find((l) => l.id === lexeme.languageId))
  const scripts = $derived(showScript && lang ? lang.scripts : [])
  /** 文字行要拿整条例句现写：开着的时候才建这张表 */
  const sentences = $derived.by(() => {
    if (!scripts.length) return null
    const m = new Map<Id, Sentence>()
    for (const s of project.sentences) m.set(s.id, s)
    return m
  })
  // 内嵌字体自己注册一次：换了语言、换了文字也跟着来
  $effect(() => {
    for (const sc of scripts) ensureScriptFont(sc)
  })
  /** 一条例句的这套文字写法；短语按文字直接转，文档的段落不转 */
  function scriptLine(h: ExampleHit, sc: Script): string {
    const l = lang
    if (!l) return ''
    if (h.kind === 'sentence') {
      const s = sentences?.get(h.id)
      return s ? sentenceScriptText(project, l, sc, s) : ''
    }
    if (h.kind === 'phrase') return textScript(project, l, sc, h.text)
    return ''
  }

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

{#snippet row(h: ExampleHit, withWhere: boolean)}
  <button class="ex" onclick={() => jump(h)}>
    <span class="badge">{t(`lexicon.exampleKinds.${h.kind}`)}</span>
    {#each scripts as sc (sc.id)}
      {@const st = scriptLine(h, sc)}
      {#if st}<span
          class="scr"
          style={fontCss(sc)}
          dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
          title={sc.name}>{st}</span
        >{/if}
    {/each}
    <span class="text data"
      >{#each markParts(h.text, h.spans) as p, i (i)}{#if p.mark}<mark>{p.text}</mark
          >{:else}{p.text}{/if}{/each}</span
    >
    {#if h.translation}<span class="tr small muted">{h.translation}</span>{/if}
    {#if h.where && (withWhere || showScript)}<span class="tiny muted">{h.where}</span>{/if}
  </button>
{/snippet}

{#if preview.length}
  <!-- 例句跟上面的词条卡用一条分割线隔开，不另写标题 -->
  <div class="examples">
    {#each preview.slice(0, perEntry) as h, i (h.kind + h.id + i)}
      {@render row(h, false)}
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
          {@render row(h, true)}
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
  /* 命中的词：跟别处标匹配一个样子 */
  .ex mark {
    background: var(--accent-soft);
    color: inherit;
    border-radius: 3px;
    padding: 0 2px;
  }
  .ex .scr {
    display: block;
    max-width: 100%;
    font-size: 18px;
    line-height: 1.3;
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
