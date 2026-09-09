<script lang="ts">
  /** 短语簿：分类 → 短语；检视器编辑原文、译文、发音、变体、标签。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { createPhrase } from '$lib/core/factory'
  import type { Id, Phrase } from '$lib/core/model'
  import { transcribe } from '$lib/core/pronounce'
  import { renderScript } from '$lib/script/render'
  import { fontCss } from '$lib/script/fonts'
  import { buildIndex, analyzeToken, tokenize } from '$lib/engine/gloss'
  import { wordHover } from '$lib/state/wordHover.svelte'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import { Plus, Trash2, X, Wand2 } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const langId = $derived(
    projectState.currentLanguageId ??
      project.settings.defaultLanguageId ??
      project.languages[0]?.id ??
      null
  )
  const language = $derived(project.languages.find((l) => l.id === langId) ?? null)

  let selectedId = $state<Id | null>(null)
  let category = $state<string>('')
  let query = $state('')

  const inLang = $derived(project.phrasebook.filter((p) => !langId || p.languageId === langId))
  const categories = $derived([...new Set(inLang.map((p) => p.category).filter(Boolean))].sort())
  const list = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return inLang.filter(
      (p) =>
        (!category || p.category === category) &&
        (!q ||
          p.text.toLowerCase().includes(q) ||
          Object.values(p.translation).some((v) => v.toLowerCase().includes(q)))
    )
  })
  const selected = $derived(project.phrasebook.find((p) => p.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.phrasebook.flatMap((p) => p.tags))].sort())
  const gidx = $derived(language ? buildIndex(project, language.id) : null)
  function lexemeFor(word: string): Id | null {
    if (!gidx) return null
    const w = tokenize(word)[0]
    if (!w) return null
    return (
      analyzeToken(gidx, w, project.settings.morphemeBoundaries).find((a) => a.lexemeId)
        ?.lexemeId ?? null
    )
  }
  function hoverWord(e: MouseEvent, word: string): void {
    const id = lexemeFor(word)
    if (id) wordHover.show(id, (e.currentTarget as HTMLElement).getBoundingClientRect())
  }
  function clickWord(e: MouseEvent, word: string): void {
    const id = lexemeFor(word)
    if (!id) return
    e.stopPropagation()
    wordHover.hide(true)
    ui.jump('lexicon', 'lexeme', id)
  }

  $effect(() => {
    inspectorTitle = selected ? t('phrasebook.phrase') : t('phrasebook.title')
  })
  $effect(() => {
    const id = ui.takePending('phrase')
    if (id) {
      selectedId = id
      category = ''
    }
  })

  function touch(): void {
    projectState.touch()
  }
  function add(): void {
    if (!langId) return
    const p = createPhrase(langId, category)
    project.phrasebook.unshift(p)
    selectedId = p.id
    touch()
    queueMicrotask(() => document.getElementById('ph-text')?.focus())
  }
  function remove(p: Phrase): void {
    const idx = project.phrasebook.indexOf(p)
    const snap = $state.snapshot(p) as Phrase
    project.phrasebook.splice(idx, 1)
    if (selectedId === p.id) selectedId = null
    touch()
    ui.toast(t('phrasebook.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.phrasebook.splice(Math.min(idx, project.phrasebook.length), 0, snap)
          selectedId = snap.id
          touch()
        }
      }
    })
  }
  function derivePron(p: Phrase): void {
    if (!language) return
    for (const o of language.orthographies) {
      const ipa = transcribe(language, o, p.text)
      if (ipa != null && !p.pronunciations[o.id]?.irregular)
        p.pronunciations[o.id] = { ipa, irregular: false }
    }
    touch()
  }
  async function renameCategory(): Promise<void> {
    if (!category) return
    const name = (await ui.prompt(t('phrasebook.category'), category))?.trim()
    if (!name || name === category) return
    for (const p of inLang) if (p.category === category) p.category = name
    category = name
    touch()
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('phrasebook.title')}</h1>
    <GuideLink section="phrasebook" />
    <span class="grow"></span>
    <input class="input search" placeholder={t('phrasebook.search')} bind:value={query} />
    <button class="btn primary" onclick={add}><Plus size={16} />{t('phrasebook.add')}</button>
  </div>
  <Hint id="phrasebook" text={t('phrasebook.hint')} />

  {#if !language}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else}
    <div class="body">
      <aside class="cats">
        <button class="cat" class:active={category === ''} onclick={() => (category = '')}
          >{t('phrasebook.allCategories')}<span class="n">{inLang.length}</span></button
        >
        {#each categories as c (c)}
          <button
            class="cat"
            class:active={category === c}
            onclick={() => (category = c)}
            ondblclick={renameCategory}
            >{c}<span class="n">{inLang.filter((p) => p.category === c).length}</span></button
          >
        {/each}
        {#if categories.length === 0}<p class="tiny muted">{t('phrasebook.noCategories')}</p>{/if}
      </aside>
      <div class="scroll">
        {#if list.length === 0}
          <p class="muted">{t('phrasebook.empty')}</p>
        {:else}
          <div class="list">
            {#each list as p (p.id)}
              <div
                class="card item"
                class:sel={selectedId === p.id}
                role="button"
                tabindex="0"
                onclick={() => (selectedId = p.id)}
                onkeydown={(e) => e.key === 'Enter' && (selectedId = p.id)}
              >
                {#each language.scripts as sc (sc.id)}
                  {@const st = renderScript(language, sc, p.text)}
                  {#if st}<div
                      class="scr"
                      style={fontCss(sc)}
                      dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
                    >
                      {st}
                    </div>{/if}
                {/each}
                <div class="row">
                  <span class="data text grow words"
                    >{#each p.text.split(/(\s+)/) as w, i (i)}{#if w.trim()}<span
                          class="w"
                          class:link={!!lexemeFor(w)}
                          role="link"
                          tabindex="-1"
                          onmouseenter={(e) => hoverWord(e, w)}
                          onmouseleave={() => wordHover.hide()}
                          onclick={(e) => clickWord(e, w)}
                          onkeydown={() => {}}>{w}</span
                        >{:else}{w}{/if}{/each}{#if !p.text}—{/if}</span
                  >
                  {#if p.category && !category}<span class="badge">{p.category}</span>{/if}
                </div>
                {#each language.orthographies as o (o.id)}
                  {#if p.pronunciations[o.id]?.ipa}<div class="small data muted">
                      /{p.pronunciations[o.id].ipa}/
                    </div>{/if}
                {/each}
                <div class="small tr">{pickText(p.translation, glossLangs)}</div>
                {#if p.variants.length}<div class="tiny muted">
                    {p.variants.map((v) => v.text).join(' · ')}
                  </div>{/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if selected && language}
  {@const p = selected}
  <Portal>
    <div class="field">
      <label for="ph-text">{t('phrasebook.text')}</label>
      <textarea
        id="ph-text"
        class="textarea data"
        rows="2"
        bind:value={p.text}
        oninput={touch}
        onchange={() => derivePron(p)}
      ></textarea>
    </div>
    <div class="field">
      <span class="small muted">{t('corpus.translation')}</span>
      <LocalizedInput bind:value={p.translation} languages={glossLangs} onchange={touch} />
    </div>
    <div class="field">
      <label for="ph-cat">{t('phrasebook.category')}</label>
      <input id="ph-cat" class="input" list="ph-cats" bind:value={p.category} oninput={touch} />
      <datalist id="ph-cats"
        >{#each categories as c (c)}<option value={c}></option>{/each}</datalist
      >
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted grow">{t('lexicon.pronunciations')}</span><button
          class="btn ghost sm"
          onclick={() => derivePron(p)}><Wand2 size={13} />{t('phrasebook.derivePron')}</button
        >
      </div>
      {#each language.orthographies as o (o.id)}
        <div class="row kv">
          <span class="small oname">{o.name}</span>
          <input
            class="input data"
            value={p.pronunciations[o.id]?.ipa ?? ''}
            oninput={(e) => {
              p.pronunciations[o.id] = {
                ipa: (e.currentTarget as HTMLInputElement).value,
                irregular: true
              }
              touch()
            }}
          />
        </div>
      {/each}
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted grow">{t('phrasebook.variants')}</span><button
          class="btn ghost sm"
          onclick={() => {
            p.variants.push({ text: '', note: '' })
            touch()
          }}><Plus size={13} />{t('common.add')}</button
        >
      </div>
      {#each p.variants as v, i (i)}
        <div class="row kv">
          <input
            class="input data grow"
            placeholder={t('phrasebook.variantText')}
            bind:value={v.text}
            oninput={touch}
          />
          <input
            class="input grow"
            placeholder={t('phrasebook.variantNote')}
            bind:value={v.note}
            oninput={touch}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              p.variants.splice(i, 1)
              touch()
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>
    <div class="field">
      <span class="small muted">{t('common.tags')}</span>
      <TagInput bind:tags={p.tags} suggestions={allTags} onchange={touch} />
    </div>
    <button class="btn sm danger" onclick={() => remove(p)}
      ><Trash2 size={14} />{t('common.delete')}</button
    >
  </Portal>
{/if}

<style>
  .link {
    cursor: pointer;
    border-radius: 3px;
  }
  .link:hover {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
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
  .search {
    width: 220px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 16px;
  }
  .cats {
    width: 180px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: auto;
  }
  .cat {
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: left;
    border: 0;
    background: none;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-2);
    font-size: 13px;
  }
  .cat:hover {
    background: var(--bg-hover);
  }
  .cat.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .cat .n {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-3);
  }
  .scroll {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding-right: 4px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item:hover {
    border-color: var(--border-strong);
  }
  .item.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .text {
    font-size: 15px;
    font-family: var(--font-corpus-text);
  }
  .tr {
    font-family: var(--font-corpus-tr);
    color: var(--text-2);
  }
  .scr {
    font-size: 20px;
    line-height: 1.3;
  }
  .kv {
    gap: 6px;
    margin-bottom: 4px;
  }
  .oname {
    width: 90px;
    flex: none;
    color: var(--text-2);
  }
  .tiny {
    font-size: 11px;
  }
</style>
