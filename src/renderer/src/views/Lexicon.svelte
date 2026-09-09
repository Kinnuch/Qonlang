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
  import { etymologyOrigin } from '$lib/core/etymology'
  import LexemeExamples from '$lib/ui/LexemeExamples.svelte'
  import { lexemeScript } from '$lib/script/render'
  import { fontCss } from '$lib/script/fonts'
  import {
    paradigmFor,
    paradigmSlots,
    deriveForms,
    makeContext,
    type SlotDef
  } from '$lib/engine/morph'
  import {
    ETYMOLOGY_TYPES,
    type Id,
    type Lexeme,
    type Paradigm,
    type Script
  } from '$lib/core/model'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import CsvImportWizard from '$lib/ui/CsvImportWizard.svelte'
  import DictExport from '$lib/ui/DictExport.svelte'
  import Menu from '$lib/ui/Menu.svelte'
  import ImageCropper from '$lib/ui/ImageCropper.svelte'
  import { prepareImage } from '$lib/core/images'
  import { newId } from '$lib/core/factory'
  import EtymologyEditor from '$lib/ui/EtymologyEditor.svelte'
  import LexemeCard from '$lib/ui/LexemeCard.svelte'
  import LexemeGraph from '$lib/ui/LexemeGraph.svelte'
  import Taxonomy from './Taxonomy.svelte'
  import {
    Plus,
    Trash2,
    X,
    Copy,
    Upload,
    Download,
    AlertTriangle,
    Eye,
    Pencil,
    Columns3,
    Waypoints,
    ArrowLeft,
    Wand2,
    RotateCcw,
    ChevronUp,
    ChevronDown,
    ImagePlus,
    Merge
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const langId = $derived(projectState.currentLanguageId)
  const language = $derived(projectState.currentLanguage)
  const glossLangs = $derived(project.settings.glossLanguages)

  let mode = $state<'entries' | 'taxonomy' | 'csv' | 'export'>('entries')
  let editMode = $state(false)
  let mainView = $state<'list' | 'graph'>('list')
  let selectedId = $state<Id | null>(null)
  let query = $state('')
  let posFilter = $state('')
  let tagFilter = $state('')
  let sort = $state<'alphabet' | 'recent' | 'pos' | 'custom'>('alphabet')
  let limit = $state(300)
  /** Ctrl / Shift 多选出来的词条 */
  let multiIds = $state<Id[]>([])
  let lastIndex = $state(-1)
  /** 从别处跳转过来时短暂高亮 */
  let flashId = $state<Id | null>(null)

  $effect(() => {
    if (ui.pendingImport === 'csv') {
      ui.pendingImport = null
      mode = 'csv'
    }
    if (ui.pendingSelect?.kind === 'new' && ui.pendingSelect.id === 'lexeme') {
      ui.pendingSelect = null
      mode = 'entries'
      add()
    }
    if (ui.pendingLexemeId) {
      const id = ui.pendingLexemeId
      ui.pendingLexemeId = null
      editMode = false
      reveal(id)
    }
  })

  const inLang = $derived(project.lexemes.filter((l) => !langId || l.languageId === langId))
  const lemmaCounts = $derived.by(() => {
    const m = new Map<string, number>()
    for (const l of inLang)
      m.set(l.languageId + ' ' + l.lemma, (m.get(l.languageId + ' ' + l.lemma) ?? 0) + 1)
    return m
  })
  const collator = $derived(makeCollator(language?.alphabet ?? []))
  const list = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const arr = inLang.filter((l) => {
      if (posFilter && l.posId !== posFilter) return false
      if (tagFilter && !l.tags.includes(tagFilter)) return false
      if (
        q &&
        !(
          l.lemma.toLowerCase().includes(q) ||
          l.senses.some((s) => Object.values(s.definition).some((d) => d.toLowerCase().includes(q)))
        )
      )
        return false
      return true
    })
    if (sort === 'alphabet') arr.sort((a, b) => collator(a.lemma, b.lemma))
    else if (sort === 'recent') arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    else if (sort === 'pos')
      arr.sort(
        (a, b) => posLabel(a.posId).localeCompare(posLabel(b.posId)) || collator(a.lemma, b.lemma)
      )
    // custom：保持项目里的数组顺序
    return arr
  })
  const selected = $derived(project.lexemes.find((l) => l.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.lexemes.flatMap((l) => l.tags))].sort())
  /** 语域：内置常用项 + 项目里已经用过的 */
  const registerOptions = $derived([
    ...new Set([
      ...t('lexicon.registerPresets').split(','),
      ...project.lexemes.flatMap((l) => l.senses.map((se) => se.register)).filter(Boolean)
    ])
  ])
  const isDup = (l: Lexeme): boolean => (lemmaCounts.get(l.languageId + ' ' + l.lemma) ?? 0) > 1
  const duplicatesOf = (l: Lexeme): Lexeme[] =>
    project.lexemes.filter((x) => x.languageId === l.languageId && x.lemma === l.lemma)
  /** 把同形词条并成一条：义项按顺序接起来，词类叠加显示 */
  function mergeDuplicates(l: Lexeme): void {
    const group = duplicatesOf(l)
    if (group.length < 2) return
    const snap = $state.snapshot(project.lexemes) as Lexeme[]
    const target = group[0]
    const filled = (x: Lexeme): Lexeme['senses'] =>
      x.senses.filter((se) => Object.values(se.definition).some(Boolean))
    for (const other of group.slice(1)) {
      target.senses.push(...filled(other))
      target.tags.push(...other.tags)
      if (other.posId && other.posId !== target.posId)
        target.extraPosIds = [...new Set([...(target.extraPosIds ?? []), other.posId])]
      for (const [k, v] of Object.entries(other.stems)) target.stems[k] ??= v
      for (const [k, v] of Object.entries(other.forms)) target.forms[k] ??= v
      for (const [k, v] of Object.entries(other.pronunciations)) target.pronunciations[k] ??= v
      for (const [k, v] of Object.entries(other.scriptForms ?? {})) {
        if (!target.scriptForms) target.scriptForms = {}
        target.scriptForms[k] ??= v
      }
      for (const r of other.relations)
        if (!target.relations.some((x) => x.kind === r.kind && x.lexemeId === r.lexemeId))
          target.relations.push(r)
      if (other.images?.length) target.images = [...(target.images ?? []), ...other.images]
      if (other.notes) target.notes = target.notes ? `${target.notes}\n${other.notes}` : other.notes
      if (target.etymology.type === 'unknown' && other.etymology.type !== 'unknown')
        target.etymology = other.etymology
      project.lexemes.splice(project.lexemes.indexOf(other), 1)
    }
    target.senses = target.senses.filter(
      (se, i) => i === 0 || Object.values(se.definition).some(Boolean)
    )
    target.tags = [...new Set(target.tags)]
    selectedId = target.id
    touch(target)
    ui.toast(t('lexicon.merged', { n: group.length }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.lexemes = snap
          touch()
        }
      }
    })
  }
  const selLang = $derived(
    selected ? project.languages.find((x) => x.id === selected.languageId) : null
  )
  const relationKinds = $derived(
    [
      ...new Set([
        'synonym',
        'antonym',
        'related',
        ...ETYMOLOGY_TYPES,
        ...project.lexemes.flatMap((l) => l.relations.map((r) => r.kind))
      ])
    ].filter(Boolean)
  )

  $effect(() => {
    inspectorTitle =
      mode === 'taxonomy'
        ? t('taxonomy.title')
        : selected
          ? selected.lemma || t('lexicon.title')
          : t('lexicon.title')
  })

  // ───── 列 ─────
  interface Col {
    key: string
    label: string
  }
  const availableColumns = $derived.by((): Col[] => {
    const cols: Col[] = [{ key: 'pos', label: t('lexicon.colPos') }]
    for (const g of glossLangs)
      cols.push({ key: `def:${g}`, label: `${t('lexicon.colDefinition')} (${g})` })
    cols.push(
      { key: 'tags', label: t('lexicon.colTags') },
      { key: 'proto', label: t('lexicon.colProto') },
      { key: 'pron', label: t('lexicon.colPron') }
    )
    for (const c of project.categories)
      cols.push({
        key: `feat:${c.id}`,
        label: `${t('lexicon.colFeature')}: ${pickText(c.name, glossLangs)}`
      })
    for (const lg of project.languages)
      if (!selLang || lg.id === selLang.id)
        for (const sc of lg.scripts)
          cols.push({ key: `script:${sc.id}`, label: t('script.lexiconColumn', { name: sc.name }) })
    const stems = new Set<string>()
    const forms = new Set<string>()
    for (const l of inLang) {
      for (const k of Object.keys(l.stems)) stems.add(k)
      for (const k of Object.keys(l.forms)) forms.add(k)
    }
    for (const s of [...stems].sort())
      cols.push({ key: `stem:${s}`, label: `${t('lexicon.colStem')}: ${s}` })
    for (const f of [...forms].sort())
      cols.push({ key: `form:${f}`, label: `${t('lexicon.colForm')}: ${f}` })
    cols.push({ key: 'updated', label: t('lexicon.colUpdated') })
    return cols
  })
  /** 不同来源撞出同名的列，选列时容易点错，直接报出来 */
  const duplicateColumnLabels = $derived.by((): string[] => {
    const count = new Map<string, number>()
    for (const c of availableColumns) count.set(c.label, (count.get(c.label) ?? 0) + 1)
    return [...count].filter(([, n]) => n > 1).map(([label]) => label)
  })
  const activeColumns = $derived.by((): Col[] => {
    const keys = project.settings.lexiconColumns.length
      ? project.settings.lexiconColumns
      : ['pos', `def:${glossLangs[0] ?? 'zh'}`, 'tags']
    return keys.map((k) => availableColumns.find((c) => c.key === k)).filter((c): c is Col => !!c)
  })
  function toggleColumn(key: string): void {
    const cur = project.settings.lexiconColumns.length
      ? [...project.settings.lexiconColumns]
      : activeColumns.map((c) => c.key)
    const idx = cur.indexOf(key)
    if (idx >= 0) cur.splice(idx, 1)
    else cur.push(key)
    project.settings.lexiconColumns = availableColumns
      .map((c) => c.key)
      .filter((k) => cur.includes(k))
    projectState.touch()
  }
  // ───── 列宽（记忆在用户偏好里） ─────
  const colWidths = $derived(ui.prefs.lexiconColWidths ?? {})
  const hasWidths = $derived(Object.keys(colWidths).length > 0)
  const colStyle = (key: string): string => (colWidths[key] ? `width:${colWidths[key]}px` : '')
  let resizing: { key: string; x: number; w: number } | null = null
  function startResize(e: PointerEvent, key: string): void {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement
    resizing = { key, x: e.clientX, w: th.getBoundingClientRect().width }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function moveResize(e: PointerEvent): void {
    if (!resizing) return
    const w = Math.max(48, Math.round(resizing.w + e.clientX - resizing.x))
    ui.prefs.lexiconColWidths = { ...ui.prefs.lexiconColWidths, [resizing.key]: w }
  }
  function endResize(): void {
    if (!resizing) return
    resizing = null
    ui.savePrefsSoon()
  }
  function resetWidths(): void {
    ui.prefs.lexiconColWidths = {}
    void ui.savePrefs()
  }

  function cell(l: Lexeme, key: string): string {
    if (key === 'pos') return posLabelOf(l)
    if (key.startsWith('def:')) {
      const g = key.slice(4)
      const parts = l.senses.map((s) => s.definition[g] ?? '').filter(Boolean)
      if (parts.length < 2) return parts[0] ?? ''
      const sep = i18n.locale === 'zh' ? '、' : '. '
      return parts.map((d, i) => `${i + 1}${sep}${d}`).join(' ')
    }
    if (key === 'tags') return l.tags.join(', ')
    if (key === 'proto') return etymologyOrigin(project, l.etymology)
    if (key === 'pron')
      return Object.values(l.pronunciations)
        .map((p) => p.ipa)
        .filter(Boolean)
        .join(' / ')
    if (key.startsWith('feat:')) {
      const cid = key.slice(5)
      const vid = l.features[cid]
      const v = project.categories.find((c) => c.id === cid)?.values.find((x) => x.id === vid)
      return v ? pickText(v.name, glossLangs) || v.abbr : ''
    }
    if (key.startsWith('stem:')) return l.stems[key.slice(5)] ?? ''
    if (key.startsWith('form:')) return l.forms[key.slice(5)]?.surface ?? ''
    if (key.startsWith('script:')) {
      const sc = scriptOf(key.slice(7))
      const lg = project.languages.find((x) => x.id === l.languageId)
      return sc && lg ? lexemeScript(lg, sc, l) : ''
    }
    if (key === 'updated') return l.updatedAt.slice(0, 10)
    return ''
  }
  function moveLexeme(l: Lexeme, dir: -1 | 1): void {
    const i = list.indexOf(l)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    const a = project.lexemes.indexOf(l)
    const b = project.lexemes.indexOf(list[j])
    ;[project.lexemes[a], project.lexemes[b]] = [project.lexemes[b], project.lexemes[a]]
    projectState.touch()
  }
  // 配图
  let cropReq = $state<{
    img: HTMLImageElement
    mime: string
    resolve: (v: string | null) => void
  } | null>(null)
  function cropAsync(img: HTMLImageElement, mime: string): Promise<string | null> {
    return new Promise((resolve) => (cropReq = { img, mime, resolve }))
  }
  async function addImages(l: Lexeme): Promise<void> {
    const files = await platform.readBinaryFiles({
      multiple: true,
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
    })
    const size = project.settings.imageSize
    for (const f of files) {
      try {
        const p = await prepareImage(f.base64, f.name, size)
        const url = p.needsCrop ? await cropAsync(p.img, p.mime) : p.dataUrl
        if (!url) continue
        if (!l.images) l.images = []
        l.images.push({ id: newId(), dataUrl: url, caption: '' })
        touch(l)
      } catch (e) {
        ui.error(String(e))
      }
    }
  }
  function scriptOf(id: string): Script | null {
    for (const lg of project.languages) for (const sc of lg.scripts) if (sc.id === id) return sc
    return null
  }
  const dataCol = (key: string): boolean =>
    key === 'proto' || key === 'pron' || key.startsWith('stem:') || key.startsWith('form:')

  function posLabel(id: Id | null): string {
    const p = project.posList.find((x) => x.id === id)
    return p ? p.abbr || pickText(p.name, glossLangs) : ''
  }
  /** 合并过的词条可能带多个词类，一起显示 */
  function posLabelOf(l: Lexeme): string {
    return [l.posId, ...(l.extraPosIds ?? [])].map(posLabel).filter(Boolean).join(' ')
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

  function relLabel(kind: string): string {
    const k = t(`lexicon.relKinds.${kind}`)
    return k === `lexicon.relKinds.${kind}` ? kind : k
  }

  const paradigmOf = (l: Lexeme): Paradigm | null => paradigmFor(project, l)
  const slotsOf = (l: Lexeme): SlotDef[] => {
    const p = paradigmFor(project, l)
    return p ? paradigmSlots(p, project.categories, glossLangs) : []
  }
  function deriveNow(l: Lexeme): void {
    const p = paradigmFor(project, l)
    const lg = project.languages.find((x) => x.id === l.languageId)
    if (!p || !lg) return
    deriveForms(makeContext(project, lg), l, p, undefined, l.paradigmVariantId)
    touch(l)
  }
  /** 换构形或变体后，推导出来的形式要重算；手填的不动 */
  function rederive(l: Lexeme): void {
    for (const [k, f] of Object.entries(l.forms)) if (!f.override) delete l.forms[k]
    deriveNow(l)
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
      const r = mergeLexicanter(project, file, {
        definitionLang: glossLangs[0] ?? 'en',
        uiLocale: i18n.locale,
        appVersion: ''
      })
      touch()
      ui.toast(t('lexicon.lexicanterDone', { lexemes: r.lexemes, languages: r.languages.length }))
    } catch (e) {
      ui.error((e as Error).message)
    }
  }
  async function exportCsv(kind: 'lexemes' | 'morphemes'): Promise<void> {
    const rows =
      kind === 'lexemes'
        ? lexemesToRows(project, inLang, glossLangs)
        : morphemesToRows(
            project.morphemes.filter((m) => !langId || m.languageId === langId),
            glossLangs
          )
    await platform.saveTextFile(
      `${language?.name ?? project.meta.name}-${kind}.csv`,
      '﻿' + toCsv(rows)
    )
  }
  function selectFromCard(id: Id): void {
    reveal(id)
  }
  /** 选中并把左侧列表滚到该词，短暂高亮；过滤条件会挡住目标，所以先清掉 */
  function reveal(id: Id): void {
    const l = project.lexemes.find((x) => x.id === id)
    if (!l) return
    if (langId && l.languageId !== langId) projectState.currentLanguageId = l.languageId
    query = ''
    posFilter = ''
    tagFilter = ''
    mode = 'entries'
    mainView = 'list'
    selectedId = id
    multiIds = []
    flashId = id
    setTimeout(() => {
      if (flashId === id) flashId = null
    }, 1800)
    requestAnimationFrame(() => {
      const i = list.findIndex((x) => x.id === id)
      if (i >= limit) limit = i + 50
      requestAnimationFrame(() =>
        document
          .querySelector(`tr[data-id="${id}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      )
    })
  }
  function rowClick(e: MouseEvent, l: Lexeme, i: number): void {
    if (e.shiftKey && lastIndex >= 0) {
      const [a, b] = [Math.min(lastIndex, i), Math.max(lastIndex, i)]
      multiIds = list.slice(a, b + 1).map((x) => x.id)
    } else if (e.ctrlKey || e.metaKey) {
      multiIds = multiIds.includes(l.id) ? multiIds.filter((x) => x !== l.id) : [...multiIds, l.id]
      lastIndex = i
    } else {
      multiIds = []
      lastIndex = i
    }
    selectedId = l.id
  }
  function removeSelected(): void {
    const ids = new Set(multiIds)
    const snap = $state.snapshot(project.lexemes) as Lexeme[]
    project.lexemes = project.lexemes.filter((l) => !ids.has(l.id))
    if (selectedId && ids.has(selectedId)) selectedId = null
    multiIds = []
    touch()
    ui.toast(t('lexicon.bulkDeleted', { n: ids.size }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.lexemes = snap
          touch()
        }
      }
    })
  }
  async function tagSelected(): Promise<void> {
    const tag = (await ui.prompt(t('lexicon.bulkTagPrompt'), ''))?.trim()
    if (!tag) return
    for (const l of project.lexemes)
      if (multiIds.includes(l.id) && !l.tags.includes(tag)) {
        l.tags.push(tag)
        l.updatedAt = now()
      }
    touch()
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('lexicon.title')}</h1>
    <GuideLink section="lexicon" />
    <div class="seg">
      <button class:active={mode === 'entries'} onclick={() => (mode = 'entries')}
        >{t('lexicon.entries')}</button
      >
      <button class:active={mode === 'taxonomy'} onclick={() => (mode = 'taxonomy')}
        >{t('lexicon.taxonomy')}</button
      >
    </div>
    {#if mode === 'entries'}
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
    {/if}
    <span class="grow"></span>
    {#if mode === 'entries' && mainView === 'graph'}
      <button class="btn" onclick={() => (mainView = 'list')}
        ><ArrowLeft size={16} />{t('lexicon.backToList')}</button
      >
    {:else if mode === 'entries'}
      <input class="input search" placeholder={t('lexicon.search')} bind:value={query} />
      <select class="select filter" bind:value={posFilter}>
        <option value="">{t('lexicon.allPos')}</option>
        {#each project.posList as p (p.id)}<option value={p.id}
            >{pickText(p.name, glossLangs) || p.abbr}</option
          >{/each}
      </select>
      <select class="select filter" bind:value={tagFilter}>
        <option value="">{t('lexicon.allTags')}</option>
        {#each allTags as tg (tg)}<option value={tg}>{tg}</option>{/each}
      </select>
      <select class="select filter sm" bind:value={sort} title={t('lexicon.sort')}>
        <option value="alphabet">{t('lexicon.sortAlphabet')}</option>
        <option value="recent">{t('lexicon.sortRecent')}</option>
        <option value="pos">{t('lexicon.sortPos')}</option>
        <option value="custom">{t('lexicon.sortCustom')}</option>
      </select>
      <Menu label={t('lexicon.columns')} icon={Columns3} wide>
        {#each availableColumns as c (c.key)}
          <label data-keep-open
            ><input
              type="checkbox"
              checked={activeColumns.some((a) => a.key === c.key)}
              onchange={() => toggleColumn(c.key)}
            />{c.label}</label
          >
        {/each}
        <button onclick={resetWidths}>{t('lexicon.resetWidths')}</button>
      </Menu>
      <Menu label={t('lexicon.import')} icon={Upload}>
        <button onclick={() => (mode = 'csv')}>{t('lexicon.importCsv')}</button>
        <button onclick={importLexicanter}>{t('lexicon.importLexicanter')}</button>
      </Menu>
      <Menu label={t('common.export')} icon={Download}>
        <button onclick={() => exportCsv('lexemes')}>{t('lexicon.exportCsv')}</button>
        <button onclick={() => exportCsv('morphemes')}>{t('lexicon.exportMorphemesCsv')}</button>
        {#if language}<button onclick={() => (mode = 'export')}>{t('dict.menu')}</button>{/if}
      </Menu>
      <button class="btn primary" onclick={add}><Plus size={16} />{t('lexicon.add')}</button>
    {/if}
  </div>
  <Hint id="lexicon" text={t('lexicon.hint')} />

  {#if mode === 'taxonomy'}
    <div class="scroll"><Taxonomy /></div>
  {:else if mode === 'export' && language}
    <div class="scroll"><DictExport {language} onclose={() => (mode = 'entries')} /></div>
  {:else if mode === 'csv'}
    <div class="scroll"><CsvImportWizard onclose={() => (mode = 'entries')} /></div>
  {:else if mainView === 'graph' && selected}
    <div class="scroll graph-wrap">
      <LexemeGraph {project} lexemeId={selected.id} onselect={selectFromCard} />
    </div>
  {:else if !project.languages.length}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if list.length === 0}
    <p class="muted">{t('lexicon.empty')}</p>
  {:else}
    <div class="row small muted">
      <span>{t('lexicon.count', { n: list.length })}</span>
      {#if duplicateColumnLabels.length}
        <span class="warn"
          ><AlertTriangle size={12} />
          {t('lexicon.dupColumns', { list: duplicateColumnLabels.join('、') })}</span
        >
      {/if}
    </div>
    {#if multiIds.length > 1}
      <div class="row bulk">
        <span class="small">{t('lexicon.selectedN', { n: multiIds.length })}</span>
        <button class="btn ghost sm" onclick={tagSelected}>{t('lexicon.bulkTag')}</button>
        <button class="btn ghost sm danger" onclick={removeSelected}
          ><Trash2 size={14} />{t('common.delete')}</button
        >
        <button class="btn ghost sm" onclick={() => (multiIds = [])}>{t('lexicon.clearSel')}</button
        >
      </div>
    {/if}
    <div class="scroll">
      <table class="tbl" class:fixed={hasWidths}>
        <colgroup>
          {#if sort === 'custom'}<col style="width:56px" />{/if}
          <col style={colStyle('lemma')} />
          {#each activeColumns as c (c.key)}<col style={colStyle(c.key)} />{/each}
        </colgroup>
        <thead>
          <tr
            >{#if sort === 'custom'}<th></th>{/if}
            <th
              >{t('lexicon.lemma')}<span
                class="grip"
                role="separator"
                aria-label={t('lexicon.resizeCol')}
                onpointerdown={(e) => startResize(e, 'lemma')}
                onpointermove={moveResize}
                onpointerup={endResize}
              ></span></th
            >
            {#each activeColumns as c (c.key)}<th
                >{c.label}<span
                  class="grip"
                  role="separator"
                  aria-label={t('lexicon.resizeCol')}
                  onpointerdown={(e) => startResize(e, c.key)}
                  onpointermove={moveResize}
                  onpointerup={endResize}
                ></span></th
              >{/each}
          </tr>
        </thead>
        <tbody>
          {#each list.slice(0, limit) as l, li (l.id)}
            <tr
              data-id={l.id}
              class:sel={selectedId === l.id || multiIds.includes(l.id)}
              class:flash={flashId === l.id}
              class:dup-row={ui.prefs.highlightDuplicates && isDup(l)}
              onclick={(e) => rowClick(e, l, li)}
            >
              {#if sort === 'custom'}
                <td class="mv">
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.moveUp')}
                    onclick={(e) => {
                      e.stopPropagation()
                      moveLexeme(l, -1)
                    }}><ChevronUp size={12} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.moveDown')}
                    onclick={(e) => {
                      e.stopPropagation()
                      moveLexeme(l, 1)
                    }}><ChevronDown size={12} /></button
                  >
                </td>
              {/if}
              <td class="lemma data"
                >{l.lemma || '—'}{#if isDup(l)}<span class="dup" title={t('lexicon.duplicate')}
                    ><AlertTriangle size={12} /></span
                  >{/if}</td
              >
              {#each activeColumns as c (c.key)}
                {#if c.key === 'pos'}
                  <td class="pos"
                    >{#each [l.posId, ...(l.extraPosIds ?? [])].filter(Boolean) as pid (pid)}<span
                        class="badge">{posLabel(pid)}</span
                      >{/each}</td
                  >
                {:else if c.key === 'tags'}
                  <td class="tags-cell"
                    >{#each l.tags.slice(0, 4) as tg (tg)}<span class="badge">{tg}</span>{/each}</td
                  >
                {:else if c.key.startsWith('script:')}
                  {@const sc = scriptOf(c.key.slice(7))}
                  <td
                    class="scr"
                    style={sc ? fontCss(sc) : ''}
                    dir={sc?.direction === 'rtl' ? 'rtl' : 'ltr'}>{cell(l, c.key)}</td
                  >
                {:else}
                  <td class:data={dataCol(c.key)} class:def={c.key.startsWith('def:')}
                    >{cell(l, c.key)}</td
                  >
                {/if}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if list.length > limit}
        <button class="btn ghost sm more" onclick={() => (limit += 300)}
          >… {list.length - limit}</button
        >
      {/if}
    </div>
  {/if}
</div>

{#if selected && mode === 'entries' && !editMode}
  {@const l = selected}
  <Portal>
    <div class="row card-actions">
      <button class="btn sm" onclick={() => (mainView = mainView === 'graph' ? 'list' : 'graph')}
        ><Waypoints size={14} />{mainView === 'graph'
          ? t('lexicon.backToList')
          : t('lexicon.graph')}</button
      >
      <button class="btn ghost sm" onclick={() => (editMode = true)}
        ><Pencil size={14} />{t('lexicon.modeEdit')}</button
      >
    </div>
    <LexemeCard lexeme={l} {project} onselect={selectFromCard} />
    <LexemeExamples lexeme={l} {project} {glossLangs} />
  </Portal>
{/if}

{#if selected && mode === 'entries' && editMode}
  {@const l = selected}
  <Portal>
    <div class="row card-actions">
      <button class="btn sm" onclick={() => (mainView = mainView === 'graph' ? 'list' : 'graph')}
        ><Waypoints size={14} />{mainView === 'graph'
          ? t('lexicon.backToList')
          : t('lexicon.graph')}</button
      >
      <button class="btn ghost sm" onclick={() => (editMode = false)}
        ><Eye size={14} />{t('lexicon.modeView')}</button
      >
    </div>
    <div class="field">
      <label for="lx-lemma">{t('lexicon.lemma')}</label>
      <input id="lx-lemma" class="input data big" bind:value={l.lemma} oninput={() => touch(l)} />
      {#if isDup(l)}
        <div class="row dup-bar">
          <span class="hint warn"><AlertTriangle size={12} /> {t('lexicon.duplicate')}</span>
          <button class="btn ghost sm" onclick={() => mergeDuplicates(l)}
            ><Merge size={14} />{t('lexicon.merge')}</button
          >
        </div>
      {/if}
    </div>
    <div class="row two">
      <div class="field grow">
        <label for="lx-pos">{t('lexicon.pos')}</label>
        <select
          id="lx-pos"
          class="select"
          value={l.posId ?? ''}
          onchange={(e) => {
            l.posId = (e.currentTarget as HTMLSelectElement).value || null
            touch(l)
          }}
        >
          <option value="">{t('lexicon.noPos')}</option>
          {#each project.posList as p (p.id)}<option value={p.id}
              >{pickText(p.name, glossLangs) || p.abbr}</option
            >{/each}
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
        <span class="small muted">{t('lexicon.features')}</span><HelpDot key="features" />
        {#each project.categories as c (c.id)}
          <label class="row feat">
            <span class="grow small">{pickText(c.name, glossLangs)}</span>
            <select
              class="select"
              value={l.features[c.id] ?? ''}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value
                if (v) l.features[c.id] = v
                else delete l.features[c.id]
                touch(l)
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
        bind:tags={l.tags}
        suggestions={allTags}
        placeholder={t('lexicon.tagsPlaceholder')}
        onchange={() => touch(l)}
      />
    </div>

    {#if selLang && selLang.dialects.length}
      <div class="field">
        <span class="small muted">{t('lexicon.dialects')}</span>
        <div class="chips">
          {#each selLang.dialects as d (d.id)}
            <label class="chip-check"
              ><input
                type="checkbox"
                checked={l.dialectIds.includes(d.id)}
                onchange={(e) => {
                  const on = (e.currentTarget as HTMLInputElement).checked
                  l.dialectIds = on
                    ? [...l.dialectIds, d.id]
                    : l.dialectIds.filter((x) => x !== d.id)
                  touch(l)
                }}
              />{d.name}</label
            >
          {/each}
        </div>
      </div>
    {/if}

    <div class="field">
      <div class="row">
        <span class="small muted">{t('lexicon.senses')}</span><HelpDot key="senses" /><span
          class="grow"
        ></span><button
          class="btn ghost sm"
          onclick={() => {
            l.senses.push(createSense())
            touch(l)
          }}><Plus size={14} />{t('lexicon.addSense')}</button
        >
      </div>
      <datalist id="dl-registers"
        >{#each registerOptions as r (r)}<option value={r}></option>{/each}</datalist
      >
      {#each l.senses as s, i (s.id)}
        <div class="sense card">
          <div class="row">
            <span class="num">{i + 1}</span><span class="grow"
            ></span>{#if l.senses.length > 1}<button
                class="btn ghost icon sm"
                onclick={() => {
                  l.senses.splice(i, 1)
                  touch(l)
                }}><X size={14} /></button
              >{/if}
          </div>
          <LocalizedInput
            bind:value={s.definition}
            languages={glossLangs}
            multiline
            placeholder={t('lexicon.definition')}
            onchange={() => touch(l)}
          />
          <input
            class="input"
            list="dl-registers"
            placeholder={t('lexicon.register')}
            bind:value={s.register}
            oninput={() => touch(l)}
          />
        </div>
      {/each}
    </div>

    <div class="field">
      <span class="small muted">{t('lexicon.etymology')}</span><HelpDot key="etymology" />
      <EtymologyEditor
        bind:etymology={l.etymology}
        {project}
        ownerId={l.id}
        ownerForm={l.lemma}
        {glossLangs}
        onchange={() => touch(l)}
      />
    </div>

    <div class="field">
      <div class="row">
        <span class="small muted">{t('lexicon.relations')}</span><HelpDot key="relations" /><span
          class="grow"
        ></span><button
          class="btn ghost sm"
          onclick={() => {
            l.relations.push({ kind: 'synonym', lexemeId: '' })
            touch(l)
          }}><Plus size={14} />{t('lexicon.addRelation')}</button
        >
      </div>
      {#each l.relations as r, i (i)}
        {@const known = relationKinds.includes(r.kind)}
        <div class="row kv">
          <select
            class="select kind"
            value={known ? r.kind : '__custom__'}
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value
              r.kind = v === '__custom__' ? '' : v
              touch(l)
            }}
          >
            {#each relationKinds as k (k)}<option value={k}>{relLabel(k)}</option>{/each}
            <option value="__custom__">{t('lexicon.customKind')}</option>
          </select>
          {#if !known}
            <input
              class="input kind"
              bind:value={r.kind}
              placeholder={t('lexicon.relationKind')}
              onchange={() => touch(l)}
            />
          {/if}
          <input
            class="input data grow"
            list="dl-lexemes"
            value={project.lexemes.find((x) => x.id === r.lexemeId)?.lemma ?? ''}
            placeholder={t('lexicon.relationTarget')}
            onchange={(e) => {
              r.lexemeId =
                project.lexemes.find(
                  (x) => x.lemma === (e.currentTarget as HTMLInputElement).value && x.id !== l.id
                )?.id ?? ''
              touch(l)
            }}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              l.relations.splice(i, 1)
              touch(l)
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>

    <div class="field">
      <div class="row">
        <span class="small muted">{t('lexicon.stems')}</span><HelpDot key="stems" /><span
          class="grow"
        ></span><button
          class="btn ghost sm"
          onclick={() => {
            l.stems[''] = ''
            touch(l)
          }}><Plus size={14} />{t('lexicon.addStem')}</button
        >
      </div>
      {#each Object.keys(l.stems) as k (k)}
        <div class="row kv">
          <input
            class="input"
            value={k}
            placeholder={t('lexicon.stemName')}
            onchange={(e) => {
              renameKey(l.stems, k, (e.currentTarget as HTMLInputElement).value.trim())
              touch(l)
            }}
          />
          <input class="input data" bind:value={l.stems[k]} oninput={() => touch(l)} />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              delete l.stems[k]
              touch(l)
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>

    {#if selLang}
      <div class="field">
        <span class="small muted">{t('lexicon.pronunciations')}</span><HelpDot
          key="pronunciations"
        />
        {#each selLang.orthographies as o (o.id)}
          <div class="row kv">
            <span class="small oname">{o.name}</span>
            <input
              class="input data"
              value={l.pronunciations[o.id]?.ipa ?? ''}
              oninput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value
                l.pronunciations[o.id] = {
                  ipa: v,
                  irregular: l.pronunciations[o.id]?.irregular ?? true
                }
                touch(l)
              }}
            />
            <label class="row small" title={t('lexicon.irregular')}
              ><input
                type="checkbox"
                checked={l.pronunciations[o.id]?.irregular ?? true}
                onchange={(e) => {
                  l.pronunciations[o.id] = {
                    ipa: l.pronunciations[o.id]?.ipa ?? '',
                    irregular: (e.currentTarget as HTMLInputElement).checked
                  }
                  touch(l)
                }}
              />!</label
            >
          </div>
        {/each}
      </div>
      {#if selLang.scripts.length}
        <div class="field">
          <span class="small muted">{t('script.override')}</span>
          {#each selLang.scripts as sc (sc.id)}
            <div class="row kv">
              <span class="small oname">{sc.name}</span>
              <input
                class="input scr"
                style={fontCss(sc)}
                dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
                value={l.scriptForms?.[sc.id] ?? ''}
                placeholder={lexemeScript(selLang, sc, l, l.lemma)}
                title={t('script.overrideHint')}
                oninput={(e) => {
                  if (!l.scriptForms) l.scriptForms = {}
                  const v = (e.currentTarget as HTMLInputElement).value
                  if (v) l.scriptForms[sc.id] = v
                  else delete l.scriptForms[sc.id]
                  touch(l)
                }}
              />
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <div class="field">
      <div class="row two">
        <select
          class="select"
          value={l.paradigmId ?? ''}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value
            l.paradigmId = v || null
            l.paradigmVariantId = null
            rederive(l)
          }}
        >
          <option value="">{t('lexicon.paradigmByPos')}</option>
          {#each project.paradigms as pa (pa.id)}<option value={pa.id}
              >{pickText(pa.name, glossLangs) || t('paradigms.untitled')}</option
            >{/each}
        </select>
        {#if (paradigmOf(l)?.variants.length ?? 0) > 0}
          <select
            class="select"
            value={l.paradigmVariantId ?? ''}
            onchange={(e) => {
              l.paradigmVariantId = (e.currentTarget as HTMLSelectElement).value || null
              rederive(l)
            }}
          >
            <option value="">{t('paradigms.variantBase')}</option>
            {#each paradigmOf(l)?.variants ?? [] as v (v.id)}<option value={v.id}>{v.name}</option
              >{/each}
          </select>
        {/if}
      </div>
      <div class="row">
        <span class="small muted">{t('lexicon.forms')}</span><HelpDot key="forms" /><span
          class="grow"
        ></span>
        {#if paradigmOf(l)}<button class="btn ghost sm" onclick={() => deriveNow(l)}
            ><Wand2 size={14} />{t('lexicon.deriveForms')}</button
          >{/if}
        <button
          class="btn ghost sm"
          onclick={() => {
            l.forms[''] = { surface: '', derived: false, override: true, trace: [] }
            touch(l)
          }}><Plus size={14} />{t('lexicon.addForm')}</button
        >
      </div>
      {#if paradigmOf(l)}
        {#each slotsOf(l) as s (s.key)}
          {@const f = l.forms[s.label]}
          <div class="row kv" title={f?.trace?.join('\n') ?? ''}>
            <span class="slot small">{s.label}</span>
            <input
              class="input data"
              class:derived={f && !f.override}
              value={f?.surface ?? ''}
              placeholder="—"
              oninput={(e) => {
                l.forms[s.label] = {
                  surface: (e.currentTarget as HTMLInputElement).value,
                  derived: false,
                  override: true,
                  trace: []
                }
                touch(l)
              }}
            />
            {#if f?.override}
              <button
                class="btn ghost icon sm"
                title={t('lexicon.resetDerived')}
                onclick={() => {
                  delete l.forms[s.label]
                  deriveNow(l)
                }}><RotateCcw size={13} /></button
              >
            {:else if f}
              <span class="badge">{t('lexicon.formsDerived')}</span>
            {/if}
          </div>
        {/each}
        {#if Object.keys(l.forms).some((k) => !slotsOf(l).some((s) => s.label === k))}<span
            class="small muted">{t('lexicon.extraForms')}</span
          >{/if}
      {:else if l.posId}
        <span class="hint">{t('lexicon.noParadigm')}</span>
      {/if}
      {#each Object.keys(l.forms).filter((k) => !slotsOf(l).some((s) => s.label === k)) as k (k)}
        <div class="row kv">
          <input
            class="input"
            value={k}
            placeholder={t('lexicon.slot')}
            onchange={(e) => {
              renameKey(l.forms, k, (e.currentTarget as HTMLInputElement).value.trim())
              touch(l)
            }}
          />
          <input
            class="input data"
            bind:value={l.forms[k].surface}
            oninput={() => {
              l.forms[k].override = true
              touch(l)
            }}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              delete l.forms[k]
              touch(l)
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>

    <div class="field">
      <div class="row">
        <span class="small muted">{t('images.title')}</span><HelpDot key="images" /><span
          class="grow"
        ></span>
        <button class="btn ghost sm" onclick={() => addImages(l)}
          ><ImagePlus size={14} />{t('images.add')}</button
        >
      </div>
      {#each l.images ?? [] as im, i (im.id)}
        <div class="row img-row">
          <img src={im.dataUrl} alt="" />
          <input
            class="input grow"
            placeholder={t('images.caption')}
            bind:value={im.caption}
            oninput={() => touch(l)}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              l.images.splice(i, 1)
              touch(l)
            }}><X size={14} /></button
          >
        </div>
      {/each}
      <p class="tiny muted">
        {t('images.sizeHint', {
          w: project.settings.imageSize.width,
          h: project.settings.imageSize.height
        })}
      </p>
    </div>

    <div class="field">
      <label for="lx-notes">{t('common.notes')}</label>
      <textarea id="lx-notes" class="textarea" bind:value={l.notes} oninput={() => touch(l)}
      ></textarea>
    </div>

    <LexemeExamples lexeme={l} {project} {glossLangs} />

    <div class="row actions">
      <button class="btn sm" onclick={() => duplicate(l)}
        ><Copy size={14} />{t('soundChanges.duplicate')}</button
      >
      <button class="btn sm danger" onclick={() => remove(l)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    </div>
  </Portal>
{/if}

{#if cropReq}
  <ImageCropper
    img={cropReq.img}
    mime={cropReq.mime}
    size={project.settings.imageSize}
    onresult={(u) => {
      cropReq?.resolve(u)
      cropReq = null
    }}
    oncancel={() => {
      cropReq?.resolve(null)
      cropReq = null
    }}
  />
{/if}

<style>
  .grip {
    position: absolute;
    top: 0;
    right: -3px;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
  }
  .tbl th {
    position: relative;
  }
  .tbl.fixed {
    table-layout: fixed;
  }
  .tbl.fixed td {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tr.dup-row td {
    background: color-mix(in srgb, var(--warn) 10%, transparent);
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
  .bulk {
    gap: 8px;
    padding: 4px 0;
  }
  .dup-bar {
    gap: 8px;
  }
  .img-row {
    gap: 6px;
    margin-bottom: 4px;
  }
  .img-row img {
    width: 64px;
    height: 48px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  .mv {
    width: 44px;
    white-space: nowrap;
  }
  .tiny {
    font-size: 11px;
  }
  .scr {
    font-size: 18px;
    line-height: 1.3;
  }
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
