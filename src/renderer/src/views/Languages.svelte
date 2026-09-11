<script lang="ts">
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import {
    createLanguage,
    languageChildren,
    languageLineage,
    wouldCreateCycle,
    LANGUAGE_COLORS,
    newId
  } from '$lib/core/factory'
  import type { Id, Language } from '$lib/core/model'
  import Portal from '$lib/ui/Portal.svelte'
  import LanguageNode from './LanguageNode.svelte'
  import { Plus, Trash2, Star, X } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  /** 回到这一页时还选着上次那门语言 */
  const memo = ui.memo<{ selectedId: Id | null }>('languages')
  let selectedId = $state<Id | null>(memo.selectedId ?? null)

  const project = $derived(projectState.project!)
  const children = $derived(languageChildren(project.languages))
  /** 顶栏搜索：命中的语言与它们的祖先；没搜索时为 null（全显示） */
  const visible = $derived.by((): Set<Id> | null => {
    const pq = parseQuery(ui.search, SEARCH_FIELDS.languages)
    if (!pq.terms.length) return null
    const byId = new Map(project.languages.map((l) => [l.id, l]))
    const hit = (l: (typeof project.languages)[number]): boolean =>
      matchQuery(pq, (f) =>
        f === 'name'
          ? [l.name]
          : f === 'abbr'
            ? [l.abbr]
            : f === 'note'
              ? [l.notes ?? '']
              : [l.name, l.abbr, l.notes ?? '']
      )
    const out = new Set<Id>()
    for (const l of project.languages) {
      if (!hit(l)) continue
      out.add(l.id)
      let p = l.parentId ? byId.get(l.parentId) : null
      while (p && !out.has(p.id)) {
        out.add(p.id)
        p = p.parentId ? (byId.get(p.parentId) ?? null) : null
      }
    }
    return out
  })
  const roots = $derived((children.get(null) ?? []).filter((l) => !visible || visible.has(l.id)))
  const selected = $derived(project.languages.find((l) => l.id === selectedId) ?? null)

  $effect(() => {
    inspectorTitle = selected ? selected.name || t('app.untitledLanguage') : t('languages.title')
  })
  $effect(() => {
    // 初次进入时选中当前语言
    if (!selectedId && projectState.currentLanguageId) selectedId = projectState.currentLanguageId
  })
  $effect(() => {
    const id = ui.takePending('language')
    if (id) selectedId = id
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('languages', {
      kind: 'language',
      lang: projectState.currentLanguageId,
      id: selectedId
    })
  })
  $effect(() => {
    const r = ui.takeRestore('languages')
    if (r?.view?.id) selectedId = r.view.id
  })
  $effect(() => {
    memo.selectedId = selectedId
  })

  function counts(l: Language): string {
    return t('languages.counts', {
      lexemes: project.lexemes.filter((x) => x.languageId === l.id).length,
      morphemes: project.morphemes.filter((x) => x.languageId === l.id).length,
      sentences: project.sentences.filter((x) => x.languageId === l.id).length
    })
  }

  function add(parentId: Id | null = null): void {
    const used = new Set(project.languages.map((l) => l.color))
    const color =
      LANGUAGE_COLORS.find((c) => !used.has(c)) ??
      LANGUAGE_COLORS[project.languages.length % LANGUAGE_COLORS.length]
    const l = createLanguage({ name: t('app.untitledLanguage'), parentId, color })
    project.languages.push(l)
    if (!project.settings.defaultLanguageId) project.settings.defaultLanguageId = l.id
    if (!projectState.currentLanguageId) projectState.currentLanguageId = l.id
    selectedId = l.id
    projectState.touch()
    queueMicrotask(() => document.getElementById('lang-name')?.focus())
  }

  function remove(l: Language): void {
    const idx = project.languages.indexOf(l)
    if (idx < 0) return
    const snapshot = $state.snapshot(l) as Language
    const orphaned = project.languages.filter((x) => x.parentId === l.id).map((x) => x.id)
    project.languages.splice(idx, 1)
    for (const x of project.languages) if (orphaned.includes(x.id)) x.parentId = null
    const wasDefault = project.settings.defaultLanguageId === l.id
    if (wasDefault) project.settings.defaultLanguageId = project.languages[0]?.id ?? null
    if (projectState.currentLanguageId === l.id)
      projectState.currentLanguageId = project.settings.defaultLanguageId
    if (selectedId === l.id) selectedId = null
    projectState.touch()
    ui.toast(t('languages.deleted', { name: snapshot.name }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.languages.splice(Math.min(idx, project.languages.length), 0, snapshot)
          for (const x of project.languages) if (orphaned.includes(x.id)) x.parentId = snapshot.id
          if (wasDefault) project.settings.defaultLanguageId = snapshot.id
          selectedId = snapshot.id
          projectState.touch()
        }
      }
    })
  }

  function setParent(l: Language, parentId: Id | null): void {
    if (wouldCreateCycle(project.languages, l.id, parentId)) {
      ui.error(t('languages.cycle'))
      return
    }
    l.parentId = parentId
    projectState.touch()
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('languages.title')}</h1>
    <GuideLink section="languages" />
    <span class="grow"></span>
    <button class="btn primary" onclick={() => add(null)}
      ><Plus size={16} />{t('languages.addLanguage')}</button
    >
  </div>

  {#if project.languages.length === 0}
    <p class="muted">{t('languages.empty')}</p>
  {:else}
    <div class="tree">
      {#each roots as l (l.id)}
        <LanguageNode
          {visible}
          language={l}
          {children}
          {selectedId}
          defaultId={project.settings.defaultLanguageId}
          onselect={(id) => (selectedId = id)}
          onaddchild={(id) => add(id)}
        />
      {/each}
    </div>
  {/if}
</div>

{#if selected}
  {@const lang = selected}
  <Portal>
    <div class="field">
      <label for="lang-name">{t('common.name')}</label>
      <input
        id="lang-name"
        class="input data"
        bind:value={lang.name}
        oninput={() => projectState.touch()}
      />
    </div>
    <div class="field">
      <label for="lang-abbr">{t('common.abbr')}</label>
      <input
        id="lang-abbr"
        class="input"
        bind:value={lang.abbr}
        oninput={() => projectState.touch()}
      />
    </div>
    <div class="field">
      <label for="lang-parent">{t('languages.parent')}</label>
      <select
        id="lang-parent"
        class="select"
        value={lang.parentId ?? ''}
        onchange={(e) => setParent(lang, (e.currentTarget as HTMLSelectElement).value || null)}
      >
        <option value="">{t('languages.noParent')}</option>
        {#each project.languages.filter((x) => x.id !== lang.id) as x (x.id)}
          <option value={x.id}>{x.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <span class="small muted">{t('common.color')}</span>
      <div class="swatches">
        {#each LANGUAGE_COLORS as c (c)}
          <button
            class="swatch"
            class:active={lang.color === c}
            style:background={c}
            aria-label={c}
            onclick={() => {
              lang.color = c
              projectState.touch()
            }}
          ></button>
        {/each}
        <input
          type="color"
          class="swatch custom"
          bind:value={lang.color}
          oninput={() => projectState.touch()}
        />
      </div>
    </div>
    <div class="field">
      <label for="lang-alphabet">{t('languages.alphabet')}</label>
      <input
        id="lang-alphabet"
        class="input data"
        value={lang.alphabet.join(' ')}
        onchange={(e) => {
          lang.alphabet = (e.currentTarget as HTMLInputElement).value.split(/\s+/).filter(Boolean)
          projectState.touch()
        }}
      />
      <span class="hint">{t('languages.alphabetHint')}</span>
    </div>
    <div class="field">
      <label for="lang-ignore">{t('languages.matchIgnore')}</label>
      <input
        id="lang-ignore"
        class="input data"
        placeholder=". 1 2 3"
        bind:value={lang.matchIgnore}
        oninput={() => projectState.touch()}
      />
      <span class="hint">{t('languages.matchIgnoreHint')}</span>
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted">{t('languages.dialects')}</span><HelpDot key="dialects" /><span
          class="grow"
        ></span><button
          class="btn ghost sm"
          onclick={() => {
            lang.dialects.push({ id: newId(), name: '', abbr: '' })
            projectState.touch()
          }}><Plus size={14} />{t('languages.addDialect')}</button
        >
      </div>
      {#each lang.dialects as d, i (d.id)}
        <div class="row dia">
          <input
            class="input"
            placeholder={t('common.name')}
            bind:value={d.name}
            oninput={() => projectState.touch()}
          />
          <input
            class="input abbr"
            placeholder={t('common.abbr')}
            bind:value={d.abbr}
            oninput={() => projectState.touch()}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              lang.dialects.splice(i, 1)
              projectState.touch()
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>
    <div class="field">
      <label for="lang-notes">{t('common.notes')}</label>
      <textarea
        id="lang-notes"
        class="textarea"
        bind:value={lang.notes}
        oninput={() => projectState.touch()}
      ></textarea>
    </div>

    {#if languageLineage(project.languages, lang.id).length > 1}
      <div class="field">
        <span class="small muted">{t('languages.lineage')}</span>
        <div class="lineage">
          {#each languageLineage(project.languages, lang.id) as a, i (a.id)}
            {#if i > 0}<span class="muted">›</span>{/if}
            <button class="link" onclick={() => (selectedId = a.id)}>{a.name}</button>
          {/each}
        </div>
      </div>
    {/if}

    <p class="small muted">{counts(lang)}</p>

    <div class="actions">
      {#if project.settings.defaultLanguageId !== lang.id}
        <button
          class="btn sm"
          onclick={() => {
            project.settings.defaultLanguageId = lang.id
            projectState.touch()
          }}><Star size={14} />{t('languages.setDefault')}</button
        >
      {/if}
      <button class="btn sm" onclick={() => add(lang.id)}
        ><Plus size={14} />{t('languages.addChild')}</button
      >
      <button class="btn sm danger" onclick={() => remove(lang)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    </div>
  </Portal>
{/if}

<style>
  .page {
    padding: 24px 28px;
    max-width: 960px;
  }
  .page-head {
    margin-bottom: 16px;
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .swatches {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .swatch.active {
    border-color: var(--text);
  }
  .swatch.custom {
    width: 26px;
    height: 26px;
    border: 1px solid var(--border);
    background: none;
  }
  .lineage {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    cursor: pointer;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .dia {
    gap: 6px;
    margin-bottom: 4px;
  }
  .dia .abbr {
    width: 90px;
  }
</style>
