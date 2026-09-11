<script lang="ts">
  import { navScroll } from '$lib/ui/navScroll'
  import type { PageView } from '$lib/state/ui.svelte'
  import { platform } from '$lib/platform'
  import Menu from '$lib/ui/Menu.svelte'
  import CsvImportWizard from '$lib/ui/CsvImportWizard.svelte'
  import { toCsv } from '$lib/core/csv'
  import { morphemesToRows } from '$lib/importers/csvImport'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
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
  import {
    Plus,
    Trash2,
    X,
    ChevronUp,
    ChevronDown,
    Eye,
    Pencil,
    ListOrdered,
    Upload,
    Download
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import EtymologyEditor from '$lib/ui/EtymologyEditor.svelte'
  import MorphemeCard from '$lib/ui/MorphemeCard.svelte'
  import ColHead from '$lib/ui/ColHead.svelte'
  import StatsPanel from '$lib/ui/StatsPanel.svelte'
  import { morphemeStats } from '$lib/engine/stats'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const langId = $derived(projectState.currentLanguageId)
  /** 回到这一页时接着用上次的筛选、排序、子页与选中项；换了语言就不恢复选中与滚动 */
  const memo = ui.memo<{
    lang: Id | null
    selectedId: Id | null
    mode: 'entries' | 'stats'
    typeFilter: MorphemeType | ''
    sortKey: string | null
    sortDir: 'asc' | 'desc'
    customOrder: boolean
    colFilters: Record<string, Set<string>>
    editMode: boolean
  }>('morphemes')
  const sameLang = memo.lang === projectState.currentLanguageId
  let selectedId = $state<Id | null>(sameLang ? (memo.selectedId ?? null) : null)
  let mode = $state<'entries' | 'stats' | 'csv'>(memo.mode ?? 'entries')
  const mStats = $derived(mode === 'stats' ? morphemeStats(project, langId) : null)
  const pctOf = (n: number, total: number): string =>
    total ? `${Math.round((n / total) * 100)}%` : '—'
  function filterFromStats(key: string, value: string): void {
    setFilter(key, new Set([value]))
    mode = 'entries'
  }
  let typeFilter = $state<MorphemeType | ''>(memo.typeFilter ?? '')
  const query = $derived(ui.search)
  let sortKey = $state<string | null>(memo.sortKey ?? null)
  let sortDir = $state<'asc' | 'desc'>(memo.sortDir ?? 'desc')
  let customOrder = $state(memo.customOrder ?? false)
  let colFilters = $state<Record<string, Set<string>>>(memo.colFilters ?? {})
  const sort = $derived(customOrder ? 'custom' : 'alphabet')
  function cycleSort(key: string): void {
    if (customOrder) customOrder = false
    if (sortKey !== key) {
      sortKey = key
      sortDir = 'desc'
    } else if (sortDir === 'desc') sortDir = 'asc'
    else sortKey = null
  }
  function setFilter(key: string, sel: Set<string> | null): void {
    const next = { ...colFilters }
    if (sel) next[key] = sel
    else delete next[key]
    colFilters = next
  }
  function initialOf(form: string): string {
    const w = form.replace(/^[-=*·]+/, '')
    const alpha = projectState.currentLanguage?.alphabet ?? []
    for (const a of [...alpha].sort((x, y) => y.length - x.length))
      if (a && w.toLowerCase().startsWith(a.toLowerCase())) return a
    return Array.from(w)[0]?.toUpperCase() ?? ''
  }
  function colValue(m: Morpheme, key: string): string {
    if (key === 'form') return m.form
    if (key === 'type') return m.type
    if (key === 'gloss') return m.gloss
    if (key === 'meaning') return pickText(m.meaning, glossLangs)
    if (key === 'language') return langName(m.languageId)
    return ''
  }
  function filterValues(m: Morpheme, key: string): string[] {
    if (key === 'form') return [initialOf(m.form)]
    if (key === 'tags') return m.tags.length ? m.tags : ['']
    return [colValue(m, key)]
  }
  function filterOptions(key: string): { value: string; label: string; count: number }[] {
    const counts = new Map<string, number>()
    const base = project.morphemes.filter((m) => !langId || m.languageId === langId)
    for (const m of base)
      for (const v of filterValues(m, key)) counts.set(v, (counts.get(v) ?? 0) + 1)
    const label = (v: string): string => (key === 'type' ? t(`morphemes.types.${v}`) : v || '—')
    const out = [...counts].map(([value, count]) => ({ value, label: label(value), count }))
    return out.sort((a, b) => (key === 'form' ? collator(a.value, b.value) : b.count - a.count))
  }
  const filterable = (key: string): boolean =>
    key === 'form' || key === 'type' || key === 'tags' || key === 'language'
  let editMode = $state(sameLang && (memo.editMode ?? false))
  const collator = $derived(makeCollator(projectState.currentLanguage?.alphabet ?? []))

  const filtered = $derived.by(() => {
    const pq = parseQuery(query, SEARCH_FIELDS.morphemes)
    return project.morphemes.filter((m) => {
      if (langId && m.languageId !== langId) return false
      if (typeFilter && m.type !== typeFilter) return false
      for (const [key, sel] of Object.entries(colFilters))
        if (!filterValues(m, key).some((v) => sel.has(v))) return false
      if (pq.terms.length && !matchQuery(pq, (f) => morphemeFieldValues(m, f))) return false
      return true
    })
  })
  /** 搜索用：语素在某个字段里的文字 */
  function morphemeFieldValues(m: Morpheme, field: string | null): string[] {
    const meaning = Object.values(m.meaning)
    switch (field) {
      case 'form':
        return [m.form]
      case 'gloss':
        return [m.gloss]
      case 'meaning':
        return meaning
      case 'type':
        return [m.type, t(`morphemes.types.${m.type}`)]
      case 'allo':
        return m.allomorphs.map((a) => a.form)
      case 'tag':
        return m.tags
      case 'note':
        return [m.notes]
      default:
        return [m.form, m.gloss, ...meaning]
    }
  }
  const list = $derived.by(() => {
    const arr = [...filtered]
    const byForm = (a: Morpheme, b: Morpheme): number =>
      collator(a.form.replace(/^[-=]+/, ''), b.form.replace(/^[-=]+/, ''))
    if (customOrder) return arr
    if (!sortKey) arr.sort(byForm)
    else {
      const key = sortKey
      const dir = sortDir === 'asc' ? 1 : -1
      arr.sort((a, b) => {
        const c =
          key === 'type'
            ? MORPHEME_TYPES.indexOf(a.type) - MORPHEME_TYPES.indexOf(b.type)
            : key === 'tags'
              ? collator(a.tags.join(','), b.tags.join(','))
              : collator(colValue(a, key), colValue(b, key))
        return (c || byForm(a, b)) * dir
      })
    }
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
    inspectorTitle =
      mode === 'csv'
        ? t('importPreview.title')
        : mode === 'stats'
          ? t('stats.title')
          : selected
            ? selected.form || t('morphemes.title')
            : t('morphemes.title')
  })
  $effect(() => {
    const id = ui.takePending('morpheme')
    if (id) reveal(id)
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('morphemes', {
      kind: 'morpheme',
      lang: projectState.currentLanguageId,
      id: selectedId,
      mode,
      edit: editMode ? '1' : ''
    })
  })
  $effect(() => {
    const r = ui.takeRestore('morphemes')
    if (!r) return
    const v: PageView = r.view ?? {}
    selectedId = v.id ?? null
    mode = v.mode === 'stats' ? 'stats' : 'entries'
    editMode = v.edit === '1'
    ui.restoreScroll('morphemes', r.scroll)
  })
  $effect(() => {
    Object.assign(memo, {
      lang: projectState.currentLanguageId,
      selectedId,
      mode: mode === 'stats' ? 'stats' : 'entries',
      typeFilter,
      sortKey,
      sortDir,
      customOrder,
      colFilters: { ...colFilters },
      editMode
    })
  })
  if (sameLang && !ui.restoring('morphemes'))
    ui.restoreScroll('morphemes', ui.lastScroll('morphemes'))
  /** 从别处跳过来：清掉筛选、选中、滚到那一行并短暂高亮 */
  let flashId = $state<Id | null>(null)
  function reveal(id: Id): void {
    const m = project.morphemes.find((x) => x.id === id)
    if (!m) return
    if (langId && m.languageId !== langId) projectState.currentLanguageId = m.languageId
    ui.search = ''
    typeFilter = ''
    selectedId = id
    flashId = id
    setTimeout(() => {
      if (flashId === id) flashId = null
    }, 1800)
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .querySelector(`tr[data-id="${id}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      )
    )
  }

  async function exportCsv(): Promise<void> {
    const rows = morphemesToRows(
      project.morphemes.filter((m) => !langId || m.languageId === langId),
      project.settings.glossLanguages
    )
    const name = projectState.currentLanguage?.name ?? project.meta.name
    await platform.saveTextFile(`${name}-morphemes.csv`, '\ufeff' + toCsv(rows))
  }
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
    <div class="seg">
      <button class:active={mode === 'entries'} onclick={() => (mode = 'entries')}
        >{t('lexicon.entries')}</button
      >
      <button class:active={mode === 'stats'} onclick={() => (mode = 'stats')}
        >{t('stats.title')}</button
      >
    </div>
    <div class="seg">
      <button
        class:active={!editMode}
        title={t('lexicon.modeView')}
        onclick={() => (editMode = false)}><Eye size={14} />{t('lexicon.modeView')}</button
      >
      <button
        class:active={editMode}
        title={t('lexicon.modeEdit')}
        onclick={() => (editMode = true)}><Pencil size={14} />{t('lexicon.modeEdit')}</button
      >
    </div>
    <span class="grow"></span>
    <Menu label={t('lexicon.import')} icon={Upload}>
      <button onclick={() => (mode = 'csv')}>{t('lexicon.importCsv')}</button>
    </Menu>
    <Menu label={t('common.export')} icon={Download}>
      <button onclick={exportCsv}>{t('lexicon.exportMorphemesCsv')}</button>
    </Menu>
    <button class="btn primary" onclick={add}><Plus size={16} />{t('morphemes.add')}</button>
  </div>
  <Hint id="morphemes" text={t('morphemes.hint')} />

  {#if mode === 'csv'}
    <div class="scroll">
      <CsvImportWizard initialTarget="morphemes" onclose={() => (mode = 'entries')} />
    </div>
  {:else if mode === 'stats' && mStats}
    {@const st = mStats}
    <div class="scroll">
      <StatsPanel
        facts={[
          { label: t('stats.morph.total'), value: st.total },
          {
            label: t('stats.morph.withGloss'),
            value: st.withGloss,
            sub: pctOf(st.withGloss, st.total)
          },
          {
            label: t('stats.morph.withMeaning'),
            value: st.withMeaning,
            sub: pctOf(st.withMeaning, st.total)
          },
          { label: t('stats.morph.withAllomorphs'), value: st.withAllomorphs },
          {
            label: t('stats.morph.withEtymology'),
            value: st.withEtymology,
            sub: pctOf(st.withEtymology, st.total)
          },
          {
            label: t('stats.morph.usedInCorpus'),
            value: st.usedInCorpus,
            sub: pctOf(st.usedInCorpus, st.total)
          },
          { label: t('stats.morph.usedInEtymology'), value: st.usedInEtymology },
          { label: t('stats.morph.usedInParadigms'), value: st.usedInParadigms },
          { label: t('stats.morph.unused'), value: st.unused.length },
          { label: t('stats.morph.duplicates'), value: st.duplicateForms }
        ]}
        groups={[
          {
            title: t('stats.morph.byType'),
            buckets: st.byType.map((b) => ({ ...b, label: t(`morphemes.types.${b.key}`) })),
            onpick: (k) => filterFromStats('type', k)
          },
          {
            title: t('stats.morph.byTag'),
            buckets: st.byTag,
            onpick: (k) => filterFromStats('tags', k)
          },
          {
            title: t('stats.morph.byInitial'),
            buckets: st.byInitial,
            max: 40,
            onpick: (k) => filterFromStats('form', k)
          }
        ]}
        rankings={[
          {
            title: t('stats.morph.topUsed'),
            items: st.topUsed.map((x) => ({ id: x.morphemeId, label: x.form, n: x.n })),
            onpick: (id) => {
              mode = 'entries'
              reveal(id)
            }
          },
          {
            title: t('stats.morph.unusedList'),
            items: st.unused.slice(0, 60).map((x) => ({ id: x.id, label: x.form, n: 0 })),
            onpick: (id) => {
              mode = 'entries'
              reveal(id)
            }
          }
        ]}
      />
    </div>
  {:else if !project.morphemes.some((m) => !langId || m.languageId === langId)}
    <p class="muted">{t('morphemes.empty')}</p>
  {:else}
    <div class="table-wrap" use:navScroll={'morphemes'}>
      <table class="tbl">
        <thead>
          <tr>
            <th class="order">
              <button
                class="btn ghost icon sm"
                class:active={customOrder}
                title={t('table.customOrder')}
                onclick={() => (customOrder = !customOrder)}><ListOrdered size={14} /></button
              >
            </th>
            {#each [['form', t('morphemes.form')], ['type', t('morphemes.type')], ['gloss', t('morphemes.gloss')], ['meaning', t('morphemes.meaning')]] as [key, label] (key)}
              <th>
                <ColHead
                  {label}
                  sort={sortKey === key ? sortDir : null}
                  onsort={() => cycleSort(key)}
                  options={filterable(key) ? filterOptions(key) : undefined}
                  selected={colFilters[key] ?? null}
                  onfilter={(sel) => setFilter(key, sel)}
                />
              </th>
            {/each}
            {#if !langId}
              <th>
                <ColHead
                  label={t('nav.languages')}
                  sort={sortKey === 'language' ? sortDir : null}
                  onsort={() => cycleSort('language')}
                  options={filterOptions('language')}
                  selected={colFilters.language ?? null}
                  onfilter={(sel) => setFilter('language', sel)}
                />
              </th>
            {/if}
            <th>
              <ColHead
                label={t('common.tags')}
                sort={sortKey === 'tags' ? sortDir : null}
                onsort={() => cycleSort('tags')}
                options={filterOptions('tags')}
                selected={colFilters.tags ?? null}
                onfilter={(sel) => setFilter('tags', sel)}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {#each list as m (m.id)}
            <tr
              data-id={m.id}
              class:sel={selectedId === m.id}
              class:flash={flashId === m.id}
              onclick={() => (selectedId = m.id)}
            >
              <td class="mv">
                {#if sort === 'custom'}
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
                {/if}
              </td>
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
            </tr>
          {:else}
            <tr class="empty"><td colspan="99" class="muted">{t('table.noMatch')}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if selected && !editMode && mode !== 'csv'}
  {@const m = selected}
  <Portal>
    <div class="row card-actions">
      <button class="btn ghost sm" onclick={() => (editMode = true)}
        ><Pencil size={14} />{t('lexicon.modeEdit')}</button
      >
    </div>
    <MorphemeCard morpheme={m} {project} onselect={(id) => ui.jump('lexicon', 'lexeme', id)} />
  </Portal>
{/if}

{#if selected && editMode && mode !== 'csv'}
  {@const m = selected}
  <Portal>
    <div class="row card-actions">
      <button class="btn ghost sm" onclick={() => (editMode = false)}
        ><Eye size={14} />{t('lexicon.modeView')}</button
      >
    </div>
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
      <span class="small muted">{t('morphemes.allomorphs')}</span><HelpDot
        tip={t('morphemes.environmentHint')}
      />
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
      <div class="row">
        <span class="small muted">{t('lexicon.etymology')}</span><HelpDot key="etymology" />
      </div>
      <EtymologyEditor
        bind:etymology={m.etymology}
        {project}
        ownerId={m.id}
        ownerForm={m.form}
        {glossLangs}
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
  th.order {
    width: 34px;
    text-align: center;
  }
  th.order .btn.active {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  tr.flash td {
    animation: flash 1.8s ease-out;
  }
  @keyframes flash {
    0%,
    35% {
      background: color-mix(in srgb, var(--accent) 34%, transparent);
    }
    100% {
      background: transparent;
    }
  }
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
    white-space: nowrap;
  }
  .tags-cell > :global(.badge) {
    margin-right: 3px;
  }
  .card-actions {
    gap: 6px;
    margin-bottom: 10px;
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
