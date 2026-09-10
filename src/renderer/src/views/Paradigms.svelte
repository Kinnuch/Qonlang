<script lang="ts">
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { makeCollator } from '$lib/core/collate'
  import { newId } from '$lib/core/factory'
  import type { Id, Paradigm, SlotGenerator } from '$lib/core/model'
  import {
    paradigmSlots,
    resolveGenerator,
    generateForm,
    deriveForms,
    reconcileSlot,
    makeContext,
    type SlotDef,
    type SlotReport,
    variantKey
  } from '$lib/engine/morph'
  import Portal from '$lib/ui/Portal.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import SlotPipeline from '$lib/ui/SlotPipeline.svelte'
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
    Minus
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import {
    checkConsistency,
    groupIssues,
    type Issue,
    type IssueGroup
  } from '$lib/engine/consistency'
  import HelpDot from '$lib/ui/HelpDot.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const language = $derived(
    projectState.currentLanguage ??
      project.languages.find((l) => l.id === project.settings.defaultLanguageId) ??
      project.languages[0] ??
      null
  )

  let activeId = $state<Id | null>(null)
  const active = $derived(
    project.paradigms.find((p) => p.id === activeId) ?? project.paradigms[0] ?? null
  )
  $effect(() => {
    const id = ui.takePending('paradigm')
    if (id) activeId = id
  })
  $effect(() => {
    if (active && activeId !== active.id) activeId = active.id
  })
  let view = $state<'slots' | 'report'>('slots')
  let report = $state<SlotReport[] | null>(null)
  /** 项目级问题清单（跟槽位比对一起跑） */
  let issues = $state<IssueGroup[] | null>(null)
  let openKinds = $state<Set<string>>(new Set())
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
  let testLemma = $state('')

  const allSlots = $derived(
    active ? paradigmSlots(active, project.categories, glossLangs, true) : []
  )
  /** 顶栏搜索：按槽位名或 gloss 缩写筛（推导与检查仍然跑全部槽位） */
  const slots = $derived.by(() => {
    const q = ui.search.trim().toLowerCase()
    if (!q) return allSlots
    return allSlots.filter(
      (s) => s.label.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q)
    )
  })
  const boundPos = $derived(active ? project.posList.filter((p) => p.paradigmId === active.id) : [])
  /** 绑定词类的全部词位；当前语言的排在前面 */
  const boundLexemes = $derived(
    project.lexemes
      .filter((l) => boundPos.some((p) => p.id === l.posId))
      .sort(
        (a, b) =>
          (language && a.languageId === language.id ? 0 : 1) -
          (language && b.languageId === language.id ? 0 : 1)
      )
  )
  const stemNames = $derived(
    [...new Set(project.lexemes.flatMap((l) => Object.keys(l.stems)))].sort()
  )
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
  let testLexemeId = $state<Id | null>(null)
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
  const testRows = $derived.by(() => {
    if (!active || !testLexeme) return []
    const ctx = ctxFor(testLexeme.languageId)
    if (!ctx) return []
    return slots
      .filter((s) => !active!.disabledSlots.includes(s.key))
      .map((s) => {
        const g = generateForm(ctx, testLexeme, active!, s, editVariantId)
        const stored = testLexeme.forms[s.label]
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
      })
  })

  $effect(() => {
    inspectorTitle = active
      ? pickText(active.name, glossLangs) || t('paradigms.untitled')
      : t('paradigms.title')
  })

  function touch(): void {
    projectState.touch()
  }
  /** 正在编辑哪个变体；null 表示通用那一套 */
  let editVariantId = $state<Id | null>(null)
  const variants = $derived(active?.variants ?? [])
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
    editVariantId = v.id
    touch()
  }
  async function renameVariant(): Promise<void> {
    const v = variants.find((x) => x.id === editVariantId)
    if (!v) return
    const name = (await ui.prompt(t('paradigms.variantName'), v.name))?.trim()
    if (!name) return
    v.name = name
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
    for (const pos of project.posList) if (pos.paradigmId === p.id) pos.paradigmId = null
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
  function toggleDimension(id: Id): void {
    if (!active) return
    const i = active.dimensionIds.indexOf(id)
    if (i >= 0) active.dimensionIds.splice(i, 1)
    else active.dimensionIds.push(id)
    touch()
  }
  function moveDimension(i: number, dir: -1 | 1): void {
    if (!active) return
    const j = i + dir
    if (j < 0 || j >= active.dimensionIds.length) return
    ;[active.dimensionIds[i], active.dimensionIds[j]] = [
      active.dimensionIds[j],
      active.dimensionIds[i]
    ]
    touch()
  }
  function toggleSlot(key: string): void {
    if (!active) return
    const i = active.disabledSlots.indexOf(key)
    if (i >= 0) active.disabledSlots.splice(i, 1)
    else active.disabledSlots.push(key)
    touch()
  }
  function setKind(key: string, kind: SlotGenerator['kind']): void {
    if (!active) return
    const cur = active.generators[key]
    const stem = cur && 'stem' in cur ? cur.stem : ''
    active.generators[key] =
      kind === 'pipeline'
        ? { kind, stem, steps: cur && cur.kind === 'pipeline' ? cur.steps : [] }
        : ({ kind } as SlotGenerator)
    touch()
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
    pos.paradigmId = on ? active.id : null
    touch()
  }
  function deriveOne(): void {
    if (!active || !testLexeme) return
    const ctx = ctxFor(testLexeme.languageId)
    if (!ctx) return
    const n = deriveForms(ctx, testLexeme, active)
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
      if (ctx) n += deriveForms(ctx, l, para, undefined, l.paradigmVariantId)
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
    for (const [lid, ls] of byLang) {
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
  <div class="page-head row">
    <h1>{t('paradigms.title')}</h1>
    <GuideLink section="paradigms" />
    <div class="tabs grow">
      {#each project.paradigms as p (p.id)}
        <button
          class="tab"
          class:active={active?.id === p.id}
          onclick={() => {
            activeId = p.id
            view = 'slots'
          }}>{pickText(p.name, glossLangs) || t('paradigms.untitled')}</button
        >
      {/each}
    </div>
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
        </h3>
        <p class="small muted">{t('consistency.hint')}</p>
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
        <h3>{t('paradigms.dimensions')}</h3>
        <p class="small muted">{t('paradigms.dimensionsHint')}</p>
        <p class="small muted">
          {t('paradigms.slotsExplain', { n: slots.length, dims: dimSizes })}
        </p>
        <div class="dims">
          {#each active.dimensionIds as id, i (id)}
            {@const c = project.categories.find((x) => x.id === id)}
            <span class="chip on">
              <b>{i + 1}</b>
              {c ? pickText(c.name, glossLangs) : '?'}
              <button class="x" onclick={() => moveDimension(i, -1)}><ChevronUp size={11} /></button
              >
              <button class="x" onclick={() => moveDimension(i, 1)}
                ><ChevronDown size={11} /></button
              >
              <button class="x" onclick={() => toggleDimension(id)}><X size={11} /></button>
            </span>
          {/each}
          {#each project.categories.filter((c) => !active!.dimensionIds.includes(c.id)) as c (c.id)}
            <button class="chip" onclick={() => toggleDimension(c.id)}
              ><Plus size={11} />{pickText(c.name, glossLangs)}
              <span class="muted small">({c.values.length})</span></button
            >
          {/each}
          {#if project.categories.length === 0}<span class="small muted"
              >{t('lexicon.noFeatures')}</span
            >{/if}
        </div>
      </section>

      <section class="block">
        <h3>{t('paradigms.slots')} <span class="badge">{slots.length}</span></h3>
        <div class="row wrap vbar">
          <span class="small muted">{t('paradigms.variants')}</span>
          <div class="seg">
            <button class:active={editVariantId === null} onclick={() => (editVariantId = null)}
              >{t('paradigms.variantBase')}</button
            >
            {#each variants as v (v.id)}
              <button class:active={editVariantId === v.id} onclick={() => (editVariantId = v.id)}
                >{v.name}</button
              >
            {/each}
          </div>
          <button class="btn ghost sm" onclick={addVariant}
            ><Plus size={13} />{t('paradigms.addVariant')}</button
          >
          {#if editVariantId}
            <button class="btn ghost sm" onclick={renameVariant}>{t('common.rename')}</button>
            <button class="btn ghost sm danger" onclick={removeVariant}>{t('common.delete')}</button
            >
          {/if}
          <span class="small muted">{t('paradigms.variantHint')}</span>
        </div>
        {#if slots.length === 0}
          <p class="small muted">{t('paradigms.noSlots')}</p>
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
              {#each slots as s (s.key)}
                {@const disabled = active.disabledSlots.includes(s.key)}
                {@const g = active.generators[gkey(s.key)] ?? { kind: 'none' }}
                <tr class:off={disabled}>
                  <td
                    ><input
                      type="checkbox"
                      checked={!disabled}
                      title={t('paradigms.enabled')}
                      onchange={() => toggleSlot(s.key)}
                    /></td
                  >
                  <td class="label">{s.label}</td>
                  <td class="mono small muted">{s.abbr}</td>
                  <td>
                    <select
                      class="select kind"
                      value={g.kind}
                      onchange={(e) =>
                        setKind(
                          gkey(s.key),
                          (e.currentTarget as HTMLSelectElement).value as SlotGenerator['kind']
                        )}
                    >
                      {#each ['none', 'table', 'pipeline'] as k (k)}<option value={k}
                          >{t(`paradigms.kinds.${k}`)}</option
                        >{/each}
                    </select>
                    {#if isInherited(gkey(s.key))}<span class="badge"
                        >{t('paradigms.inherited')}</span
                      >{/if}
                  </td>
                  <td colspan="2">
                    {#if g.kind === 'pipeline'}
                      <SlotPipeline
                        bind:stem={g.stem}
                        bind:steps={g.steps}
                        ruleSets={project.ruleSets}
                        {stemNames}
                        onchange={touch}
                      />
                    {:else if g.kind === 'table'}
                      <span class="small muted">{t('paradigms.kinds.table')}</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <datalist id="dl-stems"
            ><option value="lemma"></option>{#each stemNames as s (s)}<option value={s}
              ></option>{/each}</datalist
          >
          <p class="small muted">{t('paradigms.affixHint')}</p>
          <p class="small muted">{t('paradigms.adjustHint')}</p>
        {/if}
      </section>
    </div>
  {/if}
</div>

{#if active}
  {@const p = active}
  <Portal>
    <div class="field">
      <span class="small muted">{t('common.name')}</span>
      <LocalizedInput bind:value={p.name} languages={glossLangs} onchange={touch} />
    </div>
    <div class="field">
      <span class="small muted">{t('paradigms.bindPos')}</span>
      {#each project.posList as pos (pos.id)}
        <label class="row check"
          ><input
            type="checkbox"
            checked={pos.paradigmId === p.id}
            onchange={(e) => bindPos(pos.id, (e.currentTarget as HTMLInputElement).checked)}
          />{pickText(pos.name, glossLangs) ||
            pos.abbr}{#if pos.paradigmId && pos.paradigmId !== p.id}<span class="small muted"
              >({pickText(
                project.paradigms.find((x) => x.id === pos.paradigmId)?.name ?? {},
                glossLangs
              )})</span
            >{/if}</label
        >
      {/each}
      {#if project.posList.length === 0}<span class="small muted">{t('taxonomy.pos')}: 0</span>{/if}
    </div>
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
        ></span><span class="small muted">{boundLexemes.length}</span>
      </div>
      <input
        class="input data"
        placeholder={t('paradigms.pickLexeme')}
        bind:value={testLemma}
        oninput={() => (testLexemeId = null)}
        onfocus={() => (testFocused = true)}
        onblur={() => setTimeout(() => (testFocused = false), 180)}
      />
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
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="row">
          <button class="btn sm" onclick={deriveOne}
            ><Play size={14} />{t('paradigms.deriveOne')}</button
          >
        </div>
      {/if}
    </div>
    <div class="row wrap">
      <button class="btn sm" disabled={!boundLexemes.length} onclick={deriveAllBound}
        ><Play size={14} />{t('paradigms.deriveAll', { n: boundLexemes.length })}</button
      >
    </div>
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
  .tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    /* grow 项默认 min-width:auto，构形一多就把右边的按钮挤出去 */
    min-width: 0;
    scrollbar-width: thin;
  }
  .tabs .tab {
    flex: none;
  }
  .tab {
    border: 1px solid transparent;
    background: transparent;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-2);
    white-space: nowrap;
  }
  .tab:hover {
    background: var(--bg-hover);
  }
  .tab.active {
    background: var(--accent-soft);
    color: var(--accent-text);
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
  .slots .kind {
    margin-top: 13px;
  }
  .slots td.label,
  .slots td.mono {
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
</style>
