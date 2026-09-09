<script lang="ts">
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { createMorpheme, MORPHEME_TYPES } from '$lib/core/factory'
  import type { Id, Morpheme, MorphemeType } from '$lib/core/model'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import { makeCollator } from '$lib/core/collate'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import { Plus, Trash2, X, ChevronUp, ChevronDown } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const langId = $derived(projectState.currentLanguageId)
  let selectedId = $state<Id | null>(null)
  let typeFilter = $state<MorphemeType | ''>('')
  let query = $state('')
  let sort = $state<'alphabet' | 'type' | 'custom'>('alphabet')
  const collator = $derived(makeCollator(projectState.currentLanguage?.alphabet ?? []))

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return project.morphemes.filter((m) => {
      if (langId && m.languageId !== langId) return false
      if (typeFilter && m.type !== typeFilter) return false
      if (
        q &&
        !(
          m.form.toLowerCase().includes(q) ||
          m.gloss.toLowerCase().includes(q) ||
          Object.values(m.meaning).some((v) => v.toLowerCase().includes(q))
        )
      )
        return false
      return true
    })
  })
  const list = $derived.by(() => {
    const arr = [...filtered]
    if (sort === 'alphabet')
      arr.sort((a, b) => collator(a.form.replace(/^[-=]+/, ''), b.form.replace(/^[-=]+/, '')))
    else if (sort === 'type')
      arr.sort(
        (a, b) =>
          MORPHEME_TYPES.indexOf(a.type) - MORPHEME_TYPES.indexOf(b.type) ||
          collator(a.form, b.form)
      )
    return arr
  })
  function move(m: Morpheme, dir: -1 | 1): void {
    const i = list.indexOf(m)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    const a = project.morphemes.indexOf(m)
    const b = project.morphemes.indexOf(list[j])
    ;[project.morphemes[a], project.morphemes[b]] = [project.morphemes[b], project.morphemes[a]]
    projectState.touch()
  }
  const selected = $derived(project.morphemes.find((m) => m.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.morphemes.flatMap((m) => m.tags))].sort())
  const usedBy = $derived(
    selected
      ? project.lexemes.filter((l) =>
          l.etymology.sources.some((s) => s.kind === 'morpheme' && s.id === selected.id)
        )
      : []
  )
  const glossLangs = $derived(project.settings.glossLanguages)

  $effect(() => {
    inspectorTitle = selected ? selected.form || t('morphemes.title') : t('morphemes.title')
  })
  $effect(() => {
    const id = ui.takePending('morpheme')
    if (id) selectedId = id
  })

  function langName(id: Id): string {
    return project.languages.find((l) => l.id === id)?.name ?? ''
  }

  function add(): void {
    const lid = langId ?? project.settings.defaultLanguageId ?? project.languages[0]?.id
    if (!lid) return
    const m = createMorpheme(lid, typeFilter || 'root')
    project.morphemes.push(m)
    selectedId = m.id
    projectState.touch()
    queueMicrotask(() => document.getElementById('m-form')?.focus())
  }

  function remove(m: Morpheme): void {
    const idx = project.morphemes.indexOf(m)
    if (idx < 0) return
    const snap = $state.snapshot(m) as Morpheme
    project.morphemes.splice(idx, 1)
    if (selectedId === m.id) selectedId = null
    projectState.touch()
    ui.toast(t('morphemes.deleted', { form: snap.form }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.morphemes.splice(Math.min(idx, project.morphemes.length), 0, snap)
          selectedId = snap.id
          projectState.touch()
        }
      }
    })
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('morphemes.title')}</h1>
    <GuideLink section="morphemes" />
    <span class="badge">{t('morphemes.count', { n: list.length })}</span>
    <span class="grow"></span>
    <input class="input search" placeholder={t('morphemes.search')} bind:value={query} />
    <select class="select type" bind:value={typeFilter}>
      <option value="">{t('morphemes.allTypes')}</option>
      {#each MORPHEME_TYPES as mt (mt)}<option value={mt}>{t(`morphemes.types.${mt}`)}</option
        >{/each}
    </select>
    <select class="select type" bind:value={sort} title={t('lexicon.sort')}>
      <option value="alphabet">{t('lexicon.sortAlphabet')}</option>
      <option value="type">{t('morphemes.sortType')}</option>
      <option value="custom">{t('lexicon.sortCustom')}</option>
    </select>
    <button class="btn primary" onclick={add}><Plus size={16} />{t('morphemes.add')}</button>
  </div>
  <Hint id="morphemes" text={t('morphemes.hint')} />

  {#if list.length === 0}
    <p class="muted">{t('morphemes.empty')}</p>
  {:else}
    <div class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>{t('morphemes.form')}</th>
            <th>{t('morphemes.type')}</th>
            <th>{t('morphemes.gloss')}</th>
            <th>{t('morphemes.meaning')}</th>
            {#if !langId}<th>{t('nav.languages')}</th>{/if}
            <th></th>
            {#if sort === 'custom'}<th></th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each list as m (m.id)}
            <tr class:sel={selectedId === m.id} onclick={() => (selectedId = m.id)}>
              <td class="data form"
                >{m.form}{#if m.type === 'circumfix' && m.form2}…{m.form2}{/if}</td
              >
              <td><span class="badge">{t(`morphemes.types.${m.type}`)}</span></td>
              <td class="mono">{m.gloss}</td>
              <td class="meaning">{pickText(m.meaning, glossLangs)}</td>
              {#if !langId}<td class="small muted">{langName(m.languageId)}</td>{/if}
              <td class="tags-cell"
                >{#each m.tags as tg (tg)}<span class="badge">{tg}</span>{/each}</td
              >
              {#if sort === 'custom'}
                <td class="mv">
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.moveUp')}
                    onclick={(e) => {
                      e.stopPropagation()
                      move(m, -1)
                    }}><ChevronUp size={12} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.moveDown')}
                    onclick={(e) => {
                      e.stopPropagation()
                      move(m, 1)
                    }}><ChevronDown size={12} /></button
                  >
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if selected}
  {@const m = selected}
  <Portal>
    <div class="field">
      <label for="m-form">{t('morphemes.form')}</label>
      <input
        id="m-form"
        class="input data"
        bind:value={m.form}
        oninput={() => projectState.touch()}
      />
    </div>
    <div class="row two">
      <div class="field grow">
        <label for="m-type">{t('morphemes.type')}</label>
        <select
          id="m-type"
          class="select"
          bind:value={m.type}
          onchange={() => projectState.touch()}
        >
          {#each MORPHEME_TYPES as mt (mt)}<option value={mt}>{t(`morphemes.types.${mt}`)}</option
            >{/each}
        </select>
      </div>
      <div class="field grow">
        <label for="m-lang">{t('nav.languages')}</label>
        <select
          id="m-lang"
          class="select"
          bind:value={m.languageId}
          onchange={() => projectState.touch()}
        >
          {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
        </select>
      </div>
    </div>
    {#if m.type === 'circumfix' || m.type === 'infix' || m.type === 'pattern'}
      <div class="field">
        <label for="m-form2">{t('morphemes.form2')}</label>
        <input
          id="m-form2"
          class="input data"
          bind:value={m.form2}
          oninput={() => projectState.touch()}
        />
        <span class="hint">{t('morphemes.form2Hint')}</span>
      </div>
    {/if}
    <div class="field">
      <label for="m-gloss">{t('morphemes.gloss')}</label>
      <input
        id="m-gloss"
        class="input mono"
        bind:value={m.gloss}
        oninput={() => projectState.touch()}
      />
    </div>
    <div class="field">
      <span class="small muted">{t('morphemes.meaning')}</span>
      <LocalizedInput
        bind:value={m.meaning}
        languages={glossLangs}
        onchange={() => projectState.touch()}
      />
    </div>
    <div class="field">
      <span class="small muted">{t('morphemes.allomorphs')}</span>
      {#each m.allomorphs as a, i (i)}
        <div class="row allo">
          <input
            class="input data"
            bind:value={a.form}
            placeholder={t('morphemes.form')}
            oninput={() => projectState.touch()}
          />
          <input
            class="input data"
            bind:value={a.environment}
            placeholder={t('morphemes.environment')}
            oninput={() => projectState.touch()}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              m.allomorphs.splice(i, 1)
              projectState.touch()
            }}><X size={14} /></button
          >
        </div>
      {/each}
      <button
        class="btn ghost sm self-start"
        onclick={() => {
          m.allomorphs.push({ form: '', environment: '' })
          projectState.touch()
        }}><Plus size={14} />{t('morphemes.addAllomorph')}</button
      >
    </div>
    {#if project.categories.length}
      <div class="field">
        <span class="small muted">{t('lexicon.features')}</span>
        {#each project.categories as c (c.id)}
          <label class="row feat">
            <span class="grow small">{pickText(c.name, glossLangs)}</span>
            <select
              class="select"
              value={m.features[c.id] ?? ''}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value
                if (v) m.features[c.id] = v
                else delete m.features[c.id]
                projectState.touch()
              }}
            >
              <option value="">—</option>
              {#each c.values as v (v.id)}<option value={v.id}
                  >{pickText(v.name, glossLangs)}{v.abbr ? ` (${v.abbr})` : ''}</option
                >{/each}
            </select>
          </label>
        {/each}
      </div>
    {/if}
    <div class="field">
      <span class="small muted">{t('common.tags')}</span>
      <TagInput
        bind:tags={m.tags}
        suggestions={allTags}
        placeholder={t('lexicon.tagsPlaceholder')}
        onchange={() => projectState.touch()}
      />
    </div>
    <div class="field">
      <label for="m-notes">{t('common.notes')}</label>
      <textarea
        id="m-notes"
        class="textarea"
        bind:value={m.notes}
        oninput={() => projectState.touch()}
      ></textarea>
    </div>
    <div class="field">
      <span class="small muted">{t('morphemes.usedBy')}</span>
      {#if usedBy.length === 0}
        <span class="small muted">{t('morphemes.unused')}</span>
      {:else}
        <div class="chips">
          {#each usedBy as l (l.id)}<span class="badge data">{l.lemma}</span>{/each}
        </div>
      {/if}
    </div>
    <button class="btn sm danger" onclick={() => remove(m)}
      ><Trash2 size={14} />{t('common.delete')}</button
    >
  </Portal>
{/if}

<style>
  .mv {
    width: 44px;
    white-space: nowrap;
  }
  .page {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .page-head {
    gap: 8px;
    flex-wrap: wrap;
  }
  .search {
    width: 200px;
    min-width: 140px;
    flex: 1 1 160px;
    max-width: 260px;
  }
  .type {
    width: auto;
    min-width: 110px;
  }
  .table-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .tbl {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  .tbl th {
    position: sticky;
    top: 0;
    background: var(--bg);
    text-align: left;
    font-weight: 600;
    color: var(--text-2);
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .tbl td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .tbl tbody tr {
    cursor: pointer;
  }
  .tbl tbody tr:hover {
    background: var(--bg-hover);
  }
  .tbl tbody tr.sel {
    background: var(--accent-soft);
  }
  .form {
    font-weight: 500;
  }
  .meaning {
    max-width: 360px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .tags-cell {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .two {
    gap: 10px;
    align-items: flex-start;
  }
  .allo {
    gap: 6px;
    margin-bottom: 4px;
  }
  .feat {
    gap: 8px;
    margin: 3px 0;
  }
  .feat .select {
    width: 180px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .self-start {
    align-self: flex-start;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
</style>
