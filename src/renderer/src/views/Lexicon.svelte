<script lang="ts">
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { platform } from '$lib/platform'
  import { i18n, t, pickText } from '$lib/i18n/index.svelte'
  import { createLexeme, createSense, now } from '$lib/core/factory'
  import { makeCollator } from '$lib/core/collate'
  import { toCsv } from '$lib/core/csv'
  import { lexemesToRows, morphemesToRows } from '$lib/importers/csvImport'
  import { parseLexc, mergeLexicanter } from '$lib/importers/lexicanter'
  import { derivePronunciations } from '$lib/core/pronounce'
  import { paradigmFor, paradigmSlots, deriveForms, makeContext } from '$lib/engine/morph'
  import type { EtymologySource, Id, Lexeme } from '$lib/core/model'
  import Portal from '$lib/ui/Portal.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import CsvImportWizard from '$lib/ui/CsvImportWizard.svelte'
  import LexemeCard from '$lib/ui/LexemeCard.svelte'
  import LexemeGraph from '$lib/ui/LexemeGraph.svelte'
  import Taxonomy from './Taxonomy.svelte'
  import { Plus, Trash2, X, Copy, Upload, Download, AlertTriangle, Eye, Pencil, Columns3, Waypoints, ArrowLeft, Wand2, RotateCcw } from '@lucide/svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const langId = $derived(projectState.currentLanguageId)
  const language = $derived(projectState.currentLanguage)
  const glossLangs = $derived(project.settings.glossLanguages)

  let mode = $state<'entries' | 'taxonomy' | 'csv'>('entries')
  let editMode = $state(false)
  let mainView = $state<'list' | 'graph'>('list')
  let selectedId = $state<Id | null>(null)
  let query = $state('')
  let posFilter = $state('')
  let tagFilter = $state('')
  let sort = $state<'alphabet' | 'recent'>('alphabet')
  let limit = $state(300)
  let columnsOpen = $state(false)

  $effect(() => {
    if (ui.pendingImport === 'csv') {
      ui.pendingImport = null
      mode = 'csv'
    }
    if (ui.pendingLexemeId) {
      selectedId = ui.pendingLexemeId
      ui.pendingLexemeId = null
      mode = 'entries'
      mainView = 'list'
      editMode = false
    }
  })

  const inLang = $derived(project.lexemes.filter((l) => !langId || l.languageId === langId))
  const lemmaCounts = $derived.by(() => {
    const m = new Map<string, number>()
    for (const l of inLang) m.set(l.languageId + ' ' + l.lemma, (m.get(l.languageId + ' ' + l.lemma) ?? 0) + 1)
    return m
  })
  const collator = $derived(makeCollator(language?.alphabet ?? []))
  const list = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const arr = inLang.filter((l) => {
      if (posFilter && l.posId !== posFilter) return false
      if (tagFilter && !l.tags.includes(tagFilter)) return false
      if (q && !(l.lemma.toLowerCase().includes(q) || l.senses.some((s) => Object.values(s.definition).some((d) => d.toLowerCase().includes(q))))) return false
      return true
    })
    if (sort === 'alphabet') arr.sort((a, b) => collator(a.lemma, b.lemma))
    else arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return arr
  })
  const selected = $derived(project.lexemes.find((l) => l.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.lexemes.flatMap((l) => l.tags))].sort())
  const isDup = (l: Lexeme): boolean => (lemmaCounts.get(l.languageId + ' ' + l.lemma) ?? 0) > 1
  const selLang = $derived(selected ? project.languages.find((x) => x.id === selected.languageId) : null)
  const relationKinds = $derived([...new Set(['synonym', 'antonym', 'related', ...project.lexemes.flatMap((l) => l.relations.map((r) => r.kind))])].filter(Boolean))

  $effect(() => {
    inspectorTitle = mode === 'taxonomy' ? t('taxonomy.title') : selected ? selected.lemma || t('lexicon.title') : t('lexicon.title')
  })

  // ───── 列 ─────
  interface Col {
    key: string
    label: string
  }
  const availableColumns = $derived.by((): Col[] => {
    const cols: Col[] = [{ key: 'pos', label: t('lexicon.colPos') }]
    for (const g of glossLangs) cols.push({ key: `def:${g}`, label: `${t('lexicon.colDefinition')} (${g})` })
    cols.push({ key: 'tags', label: t('lexicon.colTags') }, { key: 'proto', label: t('lexicon.colProto') }, { key: 'pron', label: t('lexicon.colPron') })
    for (const c of project.categories) cols.push({ key: `feat:${c.id}`, label: `${t('lexicon.colFeature')}: ${pickText(c.name, glossLangs)}` })
    const stems = new Set<string>()
    const forms = new Set<string>()
    for (const l of inLang) {
      for (const k of Object.keys(l.stems)) stems.add(k)
      for (const k of Object.keys(l.forms)) forms.add(k)
    }
    for (const s of [...stems].sort()) cols.push({ key: `stem:${s}`, label: `${t('lexicon.colStem')}: ${s}` })
    for (const f of [...forms].sort()) cols.push({ key: `form:${f}`, label: `${t('lexicon.colForm')}: ${f}` })
    cols.push({ key: 'updated', label: t('lexicon.colUpdated') })
    return cols
  })
  const activeColumns = $derived.by((): Col[] => {
    const keys = project.settings.lexiconColumns.length ? project.settings.lexiconColumns : ['pos', `def:${glossLangs[0] ?? 'zh'}`, 'tags']
    return keys.map((k) => availableColumns.find((c) => c.key === k)).filter((c): c is Col => !!c)
  })
  function toggleColumn(key: string): void {
    const cur = project.settings.lexiconColumns.length ? [...project.settings.lexiconColumns] : activeColumns.map((c) => c.key)
    const idx = cur.indexOf(key)
    if (idx >= 0) cur.splice(idx, 1)
    else cur.push(key)
    project.settings.lexiconColumns = availableColumns.map((c) => c.key).filter((k) => cur.includes(k))
    projectState.touch()
  }
  function cell(l: Lexeme, key: string): string {
    if (key === 'pos') return posLabel(l.posId)
    if (key.startsWith('def:')) {
      const g = key.slice(4)
      return l.senses.map((s) => s.definition[g] ?? '').filter(Boolean).join(' | ')
    }
    if (key === 'tags') return l.tags.join(', ')
    if (key === 'proto') return l.etymology.protoForm
    if (key === 'pron') return Object.values(l.pronunciations).map((p) => p.ipa).filter(Boolean).join(' / ')
    if (key.startsWith('feat:')) {
      const cid = key.slice(5)
      const vid = l.features[cid]
      const v = project.categories.find((c) => c.id === cid)?.values.find((x) => x.id === vid)
      return v ? pickText(v.name, glossLangs) || v.abbr : ''
    }
    if (key.startsWith('stem:')) return l.stems[key.slice(5)] ?? ''
    if (key.startsWith('form:')) return l.forms[key.slice(5)]?.surface ?? ''
    if (key === 'updated') return l.updatedAt.slice(0, 10)
    return ''
  }
  const dataCol = (key: string): boolean => key === 'proto' || key === 'pron' || key.startsWith('stem:') || key.startsWith('form:')

  function posLabel(id: Id | null): string {
    const p = project.posList.find((x) => x.id === id)
    return p ? p.abbr || pickText(p.name, glossLangs) : ''
  }
  function touch(l?: Lexeme): void {
    if (l) {
      l.updatedAt = now()
      const lg = project.languages.find((x) => x.id === l.languageId)
      if (lg) derivePronunciations(lg, l)
    }
    projectState.touch()
  }

  function add(): void {
    const lid = langId ?? project.settings.defaultLanguageId ?? project.languages[0]?.id
    if (!lid) return
    const l = createLexeme(lid, '')
    if (posFilter) l.posId = posFilter
    project.lexemes.push(l)
    selectedId = l.id
    mode = 'entries'
    mainView = 'list'
    editMode = true
    touch()
    queueMicrotask(() => document.getElementById('lx-lemma')?.focus())
  }
  function duplicate(l: Lexeme): void {
    const copy = structuredClone($state.snapshot(l)) as Lexeme
    copy.id = crypto.randomUUID()
    copy.createdAt = copy.updatedAt = now()
    project.lexemes.splice(project.lexemes.indexOf(l) + 1, 0, copy)
    selectedId = copy.id
    touch()
  }
  function remove(l: Lexeme): void {
    const idx = project.lexemes.indexOf(l)
    if (idx < 0) return
    const snap = $state.snapshot(l) as Lexeme
    project.lexemes.splice(idx, 1)
    if (selectedId === l.id) selectedId = null
    touch()
    ui.toast(t('lexicon.deleted', { lemma: snap.lemma }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.lexemes.splice(Math.min(idx, project.lexemes.length), 0, snap)
          selectedId = snap.id
          touch()
        }
      }
    })
  }

  // 词源来源
  function addSource(l: Lexeme, kind: EtymologySource['kind']): void {
    if (kind === 'external') l.etymology.sources.push({ kind, language: '', form: '', meaning: '' })
    else l.etymology.sources.push({ kind, id: '' })
    touch(l)
  }
  function sourceLabel(s: EtymologySource): string {
    if (s.kind === 'morpheme') return project.morphemes.find((m) => m.id === s.id)?.form ?? ''
    if (s.kind === 'lexeme') return project.lexemes.find((m) => m.id === s.id)?.lemma ?? ''
    return s.form
  }
  function setSourceByText(s: EtymologySource, text: string): void {
    if (s.kind === 'morpheme') s.id = project.morphemes.find((m) => m.form === text)?.id ?? ''
    else if (s.kind === 'lexeme') s.id = project.lexemes.find((m) => m.lemma === text && m.id !== selectedId)?.id ?? ''
  }
  function relLabel(kind: string): string {
    const k = t(`lexicon.relKinds.${kind}`)
    return k === `lexicon.relKinds.${kind}` ? kind : k
  }

  const paradigmOf = (l: Lexeme) => paradigmFor(project, l)
  const slotsOf = (l: Lexeme) => {
    const p = paradigmFor(project, l)
    return p ? paradigmSlots(p, project.categories, glossLangs) : []
  }
  function deriveNow(l: Lexeme): void {
    const p = paradigmFor(project, l)
    const lg = project.languages.find((x) => x.id === l.languageId)
    if (!p || !lg) return
    deriveForms(makeContext(project, lg), l, p)
    touch(l)
  }

  function renameKey(obj: Record<string, unknown>, oldKey: string, newKey: string): void {
    if (oldKey === newKey || !newKey) return
    const v = obj[oldKey]
    delete obj[oldKey]
    obj[newKey] = v
  }

  async function importLexicanter(): Promise<void> {
    const [f] = await platform.readTextFiles({ multiple: false, extensions: ['lexc', 'json'] })
    if (!f) return
    try {
      const file = parseLexc(f.content)
      const r = mergeLexicanter(project, file, { definitionLang: glossLangs[0] ?? 'en', uiLocale: i18n.locale, appVersion: '' })
      touch()
      ui.toast(t('lexicon.lexicanterDone', { lexemes: r.lexemes, languages: r.languages.length }))
    } catch (e) {
      ui.error((e as Error).message)
    }
  }
  async function exportCsv(kind: 'lexemes' | 'morphemes'): Promise<void> {
    const rows = kind === 'lexemes' ? lexemesToRows(project, inLang, glossLangs) : morphemesToRows(project.morphemes.filter((m) => !langId || m.languageId === langId), glossLangs)
    await platform.saveTextFile(`${language?.name ?? project.meta.name}-${kind}.csv`, '﻿' + toCsv(rows))
  }
  function selectFromCard(id: Id): void {
    selectedId = id
    const l = project.lexemes.find((x) => x.id === id)
    if (l && langId && l.languageId !== langId) projectState.currentLanguageId = l.languageId
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('lexicon.title')}</h1>
    <div class="seg">
      <button class:active={mode === 'entries'} onclick={() => (mode = 'entries')}>{t('lexicon.entries')}</button>
      <button class:active={mode === 'taxonomy'} onclick={() => (mode = 'taxonomy')}>{t('lexicon.taxonomy')}</button>
    </div>
    {#if mode === 'entries'}
      <div class="seg">
        <button class:active={!editMode} title={t('lexicon.modeView')} onclick={() => (editMode = false)}><Eye size={14} />{t('lexicon.modeView')}</button>
        <button class:active={editMode} title={t('lexicon.modeEdit')} onclick={() => (editMode = true)}><Pencil size={14} />{t('lexicon.modeEdit')}</button>
      </div>
    {/if}
    <span class="grow"></span>
    {#if mode === 'entries' && mainView === 'graph'}
      <button class="btn" onclick={() => (mainView = 'list')}><ArrowLeft size={16} />{t('lexicon.backToList')}</button>
    {:else if mode === 'entries'}
      <input class="input search" placeholder={t('lexicon.search')} bind:value={query} />
      <select class="select filter" bind:value={posFilter}>
        <option value="">{t('lexicon.allPos')}</option>
        {#each project.posList as p (p.id)}<option value={p.id}>{pickText(p.name, glossLangs) || p.abbr}</option>{/each}
      </select>
      <select class="select filter" bind:value={tagFilter}>
        <option value="">{t('lexicon.allTags')}</option>
        {#each allTags as tg (tg)}<option value={tg}>{tg}</option>{/each}
      </select>
      <select class="select filter sm" bind:value={sort} title={t('lexicon.sort')}>
        <option value="alphabet">{t('lexicon.sortAlphabet')}</option>
        <option value="recent">{t('lexicon.sortRecent')}</option>
      </select>
      <div class="menu" class:open={columnsOpen}>
        <button class="btn" onclick={() => (columnsOpen = !columnsOpen)}><Columns3 size={16} />{t('lexicon.columns')}</button>
        {#if columnsOpen}
          <div class="menu-list card cols">
            {#each availableColumns as c (c.key)}
              <label class="row"><input type="checkbox" checked={activeColumns.some((a) => a.key === c.key)} onchange={() => toggleColumn(c.key)} />{c.label}</label>
            {/each}
          </div>
        {/if}
      </div>
      <div class="menu">
        <button class="btn"><Upload size={16} />{t('lexicon.import')}</button>
        <div class="menu-list card hover">
          <button onclick={() => (mode = 'csv')}>{t('lexicon.importCsv')}</button>
          <button onclick={importLexicanter}>{t('lexicon.importLexicanter')}</button>
        </div>
      </div>
      <div class="menu">
        <button class="btn"><Download size={16} />{t('common.export')}</button>
        <div class="menu-list card hover">
          <button onclick={() => exportCsv('lexemes')}>{t('lexicon.exportCsv')}</button>
          <button onclick={() => exportCsv('morphemes')}>{t('lexicon.exportMorphemesCsv')}</button>
        </div>
      </div>
      <button class="btn primary" onclick={add}><Plus size={16} />{t('lexicon.add')}</button>
    {/if}
  </div>

  {#if mode === 'taxonomy'}
    <div class="scroll"><Taxonomy /></div>
  {:else if mode === 'csv'}
    <div class="scroll"><CsvImportWizard onclose={() => (mode = 'entries')} /></div>
  {:else if mainView === 'graph' && selected}
    <div class="scroll graph-wrap"><LexemeGraph {project} lexemeId={selected.id} onselect={selectFromCard} /></div>
  {:else if !project.languages.length}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if list.length === 0}
    <p class="muted">{t('lexicon.empty')}</p>
  {:else}
    <div class="row small muted"><span>{t('lexicon.count', { n: list.length })}</span></div>
    <div class="scroll">
      <table class="tbl">
        <thead>
          <tr>
            <th>{t('lexicon.lemma')}</th>
            {#each activeColumns as c (c.key)}<th>{c.label}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each list.slice(0, limit) as l (l.id)}
            <tr class:sel={selectedId === l.id} onclick={() => (selectedId = l.id)}>
              <td class="lemma data">{l.lemma || '—'}{#if isDup(l)}<span class="dup" title={t('lexicon.duplicate')}><AlertTriangle size={12} /></span>{/if}</td>
              {#each activeColumns as c (c.key)}
                {#if c.key === 'pos'}
                  <td class="pos">{#if l.posId}<span class="badge">{posLabel(l.posId)}</span>{/if}</td>
                {:else if c.key === 'tags'}
                  <td class="tags-cell">{#each l.tags.slice(0, 4) as tg (tg)}<span class="badge">{tg}</span>{/each}</td>
                {:else}
                  <td class:data={dataCol(c.key)} class:def={c.key.startsWith('def:')}>{cell(l, c.key)}</td>
                {/if}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if list.length > limit}
        <button class="btn ghost sm more" onclick={() => (limit += 300)}>… {list.length - limit}</button>
      {/if}
    </div>
  {/if}
</div>

{#if selected && mode === 'entries' && !editMode}
  {@const l = selected}
  <Portal>
    <div class="row card-actions">
      <button class="btn sm" onclick={() => (mainView = mainView === 'graph' ? 'list' : 'graph')}><Waypoints size={14} />{mainView === 'graph' ? t('lexicon.backToList') : t('lexicon.graph')}</button>
      <button class="btn ghost sm" onclick={() => (editMode = true)}><Pencil size={14} />{t('lexicon.modeEdit')}</button>
    </div>
    <LexemeCard lexeme={l} {project} onselect={selectFromCard} />
  </Portal>
{/if}

{#if selected && mode === 'entries' && editMode}
  {@const l = selected}
  <Portal>
    <div class="row card-actions">
      <button class="btn sm" onclick={() => (mainView = mainView === 'graph' ? 'list' : 'graph')}><Waypoints size={14} />{mainView === 'graph' ? t('lexicon.backToList') : t('lexicon.graph')}</button>
      <button class="btn ghost sm" onclick={() => (editMode = false)}><Eye size={14} />{t('lexicon.modeView')}</button>
    </div>
    <div class="field">
      <label for="lx-lemma">{t('lexicon.lemma')}</label>
      <input id="lx-lemma" class="input data big" bind:value={l.lemma} oninput={() => touch(l)} />
      {#if isDup(l)}<span class="hint warn"><AlertTriangle size={12} /> {t('lexicon.duplicate')}</span>{/if}
    </div>
    <div class="row two">
      <div class="field grow">
        <label for="lx-pos">{t('lexicon.pos')}</label>
        <select id="lx-pos" class="select" value={l.posId ?? ''} onchange={(e) => { l.posId = (e.currentTarget as HTMLSelectElement).value || null; touch(l) }}>
          <option value="">{t('lexicon.noPos')}</option>
          {#each project.posList as p (p.id)}<option value={p.id}>{pickText(p.name, glossLangs) || p.abbr}</option>{/each}
        </select>
      </div>
      <div class="field grow">
        <label for="lx-lang">{t('nav.languages')}</label>
        <select id="lx-lang" class="select" bind:value={l.languageId} onchange={() => touch(l)}>
          {#each project.languages as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
        </select>
      </div>
    </div>

    {#if project.categories.length}
      <div class="field">
        <span class="small muted">{t('lexicon.features')}</span>
        {#each project.categories as c (c.id)}
          <label class="row feat">
            <span class="grow small">{pickText(c.name, glossLangs)}</span>
            <select class="select" value={l.features[c.id] ?? ''} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) l.features[c.id] = v; else delete l.features[c.id]; touch(l) }}>
              <option value="">—</option>
              {#each c.values as v (v.id)}<option value={v.id}>{pickText(v.name, glossLangs)}{v.abbr ? ` (${v.abbr})` : ''}</option>{/each}
            </select>
          </label>
        {/each}
      </div>
    {/if}

    <div class="field">
      <span class="small muted">{t('common.tags')}</span>
      <TagInput bind:tags={l.tags} suggestions={allTags} placeholder={t('lexicon.tagsPlaceholder')} onchange={() => touch(l)} />
    </div>

    {#if selLang && selLang.dialects.length}
      <div class="field">
        <span class="small muted">{t('lexicon.dialects')}</span>
        <div class="chips">
          {#each selLang.dialects as d (d.id)}
            <label class="chip-check"><input type="checkbox" checked={l.dialectIds.includes(d.id)} onchange={(e) => { const on = (e.currentTarget as HTMLInputElement).checked; l.dialectIds = on ? [...l.dialectIds, d.id] : l.dialectIds.filter((x) => x !== d.id); touch(l) }} />{d.name}</label>
          {/each}
        </div>
      </div>
    {/if}

    <div class="field">
      <div class="row"><span class="small muted grow">{t('lexicon.senses')}</span><button class="btn ghost sm" onclick={() => { l.senses.push(createSense()); touch(l) }}><Plus size={14} />{t('lexicon.addSense')}</button></div>
      {#each l.senses as s, i (s.id)}
        <div class="sense card">
          <div class="row"><span class="num">{i + 1}</span><span class="grow"></span>{#if l.senses.length > 1}<button class="btn ghost icon sm" onclick={() => { l.senses.splice(i, 1); touch(l) }}><X size={14} /></button>{/if}</div>
          <LocalizedInput bind:value={s.definition} languages={glossLangs} multiline placeholder={t('lexicon.definition')} onchange={() => touch(l)} />
          <input class="input" placeholder={t('lexicon.register')} bind:value={s.register} oninput={() => touch(l)} />
          <TagInput bind:tags={s.tags} suggestions={allTags} placeholder={t('lexicon.senseTags')} onchange={() => touch(l)} />
        </div>
      {/each}
    </div>

    <div class="field">
      <span class="small muted">{t('lexicon.etymology')}</span>
      <div class="row two">
        <select class="select" bind:value={l.etymology.type} onchange={() => touch(l)}>
          {#each ['root', 'compound', 'borrowing', 'derivation', 'unknown'] as et (et)}<option value={et}>{t(`lexicon.etyTypes.${et}`)}</option>{/each}
        </select>
        <input class="input data" placeholder={t('lexicon.protoForm')} bind:value={l.etymology.protoForm} oninput={() => touch(l)} />
      </div>
      {#each l.etymology.sources as s, i (i)}
        <div class="row src">
          <span class="badge">{t(`lexicon.sourceKinds.${s.kind}`)}</span>
          {#if s.kind === 'external'}
            <input class="input" placeholder={t('lexicon.externalLanguage')} bind:value={s.language} oninput={() => touch(l)} />
            <input class="input data" placeholder={t('lexicon.externalForm')} bind:value={s.form} oninput={() => touch(l)} />
            <input class="input" placeholder={t('lexicon.externalMeaning')} bind:value={s.meaning} oninput={() => touch(l)} />
          {:else}
            <input class="input data grow" list={s.kind === 'morpheme' ? 'dl-morphemes' : 'dl-lexemes'} value={sourceLabel(s)} placeholder={s.kind === 'morpheme' ? t('lexicon.pickMorpheme') : t('lexicon.pickLexeme')} onchange={(e) => { setSourceByText(s, (e.currentTarget as HTMLInputElement).value); touch(l) }} />
          {/if}
          <button class="btn ghost icon sm" onclick={() => { l.etymology.sources.splice(i, 1); touch(l) }}><X size={14} /></button>
        </div>
      {/each}
      <div class="row">
        <button class="btn ghost sm" onclick={() => addSource(l, 'morpheme')}><Plus size={14} />{t('lexicon.sourceKinds.morpheme')}</button>
        <button class="btn ghost sm" onclick={() => addSource(l, 'lexeme')}><Plus size={14} />{t('lexicon.sourceKinds.lexeme')}</button>
        <button class="btn ghost sm" onclick={() => addSource(l, 'external')}><Plus size={14} />{t('lexicon.sourceKinds.external')}</button>
      </div>
      <datalist id="dl-morphemes">{#each project.morphemes as m (m.id)}<option value={m.form}>{m.gloss || pickText(m.meaning, glossLangs)}</option>{/each}</datalist>
      <datalist id="dl-lexemes">{#each project.lexemes as m (m.id)}{#if m.id !== l.id}<option value={m.lemma}>{pickText(m.senses[0]?.definition, glossLangs)}</option>{/if}{/each}</datalist>
      <textarea class="textarea" rows="2" placeholder={t('common.notes')} bind:value={l.etymology.notes} oninput={() => touch(l)}></textarea>
    </div>

    <div class="field">
      <div class="row"><span class="small muted grow">{t('lexicon.relations')}</span><button class="btn ghost sm" onclick={() => { l.relations.push({ kind: 'synonym', lexemeId: '' }); touch(l) }}><Plus size={14} />{t('lexicon.addRelation')}</button></div>
      {#each l.relations as r, i (i)}
        {@const known = relationKinds.includes(r.kind)}
        <div class="row kv">
          <select class="select kind" value={known ? r.kind : '__custom__'} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; r.kind = v === '__custom__' ? '' : v; touch(l) }}>
            {#each relationKinds as k (k)}<option value={k}>{relLabel(k)}</option>{/each}
            <option value="__custom__">{t('lexicon.customKind')}</option>
          </select>
          {#if !known}
            <input class="input kind" bind:value={r.kind} placeholder={t('lexicon.relationKind')} onchange={() => touch(l)} />
          {/if}
          <input class="input data grow" list="dl-lexemes" value={project.lexemes.find((x) => x.id === r.lexemeId)?.lemma ?? ''} placeholder={t('lexicon.relationTarget')} onchange={(e) => { r.lexemeId = project.lexemes.find((x) => x.lemma === (e.currentTarget as HTMLInputElement).value && x.id !== l.id)?.id ?? ''; touch(l) }} />
          <button class="btn ghost icon sm" onclick={() => { l.relations.splice(i, 1); touch(l) }}><X size={14} /></button>
        </div>
      {/each}
    </div>

    <div class="field">
      <div class="row"><span class="small muted grow">{t('lexicon.stems')}</span><button class="btn ghost sm" onclick={() => { l.stems[''] = ''; touch(l) }}><Plus size={14} />{t('lexicon.addStem')}</button></div>
      {#each Object.keys(l.stems) as k (k)}
        <div class="row kv">
          <input class="input" value={k} placeholder={t('lexicon.stemName')} onchange={(e) => { renameKey(l.stems, k, (e.currentTarget as HTMLInputElement).value.trim()); touch(l) }} />
          <input class="input data" bind:value={l.stems[k]} oninput={() => touch(l)} />
          <button class="btn ghost icon sm" onclick={() => { delete l.stems[k]; touch(l) }}><X size={14} /></button>
        </div>
      {/each}
    </div>

    {#if selLang}
      <div class="field">
        <span class="small muted">{t('lexicon.pronunciations')}</span>
        {#each selLang.orthographies as o (o.id)}
          <div class="row kv">
            <span class="small oname">{o.name}</span>
            <input class="input data" value={l.pronunciations[o.id]?.ipa ?? ''} oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; l.pronunciations[o.id] = { ipa: v, irregular: l.pronunciations[o.id]?.irregular ?? true }; touch(l) }} />
            <label class="row small" title={t('lexicon.irregular')}><input type="checkbox" checked={l.pronunciations[o.id]?.irregular ?? true} onchange={(e) => { l.pronunciations[o.id] = { ipa: l.pronunciations[o.id]?.ipa ?? '', irregular: (e.currentTarget as HTMLInputElement).checked }; touch(l) }} />!</label>
          </div>
        {/each}
      </div>
    {/if}

    <div class="field">
      <div class="row">
        <span class="small muted grow">{t('lexicon.forms')}</span>
        {#if paradigmOf(l)}<button class="btn ghost sm" onclick={() => deriveNow(l)}><Wand2 size={14} />{t('lexicon.deriveForms')}</button>{/if}
        <button class="btn ghost sm" onclick={() => { l.forms[''] = { surface: '', derived: false, override: true, trace: [] }; touch(l) }}><Plus size={14} />{t('lexicon.addForm')}</button>
      </div>
      {#if paradigmOf(l)}
        {#each slotsOf(l) as s (s.key)}
          {@const f = l.forms[s.label]}
          <div class="row kv" title={f?.trace?.join('\n') ?? ''}>
            <span class="slot small">{s.label}</span>
            <input class="input data" class:derived={f && !f.override} value={f?.surface ?? ''} placeholder="—" oninput={(e) => { l.forms[s.label] = { surface: (e.currentTarget as HTMLInputElement).value, derived: false, override: true, trace: [] }; touch(l) }} />
            {#if f?.override}
              <button class="btn ghost icon sm" title={t('lexicon.resetDerived')} onclick={() => { delete l.forms[s.label]; deriveNow(l) }}><RotateCcw size={13} /></button>
            {:else if f}
              <span class="badge">{t('lexicon.formsDerived')}</span>
            {/if}
          </div>
        {/each}
        {#if Object.keys(l.forms).some((k) => !slotsOf(l).some((s) => s.label === k))}<span class="small muted">{t('lexicon.extraForms')}</span>{/if}
      {:else if l.posId}
        <span class="hint">{t('lexicon.noParadigm')}</span>
      {/if}
      {#each Object.keys(l.forms).filter((k) => !slotsOf(l).some((s) => s.label === k)) as k (k)}
        <div class="row kv">
          <input class="input" value={k} placeholder={t('lexicon.slot')} onchange={(e) => { renameKey(l.forms, k, (e.currentTarget as HTMLInputElement).value.trim()); touch(l) }} />
          <input class="input data" bind:value={l.forms[k].surface} oninput={() => { l.forms[k].override = true; touch(l) }} />
          <button class="btn ghost icon sm" onclick={() => { delete l.forms[k]; touch(l) }}><X size={14} /></button>
        </div>
      {/each}
    </div>

    <div class="field">
      <label for="lx-notes">{t('common.notes')}</label>
      <textarea id="lx-notes" class="textarea" bind:value={l.notes} oninput={() => touch(l)}></textarea>
    </div>

    <div class="row actions">
      <button class="btn sm" onclick={() => duplicate(l)}><Copy size={14} />{t('soundChanges.duplicate')}</button>
      <button class="btn sm danger" onclick={() => remove(l)}><Trash2 size={14} />{t('common.delete')}</button>
    </div>
  </Portal>
{/if}

<style>
  .page {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
  }
  .page-head {
    gap: 8px;
    flex-wrap: wrap;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: var(--bg-elev);
    padding: 4px 10px;
    font-size: 13px;
    cursor: pointer;
    color: var(--text-2);
  }
  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .search {
    width: 180px;
  }
  .filter {
    width: 120px;
  }
  .filter.sm {
    width: 105px;
  }
  .menu {
    position: relative;
  }
  .menu-list {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 220px;
    padding: 4px;
    z-index: 10;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    display: flex;
  }
  .menu-list.hover {
    display: none;
  }
  .menu:hover .menu-list.hover,
  .menu:focus-within .menu-list.hover {
    display: flex;
  }
  .menu-list button {
    text-align: left;
    border: 0;
    background: transparent;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .menu-list button:hover {
    background: var(--bg-hover);
  }
  .menu-list.cols {
    max-height: 360px;
    overflow: auto;
    gap: 2px;
  }
  .menu-list.cols label {
    gap: 8px;
    padding: 3px 8px;
    font-size: 13px;
    white-space: nowrap;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .graph-wrap {
    padding-right: 4px;
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
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
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
  .lemma {
    font-weight: 500;
    white-space: nowrap;
    width: 1%;
  }
  .dup {
    color: var(--warn);
    margin-left: 4px;
    vertical-align: middle;
  }
  .pos {
    width: 1%;
    white-space: nowrap;
  }
  .def {
    color: var(--text-2);
  }
  .tags-cell {
    white-space: nowrap;
  }
  .tags-cell .badge {
    margin-right: 3px;
  }
  .more {
    margin: 8px;
  }
  .card-actions {
    margin-bottom: 12px;
  }
  .big {
    font-size: 18px;
  }
  .two {
    gap: 8px;
    align-items: flex-start;
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
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip-check {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: 13px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .sense {
    padding: 8px 10px;
    margin-bottom: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .num {
    font-size: 11px;
    color: var(--text-3);
  }
  .src,
  .kv {
    gap: 6px;
    margin-bottom: 4px;
  }
  .kind {
    width: 110px;
    flex: none;
  }
  .oname {
    width: 90px;
    flex: none;
    color: var(--text-2);
  }
  .slot {
    width: 110px;
    flex: none;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .input.derived {
    color: var(--accent-text);
  }
  .hint.warn {
    color: var(--warn);
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .actions {
    margin-top: 8px;
  }
</style>
