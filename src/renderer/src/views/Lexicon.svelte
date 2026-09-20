<script lang="ts">
  import { navScroll } from '$lib/ui/navScroll'
  import type { GrammaticalCategory } from '$lib/core/model'
  import { VirtualRows } from '$lib/ui/virtualRows.svelte'
  import { scrollToItem } from '$lib/ui/reveal'
  import type { PageView } from '$lib/state/ui.svelte'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS, categoryFields, featureValueTexts } from '$lib/core/searchFields'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { pluginRegistry } from '$lib/plugins/registry.svelte'
  import type { PluginExporter, PluginImporter } from '$lib/plugins/types'
  import { platform } from '$lib/platform'
  import { i18n, t, pickText } from '$lib/i18n/index.svelte'
  import { createLexeme, createSense, now } from '$lib/core/factory'
  import { makeCollator } from '$lib/core/collate'
  import { toCsv } from '$lib/core/csv'
  import { lexemesToRows, morphemesToRows } from '$lib/importers/csvImport'
  import { parseLexc, mergeLexicanter, type LexcFile } from '$lib/importers/lexicanter'
  import { derivePronunciations } from '$lib/core/pronounce'
  import { etymologyOrigin } from '$lib/core/etymology'
  import {
    customFieldScript,
    customFieldsFor,
    customFieldTitle,
    customItems,
    setCustomValue
  } from '$lib/core/customFields'
  import {
    ensureCompoundPos,
    findPos,
    lexemePosIds,
    posParadigmIds,
    posParts,
    posStemSlotList
  } from '$lib/core/pos'
  import { PREVIEW_LIMIT, scratchProject, type PreviewData } from '$lib/importers/preview'
  import ImportPreview from '$lib/ui/ImportPreview.svelte'
  import StarToggle from '$lib/ui/StarToggle.svelte'
  import { orthoIpaLabel, pronText, relationLabel } from '$lib/ui/labels'
  import { KeyRows, renameObjectKey, type KeyRow } from '$lib/ui/keyRows'
  import { dragColumn, fitColumns } from '$lib/ui/fitColumns'
  import { lexiconIssues } from '$lib/core/lexiconIssues'
  import LexemeExamples from '$lib/ui/LexemeExamples.svelte'
  import { lexemeScript, scriptSourceText } from '$lib/script/render'
  import { fontCss } from '$lib/script/fonts'
  import {
    paradigmFor,
    paradigmsFor,
    lexemeSlots,
    lexemeSlotGroups,
    paradigmDims,
    deriveLexemeForms,
    makeContext,
    type LexemeSlot
  } from '$lib/engine/morph'
  import FormsView from '$lib/ui/FormsView.svelte'
  import { sectionCollapsed, toggleSection } from '$lib/ui/section.svelte'
  import type { FormsLayout } from '$lib/platform/types'
  import { newLexeme } from '$lib/state/newLexeme.svelte'
  import {
    ETYMOLOGY_TYPES,
    type CustomFieldPosition,
    type Id,
    type Lexeme,
    type Paradigm,
    type PartOfSpeech,
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
    AlertCircle,
    Eye,
    Pencil,
    Columns3,
    Waypoints,
    ArrowLeft,
    Wand2,
    RotateCcw,
    ChevronUp,
    ChevronDown,
    ChevronRight,
    List,
    Table,
    ListTree,
    ImagePlus,
    FilePlus2,
    Merge,
    ListOrdered,
    Tags,
    Star
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import ColHead from '$lib/ui/ColHead.svelte'
  import StatsPanel from '$lib/ui/StatsPanel.svelte'
  import { lexiconStats } from '$lib/engine/stats'
  import { fiveRows } from '$lib/ui/fiveRows'
  import StressSettingsEditor from '$lib/ui/StressSettingsEditor.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const langId = $derived(projectState.currentLanguageId)
  const language = $derived(projectState.currentLanguage)
  const glossLangs = $derived(project.settings.glossLanguages)

  /** 回到这一页时接着用上次的筛选、排序、子页与选中项；换了语言就不恢复选中与滚动 */
  const memo = ui.memo<{
    lang: Id | null
    mode: 'entries' | 'taxonomy' | 'stats'
    editMode: boolean
    mainView: 'list' | 'graph'
    graphMode: 'graph' | 'compare'
    selectedId: Id | null
    sortKey: string | null
    sortDir: 'asc' | 'desc'
    customOrder: boolean
    colFilters: Record<string, Set<string>>
    favOnly: boolean
  }>('lexicon')
  const sameLang = memo.lang === projectState.currentLanguageId
  let mode = $state<'entries' | 'taxonomy' | 'csv' | 'lexc' | 'export' | 'stats'>(
    memo.mode ?? 'entries'
  )
  /** 选好、还没导入的 Lexicanter 文件：主区显示摘要与选项，检视器里是导入样例 */
  let lexc = $state.raw<{ name: string; file: LexcFile } | null>(null)
  let lexcLang = $state('')
  const lexStats = $derived(mode === 'stats' && langId ? lexiconStats(project, langId) : null)
  const pctOf = (n: number, total: number): string =>
    total ? `${Math.round((n / total) * 100)}%` : '—'
  /** 从统计里点某一项：回到列表并按那一列筛选 */
  function filterFromStats(key: string, value: string): void {
    setFilter(key, new Set([value]))
    mode = 'entries'
  }
  let editMode = $state(sameLang && (memo.editMode ?? false))
  let mainView = $state<'list' | 'graph'>(sameLang ? (memo.mainView ?? 'list') : 'list')
  /** 关系图里是图还是对比视图 */
  let graphMode = $state<'graph' | 'compare'>(sameLang ? (memo.graphMode ?? 'graph') : 'graph')
  let selectedId = $state<Id | null>(sameLang ? (memo.selectedId ?? null) : null)
  const query = $derived(ui.search)
  /** 表头排序：哪一列、什么方向；null = 按字母表；'custom' = 项目里的数组顺序 */
  let sortKey = $state<string | null>(memo.sortKey ?? null)
  let sortDir = $state<'asc' | 'desc'>(memo.sortDir ?? 'desc')
  let customOrder = $state(memo.customOrder ?? false)
  /** 表头筛选：列 key → 选中的取值；不在里面的列不筛 */
  let colFilters = $state<Record<string, Set<string>>>(memo.colFilters ?? {})
  /** 只看收藏（列表左边点亮的那些） */
  let favOnly = $state(memo.favOnly ?? false)
  /** 打了记号的词前面加的符号 */
  const markSymbol = $derived(project.settings.markSymbol || '*')
  function toggleFavorite(l: Lexeme): void {
    l.favorite = !l.favorite
    touch(l)
  }
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
  /** 一条词目在某一列上的可筛取值（多个标签就是多个值） */
  /** 词条标的方言：词条自己的加上各义项的，按语言里定义的顺序 */
  function dialectsOf(l: Lexeme): { id: Id; name: string; abbr: string }[] {
    const ids = new Set([...l.dialectIds, ...l.senses.flatMap((s) => s.dialectIds)])
    const lg = project.languages.find((x) => x.id === l.languageId)
    return (lg?.dialects ?? []).filter((d) => ids.has(d.id))
  }
  function filterValues(l: Lexeme, key: string): string[] {
    if (key === 'lemma') return [initialOf(l.lemma)]
    if (key === 'pos') {
      // 复合词类的组成、义项单独选的词类也算：筛「名词」时名词兼动词的词也在
      const ids = lexemePosIds(project, l)
      return ids.length ? ids : ['']
    }
    if (key === 'tags') return l.tags.length ? l.tags : ['']
    if (key === 'language') return [l.languageId]
    if (key.startsWith('feat:')) return [l.features[key.slice(5)] ?? '']
    if (key === 'dialect') {
      const ds = dialectsOf(l)
      return ds.length ? ds.map((d) => d.id) : ['']
    }
    return [cell(l, key)]
  }
  /** 首字母：按字母表里的多合字母切 */
  function initialOf(lemma: string): string {
    const w = lemma.replace(/^[-=*·]+/, '')
    const alpha = language?.alphabet ?? []
    for (const a of [...alpha].sort((x, y) => y.length - x.length))
      if (a && w.toLowerCase().startsWith(a.toLowerCase())) return a
    return Array.from(w)[0]?.toUpperCase() ?? ''
  }
  /** 某一列的筛选项（带计数） */
  function filterOptions(key: string): { value: string; label: string; count: number }[] {
    const counts = new Map<string, number>()
    for (const l of inLang)
      for (const v of filterValues(l, key)) counts.set(v, (counts.get(v) ?? 0) + 1)
    const label = (v: string): string => {
      if (key === 'pos') return v ? posLabel(v) || t('lexicon.noPos') : t('lexicon.noPos')
      if (key === 'language') {
        const lg = project.languages.find((x) => x.id === v)
        return lg ? lg.name : '—'
      }
      if (key.startsWith('feat:')) {
        const cat = project.categories.find((c) => c.id === key.slice(5))
        const val = cat?.values.find((x) => x.id === v)
        return val ? pickText(val.name, glossLangs) || val.abbr : '—'
      }
      if (key === 'dialect') {
        for (const lg of project.languages) {
          const d = lg.dialects.find((x) => x.id === v)
          if (d) return d.name || d.abbr
        }
        return t('lexicon.noDialect')
      }
      return v || '—'
    }
    const out = [...counts].map(([value, count]) => ({ value, label: label(value), count }))
    return out.sort((a, b) => (key === 'lemma' ? collator(a.value, b.value) : b.count - a.count))
  }
  const filterable = (key: string): boolean =>
    key === 'lemma' ||
    key === 'pos' ||
    key === 'tags' ||
    key === 'language' ||
    key === 'dialect' ||
    key.startsWith('feat:')
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
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('lexicon', {
      kind: 'lexeme',
      lang: projectState.currentLanguageId,
      id: selectedId,
      mode,
      main: mainView,
      edit: editMode ? '1' : ''
    })
  })
  $effect(() => {
    const r = ui.takeRestore('lexicon')
    if (!r) return
    const v: PageView = r.view ?? {}
    selectedId = v.id ?? null
    if (v.mode === 'entries' || v.mode === 'taxonomy' || v.mode === 'stats') mode = v.mode
    mainView = v.main === 'graph' ? 'graph' : 'list'
    editMode = v.edit === '1'
    ui.restoreScroll('lexicon', r.scroll)
  })
  $effect(() => {
    Object.assign(memo, {
      lang: projectState.currentLanguageId,
      mode: mode === 'taxonomy' || mode === 'stats' ? mode : 'entries',
      editMode,
      mainView,
      graphMode,
      selectedId,
      sortKey,
      sortDir,
      customOrder,
      colFilters: { ...colFilters },
      favOnly
    })
  })
  // 不是「返回」进来的：列表滚回上次离开时的位置
  if (sameLang && !ui.restoring('lexicon')) ui.restoreScroll('lexicon', ui.lastScroll('lexicon'))

  const inLang = $derived(project.lexemes.filter((l) => !langId || l.languageId === langId))
  /** 要提醒的问题（缺释义标红、词头重复标黄）：列表按它标行，底部右边的状态栏按它计数 */
  const issues = $derived(lexiconIssues(inLang))
  const errorIssues = $derived(issues.filter((i) => i.severity === 'error'))
  const warnIssues = $derived(issues.filter((i) => i.severity === 'warning'))
  const noDefIds = $derived(new Set(errorIssues.map((i) => i.lexemeId)))
  /** 状态栏悬浮列表最多列多少条 */
  const ISSUE_LIST_MAX = 60
  const lemmaCounts = $derived.by(() => {
    const m = new Map<string, number>()
    for (const l of inLang)
      m.set(l.languageId + ' ' + l.lemma, (m.get(l.languageId + ' ' + l.lemma) ?? 0) + 1)
    return m
  })
  const collator = $derived(makeCollator(language?.alphabet ?? []))
  /** 搜索字段：内置的，再加每个检视器模块（标题或别名写成 标题=内容） */
  const searchFields = $derived([
    ...SEARCH_FIELDS.lexicon,
    ...categoryFields(project.categories),
    ...project.customFields.map((f) => ({
      key: `custom:${f.id}`,
      aliases: [...Object.values(f.name).filter(Boolean), ...f.aliases]
    }))
  ])
  const list = $derived.by(() => {
    const pq = parseQuery(query, searchFields)
    const arr = inLang.filter((l) => {
      if (favOnly && !l.favorite) return false
      for (const [key, sel] of Object.entries(colFilters))
        if (!filterValues(l, key).some((v) => sel.has(v))) return false
      if (pq.terms.length && !matchQuery(pq, (f) => lexemeFieldValues(l, f))) return false
      return true
    })
    // custom：保持项目里的数组顺序
    if (customOrder) return arr
    // 排序键每行只算一次：比较时现算的话，按文字列排一次要转写几万遍
    const key = sortKey
    const lemmas = arr.map((l) => l.lemma)
    const keys =
      !key || key === 'lemma'
        ? lemmas
        : arr.map((l) =>
            key === 'pos' ? posLabelOf(l) : key === 'updated' ? l.updatedAt : cell(l, key)
          )
    const dir = key && sortDir === 'desc' ? -1 : 1
    const order = arr.map((_, i) => i)
    order.sort((i, j) => {
      if (!key) return collator(lemmas[i], lemmas[j])
      const c =
        key === 'updated'
          ? keys[i] < keys[j]
            ? -1
            : keys[i] > keys[j]
              ? 1
              : 0
          : collator(keys[i], keys[j])
      return (c || collator(lemmas[i], lemmas[j])) * dir
    })
    return order.map((i) => arr[i])
  })
  /** 表格只画看得见的那些行（几千条也不卡），滚动位置照旧 */
  const listIds = $derived(list.map((l) => l.id))
  const rows = new VirtualRows('lexicon', () => listIds)
  /** 搜索用：词条在某个字段里的文字（field 为 null 时是默认那一组）；只读要找的那个字段 */
  function lexemeFieldValues(l: Lexeme, field: string | null): string[] {
    const defs = (): string[] =>
      l.senses.flatMap((se) => [...Object.values(se.definition), ...se.registers])
    const forms = (): string[] => Object.values(l.forms).map((f) => f.surface)
    const ipa = (): string[] => Object.values(l.pronunciations).map((pr) => pr.ipa)
    const etym = (): string[] => [
      l.etymology.notes,
      ...l.etymology.stages.map((st) => st.form),
      ...l.etymology.sources.flatMap((src) =>
        src.kind === 'external' ? [src.form, src.meaning] : []
      )
    ]
    switch (field) {
      case 'word':
        return [l.lemma]
      case 'gloss':
        return defs()
      case 'form':
        return forms()
      case 'stem':
        return Object.values(l.stems)
      case 'ipa':
        return ipa()
      case 'pos':
        return lexemePosIds(project, l).flatMap((id) => {
          const p = findPos(project, id)
          return p ? [...Object.values(p.name), p.abbr] : []
        })
      case 'tag':
        return l.tags
      case 'register':
        return l.senses.flatMap((se) => se.registers)
      case 'etym':
        return etym()
      case 'note':
        return [l.notes]
      case 'script': {
        // 文字列显示的是按规则转写出来的（没手填时），搜的也是它
        const lg = project.languages.find((x) => x.id === l.languageId)
        return lg ? lg.scripts.map((sc) => lexemeScript(lg, sc, l)) : []
      }
      case 'feature':
        return featureValueTexts(project.categories, l.features)
      case 'dialect':
        return dialectsOf(l).flatMap((d) => [d.name, d.abbr])
      default:
        if (field?.startsWith('custom:')) return [l.custom?.[field.slice(7)] ?? '']
        if (field?.startsWith('feat:'))
          return featureValueTexts(project.categories, l.features, field.slice(5))
        return [
          l.lemma,
          l.notes,
          ...Object.values(l.custom ?? {}),
          ...l.tags,
          ...defs(),
          ...Object.values(l.stems),
          ...forms(),
          ...ipa(),
          ...Object.values(l.scriptForms ?? {}),
          ...etym()
        ]
    }
  }
  const selected = $derived(project.lexemes.find((l) => l.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.lexemes.flatMap((l) => l.tags))].sort())
  /** 语域：内置常用项 + 项目里已经用过的 */
  const registerOptions = $derived([
    ...new Set([
      ...t('lexicon.registerPresets').split(','),
      ...project.lexemes.flatMap((l) => l.senses.flatMap((se) => se.registers)).filter(Boolean)
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
    // 词类不一样时：各义项记下自己原来的词类，合并后的词条用它们组成的复合词类
    const mixedPos = new Set(group.map((x) => x.posId ?? '')).size > 1
    const posSnap = $state.snapshot(project.posList) as PartOfSpeech[]
    if (mixedPos)
      for (const x of group) for (const se of x.senses) if (!se.posId && x.posId) se.posId = x.posId
    const groupPos = [...new Set(group.flatMap((x) => (x.posId ? [x.posId] : [])))]
    for (const other of group.slice(1)) {
      target.senses.push(...filled(other))
      target.tags.push(...other.tags)
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
    if (mixedPos && groupPos.length) {
      const r = ensureCompoundPos(project, groupPos)
      if (r) target.posId = r.pos.id
      for (const se of target.senses) if (se.posId === target.posId) delete se.posId
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
          project.posList = posSnap
          touch()
        }
      }
    })
  }
  const selLang = $derived(
    selected ? project.languages.find((x) => x.id === selected.languageId) : null
  )
  /** 自己写关系种类时的草稿（下标 → 正在打的字），打完才写回词条 */
  let kindDraft = $state<Record<number, string>>({})
  function commitKind(l: Lexeme, r: { kind: string }, i: number): void {
    const v = (kindDraft[i] ?? '').trim()
    const { [i]: _drop, ...rest } = kindDraft
    void _drop
    kindDraft = rest
    if (!v || v === r.kind) return
    r.kind = v
    touch(l)
  }
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
      mode === 'csv' || mode === 'lexc'
        ? t('importPreview.title')
        : mode === 'taxonomy'
          ? t('taxonomy.title')
          : mode === 'stats'
            ? t('stats.title')
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
    if (project.languages.some((lg) => lg.dialects.length))
      cols.push({ key: 'dialect', label: t('lexicon.colDialect') })
    for (const f of langId ? customFieldsFor(project, langId) : project.customFields)
      cols.push({
        key: `custom:${f.id}`,
        label: customFieldTitle(f, glossLangs) || t('taxonomy.customUntitled')
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
    // 「全部语言」时多一列语言（selLang 是选中词的语言，跟这里的过滤无关）
    if (!langId) cols.unshift({ key: 'language', label: t('nav.languages') })
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
    const cols = keys
      .map((k) => availableColumns.find((c) => c.key === k))
      .filter((c): c is Col => !!c)
    // 「全部语言」时总带上语言列，不然分不清哪条是哪门语言的
    const langCol = !langId ? availableColumns.find((c) => c.key === 'language') : null
    if (langCol && !cols.some((c) => c.key === 'language')) cols.unshift(langCol)
    return cols
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
  // ───── 列宽（记忆在用户偏好里）：按表格所在区域铺满，见 fitColumns ─────
  const colWidths = $derived(ui.prefs.lexiconColWidths ?? {})
  let scrollW = $state(0)
  /**
   * 表格区域能用的宽（不含竖滚动条）：竖滚动条出现 / 消失时元素本身没变大小，bind:clientWidth 收不到，
   * 这里按内容盒观察，滚动条一变就重新量
   */
  function innerWidth(node: HTMLElement, set: (w: number) => void): { destroy: () => void } {
    const ro = new ResizeObserver(() => set(node.clientWidth))
    ro.observe(node)
    set(node.clientWidth)
    return { destroy: () => ro.disconnect() }
  }
  /** 没拖过的列按种类给个默认宽：释义宽一些，词类、维度这类窄一些 */
  function defaultColWidth(key: string): number {
    if (key === 'lemma') return 150
    if (key.startsWith('def:')) return 280
    if (key === 'pos' || key === 'language') return 80
    if (key.startsWith('feat:')) return 90
    if (key === 'dialect' || key === 'updated') return 100
    if (key.startsWith('custom:')) return 180
    if (key === 'tags' || key === 'proto' || key === 'pron' || key.startsWith('script:')) return 140
    return 120
  }
  function minColWidth(key: string): number {
    if (key.startsWith('def:')) return 120
    if (key === 'lemma') return 80
    return 56
  }
  const colKeys = $derived(['lemma', ...activeColumns.map((c) => c.key)])
  const orderW = $derived(sort === 'custom' ? 56 : 34)
  const fitted = $derived(
    fitColumns(
      colKeys.map((k) => ({ base: colWidths[k] ?? defaultColWidth(k), min: minColWidth(k) })),
      Math.max(0, scrollW - orderW)
    )
  )
  const tableWidth = $derived(orderW + fitted.reduce((a, b) => a + b, 0))
  const colStyle = (key: string): string => {
    const i = colKeys.indexOf(key)
    return i >= 0 && fitted[i] ? `width:${fitted[i]}px` : ''
  }
  /** 拖列宽：从按下时各列的实际宽出发，这一列和右边的邻居一增一减，拖完把每一列的宽都记下来当基准 */
  let resizing: { index: number; x: number; widths: number[] } | null = null
  function startResize(e: PointerEvent, key: string): void {
    e.preventDefault()
    e.stopPropagation()
    resizing = { index: colKeys.indexOf(key), x: e.clientX, widths: fitted.slice() }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function moveResize(e: PointerEvent): void {
    if (!resizing || resizing.index < 0) return
    const next = dragColumn(
      resizing.widths,
      colKeys.map(minColWidth),
      resizing.index,
      e.clientX - resizing.x
    )
    ui.prefs.lexiconColWidths = {
      ...ui.prefs.lexiconColWidths,
      ...Object.fromEntries(colKeys.map((k, i) => [k, next[i]]))
    }
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

  /** 这个词条能填的语法维度：维度限定了词类时只列对得上的（已经填了值的照样显示） */
  function catsFor(l: Lexeme): GrammaticalCategory[] {
    const ids = new Set(lexemePosIds(project, l))
    return project.categories.filter(
      (c) => !c.posIds?.length || c.posIds.some((p) => ids.has(p)) || c.id in l.features
    )
  }

  function cell(l: Lexeme, key: string): string {
    if (key === 'pos') return posLabelOf(l)
    if (key === 'language') {
      const lg = project.languages.find((x) => x.id === l.languageId)
      return lg ? lg.abbr || lg.name : ''
    }
    if (key.startsWith('def:')) {
      const g = key.slice(4)
      const parts = l.senses.map((s) => s.definition[g] ?? '').filter(Boolean)
      if (parts.length < 2) return parts[0] ?? ''
      const sep = i18n.locale === 'zh' ? '、' : '. '
      return parts.map((d, i) => `${i + 1}${sep}${d}`).join(' ')
    }
    if (key === 'tags') return l.tags.join(', ')
    if (key === 'dialect')
      return dialectsOf(l)
        .map((d) => d.name || d.abbr)
        .join(i18n.locale === 'zh' ? '、' : ', ')
    if (key === 'proto') return etymologyOrigin(project, l.etymology)
    if (key === 'pron')
      return Object.values(l.pronunciations)
        .map((p) => pronText(p.ipa))
        .filter(Boolean)
        .join(' / ')
    if (key.startsWith('feat:')) {
      const cid = key.slice(5)
      const vid = l.features[cid]
      const v = project.categories.find((c) => c.id === cid)?.values.find((x) => x.id === vid)
      return v ? pickText(v.name, glossLangs) || v.abbr : ''
    }
    if (key.startsWith('custom:')) return (l.custom?.[key.slice(7)] ?? '').replace(/\n+/g, ' ')
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
      if (lg) derivePronunciations(lg, l, project)
    }
    projectState.touch()
  }

  function add(): void {
    const lid = langId ?? project.settings.defaultLanguageId ?? project.languages[0]?.id
    if (!lid) return
    const l = createLexeme(lid, '')
    const onlyPos = colFilters.pos && colFilters.pos.size === 1 ? [...colFilters.pos][0] : ''
    if (onlyPos) l.posId = onlyPos
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
    return relationLabel(kind)
  }

  const paradigmOf = (l: Lexeme): Paradigm | null => paradigmFor(project, l)
  const paraName = (id: string): string =>
    pickText(project.paradigms.find((x) => x.id === id)?.name ?? {}, glossLangs) ||
    t('paradigms.untitled')
  /** 词类绑的构形（第一个是默认的）：绑了几个时在下拉里单独列一组 */
  const posParas = (l: Lexeme): string[] => posParadigmIds(project, l.posId)
  /** 词条用的全部构形的槽位（第一个构形在前，另外加的依次在后），以及每一格存在哪个键下 */
  const slotsOf = (l: Lexeme): LexemeSlot[] => lexemeSlots(project, l, glossLangs)
  /** 按构形分组：录入里每一套（构形 + 变体）一组，组名是构形名，挑了变体时带上变体名 */
  const slotGroups = (l: Lexeme): ReturnType<typeof lexemeSlotGroups> =>
    lexemeSlotGroups(project, l, glossLangs)
  /** 录入模式下屈折形那一块收没收起（显示模式那边另记，见 LexemeCard） */
  const FORMS_FOLD_EDIT = 'lex.forms:edit'
  const formsFolded = $derived(sectionCollapsed(FORMS_FOLD_EDIT))
  /** 屈折形怎么排：列表、表格、树形图；跟显示模式共用一个选择，记在本机 */
  const formsLayout = $derived<FormsLayout>(ui.prefs.formsLayout ?? 'list')
  const setFormsLayout = (v: FormsLayout): void => {
    ui.prefs.formsLayout = v
    void ui.savePrefs()
  }
  /** 收起来时那一行写什么：几格、填了几个 */
  function foldedFormsSummary(l: Lexeme): string {
    const filled = Object.values(l.forms).filter((f) => f.surface.trim()).length
    return t('lexicon.formsCount', { n: String(slotsOf(l).length), filled: String(filled) })
  }
  /** 连手改过的一起重推：先把槽位上的形式都去掉，再照构形推一遍 */
  function deriveAllForms(l: Lexeme): void {
    const keys = new Set(slotsOf(l).map((s) => s.key))
    for (const k of Object.keys(l.forms)) if (keys.has(k)) delete l.forms[k]
    deriveNow(l)
    ui.toast(t('lexicon.deriveAllDone', { n: keys.size }))
  }
  function deriveNow(l: Lexeme): void {
    const lg = project.languages.find((x) => x.id === l.languageId)
    if (!lg || !paradigmsFor(project, l).length) return
    deriveLexemeForms(makeContext(project, lg), l)
    touch(l)
  }
  /**
   * 还能添的一套：先挑整个没用过的构形，都用过了就挑还有变体没用的那个
   * （同一套构形的两个变体可以一起用：书面一套、口语一套）
   */
  function freeParadigm(l: Lexeme): { paradigmId: Id; variantId: Id | null } | null {
    const used = new Set(
      paradigmsFor(project, l).map((x) => `${x.paradigm.id}#${x.variantId ?? ''}`)
    )
    for (const p of project.paradigms) {
      if (p.appliesToAll) continue
      for (const vid of [null, ...p.variants.map((v) => v.id)])
        if (!used.has(`${p.id}#${vid ?? ''}`)) return { paradigmId: p.id, variantId: vid }
    }
    return null
  }
  /** 另外加一个构形 */
  function addExtraParadigm(l: Lexeme): void {
    const next = freeParadigm(l)
    if (!next) return
    l.extraParadigms = [...(l.extraParadigms ?? []), next]
    rederive(l)
  }
  /** 录入里某一格推出来的形式：生成成一个新词条（弹出表单，词源和关系按构形填好） */
  function generateFromSlot(l: Lexeme, s: LexemeSlot): void {
    const surface = l.forms[s.key]?.surface?.trim()
    if (!surface) return
    newLexeme.open({
      languageId: l.languageId,
      form: surface.split(/[,，;；/]/)[0].trim(),
      base: l,
      paradigmId: s.lp.paradigm.id,
      slotLabel: s.slot.label
    })
  }
  /** 换构形或变体后，推导出来的形式要重算；手填的不动 */
  function rederive(l: Lexeme): void {
    for (const [k, f] of Object.entries(l.forms)) if (!f.override) delete l.forms[k]
    deriveNow(l)
  }

  // 词条自己加的词干、屈折形：每行一个固定 id（见 keyRows.ts），改名时焦点不丢、行不换位
  const stemRows = new KeyRows()
  const formRows = new KeyRows()
  function renameRow(
    obj: Record<string, unknown>,
    rows: KeyRows,
    row: KeyRow,
    input: HTMLInputElement,
    l: Lexeme
  ): void {
    const name = input.value.trim()
    if (renameObjectKey(obj, row.key, name)) {
      rows.rename(row.id, name)
      // 状态代理删了键再加回来，键的位置不一定跟着变（先后加 A、B，互相改名后仍是 A 在前）：
      // 按界面上行的顺序重建对象，词条卡、存盘的顺序才跟录入界面一致
      const order = rows.keys()
      const rebuilt = Object.fromEntries([
        ...Object.keys(obj)
          .filter((k) => !order.includes(k))
          .map((k) => [k, obj[k]]),
        ...order.filter((k) => k in obj).map((k) => [k, obj[k]])
      ])
      if (obj === l.stems) l.stems = rebuilt as Lexeme['stems']
      else if (obj === l.forms) l.forms = rebuilt as Lexeme['forms']
      touch(l)
    } else {
      if (name && name !== row.key) ui.toast(t('lexicon.nameTaken', { name }))
      input.value = row.key
    }
  }

  async function importLexicanter(): Promise<void> {
    const [f] = await platform.readTextFiles({ multiple: false, extensions: ['lexc', 'json'] })
    if (!f) return
    try {
      lexc = { name: f.name, file: parseLexc(f.content) }
      lexcLang = glossLangs[0] ?? 'en'
      mode = 'lexc'
    } catch (e) {
      ui.error((e as Error).message)
    }
  }
  /** 插件注册的导入：让用户挑文件，把内容交给插件 */
  async function runPluginImport(im: PluginImporter): Promise<void> {
    const exts = im.extensions.map((e) => e.replace(/^\./, ''))
    const [f] = await platform.readTextFiles({ multiple: false, extensions: exts })
    if (!f) return
    try {
      await im.run(f.content, {
        project,
        languageId: projectState.currentLanguageId,
        edit: (fn) => {
          fn(project)
          projectState.touch()
        }
      })
      ui.toast(t('plugins.imported', { name: im.name }))
    } catch (e) {
      ui.error((e as Error).message)
    }
  }
  /** 插件注册的导出：拿到文本后问用户存到哪 */
  async function runPluginExport(ex: PluginExporter): Promise<void> {
    try {
      const text = await ex.run({
        project,
        languageId: projectState.currentLanguageId,
        edit: (fn) => {
          fn(project)
          projectState.touch()
        }
      })
      await platform.saveTextFile(`${project.meta.name}${ex.extension ?? '.txt'}`, text)
    } catch (e) {
      ui.error((e as Error).message)
    }
  }

  /** Lexicanter 导入样例：在项目副本上试着并进去 */
  const lexcPreview = $derived.by(() => {
    if (!lexc) return null
    const scratch = scratchProject(project)
    const report = mergeLexicanter(scratch, lexc.file, {
      definitionLang: lexcLang || 'en',
      uiLocale: i18n.locale,
      appVersion: ''
    })
    return { project: scratch, report }
  })
  /** 测试台：粘一段 .lexc 里的内容，按同样的设置并进副本看看认成什么 */
  function testLexc(text: string): PreviewData | null {
    const scratch = scratchProject(project)
    mergeLexicanter(scratch, parseLexc(text), {
      definitionLang: lexcLang || 'en',
      uiLocale: i18n.locale,
      appVersion: ''
    })
    return { project: scratch, lexemes: scratch.lexemes.slice(0, PREVIEW_LIMIT) }
  }
  function runLexicanter(): void {
    if (!lexc) return
    try {
      const r = mergeLexicanter(project, lexc.file, {
        definitionLang: lexcLang || 'en',
        uiLocale: i18n.locale,
        appVersion: ''
      })
      touch()
      ui.toast(t('lexicon.lexicanterDone', { lexemes: r.lexemes, languages: r.languages.length }))
    } catch (e) {
      ui.error((e as Error).message)
    }
    closeLexicanter()
  }
  function closeLexicanter(): void {
    lexc = null
    mode = 'entries'
  }
  async function exportCsv(kind: 'lexemes' | 'morphemes'): Promise<void> {
    const rows =
      kind === 'lexemes'
        ? lexemesToRows(project, inLang, glossLangs)
        : morphemesToRows(
            project.morphemes.filter((m) => !langId || m.languageId === langId),
            glossLangs,
            project.posList
          )
    await platform.saveTextFile(
      `${language?.name ?? project.meta.name}-${kind}.csv`,
      '﻿' + toCsv(rows)
    )
  }
  /** 这个词条所属词类定义的词干槽：去掉空名字、首尾空格，重名的只留第一个 */
  function posStemSlots(l: Lexeme): { name: string; notes: string }[] {
    const seen = new Set<string>()
    const out: { name: string; notes: string }[] = []
    // 复合词类自己没定义词干槽时沿用组成词类的
    for (const st of posStemSlotList(project, l.posId)) {
      const name = st.name.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({ name, notes: st.notes })
    }
    return out
  }
  function selectFromCard(id: Id): void {
    reveal(id)
  }
  /** 关系图里点节点：就地换中心，跨语言时顺带切当前语言，不退回列表 */
  function recenterGraph(id: Id): void {
    const l = project.lexemes.find((x) => x.id === id)
    if (!l) return
    if (langId && l.languageId !== langId) projectState.currentLanguageId = l.languageId
    selectedId = id
    mainView = 'graph'
  }
  /** 选中并把左侧列表滚到该词，短暂高亮；过滤条件会挡住目标，所以先清掉 */
  function reveal(id: Id): void {
    const l = project.lexemes.find((x) => x.id === id)
    if (!l) return
    if (langId && l.languageId !== langId) projectState.currentLanguageId = l.languageId
    ui.search = ''
    colFilters = {}
    mode = 'entries'
    mainView = 'list'
    selectedId = id
    multiIds = []
    void scrollToItem('lexicon', `tr[data-id="${id}"]`, () => {
      rows.scrollToIndex(list.findIndex((x) => x.id === id))
    }).then(() => flash(id))
  }
  /** 滚到了再闪：高亮从头到尾都看得见 */
  function flash(id: Id): void {
    flashId = id
    setTimeout(() => {
      if (flashId === id) flashId = null
    }, 1800)
  }
  /** 双击一行：选中这一条，右侧检视器切到录入模式直接改 */
  function editRow(e: MouseEvent, id: Id): void {
    if ((e.target as Element | null)?.closest('button, input, select, textarea, a')) return
    window.getSelection()?.removeAllRanges()
    multiIds = []
    selectedId = id
    editMode = true
    ui.inspectorOpen = true
    ui.syntaxOpen = false
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
  // ── 批量标签：选中几条之后一起加、一起去掉、一起改名 ──
  let tagBoxOpen = $state(false)
  let newTag = $state('')
  const selectedLexemes = $derived(project.lexemes.filter((l) => multiIds.includes(l.id)))
  /** 选中的这些词条上出现过的标签：标签 → 有几条带着它 */
  const selectedTags = $derived.by(() => {
    const m = new Map<string, number>()
    for (const l of selectedLexemes) for (const tg of l.tags) m.set(tg, (m.get(tg) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })
  /** 这门语言里用过的标签，加标签时给提示 */
  const knownTags = $derived([...new Set(inLang.flatMap((l) => l.tags))].sort())
  function addTagToSelected(tag: string): void {
    const tg = tag.trim()
    if (!tg) return
    for (const l of selectedLexemes)
      if (!l.tags.includes(tg)) {
        l.tags.push(tg)
        l.updatedAt = now()
      }
    newTag = ''
    touch()
  }
  function removeTagFromSelected(tag: string): void {
    for (const l of selectedLexemes) {
      const i = l.tags.indexOf(tag)
      if (i >= 0) {
        l.tags.splice(i, 1)
        l.updatedAt = now()
      }
    }
    touch()
  }
  async function renameTagInSelected(tag: string): Promise<void> {
    const name = (await ui.prompt(t('lexicon.tagRename'), tag))?.trim()
    if (!name || name === tag) return
    for (const l of selectedLexemes) {
      const i = l.tags.indexOf(tag)
      if (i < 0) continue
      if (l.tags.includes(name)) l.tags.splice(i, 1)
      else l.tags[i] = name
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
      <button class:active={mode === 'stats'} onclick={() => (mode = 'stats')}
        >{t('stats.title')}</button
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
      <button
        class="btn icon"
        class:active={favOnly}
        title={t('lexicon.favOnly')}
        aria-pressed={favOnly}
        onclick={() => (favOnly = !favOnly)}><Star size={16} /></button
      >
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
      <Menu label={t('lexicon.import')} icon={Download}>
        <button onclick={() => (mode = 'csv')}>{t('lexicon.importCsv')}</button>
        <button onclick={importLexicanter}>{t('lexicon.importLexicanter')}</button>
        <!-- 插件注册的导入格式 -->
        {#each pluginRegistry.importers as im (im.pluginId + im.item.id)}
          <button onclick={() => void runPluginImport(im.item)}>{im.item.name}</button>
        {/each}
      </Menu>
      <Menu label={t('common.export')} icon={Upload}>
        <button onclick={() => exportCsv('lexemes')}>{t('lexicon.exportCsv')}</button>
        <button onclick={() => exportCsv('morphemes')}>{t('lexicon.exportMorphemesCsv')}</button>
        {#if language}<button onclick={() => (mode = 'export')}>{t('dict.menu')}</button>{/if}
        {#each pluginRegistry.exporters as ex (ex.pluginId + ex.item.id)}
          <button onclick={() => void runPluginExport(ex.item)}>{ex.item.name}</button>
        {/each}
      </Menu>
      <button class="btn primary" onclick={add}><Plus size={16} />{t('lexicon.add')}</button>
    {/if}
  </div>
  <Hint id="lexicon" text={t('lexicon.hint')} />

  {#if mode === 'stats' && lexStats}
    {@const st = lexStats}
    <div class="scroll">
      <StatsPanel
        facts={[
          { label: t('stats.lex.total'), value: st.total },
          {
            label: t('stats.lex.withDefinition'),
            value: st.withDefinition,
            sub: pctOf(st.withDefinition, st.total)
          },
          {
            label: t('stats.lex.withPronunciation'),
            value: st.withPronunciation,
            sub: pctOf(st.withPronunciation, st.total)
          },
          {
            label: t('stats.lex.withEtymology'),
            value: st.withEtymology,
            sub: pctOf(st.withEtymology, st.total)
          },
          {
            label: t('stats.lex.withForms'),
            value: st.withForms,
            sub: t('stats.lex.overridden', { n: st.overriddenForms })
          },
          {
            label: t('stats.lex.usedInCorpus'),
            value: st.usedInCorpus,
            sub: pctOf(st.usedInCorpus, st.total)
          },
          { label: t('stats.lex.unusedInCorpus'), value: st.unusedInCorpus },
          { label: t('stats.lex.withImages'), value: st.withImages },
          { label: t('stats.lex.withRelations'), value: st.withRelations },
          {
            label: t('stats.lex.senses'),
            value: st.sensesTotal,
            sub: t('stats.lex.perEntry', {
              n: st.total ? (st.sensesTotal / st.total).toFixed(2) : '—'
            })
          },
          { label: t('stats.lex.avgLength'), value: st.avgLength.toFixed(1) },
          { label: t('stats.lex.duplicates'), value: st.duplicateLemmas },
          {
            label: t('stats.lex.added7d'),
            value: st.added7d,
            sub: t('stats.lex.added30d', { n: st.added30d })
          }
        ]}
        groups={[
          {
            title: t('stats.lex.byPos'),
            buckets: st.byPos,
            onpick: (k) => filterFromStats('pos', k)
          },
          {
            title: t('stats.lex.byTag'),
            buckets: st.byTag,
            onpick: (k) => filterFromStats('tags', k)
          },
          {
            title: t('stats.lex.byInitial'),
            buckets: st.byInitial,
            max: 40,
            onpick: (k) => filterFromStats('lemma', k)
          },
          { title: t('stats.lex.byLength'), buckets: st.byLength, max: 40 },
          {
            title: t('stats.lex.byEtymologyType'),
            buckets: st.byEtymologyType.map((b) => ({
              ...b,
              label:
                t(`lexicon.etyTypes.${b.key}`) === `lexicon.etyTypes.${b.key}`
                  ? b.label
                  : t(`lexicon.etyTypes.${b.key}`)
            }))
          },
          { title: t('stats.lex.byDialect'), buckets: st.byDialect },
          ...st.byFeature.map((f) => ({
            title: f.category,
            buckets: f.buckets,
            onpick: (k: string) => filterFromStats('feat:' + f.categoryId, k)
          }))
        ]}
        rankings={[
          {
            title: t('stats.lex.topUsed'),
            items: st.topUsed.map((x) => ({ id: x.lexemeId, label: x.lemma, n: x.n })),
            onpick: (id) => reveal(id)
          }
        ]}
      />
    </div>
  {:else if mode === 'stats'}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if mode === 'taxonomy'}
    <div class="scroll"><Taxonomy /></div>
  {:else if mode === 'export' && language}
    <div class="scroll"><DictExport {language} onclose={() => (mode = 'entries')} /></div>
  {:else if mode === 'csv'}
    <div class="scroll"><CsvImportWizard onclose={() => (mode = 'entries')} /></div>
  {:else if mode === 'lexc' && lexc}
    <div class="scroll">
      <div class="card lexc-panel">
        <div class="row">
          <strong class="grow">{t('lexicon.lexicanterTitle')}</strong>
          <button class="btn ghost icon sm" title={t('common.close')} onclick={closeLexicanter}
            ><X size={16} /></button
          >
        </div>
        <span class="small muted">{lexc.name}</span>
        <label class="field"
          ><span class="small muted">{t('lexicon.definitionLang')}</span>
          <select class="select" bind:value={lexcLang}>
            {#each [...new Set([...glossLangs, lexcLang].filter(Boolean))] as g (g)}<option
                value={g}>{g}</option
              >{/each}
          </select></label
        >
        {#if lexcPreview}
          {@const r = lexcPreview.report}
          <p class="small">
            {t('lexicon.lexicanterSummary', {
              languages: r.languages.length,
              names: r.languages.join('、'),
              lexemes: r.lexemes,
              phrases: r.phrases,
              ruleSets: r.ruleSets,
              docs: r.docs
            })}
          </p>
          {#each r.warnings as w (w)}<p class="small warn">{w}</p>{/each}
        {/if}
        <div class="row">
          <span class="grow"></span>
          <button class="btn" onclick={closeLexicanter}>{t('common.cancel')}</button>
          <button class="btn primary" onclick={runLexicanter}>{t('io.import')}</button>
        </div>
      </div>
    </div>
  {:else if mainView === 'graph' && selected}
    <div class="scroll graph-wrap">
      <LexemeGraph
        {project}
        lexemeId={selected.id}
        onselect={recenterGraph}
        bind:mode={graphMode}
      />
    </div>
  {:else if !project.languages.length}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if inLang.length === 0}
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
        <button class="btn ghost sm" onclick={() => (tagBoxOpen = !tagBoxOpen)}
          ><Tags size={14} />{t('lexicon.bulkTag')}</button
        >
        <button class="btn ghost sm danger" onclick={removeSelected}
          ><Trash2 size={14} />{t('common.delete')}</button
        >
        <button class="btn ghost sm" onclick={() => (multiIds = [])}>{t('lexicon.clearSel')}</button
        >
      </div>
      {#if tagBoxOpen}
        <div class="card tagbox">
          <div class="row">
            <input
              class="input grow"
              list="dl-tags"
              placeholder={t('lexicon.tagAddPlaceholder')}
              bind:value={newTag}
              onkeydown={(e) => {
                if (e.key === 'Enter') addTagToSelected(newTag)
              }}
            />
            <button
              class="btn sm primary"
              disabled={!newTag.trim()}
              onclick={() => addTagToSelected(newTag)}>{t('lexicon.tagAdd')}</button
            >
            <button
              class="btn ghost icon sm"
              title={t('common.close')}
              onclick={() => (tagBoxOpen = false)}><X size={14} /></button
            >
          </div>
          <datalist id="dl-tags"
            >{#each knownTags as tg (tg)}<option value={tg}></option>{/each}</datalist
          >
          {#if selectedTags.length}
            <div class="row wrap tagrows">
              {#each selectedTags as [tg, n] (tg)}
                <span class="tagrow">
                  <span class="badge">{tg}</span>
                  <span class="small muted">{n}/{selectedLexemes.length}</span>
                  {#if n < selectedLexemes.length}
                    <button
                      class="btn ghost icon sm"
                      title={t('lexicon.tagAddAllHint')}
                      onclick={() => addTagToSelected(tg)}><Plus size={12} /></button
                    >
                  {/if}
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.tagRename')}
                    onclick={() => renameTagInSelected(tg)}><Pencil size={12} /></button
                  >
                  <button
                    class="btn ghost icon sm danger"
                    title={t('lexicon.tagRemoveAll')}
                    onclick={() => removeTagFromSelected(tg)}><X size={12} /></button
                  >
                </span>
              {/each}
            </div>
          {:else}
            <span class="small muted">{t('lexicon.tagNone')}</span>
          {/if}
        </div>
      {/if}
    {/if}
    <div
      class="scroll"
      use:navScroll={'lexicon'}
      use:innerWidth={(w) => (scrollW = w)}
      use:rows.box
    >
      <table class="tbl fixed" style={`width:${tableWidth}px`}>
        <colgroup>
          <col style={sort === 'custom' ? 'width:76px' : 'width:30px'} />
          <col style={colStyle('lemma')} />
          {#each activeColumns as c (c.key)}<col style={colStyle(c.key)} />{/each}
        </colgroup>
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
            <th>
              <ColHead
                label={t('lexicon.lemma')}
                sort={sortKey === 'lemma' ? sortDir : null}
                onsort={() => cycleSort('lemma')}
                options={filterOptions('lemma')}
                selected={colFilters.lemma ?? null}
                onfilter={(sel) => setFilter('lemma', sel)}
              />
              <span
                class="grip"
                role="separator"
                aria-label={t('lexicon.resizeCol')}
                onpointerdown={(e) => startResize(e, 'lemma')}
                onpointermove={moveResize}
                onpointerup={endResize}
              ></span>
            </th>
            {#each activeColumns as c (c.key)}
              <th>
                <ColHead
                  label={c.label}
                  sort={sortKey === c.key ? sortDir : null}
                  onsort={() => cycleSort(c.key)}
                  options={filterable(c.key) ? filterOptions(c.key) : undefined}
                  selected={colFilters[c.key] ?? null}
                  onfilter={(sel) => setFilter(c.key, sel)}
                />
                <span
                  class="grip"
                  role="separator"
                  aria-label={t('lexicon.resizeCol')}
                  onpointerdown={(e) => startResize(e, c.key)}
                  onpointermove={moveResize}
                  onpointerup={endResize}
                ></span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#if rows.range.start > 0}
            <tr class="vpad" aria-hidden="true"
              ><td colspan="99" style={`height:${rows.before}px`}></td></tr
            >
          {/if}
          {#each list.slice(rows.range.start, rows.range.end) as l, vi (l.id)}
            {@const li = rows.range.start + vi}
            <tr
              use:rows.row
              data-id={l.id}
              class:sel={selectedId === l.id || multiIds.includes(l.id)}
              class:flash={flashId === l.id}
              class:dup-row={ui.prefs.highlightDuplicates && isDup(l)}
              class:nodef-row={noDefIds.has(l.id)}
              onclick={(e) => rowClick(e, l, li)}
              ondblclick={(e) => editRow(e, l.id)}
            >
              <td class="mv">
                <StarToggle
                  on={!!l.favorite}
                  title={t('lexicon.favorite')}
                  onchange={() => toggleFavorite(l)}
                />
                {#if sort === 'custom'}
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
                {/if}
              </td>
              <td class="lemma data"
                >{#if l.marked}<span class="mark" title={t('lexicon.marked')}>{markSymbol}</span
                  >{/if}{l.lemma || '—'}{#if noDefIds.has(l.id)}<span
                    class="nodef"
                    title={t('lexicon.noDefinition')}><AlertCircle size={12} /></span
                  >{/if}{#if isDup(l)}<span class="dup" title={t('lexicon.duplicate')}
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
          {:else}
            <tr class="empty"><td colspan="99" class="muted">{t('table.noMatch')}</td></tr>
          {/each}
          {#if rows.range.end < list.length}
            <tr class="vpad" aria-hidden="true"
              ><td colspan="99" style={`height:${rows.after}px`}></td></tr
            >
          {/if}
        </tbody>
      </table>
    </div>
    <!-- 底部状态栏：红的、黄的各有几条，鼠标放上去列出是哪些，点一下跳过去 -->
    <div class="lex-status row">
      <span class="grow"></span>
      {#snippet issueBadge(list: typeof issues, cls: string, label: string)}
        <div class="issue-wrap">
          <span class="badge {cls}" role="button" tabindex="0">{label}</span>
          <div class="issue-pop card">
            {#each list.slice(0, ISSUE_LIST_MAX) as it (it.lexemeId)}
              <button class="issue-item" onclick={() => reveal(it.lexemeId)}
                ><span class="data">{it.lemma || '—'}</span><span class="small muted"
                  >{it.kind === 'noDefinition'
                    ? t('lexicon.noDefinition')
                    : t('lexicon.duplicate')}</span
                ></button
              >
            {/each}
            {#if list.length > ISSUE_LIST_MAX}<span class="small muted more-issues"
                >{t('lexicon.issuesMore', { n: list.length - ISSUE_LIST_MAX })}</span
              >{/if}
          </div>
        </div>
      {/snippet}
      {#if errorIssues.length}
        {@render issueBadge(
          errorIssues,
          'err',
          t('lexicon.issuesNoDef', { n: errorIssues.length })
        )}
      {/if}
      {#if warnIssues.length}
        {@render issueBadge(warnIssues, 'warnb', t('lexicon.issuesDup', { n: warnIssues.length }))}
      {/if}
      {#if !errorIssues.length && !warnIssues.length}<span class="badge"
          >{t('lexicon.noIssues')}</span
        >{/if}
    </div>
  {/if}
</div>

{#if mode === 'lexc' && lexcPreview}
  <Portal>
    <ImportPreview
      kind="lexemes"
      total={lexcPreview.report.lexemes}
      project={lexcPreview.project}
      lexemes={lexcPreview.project.lexemes.slice(0, PREVIEW_LIMIT)}
      source={lexc?.name ?? ''}
      testParse={testLexc}
      testPlaceholder={t('importPreview.phLexc')}
    />
  </Portal>
{/if}

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
    <LexemeCard lexeme={l} {project} onselect={selectFromCard} controls />
    <LexemeExamples lexeme={l} {project} {glossLangs} />
  </Portal>
{/if}

<!-- 检视器模块的录入框：跟词条卡一样按位置排 -->
{#snippet customEditors(l: Lexeme, where: CustomFieldPosition)}
  {#each customFieldsFor(project, l.languageId).filter((f) => f.position === where) as f (f.id)}
    {@const sc = customFieldScript(project, f)}
    {@const title = customFieldTitle(f, glossLangs) || t('taxonomy.customUntitled')}
    <div class="field">
      {#if f.kind === 'list'}
        <span class="small muted">{title}</span>
        <TagInput
          tags={customItems(l.custom?.[f.id] ?? '')}
          placeholder={t('lexicon.customListPlaceholder')}
          onchange={(tags) => {
            setCustomValue(l, f.id, tags.join('、'))
            touch(l)
          }}
        />
      {:else}
        <label for={`cf-${f.id}`}>{title}</label>
        <textarea
          id={`cf-${f.id}`}
          class="textarea"
          rows="2"
          style={sc ? fontCss(sc) : undefined}
          value={l.custom?.[f.id] ?? ''}
          oninput={(e) => {
            setCustomValue(l, f.id, (e.currentTarget as HTMLTextAreaElement).value)
            touch(l)
          }}
        ></textarea>
      {/if}
    </div>
  {/each}
{/snippet}

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
      <div class="row">
        <label class="grow" for="lx-lemma">{t('lexicon.lemma')}</label>
        <StarToggle
          on={!!l.favorite}
          label={t('lexicon.favorite')}
          onchange={() => toggleFavorite(l)}
        />
        <label class="chip-check" title={t('lexicon.markedHint')}
          ><input
            type="checkbox"
            checked={!!l.marked}
            onchange={(e) => {
              l.marked = (e.currentTarget as HTMLInputElement).checked
              touch(l)
            }}
          />{markSymbol}&thinsp;{t('lexicon.marked')}</label
        >
      </div>
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
      {#if selLang?.stages?.length}
        <div class="field grow">
          <label for="lx-stage">{t('lexicon.stage')}</label>
          <select
            id="lx-stage"
            class="select"
            value={l.stageId ?? ''}
            onchange={(e) => {
              l.stageId = (e.currentTarget as HTMLSelectElement).value || null
              touch(l)
            }}
          >
            <option value="">{t('lexicon.latestStage')}</option>
            {#each selLang.stages as st (st.id)}<option value={st.id}
                >{st.abbr ? `${st.abbr} · ${st.name}` : st.name}</option
              >{/each}
          </select>
        </div>
      {/if}
    </div>

    {#if catsFor(l).length}
      <div class="field">
        <div class="row">
          <span class="small muted">{t('lexicon.features')}</span><HelpDot key="features" />
        </div>
        {#each catsFor(l) as c (c.id)}
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
        <div class="chips" use:fiveRows>
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

    {@render customEditors(l, 'beforeSenses')}

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
      {#each l.senses as s, i (s.id)}
        {@const ownParts = posParts(project, l.posId)}
        <div class="sense card">
          <div class="row">
            <span class="num">{i + 1}</span>
            <select
              class="select sense-pos"
              title={t('lexicon.sensePos')}
              value={s.posId ?? ''}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value
                if (v) s.posId = v
                else delete s.posId
                touch(l)
              }}
            >
              <option value="">{t('lexicon.sensePosInherit')}</option>
              {#if ownParts.length > 1}
                <optgroup label={t('lexicon.sensePosOwn')}>
                  {#each ownParts as p (p.id)}<option value={p.id}
                      >{pickText(p.name, glossLangs) || p.abbr}</option
                    >{/each}
                </optgroup>
                <optgroup label={t('lexicon.sensePosOther')}>
                  {#each project.posList.filter((p) => !ownParts.some((o) => o.id === p.id)) as p (p.id)}<option
                      value={p.id}>{pickText(p.name, glossLangs) || p.abbr}</option
                    >{/each}
                </optgroup>
              {:else}
                {#each project.posList as p (p.id)}<option value={p.id}
                    >{pickText(p.name, glossLangs) || p.abbr}</option
                  >{/each}
              {/if}
            </select>
            <span class="grow"></span>{#if l.senses.length > 1}<button
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
          <TagInput
            bind:tags={s.registers}
            suggestions={registerOptions}
            placeholder={t('lexicon.registersPlaceholder')}
            onchange={() => touch(l)}
          />
        </div>
      {/each}
    </div>

    {@render customEditors(l, 'afterSenses')}

    <div class="field">
      <div class="row">
        <span class="small muted">{t('lexicon.etymology')}</span><HelpDot key="etymology" />
      </div>
      <EtymologyEditor
        bind:etymology={l.etymology}
        {project}
        ownerId={l.id}
        ownerForm={l.lemma}
        {glossLangs}
        onchange={() => touch(l)}
      />
    </div>

    {@render customEditors(l, 'afterEtymology')}

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
        {@const known = relationKinds.includes(r.kind) && !(i in kindDraft)}
        <div class="row kv">
          <select
            class="select kind"
            value={known ? r.kind : '__custom__'}
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value
              if (v === '__custom__') {
                kindDraft = { ...kindDraft, [i]: r.kind }
                return
              }
              const { [i]: _drop, ...rest } = kindDraft
              void _drop
              kindDraft = rest
              r.kind = v
              touch(l)
            }}
          >
            {#each relationKinds as k (k)}<option value={k}>{relLabel(k)}</option>{/each}
            <option value="__custom__">{t('lexicon.customKind')}</option>
          </select>
          {#if !known}
            <!-- 自己写的种类：边打字边写回去的话，刚打一个字母这个种类就进了下拉表、输入框跟着消失；打完回车或者移开焦点才算 -->
            <input
              class="input kind"
              value={kindDraft[i] ?? r.kind}
              placeholder={t('lexicon.relationKind')}
              oninput={(e) =>
                (kindDraft = { ...kindDraft, [i]: (e.currentTarget as HTMLInputElement).value })}
              onkeydown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                else if (e.key === 'Escape') {
                  const { [i]: _drop, ...rest } = kindDraft
                  void _drop
                  kindDraft = rest
                }
              }}
              onblur={() => commitKind(l, r, i)}
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
      <!-- 词类定义的词干槽固定排前面：填了字也还在原地，不会换到下面一组丢了焦点 -->
      {#each posStemSlots(l) as st (st.name)}
        <div class="row kv">
          <input class="input" value={st.name} disabled title={st.notes} />
          <input
            class="input data"
            placeholder={st.notes || t('lexicon.stemEmpty')}
            value={l.stems[st.name] ?? ''}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value
              if (v) l.stems[st.name] = v
              else delete l.stems[st.name]
              touch(l)
            }}
          />
          <span class="kv-spacer"></span>
        </div>
      {/each}
      {#each stemRows.sync( l.id, Object.keys(l.stems).filter((k) => !posStemSlots(l).some((st) => st.name === k)) ) as row (row.id)}
        <div class="row kv">
          <input
            class="input"
            value={row.key}
            placeholder={t('lexicon.stemName')}
            onchange={(e) =>
              renameRow(l.stems, stemRows, row, e.currentTarget as HTMLInputElement, l)}
          />
          <input class="input data" bind:value={l.stems[row.key]} oninput={() => touch(l)} />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              delete l.stems[row.key]
              touch(l)
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>

    {#if selLang}
      <div class="field">
        <div class="row">
          <span class="small muted">{t('lexicon.pronunciations')}</span><HelpDot
            key="pronunciations"
          />
        </div>
        {#each selLang.orthographies as o (o.id)}
          <div class="row kv">
            <span class="small oname" title={o.name}
              >{orthoIpaLabel(o.name, selLang.orthographies.length)}</span
            >
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
      <StressSettingsEditor
        value={l.stress}
        onchange={(v) => {
          l.stress = v
          touch(l)
        }}
      />
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
                placeholder={lexemeScript(selLang, sc, l, scriptSourceText(sc, l))}
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
          <option value=""
            >{posParas(l)[0]
              ? t('lexicon.paradigmByPosNamed', { name: paraName(posParas(l)[0]) })
              : t('lexicon.paradigmByPos')}</option
          >
          {#if posParas(l).length > 1}
            <optgroup label={t('lexicon.paradigmsOfPos')}>
              {#each posParas(l) as id (id)}<option value={id}>{paraName(id)}</option>{/each}
            </optgroup>
            <optgroup label={t('lexicon.paradigmsOther')}>
              {#each project.paradigms.filter((pa) => !pa.appliesToAll && !posParas(l).includes(pa.id)) as pa (pa.id)}<option
                  value={pa.id}>{paraName(pa.id)}</option
                >{/each}
            </optgroup>
          {:else}
            {#each project.paradigms.filter((pa) => !pa.appliesToAll) as pa (pa.id)}<option
                value={pa.id}>{paraName(pa.id)}</option
              >{/each}
          {/if}
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
            <option value=""
              >{paradigmOf(l)?.baseVariantName?.trim() || t('paradigms.variantBase')}</option
            >
            {#each paradigmOf(l)?.variants ?? [] as v (v.id)}<option value={v.id}>{v.name}</option
              >{/each}
          </select>
        {/if}
      </div>
      <!-- 另外还用的构形（名词兼动词：一个变格、一个变位） -->
      {#each l.extraParadigms ?? [] as ep, ei (ei)}
        {@const epara = project.paradigms.find((pa) => pa.id === ep.paradigmId)}
        <div class="row two extra-para">
          <select
            class="select"
            value={ep.paradigmId}
            onchange={(e) => {
              ep.paradigmId = (e.currentTarget as HTMLSelectElement).value
              ep.variantId = null
              rederive(l)
            }}
          >
            {#each project.paradigms.filter((pa) => !pa.appliesToAll) as pa (pa.id)}<option
                value={pa.id}>{paraName(pa.id)}</option
              >{/each}
          </select>
          {#if (epara?.variants.length ?? 0) > 0}
            <select
              class="select"
              value={ep.variantId ?? ''}
              onchange={(e) => {
                ep.variantId = (e.currentTarget as HTMLSelectElement).value || null
                rederive(l)
              }}
            >
              <option value=""
                >{epara?.baseVariantName?.trim() || t('paradigms.variantBase')}</option
              >
              {#each epara?.variants ?? [] as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
            </select>
          {/if}
          <button
            class="btn ghost icon sm"
            title={t('lexicon.removeParadigm')}
            onclick={() => {
              l.extraParadigms?.splice(ei, 1)
              if (!l.extraParadigms?.length) delete l.extraParadigms
              rederive(l)
            }}><X size={14} /></button
          >
        </div>
      {/each}
      <div class="row forms-head">
        <span class="small muted nowrap">{t('lexicon.forms')}</span><HelpDot key="forms" /><button
          class="fold-btn"
          class:on={formsFolded}
          title={formsFolded ? t('common.expand') : t('common.collapse')}
          aria-expanded={!formsFolded}
          onclick={() => toggleSection(FORMS_FOLD_EDIT)}
          >{#if formsFolded}<ChevronRight size={14} />{:else}<ChevronDown size={14} />{/if}</button
        ><span class="grow"></span>
        <span class="seg">
          <button
            class:active={formsLayout === 'list'}
            title={t('lexicon.layoutList')}
            onclick={() => setFormsLayout('list')}><List size={13} /></button
          ><button
            class:active={formsLayout === 'table'}
            title={t('lexicon.layoutTable')}
            onclick={() => setFormsLayout('table')}><Table size={13} /></button
          ><button
            class:active={formsLayout === 'tree'}
            title={t('lexicon.layoutTree')}
            onclick={() => setFormsLayout('tree')}><ListTree size={13} /></button
          >
        </span>
        {#if freeParadigm(l)}<button
            class="btn ghost sm"
            title={t('lexicon.addParadigmHint')}
            onclick={() => addExtraParadigm(l)}><Plus size={14} />{t('lexicon.addParadigm')}</button
          >{/if}
        {#if slotsOf(l).length}<button class="btn ghost sm" onclick={() => deriveNow(l)}
            ><Wand2 size={14} />{t('lexicon.deriveForms')}</button
          ><button
            class="btn ghost sm"
            title={t('lexicon.deriveAllHint')}
            onclick={() => deriveAllForms(l)}
            ><RotateCcw size={14} />{t('lexicon.deriveAllForms')}</button
          >{/if}
        <button
          class="btn ghost sm"
          onclick={() => {
            l.forms[''] = { surface: '', derived: false, override: true, trace: [] }
            touch(l)
          }}><Plus size={14} />{t('lexicon.addForm')}</button
        >
      </div>
      {#if formsFolded}
        <button class="fold-sum small" onclick={() => toggleSection(FORMS_FOLD_EDIT)}
          >{foldedFormsSummary(l)}</button
        >
      {:else if slotsOf(l).length}
        {@const groups = slotGroups(l)}
        {#each groups as grp (grp.id)}
          {@const dims =
            formsLayout === 'list'
              ? []
              : paradigmDims(grp.lp.paradigm, project.categories, glossLangs)}
          {#if groups.length > 1}<div class="small para-head">{grp.name}</div>{/if}
          {#if dims.length}
            <FormsView {dims} slots={grp.slots} layout={formsLayout as 'table' | 'tree'}>
              {#snippet cell(s: LexemeSlot | null)}
                {#if s}
                  {@const f = l.forms[s.key]}
                  <span class="cellwrap">
                    <input
                      class="input data cell"
                      class:derived={f && !f.override}
                      value={f?.surface ?? ''}
                      placeholder="—"
                      title={[s.slot.label, ...(f?.trace ?? [])].filter(Boolean).join('\n')}
                      oninput={(e) => {
                        l.forms[s.key] = {
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
                        class="cell-reset"
                        title={t('lexicon.resetDerived')}
                        onclick={() => {
                          delete l.forms[s.key]
                          deriveNow(l)
                        }}><RotateCcw size={11} /></button
                      >
                    {/if}
                  </span>
                {/if}
              {/snippet}
            </FormsView>
          {:else}
            {#each grp.slots as s (grp.id + '|' + s.slot.key)}
              {@const f = l.forms[s.key]}
              <div class="row kv" title={f?.trace?.join('\n') ?? ''}>
                <span class="slot small">{s.slot.label}</span>
                <input
                  class="input data"
                  class:derived={f && !f.override}
                  value={f?.surface ?? ''}
                  placeholder="—"
                  oninput={(e) => {
                    l.forms[s.key] = {
                      surface: (e.currentTarget as HTMLInputElement).value,
                      derived: false,
                      override: true,
                      trace: []
                    }
                    touch(l)
                  }}
                />
                {#if f?.surface?.trim()}
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.generateEntry')}
                    onclick={() => generateFromSlot(l, s)}><FilePlus2 size={13} /></button
                  >
                {/if}
                {#if f?.override}
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.resetDerived')}
                    onclick={() => {
                      delete l.forms[s.key]
                      deriveNow(l)
                    }}><RotateCcw size={13} /></button
                  >
                {:else if f}
                  <span class="badge">{t('lexicon.formsDerived')}</span>
                {/if}
              </div>
            {/each}
          {/if}
        {/each}
        {#if Object.keys(l.forms).some((k) => !slotsOf(l).some((s) => s.key === k))}<span
            class="small muted">{t('lexicon.extraForms')}</span
          >{/if}
      {:else if l.posId}
        <span class="hint">{t('lexicon.noParadigm')}</span>
      {/if}
      {#each formsFolded ? [] : formRows.sync( l.id, Object.keys(l.forms).filter((k) => !slotsOf(l).some((s) => s.key === k)) ) as row (row.id)}
        <div class="row kv">
          <input
            class="input"
            value={row.key}
            placeholder={t('lexicon.slot')}
            onchange={(e) =>
              renameRow(l.forms, formRows, row, e.currentTarget as HTMLInputElement, l)}
          />
          <input
            class="input data"
            bind:value={l.forms[row.key].surface}
            oninput={() => {
              l.forms[row.key].override = true
              touch(l)
            }}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              delete l.forms[row.key]
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

    {@render customEditors(l, 'end')}

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
  .kv-spacer {
    width: 28px;
    flex: none;
  }
  th.order {
    width: 34px;
    text-align: center;
  }
  th.order .btn.active {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .grip {
    position: absolute;
    top: 0;
    right: 0;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
  }
  .tbl th {
    position: relative;
  }
  .tbl.fixed {
    /* 宽度由脚本按表格所在区域铺满后各列之和给出，见 fitted / tableWidth */
    table-layout: fixed;
  }
  .tbl.fixed td {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tr.dup-row td {
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  tr.nodef-row:not(.sel) td {
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }
  .nodef {
    color: var(--danger);
    margin-left: 4px;
    vertical-align: middle;
  }
  .lex-status {
    flex: none;
    gap: 6px;
  }
  .lex-status .badge.err {
    background: var(--danger-soft);
    color: var(--danger);
    cursor: default;
  }
  /* 深色下红字压在暗红底上不够清楚 */
  :global([data-theme='dark']) .lex-status .badge.err {
    color: #ef8b8b;
  }
  .lex-status .badge.warnb {
    background: var(--warn-soft);
    color: var(--warn);
    cursor: default;
  }
  .issue-wrap {
    position: relative;
  }
  /* 悬浮列表贴着徽章上沿，鼠标从徽章移上去不会断 */
  .issue-pop {
    display: none;
    position: absolute;
    right: 0;
    bottom: 100%;
    z-index: 30;
    min-width: 240px;
    max-height: 320px;
    overflow: auto;
    padding: 4px;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .issue-wrap:hover .issue-pop,
  .issue-wrap:focus-within .issue-pop {
    display: flex;
  }
  .issue-item {
    display: flex;
    gap: 10px;
    align-items: baseline;
    justify-content: space-between;
    border: 0;
    background: none;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: inherit;
    text-align: left;
  }
  .issue-item:hover {
    background: var(--bg-hover);
  }
  .more-issues {
    padding: 4px 8px;
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
  /* 表格 / 树形图里手改过的格子：右上角一个小 ↺ 回到推导值 */
  .cellwrap {
    position: relative;
    display: block;
  }
  .cell-reset {
    position: absolute;
    right: 2px;
    top: 2px;
    display: none;
    border: 0;
    background: var(--bg-elev);
    border-radius: 4px;
    padding: 1px;
    color: var(--text-3);
    cursor: pointer;
  }
  .cellwrap:hover .cell-reset {
    display: block;
  }
  .cell-reset:hover {
    color: var(--text);
  }
  /* 批量标签：选中几条之后展开的小面板 */
  .tagbox {
    padding: 10px 12px;
    margin: 0 0 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tagrows {
    gap: 8px;
  }
  .tagrow {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 999px;
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
    /* 这一格里只有图标按钮：字号归零，免得标签之间的空白在星星后面画出一个点 */
    font-size: 0;
  }
  /* 收藏的星星平时不打眼：没收藏的只在这一行上有鼠标时露出来 */
  .mv :global(.star:not(.on)) {
    opacity: 0;
    transition: opacity 0.12s;
  }
  tr:hover .mv :global(.star:not(.on)),
  .mv :global(.star:focus-visible) {
    opacity: 0.55;
  }
  tr:hover .mv :global(.star:not(.on):hover) {
    opacity: 1;
  }
  /* 打了记号的词，单词前面那个符号 */
  .mark {
    margin-right: 3px;
    color: var(--warn);
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
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .graph-wrap {
    padding-right: 4px;
    display: flex;
    flex-direction: column;
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
  .tbl tbody tr.vpad {
    cursor: default;
    background: none;
  }
  .tbl tbody tr.vpad td {
    padding: 0;
    border: 0;
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
  /* 义项的词类：小一点、淡一点，不抢释义的眼 */
  .sense-pos {
    width: auto;
    max-width: 170px;
    padding: 1px 24px 1px 6px;
    background-position: right 7px center;
    font-size: 12px;
    color: var(--text-2);
  }
  .lexc-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 640px;
    padding: 14px 16px;
  }
  .lexc-panel .warn {
    color: var(--warn);
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
    width: 124px;
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
  .extra-para {
    margin-top: 4px;
  }
  .para-head {
    margin: 6px 0 2px;
    color: var(--text-2);
    font-weight: 600;
  }
  /* 屈折形那一行：检视器窄的时候按钮换行，别把标题和视图按钮挤扁 */
  .forms-head {
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .forms-head .seg {
    flex: none;
  }
  .nowrap {
    white-space: nowrap;
  }
  /* 屈折形：标题旁收起的三角，收起后那一行小字 */
  .fold-btn {
    display: inline-flex;
    align-items: center;
    border: 0;
    background: none;
    padding: 0 2px;
    color: var(--text-3);
    cursor: pointer;
  }
  .fold-sum {
    border: 0;
    background: none;
    padding: 2px 0;
    text-align: left;
    color: var(--text-3);
    cursor: pointer;
  }
  .fold-sum:hover {
    color: var(--text-2);
  }
  /* 表格、树形图里的格子：输入框铺满一格 */
  .input.cell {
    min-width: 90px;
    width: 100%;
    border: 0;
    background: none;
    padding: 3px 4px;
  }
  .input.cell:focus {
    background: var(--bg-elev);
  }
</style>
