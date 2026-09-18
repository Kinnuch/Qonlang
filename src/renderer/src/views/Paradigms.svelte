<script lang="ts">
  import { tick } from 'svelte'
  import type { PageView } from '$lib/state/ui.svelte'
  import { lazy, lazyMore } from '$lib/ui/lazy.svelte'
  import { focusField } from '$lib/ui/focus'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { makeCollator } from '$lib/core/collate'
  import { createLexeme, newId } from '$lib/core/factory'
  import { newLexeme } from '$lib/state/newLexeme.svelte'
  import {
    bindPosParadigm,
    ownParadigmIds,
    posParadigmIds,
    setDefaultPosParadigm,
    unbindParadigm
  } from '$lib/core/pos'
  import type {
    CategoryValue,
    GrammaticalCategory,
    Id,
    Lexeme,
    Paradigm,
    SlotBase,
    SlotGenerator
  } from '$lib/core/model'
  import {
    formKeyOf,
    lexemeVariantFor,
    paradigmsFor,
    paradigmSlots,
    resolveGenerator,
    generateForm,
    deriveForms,
    reconcileSlot,
    makeContext,
    type SlotDef,
    type SlotReport,
    slotKey,
    variantKey
  } from '$lib/engine/morph'
  import Portal from '$lib/ui/Portal.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import SlotPipeline from '$lib/ui/SlotPipeline.svelte'
  import TabStrip from '$lib/ui/TabStrip.svelte'
  import { flashOn } from '$lib/ui/flash'
  let derivedFlash = $state(0)
  import {
    Plus,
    Trash2,
    ChevronUp,
    ChevronDown,
    Play,
    ClipboardCheck,
    ArrowLeft,
    Check,
    X,
    Minus,
    Pencil,
    List,
    Table,
    ListTree,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    FilePlus2,
    CornerDownRight,
    Copy,
    ClipboardPaste,
    MoveRight,
    Lock,
    LockOpen
  } from '@lucide/svelte'
  import { morphClip } from '$lib/state/morphClip.svelte'
  import { pastedGenerator } from '$lib/core/pasteGenerator'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import { sortable } from '$lib/ui/sortable.svelte'
  import { moveItem } from '$lib/core/move'
  import { setDimensionOrder } from '$lib/core/relabel'
  import {
    checkConsistency,
    groupIssues,
    type Issue,
    type IssueGroup
  } from '$lib/engine/consistency'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import {
    forgetSectionsWithPrefix,
    sectionCollapsed,
    setSectionsCollapsed,
    toggleSection
  } from '$lib/ui/section.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const language = $derived(
    projectState.currentLanguage ??
      project.languages.find((l) => l.id === project.settings.defaultLanguageId) ??
      project.languages[0] ??
      null
  )

  /** 槽位的三种看法：可视化（逐格编辑）、表格（第一、二个维度排成行列，其余维度每种取值一张表）、树形图 */
  type SlotLayout = 'visual' | 'table' | 'tree'
  /** 回到这一页时接着用上次的构形、视图、一致性检查结果与测试台 */
  const memo = ui.memo<{
    activeId: Id | null
    view: 'slots' | 'report'
    report: SlotReport[] | null
    issues: IssueGroup[] | null
    openKinds: Set<string>
    testLemma: string
    testLexemeId: Id | null
    editVariantId: Id | null
    layout: SlotLayout
    benchMode: 'compare' | 'free'
    freeInput: string
    /** 上锁时按维度筛选要看哪些槽位（只影响显示，不进项目） */
    dimFilter: Id[]
  }>('paradigms')
  let activeId = $state<Id | null>(memo.activeId ?? null)
  const active = $derived(
    project.paradigms.find((p) => p.id === activeId) ?? project.paradigms[0] ?? null
  )
  $effect(() => {
    const id = ui.takePending('paradigm')
    if (id) activeId = id
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('paradigms', {
      kind: 'paradigm',
      lang: projectState.currentLanguageId,
      id: activeId,
      view
    })
  })
  $effect(() => {
    const r = ui.takeRestore('paradigms')
    if (!r) return
    const v: PageView = r.view ?? {}
    if (v.id) activeId = v.id
    // 一致性检查的结果不跟着页面留下来：没有结果就回到槽位表
    view = v.view === 'report' && report ? 'report' : 'slots'
  })
  $effect(() => {
    if (active && activeId !== active.id) activeId = active.id
  })
  let view = $state<'slots' | 'report'>(memo.view === 'report' && memo.report ? 'report' : 'slots')
  let report = $state<SlotReport[] | null>(memo.report ?? null)
  /** 项目级问题清单（跟槽位比对一起跑） */
  let issues = $state<IssueGroup[] | null>(memo.issues ?? null)
  let openKinds = $state<Set<string>>(memo.openKinds ?? new Set())
  function toggleKind(k: string): void {
    const next = new Set(openKinds)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    openKinds = next
  }
  function gotoIssue(i: Issue): void {
    if (!i.targetId) return
    if (i.target === 'lexeme') ui.jump('lexicon', 'lexeme', i.targetId)
    else if (i.target === 'morpheme') ui.jump('morphemes', 'morpheme', i.targetId)
    else if (i.target === 'sentence') ui.jump('corpus', 'sentence', i.targetId)
    else if (i.target === 'paradigm') {
      activeId = i.targetId
      view = 'slots'
    } else if (i.target === 'script') ui.jump('script', 'script', i.targetId)
  }
  const issueTotal = $derived(issues ? issues.reduce((a, g) => a + g.issues.length, 0) : 0)
  let testLemma = $state(memo.testLemma ?? '')
  /**
   * 测试台两种模式：对比（挑一个词，推出来的形式跟词库里录的比）；
   * 自由（随便写一个形式，只看它经过这个构形变成什么；结果可以生成词条，也可以接着拿去套别的构形）
   */
  let benchMode = $state<'compare' | 'free'>(memo.benchMode ?? 'compare')
  let freeInput = $state(memo.freeInput ?? '')

  const allSlots = $derived(
    active ? paradigmSlots(active, project.categories, glossLangs, true) : []
  )
  // ── 维度上锁与筛选 ──
  const locked = $derived(!!active?.slotsLocked)
  let dimFilter = $state<Id[]>(memo.dimFilter ?? [])
  $effect(() => {
    memo.dimFilter = dimFilter
  })
  const catOfValue = $derived.by(() => {
    const m = new Map<Id, Id>()
    for (const c of project.categories) for (const v of c.values) m.set(v.id, c.id)
    return m
  })
  /** 固定下来的槽位：怎么筛都在，底色深一点 */
  const fixedKeys = $derived(new Set(active?.lockedSlots ?? []))
  /** 上锁时按选中的维度筛：槽位得用上这几个维度 */
  const inFilter = (s: SlotDef): boolean =>
    !locked ||
    !dimFilter.length ||
    dimFilter.every((d) => s.values.some((v) => catOfValue.get(v.valueId) === d))
  /** 上锁：把眼下这些槽位固定下来，之后点维度只当筛选 */
  function toggleLock(): void {
    if (!active) return
    if (active.slotsLocked) {
      active.slotsLocked = false
      dimFilter = []
    } else {
      active.slotsLocked = true
      active.lockedSlots = [...new Set(allSlots.map((s) => s.key))]
      dimFilter = []
    }
    touch()
  }
  /** 上锁时点维度：只改筛选 */
  function toggleFilter(id: Id): void {
    dimFilter = dimFilter.includes(id) ? dimFilter.filter((x) => x !== id) : [...dimFilter, id]
  }
  /** 按眼下筛出来的这批槽位批量启用 / 停用 */
  function setShownEnabled(on: boolean): void {
    if (!active) return
    const keys = new Set(slots.map((s) => s.key))
    const rest = active.disabledSlots.filter((k) => !keys.has(k))
    active.disabledSlots = on ? rest : [...rest, ...keys]
    touch()
    ui.toast(t(on ? 'paradigms.batchEnabled' : 'paradigms.batchDisabled', { n: keys.size }))
  }
  /** 顶栏搜索：按槽位名或 gloss 缩写筛（推导与检查仍然跑全部槽位） */
  const slots = $derived.by(() => {
    const shown = allSlots.filter(inFilter)
    const pq = parseQuery(ui.search, SEARCH_FIELDS.paradigms)
    if (!pq.terms.length) return shown
    return shown.filter((s) =>
      matchQuery(pq, (f) =>
        f === 'slot' ? [s.label] : f === 'gloss' ? [s.abbr] : [s.label, s.abbr]
      )
    )
  })
  const boundPos = $derived(
    active ? project.posList.filter((p) => ownParadigmIds(p).includes(active.id)) : []
  )
  /** 词条眼下用的就是这个构形（词条上指名的，或者词类默认的）排前面 */
  const usesRank = (l: Lexeme): number =>
    active && paradigmsFor(project, l).some((x) => x.paradigm.id === active.id) ? 0 : 1
  const paradigmName = (id: Id): string =>
    pickText(project.paradigms.find((x) => x.id === id)?.name ?? {}, glossLangs) ||
    t('paradigms.untitled')
  /** 绑定词类的全部词位；当前语言的排在前面 */
  const boundLexemes = $derived(
    project.lexemes
      // 作用于所有词的构形：测试台列出当前语言的全部词
      .filter((l) =>
        active?.appliesToAll
          ? !language || l.languageId === language.id
          : // 用着这个构形的词，加上词类绑了它、可以改用它的（复合词类没绑时跟着组成词类走）
            !!active &&
            (paradigmsFor(project, l).some((x) => x.paradigm.id === active.id) ||
              posParadigmIds(project, l.posId).includes(active.id))
      )
      .sort(
        (a, b) =>
          usesRank(a) - usesRank(b) ||
          (language && a.languageId === language.id ? 0 : 1) -
            (language && b.languageId === language.id ? 0 : 1)
      )
  )
  /** 词干候选：绑定词类里定义的词干槽在前，再补上词条里实际填过的 */
  const stemNames = $derived([
    ...new Set([
      ...boundPos.flatMap((p) => (p.stemSlots ?? []).map((st) => st.name.trim())).filter(Boolean),
      ...[...new Set(project.lexemes.flatMap((l) => Object.keys(l.stems)))].sort()
    ])
  ])
  /** 每门语言一个推导上下文（音类、多合字母、音节核、规则集缓存） */
  const ctxCache = new Map<Id, ReturnType<typeof makeContext>>()
  function ctxFor(languageId: Id): ReturnType<typeof makeContext> | null {
    const lg = project.languages.find((l) => l.id === languageId)
    if (!lg) return null
    let c = ctxCache.get(languageId)
    if (!c) {
      c = makeContext(project, lg)
      ctxCache.set(languageId, c)
    }
    return c
  }
  // 项目内容变化时清缓存
  $effect(() => {
    void project.ruleSets.map((r) => r.text)
    void project.languages.map((l) => l.classes.length + l.digraphs.length + l.phonemes.length)
    ctxCache.clear()
  })
  /** 测试台选中的词；没选就拿第一个绑定本构形的词 */
  let testLexemeId = $state<Id | null>(memo.testLexemeId ?? null)
  const testLexeme = $derived(
    project.lexemes.find((l) => l.id === testLexemeId) ??
      boundLexemes.find((l) => l.lemma === testLemma) ??
      boundLexemes[0] ??
      null
  )
  /** 模糊搜索：词头或释义包含关键词，绑定本构形的排前面 */
  let testFocused = $state(false)
  const testMatches = $derived.by(() => {
    const q = testLemma.trim().toLowerCase()
    const bound = new Set(boundLexemes.map((l) => l.id))
    // 绑定了词类就只在这些词里找；没绑定才搜整本词库
    const pool = boundLexemes.length ? boundLexemes : project.lexemes
    if (!q) {
      if (!testFocused) return []
      const collator = makeCollator(language?.alphabet ?? [])
      return [...pool].sort((a, b) => collator(a.lemma, b.lemma)).slice(0, 40)
    }
    const hit = pool.filter(
      (l) =>
        l.lemma.toLowerCase().includes(q) ||
        l.senses.some((se) => Object.values(se.definition).some((d) => d.toLowerCase().includes(q)))
    )
    hit.sort((a, b) => {
      const ba = bound.has(a.id) ? 0 : 1
      const bb = bound.has(b.id) ? 0 : 1
      if (ba !== bb) return ba - bb
      const sa = a.lemma.toLowerCase().startsWith(q) ? 0 : 1
      const sb = b.lemma.toLowerCase().startsWith(q) ? 0 : 1
      return sa - sb || a.lemma.length - b.lemma.length
    })
    return hit.slice(0, 12)
  })
  /** 一个词在一格里的推导结果，和已录入的形式比一比 */
  function formRow(
    ctx: ReturnType<typeof makeContext>,
    lexeme: Lexeme,
    para: Paradigm,
    s: SlotDef
  ): {
    slot: SlotDef
    generated: string
    trace: string[]
    stored: string
    status: 'none' | 'missing' | 'same' | 'diff'
  } {
    const g = generateForm(ctx, lexeme, para, s, editVariantId)
    const stored = lexeme.forms[formKeyOf(project, lexeme, para.id, s, editVariantId)]
    const status = !g
      ? 'none'
      : !stored?.override
        ? 'missing'
        : stored.surface
              .split(/[,，;；/]\s*/)
              .map((v) => v.trim().replace(/^\*/, ''))
              .includes(g.surface)
          ? 'same'
          : 'diff'
    return {
      slot: s,
      generated: g?.surface ?? '',
      trace: g?.trace ?? [],
      stored: stored?.surface ?? '',
      status
    }
  }
  /** 自由模式：写进去的形式当词头（词干都回落到它），按当前语言推一遍每一格 */
  const freeRows = $derived.by(() => {
    const form = freeInput.trim()
    const lid = language?.id
    if (benchMode !== 'free' || !active || !form || !lid) return []
    const ctx = ctxFor(lid)
    if (!ctx) return []
    const para = active
    const pseudo = createLexeme(lid, form)
    return slots
      .filter((s) => !para.disabledSlots.includes(s.key))
      .map((s) => {
        const g = generateForm(ctx, pseudo, para, s, editVariantId)
        return { slot: s, generated: g?.surface ?? '', trace: g?.trace ?? [] }
      })
  })
  /** 测试台里某一格推出来的形式：生成成一个新词条（弹出表单，词源、关系按构形填好） */
  function generateEntry(form: string, slot: SlotDef, base: Lexeme | null, languageId: Id): void {
    if (!active || !form.trim()) return
    newLexeme.open({
      languageId,
      form: form.trim(),
      base,
      paradigmId: active.id,
      slotLabel: slot.label
    })
  }
  const testRows = $derived.by(() => {
    if (!active || !testLexeme) return []
    const ctx = ctxFor(testLexeme.languageId)
    if (!ctx) return []
    const para = active
    return slots
      .filter((s) => !para.disabledSlots.includes(s.key))
      .map((s) => formRow(ctx, testLexeme, para, s))
  })

  // ───── 表格、树形图 ─────
  let layout = $state<SlotLayout>(memo.layout ?? 'visual')
  const dims = $derived(
    (active?.dimensionIds ?? [])
      .map((id) => project.categories.find((c) => c.id === id))
      .filter((c): c is GrammaticalCategory => !!c)
  )
  const slotByKey = $derived(new Map(allSlots.map((s) => [s.key, s])))
  /** 顶栏搜索筛剩下的格子；表格、树形图里其余的淡一些 */
  const shownKeys = $derived(new Set(slots.map((s) => s.key)))
  const valueName = (v: CategoryValue): string => pickText(v.name, glossLangs) || v.abbr || '?'
  const catName = (c: GrammaticalCategory): string => pickText(c.name, glossLangs) || '?'
  /** 表格、树形图里每一格：测试台里那个词的推导结果（只在这两种看法下算） */
  const cellForms = $derived.by(() => {
    const out = new Map<string, ReturnType<typeof formRow>>()
    if (layout === 'visual' || !active || !testLexeme) return out
    const ctx = ctxFor(testLexeme.languageId)
    if (!ctx) return out
    for (const s of allSlots)
      if (!active.disabledSlots.includes(s.key)) out.set(s.key, formRow(ctx, testLexeme, active, s))
    return out
  })
  /** 流水线里「构形」这一步能套的：别的构形（作用于所有词的不算），各自的槽位与变体 */
  const nestChoices = $derived(
    project.paradigms
      .filter((p) => p.id !== active?.id && !p.appliesToAll)
      .map((p) => ({
        id: p.id,
        name: pickText(p.name, glossLangs) || t('paradigms.untitled'),
        slots: paradigmSlots(p, project.categories, glossLangs).map((s) => ({
          key: s.key,
          label: s.label
        })),
        variants: p.variants.map((v) => ({ id: v.id, name: v.name }))
      }))
  )
  /** 一格的写法缩成一行：流水线每一步的词缀、跑哪套音变……（没有测试词时格子里就显示它） */
  function slotSummary(s: SlotDef): string {
    if (!active) return ''
    const g = resolveGenerator(active, s.key, project.paradigms, 0, editVariantId)
    if (g.kind === 'none') return ''
    if (g.kind !== 'pipeline') return t(`paradigms.kinds.${g.kind}`)
    const stem = g.base?.slotKey
      ? t('paradigms.base.summary', { name: baseLabel(g.base) })
      : g.stem.trim() && g.stem.trim() !== 'lemma'
        ? t('paradigms.stemRef', { name: g.stem.trim() })
        : ''
    const parts = g.steps.map((st) => {
      switch (st.kind) {
        case 'prefix':
        case 'suffix':
        case 'infix':
          return st.text.trim() || t(`paradigms.steps.${st.kind}`)
        case 'circumfix':
          return `${st.text.trim()}…${st.text2.trim()}`
        case 'sca': {
          const rs = project.ruleSets.find((r) => r.id === st.ruleSetId)
          return [t('paradigms.steps.sca'), rs?.name].filter(Boolean).join(' ')
        }
        case 'pattern':
          return st.pattern.trim() || t('paradigms.steps.pattern')
        case 'reduplication':
          return t('paradigms.steps.reduplication')
        case 'adjust':
          return [t('paradigms.steps.adjust'), st.text.split('\n')[0].trim()]
            .filter(Boolean)
            .join(' ')
        case 'paradigm': {
          const np = project.paradigms.find((x) => x.id === st.paradigmId)
          return [t('paradigms.steps.paradigm'), np && pickText(np.name, glossLangs)]
            .filter(Boolean)
            .join(' ')
        }
      }
    })
    if (!parts.length) return stem || t('paradigms.onlyStem')
    return [stem, ...parts].filter(Boolean).join(' · ')
  }
  /** 表格：第三个维度起，每种取值组合一张表 */
  const tableGroups = $derived.by(() => {
    if (layout !== 'table' || !dims.length) return []
    let combos: { categoryId: Id; valueId: Id; label: string }[][] = [[]]
    for (const d of dims.slice(2))
      combos = combos.flatMap((c) =>
        d.values.map((v) => [
          ...c,
          { categoryId: d.id, valueId: v.id, label: `${catName(d)} ${valueName(v)}` }
        ])
      )
    return combos.map((extra) => ({
      key: extra.map((e) => e.valueId).join('|') || '-',
      caption: extra.map((e) => e.label).join(' · '),
      extra
    }))
  })
  /** 表格里一格：行是第一个维度、列是第二个维度（只有一个维度时只有一列） */
  function slotAt(
    row: CategoryValue,
    col: CategoryValue | null,
    extra: { categoryId: Id; valueId: Id }[]
  ): SlotDef | undefined {
    const values = [{ categoryId: dims[0].id, valueId: row.id }]
    if (col && dims[1]) values.push({ categoryId: dims[1].id, valueId: col.id })
    return slotByKey.get(slotKey([...values, ...extra]))
  }
  interface TreeNode {
    key: string
    label: string
    abbr: string
    children: TreeNode[]
    slot: SlotDef | null
  }
  /** 树形图：第一个维度的取值分叉，往下每个维度再分，叶子是槽位 */
  const tree = $derived.by((): TreeNode[] => {
    if (layout !== 'tree' || !dims.length) return []
    const build = (depth: number, prefix: { categoryId: Id; valueId: Id }[]): TreeNode[] =>
      dims[depth].values.map((v) => {
        const values = [...prefix, { categoryId: dims[depth].id, valueId: v.id }]
        const key = slotKey(values)
        const leaf = depth === dims.length - 1
        return {
          key,
          label: valueName(v),
          abbr: v.abbr,
          children: leaf ? [] : build(depth + 1, values),
          slot: leaf ? (slotByKey.get(key) ?? null) : null
        }
      })
    return build(0, [])
  })
  /** 树形图的分叉点开 / 收起；槽位多（200 个以上）时默认收着，点开哪支画哪支 */
  let treeToggled = $state<Set<string>>(new Set())
  const treeBig = $derived(allSlots.length > 200)
  const treeOpen = (key: string): boolean =>
    treeBig ? treeToggled.has(key) : !treeToggled.has(key)
  function toggleTree(key: string): void {
    const next = new Set(treeToggled)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    treeToggled = next
  }
  let treeFor = ''
  $effect(() => {
    const id = active?.id ?? ''
    if (id === treeFor) return
    treeFor = id
    treeToggled = new Set()
  })
  /** 可视化里每个槽位各自能收起，记在本机（按构形与槽位记，变体之间共用） */
  const foldId = (key: string): string => `pd.slot:${active?.id ?? ''}:${key}`
  const allSlotsFolded = $derived(
    slots.length > 0 && slots.every((s) => sectionCollapsed(foldId(s.key)))
  )
  /** 收起时这一行写什么：生成器是流水线就把各步连起来，否则写生成器的种类 */
  function foldedSummary(s: SlotDef): string {
    const g = active?.generators[gkey(s.key)] ?? { kind: 'none' }
    return slotSummary(s) || t(`paradigms.kinds.${g.kind}`)
  }

  /** 表格、树形图里点一格：回到可视化，滚到这一格并闪一下 */
  async function openSlot(key: string): Promise<void> {
    const idx = slots.findIndex((s) => s.key === key)
    if (idx < 0) {
      ui.toast(t('paradigms.slotHidden'))
      return
    }
    if (sectionCollapsed(foldId(key))) setSectionsCollapsed([foldId(key)], false)
    layout = 'visual'
    while (lzSlots.shown <= idx) lzSlots.grow()
    await tick()
    const row = document.querySelector<HTMLElement>(`tr[data-slot="${CSS.escape(key)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    row.classList.remove('flash-ok')
    void row.offsetWidth
    row.classList.add('flash-ok')
    setTimeout(() => row.classList.remove('flash-ok'), 900)
  }

  $effect(() => {
    inspectorTitle = active
      ? pickText(active.name, glossLangs) || t('paradigms.untitled')
      : t('paradigms.title')
  })

  function touch(): void {
    projectState.touch()
  }
  /** 正在编辑哪个变体；null 表示通用那一套 */
  let editVariantId = $state<Id | null>(memo.editVariantId ?? null)
  // 换到别的构形时，原来选着的变体不是这个构形的：回到通用那一套。
  // 不回的话槽位按「槽位#别人的变体」去找生成器，整页都成了「无」、流水线全空
  $effect(() => {
    const vs = active?.variants ?? []
    if (editVariantId && !vs.some((v) => v.id === editVariantId)) editVariantId = null
  })
  $effect(() => {
    Object.assign(memo, {
      activeId,
      view,
      report,
      issues,
      openKinds,
      testLemma,
      testLexemeId,
      editVariantId,
      layout,
      benchMode,
      freeInput
    })
  })
  // 槽位多的时候分批画（维度一多就是几百行）
  const lzSlots = lazy(60)
  let lastSlots = -1
  $effect(() => {
    const n = slots.length
    if (n === lastSlots) return
    lastSlots = n
    lzSlots.reset()
  })
  const variants = $derived(active?.variants ?? [])
  /** 没选变体时那一套的名字：用户改过就用改的 */
  const baseName = $derived(active?.baseVariantName?.trim() || t('paradigms.variantBase'))
  /** 「2 × 6」这样的维度规模，用在槽位说明里 */
  const dimSizes = $derived(
    (active?.dimensionIds ?? [])
      .map((id) => project.categories.find((c) => c.id === id)?.values.length ?? 0)
      .join(' × ')
  )
  /** 该槽位在当前变体下的生成器键 */
  const gkey = (key: string): string => variantKey(key, editVariantId)
  async function addVariant(): Promise<void> {
    if (!active) return
    const name = (await ui.prompt(t('paradigms.variantName'), ''))?.trim()
    if (!name) return
    const v = { id: newId(), name }
    active.variants = [...active.variants, v]
    // 新变体先照搬正在看的这一套，改起来省事：只搬这一套自己写了的，继承来的还是继承
    const from = editVariantId ?? null
    const all = $state.snapshot(active.generators) as Record<string, SlotGenerator>
    for (const [key, gen] of Object.entries(all)) {
      const at = key.lastIndexOf('#')
      const vid = at < 0 ? null : key.slice(at + 1)
      if (vid !== from) continue
      active.generators[variantKey(at < 0 ? key : key.slice(0, at), v.id)] = gen
    }
    editVariantId = v.id
    touch()
  }
  /** 重命名选中的变体；没选变体时改的是基础那套的名字（清空或写回默认名就恢复默认） */
  async function renameVariant(): Promise<void> {
    if (!active) return
    const v = variants.find((x) => x.id === editVariantId)
    const name = (await ui.prompt(t('paradigms.variantName'), v ? v.name : baseName))?.trim()
    if (name === undefined) return
    if (v) {
      if (!name) return
      v.name = name
    } else if (!name || name === t('paradigms.variantBase')) delete active.baseVariantName
    else active.baseVariantName = name
    touch()
  }
  function removeVariant(): void {
    if (!active || !editVariantId) return
    const id = editVariantId
    active.variants = active.variants.filter((x) => x.id !== id)
    for (const k of Object.keys(active.generators))
      if (k.endsWith('#' + id)) delete active.generators[k]
    editVariantId = null
    touch()
  }
  function addParadigm(): void {
    const p: Paradigm = {
      id: newId(),
      name: { [glossLangs[0] ?? 'zh']: t('paradigms.untitled') },
      variants: [],
      dimensionIds: [],
      disabledSlots: [],
      generators: {},
      inheritsFrom: null
    }
    project.paradigms.push(p)
    activeId = p.id
    touch()
  }
  function removeParadigm(p: Paradigm): void {
    const idx = project.paradigms.indexOf(p)
    const snap = $state.snapshot(p) as Paradigm
    project.paradigms.splice(idx, 1)
    unbindParadigm(project, p.id)
    forgetSectionsWithPrefix(`pd.slot:${p.id}:`)
    activeId = project.paradigms[0]?.id ?? null
    touch()
    ui.toast(t('paradigms.deleted', { name: pickText(snap.name, glossLangs) }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.paradigms.splice(Math.min(idx, project.paradigms.length), 0, snap)
          activeId = snap.id
          touch()
        }
      }
    })
  }
  /** 槽位超过这个数先问一句（不拦着）：几百格的构形，编辑、推导、词条录入都会慢下来 */
  const SLOT_WARN = 500
  async function toggleDimension(id: Id): Promise<void> {
    if (!active) return
    const i = active.dimensionIds.indexOf(id)
    if (i >= 0) {
      active.dimensionIds.splice(i, 1)
      touch()
      return
    }
    const size = (cid: Id): number =>
      project.categories.find((c) => c.id === cid)?.values.length ?? 0
    const next = [...active.dimensionIds, id].reduce((n, cid) => n * size(cid), 1)
    if (next > SLOT_WARN) {
      const ok = await ui.confirm(
        t('paradigms.manySlotsTitle', { n: next }),
        t('paradigms.manySlotsBody', { n: next, limit: SLOT_WARN }),
        t('paradigms.manySlotsOk')
      )
      if (!ok || !active || active.dimensionIds.includes(id)) return
    }
    active.dimensionIds.push(id)
    touch()
  }
  function moveDimension(i: number, dir: -1 | 1): void {
    if (!active) return
    const j = i + dir
    if (j < 0 || j >= active.dimensionIds.length) return
    const order = [...active.dimensionIds]
    ;[order[i], order[j]] = [order[j], order[i]]
    reorderDimensions(order)
  }
  /** 换维度先后：生成器、停用的槽位按新顺序重拼 key，词库里的屈折形挪到新槽位名下 */
  function reorderDimensions(order: Id[]): void {
    if (!active) return
    const n = setDimensionOrder(project, active, order)
    touch()
    if (n) ui.toast(t('taxonomy.followedForms', { n }))
  }
  function toggleSlot(key: string): void {
    if (!active) return
    const i = active.disabledSlots.indexOf(key)
    if (i >= 0) active.disabledSlots.splice(i, 1)
    else active.disabledSlots.push(key)
    touch()
  }
  /** 生成器下拉里的四项：无 / 查表 / 组合 / 组合 + 影响发音 */
  const KIND_OPTIONS = ['none', 'table', 'pipeline', 'pipelinePron'] as const
  type KindOption = (typeof KIND_OPTIONS)[number]
  const kindOf = (g: SlotGenerator): KindOption =>
    g.kind === 'pipeline' && g.pron?.on ? 'pipelinePron' : (g.kind as KindOption)
  function setKind(key: string, option: KindOption): void {
    if (!active) return
    const cur = active.generators[key]
    const stem = cur && 'stem' in cur ? cur.stem : ''
    if (option === 'none' || option === 'table') {
      active.generators[key] = { kind: option } as SlotGenerator
      touch()
      return
    }
    const steps = cur && cur.kind === 'pipeline' ? cur.steps : []
    const base = cur && cur.kind === 'pipeline' ? cur.base : undefined
    // 写过的发音流水线留着：换回「组合（流水线）」只是不再推导发音
    const pron = cur && cur.kind === 'pipeline' ? cur.pron : undefined
    const next: SlotGenerator = { kind: 'pipeline', stem, steps }
    if (base) next.base = base
    if (option === 'pipelinePron')
      next.pron = pron ? { ...pron, on: true } : { on: true, from: 'form', steps: [] }
    else if (pron) next.pron = { ...pron, on: false }
    active.generators[key] = next
    touch()
  }
  /** 复制一个槽位的生成方式（当前变体下的；变体没写的复制通用那套） */
  function copySlot(key: string): void {
    if (!active) return
    if (projectState.readOnly) return void ui.toast(t('readonly.exportBlocked'))
    const g = active.generators[gkey(key)] ?? active.generators[key] ?? { kind: 'none' }
    morphClip.copy({ kind: 'slot', generator: g })
    ui.toast(t('paradigms.clip.slotCopied'))
  }
  async function pasteSlot(key: string): Promise<void> {
    if (!active) return
    const c = await morphClip.read()
    if (c?.kind !== 'slot') return void ui.toast(t('paradigms.clip.noSlot'))
    active.generators[gkey(key)] = pastedGenerator(c.generator)
    touch()
  }
  /** 复制正在看的这一套：每个槽位实际用的生成方式（变体没写的沿用通用那套） */
  function copyVariant(): void {
    if (!active) return
    if (projectState.readOnly) return void ui.toast(t('readonly.exportBlocked'))
    const generators: Record<string, SlotGenerator> = {}
    for (const s of slots) {
      const g = active.generators[gkey(s.key)] ?? active.generators[s.key]
      if (g && g.kind !== 'none') generators[s.key] = g
    }
    const name = variants.find((v) => v.id === editVariantId)?.name ?? baseName
    morphClip.copy({ kind: 'variant', name, generators })
    ui.toast(t('paradigms.clip.variantCopied', { name, n: Object.keys(generators).length }))
  }
  /** 整套贴进正在看的这一套：槽位对得上的都换掉，对不上的（维度不一样）跳过 */
  async function pasteVariant(): Promise<void> {
    if (!active) return
    const c = await morphClip.read()
    if (c?.kind !== 'variant') return void ui.toast(t('paradigms.clip.noVariant'))
    const keys = new Set(slots.map((s) => s.key))
    let n = 0
    for (const [key, g] of Object.entries(c.generators)) {
      if (!keys.has(key)) continue
      active.generators[gkey(key)] = pastedGenerator(g)
      n++
    }
    if (!n) return void ui.toast(t('paradigms.clip.noMatch'))
    touch()
    ui.toast(t('paradigms.clip.variantPasted', { name: c.name, n }))
  }
  // ── 槽位继承：起点换成另一格推出来的形式 ──
  /** 起点下拉框的值：空是词干，`构形id:槽位键`（本构形的构形 id 留空） */
  const baseValue = (g: { base?: SlotBase }): string =>
    g.base?.slotKey ? `${g.base.paradigmId ?? ''}:${g.base.slotKey}` : ''
  function setBase(key: string, value: string): void {
    const g = active?.generators[key]
    if (!g || g.kind !== 'pipeline') return
    if (!value) delete g.base
    else {
      const at = value.indexOf(':')
      g.base = { paradigmId: value.slice(0, at) || null, slotKey: value.slice(at + 1) }
    }
    touch()
  }
  function baseLabel(b: SlotBase): string {
    const p = b.paradigmId ? project.paradigms.find((x) => x.id === b.paradigmId) : active
    if (!p) return '?'
    const slot = paradigmSlots(p, project.categories, glossLangs, true).find(
      (s) => s.key === b.slotKey
    )
    const name = slot?.label ?? '?'
    return b.paradigmId
      ? `${pickText(p.name, glossLangs) || t('paradigms.untitled')} · ${name}`
      : name
  }
  /** 本构形里能继承的格：除了自己 */
  const ownBaseChoices = (key: string): SlotDef[] => allSlots.filter((s) => s.key !== key)

  // ── 重定位：写错槽位时把这一格的写法挪到别的格，这一格变回「无」 ──
  let relocateFrom = $state<string | null>(null)
  let relocateQuery = $state('')
  const relocateList = $derived.by(() => {
    if (!relocateFrom) return []
    const q = relocateQuery.trim().toLowerCase()
    return allSlots.filter(
      (s) =>
        s.key !== relocateFrom &&
        (!q || s.label.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q))
    )
  })
  function openRelocate(key: string): void {
    const g = active?.generators[gkey(key)]
    if (!g || g.kind === 'none') return void ui.toast(t('paradigms.relocate.empty'))
    relocateQuery = ''
    relocateFrom = key
  }
  async function relocateTo(target: SlotDef): Promise<void> {
    if (!active || !relocateFrom) return
    const from = gkey(relocateFrom)
    const to = gkey(target.key)
    const g = active.generators[from]
    if (!g) return
    const cur = active.generators[to]
    if (cur && cur.kind !== 'none') {
      const ok = await ui.confirm(
        t('paradigms.relocate.overwrite', { name: target.label }),
        t('paradigms.relocate.overwriteBody'),
        t('paradigms.relocate.do')
      )
      if (!ok) return
    }
    const fromLabel = allSlots.find((s) => s.key === relocateFrom)?.label ?? ''
    active.generators[to] = g
    delete active.generators[from]
    relocateFrom = null
    touch()
    ui.toast(t('paradigms.relocate.done', { from: fromLabel, to: target.label }))
    void openSlot(target.key)
  }

  function isInherited(key: string): boolean {
    if (!active) return false
    const own = active.generators[key]
    return (
      (!own || own.kind === 'none') &&
      !!active.inheritsFrom &&
      resolveGenerator(active, key, project.paradigms).kind !== 'none'
    )
  }
  function bindPos(posId: Id, on: boolean): void {
    const pos = project.posList.find((p) => p.id === posId)
    if (!pos || !active) return
    bindPosParadigm(pos, active.id, on)
    touch()
  }
  function deriveOne(): void {
    if (!active || !testLexeme) return
    const ctx = ctxFor(testLexeme.languageId)
    if (!ctx) return
    const n = deriveForms(
      ctx,
      testLexeme,
      active,
      undefined,
      lexemeVariantFor(testLexeme, project, active.id)
    )
    touch()
    derivedFlash++
    ui.toast(t('paradigms.derivedCount', { n, words: 1 }))
  }
  async function deriveAllBound(): Promise<void> {
    if (!active) return
    const para = active
    let n = 0
    await ui.runProgress(t('paradigms.deriveProgress'), boundLexemes, (l) => {
      const ctx = ctxFor(l.languageId)
      if (ctx) n += deriveForms(ctx, l, para, undefined, lexemeVariantFor(l, project, para.id))
    })
    touch()
    ui.toast(t('paradigms.derivedCount', { n, words: boundLexemes.length }))
  }
  async function runReport(): Promise<void> {
    if (!active) return
    const para = active
    // 按语言分组检查，再按槽位合并；一个槽位一批，中间让出线程画进度
    const byLang = new Map<Id, typeof boundLexemes>()
    for (const l of boundLexemes) byLang.set(l.languageId, [...(byLang.get(l.languageId) ?? []), l])
    const merged = new Map<string, SlotReport>()
    const jobs: { ctx: ReturnType<typeof makeContext>; ls: typeof boundLexemes; slot: SlotDef }[] =
      []
    // 作用于所有词的构形不往词条里写形式，没有可比对的；只跑项目一致性
    for (const [lid, ls] of para.appliesToAll ? [] : byLang) {
      const ctx = ctxFor(lid)
      if (!ctx) continue
      for (const slot of allSlots) jobs.push({ ctx, ls, slot })
    }
    await ui.runProgress(
      t('paradigms.reportProgress'),
      jobs,
      (j) => {
        const r = reconcileSlot(j.ctx, j.ls, para, j.slot, editVariantId)
        const m = merged.get(r.slot.key)
        if (!m) merged.set(r.slot.key, r)
        else {
          m.same += r.same
          m.diff += r.diff
          m.missing += r.missing
          m.examples.push(...r.examples.slice(0, Math.max(0, 30 - m.examples.length)))
        }
      },
      1
    )
    report = [...merged.values()]
    issues = groupIssues(checkConsistency(project, projectState.currentLanguageId))
    view = 'report'
  }
  function pct(r: SlotReport): string {
    const total = r.same + r.diff
    return total ? `${Math.round((r.same / total) * 100)}%` : '—'
  }
  const posName = (id: Id | null): string => {
    const x = project.posList.find((p) => p.id === id)
    return x ? x.abbr || pickText(x.name, glossLangs) : ''
  }
</script>

<div class="page">
  <div class="page-head row tabbed">
    <h1>{t('paradigms.title')}</h1>
    <GuideLink section="paradigms" />
    <TabStrip
      kind="paradigms"
      items={project.paradigms.map((p) => ({
        id: p.id,
        label: pickText(p.name, glossLangs) || t('paradigms.untitled')
      }))}
      activeId={active?.id ?? null}
      onselect={(id) => {
        activeId = id
        view = 'slots'
      }}
      onrename={(id) => {
        activeId = id
        view = 'slots'
        ui.inspectorOpen = true
        ui.syntaxOpen = false
        focusField('#p-name-field input')
      }}
      onmove={(from, to) => {
        if (!moveItem(project.paradigms, from, to)) return false
        touch()
        return true
      }}
    />
    {#if view === 'report'}
      <button class="btn" onclick={() => (view = 'slots')}
        ><ArrowLeft size={16} />{t('paradigms.backToSlots')}</button
      >
    {:else}
      <button class="btn" disabled={!active} title={t('paradigms.reportHint')} onclick={runReport}
        ><ClipboardCheck size={16} />{t('paradigms.report')}</button
      >
    {/if}
    <button class="btn primary" onclick={addParadigm}
      ><Plus size={16} />{t('paradigms.newParadigm')}</button
    >
  </div>

  <Hint id="paradigms" text={t('paradigms.hint')} />
  {#if !active}
    <p class="muted">{t('paradigms.empty')}</p>
  {:else if view === 'report' && report}
    <div class="scroll">
      <div class="row">
        <button class="btn sm" onclick={() => (view = 'slots')}
          ><ArrowLeft size={14} />{t('paradigms.backToSlots')}</button
        ><span class="small muted">{t('paradigms.reportTitle', { n: boundLexemes.length })}</span>
      </div>
      <table class="tbl">
        <thead
          ><tr
            ><th>{t('paradigms.slot')}</th><th>{t('paradigms.same')}</th><th
              >{t('paradigms.diff')}</th
            ><th>{t('paradigms.missing')}</th><th>%</th></tr
          ></thead
        >
        <tbody>
          {#each report as r (r.slot.key)}
            <tr>
              <td>{r.slot.label} <span class="mono muted small">{r.slot.abbr}</span></td>
              {#if r.skipped}<td colspan="4" class="muted small">{t('paradigms.kinds.none')}</td
                >{:else}
                <td class="ok">{r.same}</td><td class="bad">{r.diff}</td><td class="muted"
                  >{r.missing}</td
                ><td><b>{pct(r)}</b></td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if issues}
        <h3 class="issues-head">
          {t('consistency.title')}
          <span class="badge" class:accent={issueTotal === 0}
            >{issueTotal ? t('consistency.count', { n: issueTotal }) : t('consistency.clean')}</span
          >
          <HelpDot tip={t('consistency.hint')} />
        </h3>
        {#each issues as g (g.kind)}
          {@const open = openKinds.has(g.kind)}
          {@const shown = open ? g.issues : g.issues.slice(0, 8)}
          <div class="issue-group card">
            <button class="issue-title row" onclick={() => toggleKind(g.kind)}>
              <span class="sev {g.severity}"></span>
              <span class="grow">{t(`consistency.kinds.${g.kind.replace('.', '_')}`)}</span>
              <span class="badge">{g.issues.length}</span>
            </button>
            <div class="issue-list">
              {#each shown as i, idx (g.kind + idx)}
                <button
                  class="issue"
                  class:clickable={!!i.targetId && i.target !== 'taxonomy' && i.target !== 'abbr'}
                  onclick={() => gotoIssue(i)}
                >
                  <span class="data">{i.label}</span>
                  {#if i.detail}<span class="small muted">{i.detail}</span>{/if}
                </button>
              {/each}
              {#if g.issues.length > 8}
                <button class="btn ghost sm self" onclick={() => toggleKind(g.kind)}
                  >{open
                    ? t('consistency.less')
                    : t('consistency.more', { n: g.issues.length - 8 })}</button
                >
              {/if}
            </div>
          </div>
        {/each}
      {/if}
      {#each report.filter((r) => r.examples.length) as r (r.slot.key + 'x')}
        <h3>{t('paradigms.examples')} · {r.slot.label}</h3>
        <table class="tbl small">
          <thead
            ><tr
              ><th>{t('lexicon.lemma')}</th><th>{t('paradigms.stored')}</th><th
                >{t('paradigms.generated')}</th
              ></tr
            ></thead
          >
          <tbody
            >{#each r.examples as e (e.lemma)}<tr
                ><td class="data">{e.lemma}</td><td class="data">{e.stored}</td><td class="data bad"
                  >{e.generated}</td
                ></tr
              >{/each}</tbody
          >
        </table>
      {/each}
    </div>
  {:else}
    <div class="scroll">
      <section class="block">
        <div class="row">
          <h3 class="grow">
            {t('paradigms.dimensions')}
            <HelpDot tip={t('paradigms.dimensionsHint')} />
          </h3>
          <button
            class="btn ghost sm"
            class:active={locked}
            title={t(locked ? 'paradigms.unlockHint' : 'paradigms.lockHint')}
            onclick={toggleLock}
            >{#if locked}<Lock size={13} />{:else}<LockOpen size={13} />{/if}{t(
              locked ? 'paradigms.locked' : 'paradigms.unlocked'
            )}</button
          >
        </div>
        <p class="small muted" class:warn-text={slots.length > SLOT_WARN}>
          {locked
            ? t('paradigms.lockedExplain', { n: slots.length, total: allSlots.length })
            : t('paradigms.slotsExplain', { n: slots.length, dims: dimSizes })}
        </p>
        <div class="dims">
          {#each active.dimensionIds as id, i (id)}
            {@const c = project.categories.find((x) => x.id === id)}
            <span
              class="chip on"
              {...sortable(`dims-${active.id}`, i, (from, to) => {
                if (!active) return
                const order = [...active.dimensionIds]
                if (moveItem(order, from, to)) reorderDimensions(order)
              })}
            >
              <b>{i + 1}</b>
              {c ? pickText(c.name, glossLangs) : '?'}
              <button class="x" onclick={() => moveDimension(i, -1)}><ChevronUp size={11} /></button
              >
              <button class="x" onclick={() => moveDimension(i, 1)}
                ><ChevronDown size={11} /></button
              >
              {#if !locked}<button class="x" onclick={() => toggleDimension(id)}
                  ><X size={11} /></button
                >{/if}
            </span>
          {/each}
          {#each project.categories.filter((c) => !active!.dimensionIds.includes(c.id)) as c (c.id)}
            <button
              class="chip"
              class:filtering={locked && dimFilter.includes(c.id)}
              title={locked ? t('paradigms.filterHint') : ''}
              onclick={() => (locked ? toggleFilter(c.id) : toggleDimension(c.id))}
              ><Plus size={11} />{pickText(c.name, glossLangs)}
              <span class="muted small">({c.values.length})</span></button
            >
          {/each}
          {#if locked && dimFilter.length}
            <button class="btn ghost sm" onclick={() => (dimFilter = [])}
              >{t('paradigms.clearFilter')}</button
            >
            <button class="btn ghost sm" onclick={() => setShownEnabled(true)}
              >{t('paradigms.batchEnable')}</button
            >
            <button class="btn ghost sm" onclick={() => setShownEnabled(false)}
              >{t('paradigms.batchDisable')}</button
            >
          {/if}
          {#if project.categories.length === 0}<span class="small muted"
              >{t('lexicon.noFeatures')}</span
            >{/if}
        </div>
      </section>

      <section class="block">
        <div class="row slots-head">
          <h3 class="grow">
            {t('paradigms.slots')} <span class="badge">{slots.length}</span>
            <HelpDot tip={t('paradigms.affixHint')} />
          </h3>
          {#if layout === 'visual' && slots.length > 1}
            <button
              class="btn ghost sm fold-all"
              onclick={() =>
                setSectionsCollapsed(
                  slots.map((s) => foldId(s.key)),
                  !allSlotsFolded
                )}
              >{#if allSlotsFolded}<ChevronsUpDown size={14} />{t(
                  'paradigms.expandAll'
                )}{:else}<ChevronsDownUp size={14} />{t('paradigms.collapseAll')}{/if}</button
            >
          {/if}
          <div class="seg">
            <button class:active={layout === 'visual'} onclick={() => (layout = 'visual')}
              ><List size={14} />{t('paradigms.layoutVisual')}</button
            >
            <button class:active={layout === 'table'} onclick={() => (layout = 'table')}
              ><Table size={14} />{t('paradigms.layoutTable')}</button
            >
            <button class:active={layout === 'tree'} onclick={() => (layout = 'tree')}
              ><ListTree size={14} />{t('paradigms.layoutTree')}</button
            >
          </div>
        </div>
        <div class="row wrap vbar">
          <span class="small muted">{t('paradigms.variants')}</span>
          <div class="seg">
            <span class="vwrap">
              <button class:active={editVariantId === null} onclick={() => (editVariantId = null)}
                >{baseName}</button
              >
              <button
                class="pen"
                title={t('common.rename')}
                onclick={() => {
                  editVariantId = null
                  void renameVariant()
                }}><Pencil size={11} /></button
              >
            </span>
            {#each variants as v (v.id)}
              <span class="vwrap">
                <button class:active={editVariantId === v.id} onclick={() => (editVariantId = v.id)}
                  >{v.name}</button
                >
                <button
                  class="pen"
                  title={t('common.rename')}
                  onclick={() => {
                    editVariantId = v.id
                    void renameVariant()
                  }}><Pencil size={11} /></button
                >
              </span>
            {/each}
          </div>
          <button class="btn ghost sm" onclick={addVariant}
            ><Plus size={13} />{t('paradigms.addVariant')}</button
          >
          {#if editVariantId}
            <button class="btn ghost sm danger" onclick={removeVariant}>{t('common.delete')}</button
            >
          {/if}
          <HelpDot tip={t('paradigms.variantHint')} />
          <span class="grow"></span>
          <button
            class="btn ghost sm"
            title={t('paradigms.clip.copyVariantHint')}
            onclick={copyVariant}><Copy size={13} />{t('paradigms.clip.copyVariant')}</button
          >
          <button
            class="btn ghost sm"
            title={t('paradigms.clip.pasteVariantHint')}
            onclick={pasteVariant}
            ><ClipboardPaste size={13} />{t('paradigms.clip.pasteVariant')}</button
          >
        </div>
        {#snippet cell(s: SlotDef | undefined)}
          {#if s}
            {@const off = active.disabledSlots.includes(s.key)}
            {@const f = cellForms.get(s.key)}
            {@const sum = slotSummary(s)}
            <button
              class="pcell"
              class:off
              class:dim={!shownKeys.has(s.key)}
              class:bad={f?.status === 'diff'}
              title={[s.label, sum, ...(f?.trace ?? [])].filter(Boolean).join('\n')}
              onclick={() => openSlot(s.key)}
            >
              {#if off}
                <span class="small muted">{t('paradigms.slotOff')}</span>
              {:else}
                {#if testLexeme}<span class="data form">{f?.generated || '—'}</span>{/if}
                <span class="sum">{sum || t('paradigms.kinds.none')}</span>
              {/if}
            </button>
          {/if}
        {/snippet}
        {#snippet branch(nodes: TreeNode[])}
          <ul class="ptree">
            {#each nodes as n (n.key)}
              <li>
                {#if n.slot}
                  {@const s = n.slot}
                  {@const off = active.disabledSlots.includes(s.key)}
                  {@const f = cellForms.get(s.key)}
                  {@const sum = slotSummary(s)}
                  <button
                    class="tnode leaf"
                    class:off
                    class:dim={!shownKeys.has(s.key)}
                    class:bad={f?.status === 'diff'}
                    title={[s.label, ...(f?.trace ?? [])].join('\n')}
                    onclick={() => openSlot(s.key)}
                  >
                    <span>{n.label}</span>
                    <span class="mono small muted">{s.abbr}</span>
                    {#if off}
                      <span class="small muted">{t('paradigms.slotOff')}</span>
                    {:else}
                      {#if testLexeme}<span class="data form">{f?.generated || '—'}</span>{/if}
                      <span class="sum">{sum || t('paradigms.kinds.none')}</span>
                    {/if}
                  </button>
                {:else}
                  <button class="tnode" onclick={() => toggleTree(n.key)}>
                    {#if treeOpen(n.key)}<ChevronDown size={12} />{:else}<ChevronRight
                        size={12}
                      />{/if}
                    <span>{n.label}</span>
                    {#if n.abbr && n.abbr !== n.label}<span class="mono small muted">{n.abbr}</span
                      >{/if}
                  </button>
                  {#if treeOpen(n.key)}{@render branch(n.children)}{/if}
                {/if}
              </li>
            {/each}
          </ul>
        {/snippet}
        {#if slots.length === 0}
          <p class="small muted">{t('paradigms.noSlots')}</p>
        {:else if layout !== 'visual'}
          <p class="small muted layout-note">
            {testLexeme
              ? t('paradigms.layoutWord', { word: testLexeme.lemma })
              : t('paradigms.layoutNoWord')}
          </p>
          {#if layout === 'table'}
            <div class="ptables">
              {#each tableGroups as grp (grp.key)}
                <div>
                  {#if grp.caption}<div class="ptable-cap">{grp.caption}</div>{/if}
                  <div class="table-wrap">
                    <table class="ptable">
                      <thead>
                        <tr>
                          <th class="corner"
                            >{catName(dims[0])}{#if dims[1]}
                              ＼ {catName(dims[1])}{/if}</th
                          >
                          {#if dims[1]}
                            {#each dims[1].values as c (c.id)}<th
                                >{valueName(c)}
                                {#if c.abbr && c.abbr !== valueName(c)}<span
                                    class="mono small muted">{c.abbr}</span
                                  >{/if}</th
                              >{/each}
                          {:else}
                            <th></th>
                          {/if}
                        </tr>
                      </thead>
                      <tbody>
                        {#each dims[0].values as r (r.id)}
                          <tr>
                            <th
                              >{valueName(r)}
                              {#if r.abbr && r.abbr !== valueName(r)}<span class="mono small muted"
                                  >{r.abbr}</span
                                >{/if}</th
                            >
                            {#if dims[1]}
                              {#each dims[1].values as c (c.id)}<td
                                  >{@render cell(slotAt(r, c, grp.extra))}</td
                                >{/each}
                            {:else}
                              <td>{@render cell(slotAt(r, null, grp.extra))}</td>
                            {/if}
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="ptree-wrap">
              <div class="ptree-root">
                {pickText(active.name, glossLangs) || t('paradigms.untitled')}
                <span class="small muted">{dims.map(catName).join(' → ')}</span>
              </div>
              {@render branch(tree)}
            </div>
          {/if}
        {:else}
          <table class="tbl slots">
            <thead
              ><tr
                ><th></th><th>{t('paradigms.slot')}</th><th>{t('paradigms.gloss')}</th><th
                  >{t('paradigms.generator')}</th
                ><th colspan="2">{t('paradigms.pipeline')}</th></tr
              ></thead
            >
            <tbody>
              {#each slots.slice(0, lzSlots.shown) as s (s.key)}
                {@const disabled = active.disabledSlots.includes(s.key)}
                {@const g = active.generators[gkey(s.key)] ?? { kind: 'none' }}
                {@const folded = sectionCollapsed(foldId(s.key))}
                <tr
                  class:off={disabled}
                  class:folded
                  class:fixed-slot={locked && fixedKeys.has(s.key)}
                  data-slot={s.key}
                >
                  <td class="lead"
                    ><span class="lead-in"
                      ><button
                        class="fold-btn"
                        title={folded ? t('common.expand') : t('common.collapse')}
                        aria-expanded={!folded}
                        onclick={() => toggleSection(foldId(s.key))}
                        >{#if folded}<ChevronRight size={15} />{:else}<ChevronDown
                            size={15}
                          />{/if}</button
                      ><input
                        type="checkbox"
                        checked={!disabled}
                        title={t('paradigms.enabled')}
                        onchange={() => toggleSlot(s.key)}
                      /></span
                    ></td
                  >
                  <td class="label" title={t('paradigms.relocate.hint')}>
                    <span
                      class="label-in"
                      ondblclick={() => openRelocate(s.key)}
                      role="presentation">{s.label}</span
                    ><button
                      class="btn ghost icon sm relocate-btn"
                      title={t('paradigms.relocate.button')}
                      onclick={() => openRelocate(s.key)}><MoveRight size={13} /></button
                    >
                  </td>
                  <td class="mono small muted">{s.abbr}</td>
                  {#if folded}
                    <td colspan="3" class="fold-cell">
                      <button class="fold-sum" onclick={() => toggleSection(foldId(s.key))}
                        >{foldedSummary(s)}</button
                      >{#if isInherited(gkey(s.key))}<span class="badge"
                          >{t('paradigms.inherited')}</span
                        >{/if}
                    </td>
                  {:else}
                    <td>
                      <select
                        class="select kind"
                        value={kindOf(g)}
                        title={t('paradigms.pron.hint')}
                        onchange={(e) =>
                          setKind(
                            gkey(s.key),
                            (e.currentTarget as HTMLSelectElement).value as KindOption
                          )}
                      >
                        {#each KIND_OPTIONS as k (k)}<option value={k}
                            >{t(`paradigms.kinds.${k}`)}</option
                          >{/each}
                      </select>
                      {#if isInherited(gkey(s.key))}<span class="badge"
                          >{t('paradigms.inherited')}</span
                        >{/if}
                      <div class="row slot-clip">
                        <button
                          class="btn ghost icon sm"
                          title={t('paradigms.clip.copySlot')}
                          onclick={() => copySlot(s.key)}><Copy size={13} /></button
                        >
                        <button
                          class="btn ghost icon sm"
                          title={t('paradigms.clip.pasteSlot')}
                          onclick={() => pasteSlot(s.key)}><ClipboardPaste size={13} /></button
                        >
                      </div>
                    </td>
                    <td colspan="2">
                      {#if g.kind === 'pipeline'}
                        {@const gp = g}
                        {#snippet startBox()}
                          <div class="step stem start" title={t('paradigms.base.hint')}>
                            <select
                              class="select sm base-sel"
                              class:based={!!gp.base?.slotKey}
                              value={baseValue(gp)}
                              onchange={(e) =>
                                setBase(gkey(s.key), (e.currentTarget as HTMLSelectElement).value)}
                            >
                              <option value="">{t('paradigms.stem')}</option>
                              <optgroup label={t('paradigms.base.thisParadigm')}>
                                {#each ownBaseChoices(s.key) as b (b.key)}<option
                                    value={`:${b.key}`}
                                    >{t('paradigms.base.from', { name: b.label })}</option
                                  >{/each}
                              </optgroup>
                              {#each nestChoices as np (np.id)}
                                <optgroup label={np.name}>
                                  {#each np.slots as b (b.key)}<option value={`${np.id}:${b.key}`}
                                      >{t('paradigms.base.from', { name: b.label })}</option
                                    >{/each}
                                </optgroup>
                              {/each}
                            </select>
                            {#if !gp.base?.slotKey}
                              <input
                                class="input data"
                                list="dl-stems"
                                placeholder="lemma"
                                bind:value={gp.stem}
                                oninput={touch}
                              />
                            {/if}
                          </div>
                        {/snippet}
                        <SlotPipeline
                          bind:steps={gp.steps}
                          ruleSets={project.ruleSets}
                          paradigms={nestChoices}
                          onchange={touch}
                          start={startBox}
                        />
                        {#if gp.pron?.on}
                          {@const pr = gp.pron}
                          {#snippet pronStart()}
                            <div class="step stem start pron" title={t('paradigms.pron.startHint')}>
                              <span class="tag">{t('paradigms.pron.label')}</span>
                              <select
                                class="select sm"
                                value={pr.from}
                                onchange={(e) => {
                                  pr.from = (e.currentTarget as HTMLSelectElement).value as
                                    'form' | 'lemma'
                                  touch()
                                }}
                              >
                                <option value="form">{t('paradigms.pron.fromForm')}</option>
                                <option value="lemma">{t('paradigms.pron.fromLemma')}</option>
                              </select>
                            </div>
                          {/snippet}
                          <div class="pron-pipe">
                            <SlotPipeline
                              bind:steps={pr.steps}
                              ruleSets={project.ruleSets}
                              onchange={touch}
                              start={pronStart}
                              nest={false}
                            />
                          </div>
                        {/if}
                      {:else if g.kind === 'table'}
                        <span class="small muted">{t('paradigms.kinds.table')}</span>
                      {/if}
                    </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
          {#if slots.length > lzSlots.shown}<div use:lazyMore={lzSlots}></div>{/if}
          <datalist id="dl-stems"
            ><option value="lemma"></option>{#each stemNames as s (s)}<option value={s}
              ></option>{/each}</datalist
          >
        {/if}
      </section>
    </div>
  {/if}
</div>

{#if relocateFrom && active}
  {@const fromSlot = allSlots.find((x) => x.key === relocateFrom)}
  <div class="relocate-backdrop" role="presentation" onclick={() => (relocateFrom = null)}></div>
  <div class="relocate card" role="dialog" aria-modal="true">
    <strong>{t('paradigms.relocate.title', { name: fromSlot?.label ?? '' })}</strong>
    <p class="small muted">{t('paradigms.relocate.body')}</p>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="input"
      placeholder={t('paradigms.relocate.search')}
      bind:value={relocateQuery}
      autofocus
      onkeydown={(e) => {
        if (e.key === 'Escape') relocateFrom = null
        else if (e.key === 'Enter' && relocateList.length === 1) void relocateTo(relocateList[0])
      }}
    />
    <div class="relocate-list">
      {#each relocateList as r (r.key)}
        {@const own = active.generators[gkey(r.key)]}
        <button onclick={() => relocateTo(r)}
          ><span>{r.label}</span><span class="mono small muted">{r.abbr}</span
          >{#if own && own.kind !== 'none'}<span class="badge">{t('paradigms.relocate.taken')}</span
            >{/if}</button
        >
      {/each}
    </div>
    <div class="row">
      <span class="grow"></span>
      <button class="btn sm" onclick={() => (relocateFrom = null)}>{t('common.cancel')}</button>
    </div>
  </div>
{/if}

{#if active}
  {@const p = active}
  <Portal>
    <div class="field">
      <span class="small muted">{t('common.name')}</span>
      <div id="p-name-field">
        <LocalizedInput bind:value={p.name} languages={glossLangs} onchange={touch} />
      </div>
    </div>
    {#if !p.appliesToAll}
      <div class="field">
        <span class="small muted">{t('paradigms.bindPos')}</span>
        {#each project.posList as pos (pos.id)}
          {@const ids = ownParadigmIds(pos)}
          {@const others = ids.filter((x) => x !== p.id)}
          <div class="row bind">
            <label class="row check"
              ><input
                type="checkbox"
                checked={ids.includes(p.id)}
                onchange={(e) => bindPos(pos.id, (e.currentTarget as HTMLInputElement).checked)}
              />{pickText(pos.name, glossLangs) || pos.abbr}</label
            >
            <!-- 一个词类绑了几个构形（变位法一、二……）：没挑构形的词条用默认的那个 -->
            {#if ids.includes(p.id) && ids.length > 1}
              {#if pos.paradigmId === p.id}
                <span class="badge">{t('paradigms.defaultForPos')}</span>
              {:else}
                <button
                  class="btn ghost sm"
                  onclick={() => {
                    setDefaultPosParadigm(pos, p.id)
                    touch()
                  }}>{t('paradigms.makeDefault')}</button
                >
              {/if}
            {/if}
            {#if others.length}
              <span class="small muted"
                >{t(ids.includes(p.id) ? 'paradigms.alsoBound' : 'paradigms.boundTo', {
                  list: others.map(paradigmName).join(t('taxonomy.listSep'))
                })}</span
              >
            {/if}
          </div>
        {/each}
        {#if project.posList.length === 0}<span class="small muted">{t('taxonomy.pos')}: 0</span
          >{/if}
      </div>
    {/if}
    <label class="row check">
      <input
        type="checkbox"
        checked={!!p.appliesToAll}
        onchange={(e) => {
          const on = (e.currentTarget as HTMLInputElement).checked
          p.appliesToAll = on || undefined
          // 作用于所有词的构形不绑定词类，也不给单个词条指名
          if (on) {
            unbindParadigm(project, p.id)
            for (const l of project.lexemes) if (l.paradigmId === p.id) l.paradigmId = null
          }
          touch()
        }}
      />
      {t('paradigms.appliesToAll')}<HelpDot tip={t('paradigms.appliesToAllHint')} />
    </label>
    {#if p.appliesToAll}
      <div class="field">
        <label for="pd-scope">{t('paradigms.appliesToLanguage')}</label>
        <select
          id="pd-scope"
          class="select"
          value={p.appliesToLanguageId ?? ''}
          onchange={(e) => {
            p.appliesToLanguageId = (e.currentTarget as HTMLSelectElement).value || null
            touch()
          }}
        >
          <option value="">{t('topbar.allLanguages')}</option>
          {#each project.languages as lg (lg.id)}<option value={lg.id}>{lg.name}</option>{/each}
        </select>
      </div>
    {/if}
    <div class="field">
      <label for="pd-inh">{t('paradigms.inheritsFrom')}</label>
      <select
        id="pd-inh"
        class="select"
        value={p.inheritsFrom ?? ''}
        onchange={(e) => {
          p.inheritsFrom = (e.currentTarget as HTMLSelectElement).value || null
          touch()
        }}
      >
        <option value="">{t('paradigms.noInherit')}</option>
        {#each project.paradigms.filter((x) => x.id !== p.id) as x (x.id)}<option value={x.id}
            >{pickText(x.name, glossLangs)}</option
          >{/each}
      </select>
    </div>

    <div class="field">
      <div class="row">
        <span class="small muted">{t('paradigms.testBench')}</span><HelpDot key="testBench" /><span
          class="grow"
        ></span>
        <div class="seg">
          <button
            class:active={benchMode === 'compare'}
            title={t('paradigms.benchCompareHint')}
            onclick={() => (benchMode = 'compare')}>{t('paradigms.benchCompare')}</button
          >
          <button
            class:active={benchMode === 'free'}
            title={t('paradigms.benchFreeHint')}
            onclick={() => (benchMode = 'free')}>{t('paradigms.benchFree')}</button
          >
        </div>
        {#if benchMode === 'compare'}<span class="small muted">{boundLexemes.length}</span>{/if}
      </div>
      {#if benchMode === 'free'}
        <div class="clear-wrap">
          <input
            class="input data"
            placeholder={t('paradigms.freePlaceholder')}
            bind:value={freeInput}
          />
          {#if freeInput}<button
              class="clear-x"
              title={t('common.clear')}
              onclick={() => (freeInput = '')}><X size={13} /></button
            >{/if}
        </div>
        {#if freeRows.length}
          {@const lid = language?.id ?? ''}
          {@const base =
            project.lexemes.find((x) => x.languageId === lid && x.lemma === freeInput.trim()) ??
            null}
          <table class="tbl small test">
            <tbody>
              {#each freeRows as r (r.slot.key)}
                <tr title={r.trace.join('\n')}>
                  <td class="muted">{r.slot.label}</td>
                  <td class="data">{r.generated || '—'}</td>
                  <td class="st">
                    {#if r.generated}
                      <button
                        class="btn ghost icon xs"
                        title={t('paradigms.continueNest')}
                        onclick={() => (freeInput = r.generated)}
                        ><CornerDownRight size={12} /></button
                      >
                      <button
                        class="btn ghost icon xs"
                        title={t('lexicon.generateEntry')}
                        onclick={() => generateEntry(r.generated, r.slot, base, lid)}
                        ><FilePlus2 size={12} /></button
                      >
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {:else}
        <div class="clear-wrap">
          <input
            class="input data"
            placeholder={t('paradigms.pickLexeme')}
            bind:value={testLemma}
            oninput={() => (testLexemeId = null)}
            onfocus={() => (testFocused = true)}
            onblur={() => setTimeout(() => (testFocused = false), 180)}
          />
          {#if testLemma}<button
              class="clear-x"
              title={t('common.clear')}
              onclick={() => {
                testLemma = ''
                testLexemeId = null
              }}><X size={13} /></button
            >{/if}
        </div>
        {#if testMatches.length}
          <div class="matches">
            {#each testMatches as l (l.id)}
              <button
                class="match"
                class:on={testLexeme?.id === l.id}
                onclick={() => {
                  testLexemeId = l.id
                  testLemma = l.lemma
                }}
              >
                <span class="data">{l.lemma}</span>
                <span class="small muted">{posName(l.posId)}</span>
                <span class="small muted grow gloss"
                  >{pickText(l.senses[0]?.definition, glossLangs)}</span
                >
              </button>
            {/each}
          </div>
        {/if}
        {#if testLexeme}
          <table class="tbl small test" use:flashOn={derivedFlash}>
            <tbody>
              {#each testRows as r (r.slot.key)}
                <tr title={r.trace.join('\n')}>
                  <td class="muted">{r.slot.label}</td>
                  <td class="data">{r.generated || '—'}</td>
                  <td class="st">
                    {#if r.status === 'same'}<span class="ok"><Check size={12} /></span>
                    {:else if r.status === 'diff'}<span class="bad" title={r.stored}
                        ><X size={12} /> <span class="data small">{r.stored}</span></span
                      >
                    {:else if r.status === 'missing'}<span class="muted"><Minus size={12} /></span
                      >{/if}
                    {#if r.generated && testLexeme}
                      {@const tl = testLexeme}
                      <button
                        class="btn ghost icon xs"
                        title={t('lexicon.generateEntry')}
                        onclick={() => generateEntry(r.generated, r.slot, tl, tl.languageId)}
                        ><FilePlus2 size={12} /></button
                      >
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if !p.appliesToAll}
            <div class="row">
              <button class="btn sm" onclick={deriveOne}
                ><Play size={14} />{t('paradigms.deriveOne')}</button
              >
            </div>
          {/if}
        {/if}
      {/if}
    </div>
    {#if !p.appliesToAll}
      <div class="row wrap">
        <button class="btn sm" disabled={!boundLexemes.length} onclick={deriveAllBound}
          ><Play size={14} />{t('paradigms.deriveAll', { n: boundLexemes.length })}</button
        >
      </div>
    {/if}
    <button class="btn sm danger" onclick={() => removeParadigm(p)}
      ><Trash2 size={14} />{t('common.delete')}</button
    >
  </Portal>
{/if}

<datalist id="dl-infix-at">
  <option value="V1">{t('paradigms.infixPresets.v1')}</option>
  <option value="C1">{t('paradigms.infixPresets.c1')}</option>
  <option value="<C-1">{t('paradigms.infixPresets.beforeLastC')}</option>
  <option value="C-1">{t('paradigms.infixPresets.afterLastC')}</option>
  <option value="<V-1">{t('paradigms.infixPresets.beforeLastV')}</option>
  <option value="1">{t('paradigms.infixPresets.afterFirst')}</option>
  <option value="-1">{t('paradigms.infixPresets.beforeLast')}</option>
</datalist>

<style>
  .matches {
    display: flex;
    flex-direction: column;
    max-height: 190px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .match {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px 8px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .match:last-child {
    border-bottom: none;
  }
  .match:hover {
    background: var(--bg-hover);
  }
  .match.on {
    background: var(--accent-soft);
  }
  .match .gloss {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vbar {
    gap: 8px;
    margin-bottom: 6px;
  }
  .slots-head {
    gap: 8px;
    margin-bottom: 6px;
  }
  .layout-note {
    margin: 2px 0 10px;
  }
  /* 表格：第一个维度作行、第二个维度作列 */
  .ptables {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .ptable-cap {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
  }
  .ptable {
    border-collapse: collapse;
  }
  .ptable th,
  .ptable td {
    border: 1px solid var(--border);
    padding: 0;
    vertical-align: top;
  }
  .ptable th {
    padding: 4px 10px;
    background: var(--bg-sunken);
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
  }
  .ptable .corner {
    color: var(--text-3);
    font-size: 12px;
  }
  .pcell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    min-width: 80px;
    padding: 5px 10px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pcell:hover,
  .tnode:hover {
    background: var(--bg-hover);
  }
  .pcell .form,
  .tnode .form {
    font-size: 15px;
  }
  .pcell .sum,
  .tnode .sum {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-3);
  }
  .pcell.off,
  .tnode.off {
    opacity: 0.5;
  }
  .pcell.dim,
  .tnode.dim {
    opacity: 0.35;
  }
  .pcell.bad .form,
  .tnode.bad .form {
    color: var(--danger);
  }
  /* 树形图：竖线连着各个分叉 */
  .ptree-root {
    font-weight: 600;
    margin-bottom: 2px;
  }
  .ptree {
    list-style: none;
    margin: 0;
    padding: 0 0 0 12px;
  }
  .ptree li {
    position: relative;
    padding-left: 18px;
  }
  .ptree li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-left: 1px solid var(--border-strong);
  }
  .ptree li:last-child::before {
    bottom: auto;
    height: 15px;
  }
  .ptree li::after {
    content: '';
    position: absolute;
    left: 0;
    top: 15px;
    width: 14px;
    border-top: 1px solid var(--border-strong);
  }
  .tnode {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
    padding: 2px 10px 2px 6px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .tnode.leaf {
    padding-left: 10px;
    border-radius: var(--radius-sm);
  }
  .page {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .page-head {
    gap: 12px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .warn-text {
    color: var(--warn);
  }
  .dims {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
    cursor: pointer;
    font-size: 13px;
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    cursor: default;
  }
  .chip b {
    font-size: 11px;
    color: var(--accent-text);
  }
  .chip .x {
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-3);
    display: grid;
    place-items: center;
  }
  .tbl {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  .tbl th {
    text-align: left;
    font-weight: 600;
    color: var(--text-2);
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .tbl td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .tbl.small td,
  .tbl.small th {
    padding: 2px 6px;
    font-size: 12px;
  }
  .slots tr.off {
    opacity: 0.45;
  }
  .label {
    white-space: nowrap;
    font-weight: 500;
  }
  .kind {
    width: 130px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .slots {
    width: auto;
    min-width: 100%;
  }
  .slots td {
    vertical-align: top;
    padding-top: 8px;
    padding-bottom: 8px;
    white-space: nowrap;
  }
  .slots td:first-child {
    padding-top: 22px;
  }
  .lead-in {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .fold-btn {
    display: inline-flex;
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-3);
    cursor: pointer;
  }
  .fold-btn:hover {
    color: var(--text);
  }
  /* 收起的一行：各格上下留得少，写法挤成一行，放不下的省略 */
  .slots tr.folded td {
    padding-top: 6px;
    padding-bottom: 6px;
    vertical-align: middle;
  }
  .fold-cell .badge {
    margin-left: 8px;
  }
  .fold-sum {
    max-width: min(60vw, 760px);
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-2);
    font: inherit;
    font-size: 12px;
    font-family: var(--font-mono);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
    cursor: pointer;
  }
  .fold-sum:hover {
    color: var(--text);
  }
  .slots .kind {
    margin-top: 13px;
  }
  /* 测试台输入框里有字时右边一个叉，一下清空 */
  .clear-wrap {
    position: relative;
  }
  .clear-wrap .input {
    width: 100%;
    padding-right: 28px;
  }
  .clear-x {
    position: absolute;
    right: 5px;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .clear-x:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .slot-clip {
    gap: 2px;
    margin-top: 4px;
  }
  /* 槽位名旁边的「挪到别的槽位」：鼠标放到这一行才出现，双击槽位名也行 */
  .relocate-btn {
    opacity: 0;
    vertical-align: middle;
  }
  /* 上锁后固定下来的槽位：底色深一点，维度怎么筛它都在 */
  .slots tr.fixed-slot > td {
    background: var(--bg-sunken);
  }
  .chip.filtering {
    border-color: var(--accent);
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .slots tr:hover .relocate-btn,
  .relocate-btn:focus-visible {
    opacity: 1;
  }
  .slots td.label {
    cursor: default;
    user-select: none;
  }
  /* 流水线的起点（在这里画的，SlotPipeline 里 .step 的样式够不着，照着写一份） */
  .start {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 4px 2px 6px;
    border: 1px solid var(--accent-soft);
    border-radius: 999px;
    background: var(--accent-soft);
  }
  .start .tag {
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .start .input,
  .start .select {
    padding: 1px 6px;
    font-size: 12px;
    height: 22px;
    width: 110px;
  }
  .start .base-sel {
    width: 72px;
  }
  .start .base-sel.based {
    width: 160px;
  }
  .pron-pipe {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border);
  }
  .relocate {
    position: fixed;
    z-index: 401;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    box-shadow: var(--shadow-lg);
  }
  .relocate-backdrop {
    position: fixed;
    inset: 0;
    z-index: 400;
    background: rgb(0 0 0 / 30%);
  }
  .relocate-list {
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .relocate-list button {
    display: flex;
    gap: 8px;
    align-items: baseline;
    text-align: left;
    border: 0;
    background: none;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .relocate-list button:hover {
    background: var(--bg-hover);
  }
  .slots tr:not(.folded) td.label,
  .slots tr:not(.folded) td.mono {
    padding-top: 22px;
  }
  .slots tbody tr:nth-child(even) {
    background: var(--bg-sunken);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .ok {
    color: var(--accent-text);
  }
  .issues-head {
    margin-top: 18px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .issue-group {
    padding: 6px 10px 8px;
    margin-top: 8px;
  }
  .issue-title {
    width: 100%;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    gap: 8px;
    padding: 2px 0;
  }
  .sev {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-3);
  }
  .sev.error {
    background: var(--danger);
  }
  .sev.warn {
    background: var(--warn);
  }
  .issue-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    margin-top: 6px;
  }
  .issue {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    cursor: default;
  }
  .issue.clickable {
    cursor: pointer;
  }
  .issue.clickable:hover {
    border-color: var(--accent);
  }
  .self {
    align-self: center;
  }
  .bad {
    color: var(--danger);
  }
  .check {
    gap: 8px;
    margin: 2px 0;
  }
  .test {
    margin: 6px 0;
  }
  .st {
    white-space: nowrap;
  }
  .wrap {
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  h3 {
    margin-top: 6px;
  }
  /* 变体按钮上的铅笔：鼠标放上去才出现，点了就地改名 */
  .vwrap {
    position: relative;
    display: inline-flex;
  }
  .vwrap:hover > button:first-child,
  .vwrap:focus-within > button:first-child {
    padding-right: 26px;
  }
  .vwrap .pen {
    position: absolute;
    right: 5px;
    top: 50%;
    transform: translateY(-50%);
    border: 0;
    background: none;
    padding: 2px;
    color: var(--text-3);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .vwrap:hover .pen,
  .vwrap .pen:focus-visible {
    opacity: 1;
  }
  .bind {
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
