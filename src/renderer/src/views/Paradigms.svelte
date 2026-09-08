<script lang="ts">
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { newId } from '$lib/core/factory'
  import type { Id, Paradigm, SlotGenerator } from '$lib/core/model'
  import { paradigmSlots, resolveGenerator, generateForm, deriveForms, reconcile, makeContext, type SlotReport } from '$lib/engine/morph'
  import { parseRuleText } from '$lib/engine/sca'
  import Portal from '$lib/ui/Portal.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import { Plus, Trash2, ChevronUp, ChevronDown, Play, ClipboardCheck, ArrowLeft, Check, X, Minus } from '@lucide/svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const language = $derived(projectState.currentLanguage ?? project.languages.find((l) => l.id === project.settings.defaultLanguageId) ?? project.languages[0] ?? null)

  let activeId = $state<Id | null>(null)
  const active = $derived(project.paradigms.find((p) => p.id === activeId) ?? project.paradigms[0] ?? null)
  $effect(() => {
    if (active && activeId !== active.id) activeId = active.id
  })
  let view = $state<'slots' | 'report'>('slots')
  let report = $state<SlotReport[] | null>(null)
  let testLemma = $state('')

  const slots = $derived(active ? paradigmSlots(active, project.categories, glossLangs, true) : [])
  const boundPos = $derived(active ? project.posList.filter((p) => p.paradigmId === active.id) : [])
  /** 绑定词类的全部词位；当前语言的排在前面 */
  const boundLexemes = $derived(
    project.lexemes.filter((l) => boundPos.some((p) => p.id === l.posId)).sort((a, b) => (language && a.languageId === language.id ? 0 : 1) - (language && b.languageId === language.id ? 0 : 1))
  )
  const stemNames = $derived([...new Set(project.lexemes.flatMap((l) => Object.keys(l.stems)))].sort())
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
  const testLexeme = $derived(boundLexemes.find((l) => l.lemma === testLemma) ?? project.lexemes.find((l) => l.lemma === testLemma) ?? boundLexemes[0] ?? null)
  const testRows = $derived.by(() => {
    if (!active || !testLexeme) return []
    const ctx = ctxFor(testLexeme.languageId)
    if (!ctx) return []
    return slots
      .filter((s) => !active!.disabledSlots.includes(s.key))
      .map((s) => {
        const g = generateForm(ctx, testLexeme, active!, s)
        const stored = testLexeme.forms[s.label]
        const status = !g ? 'none' : !stored?.override ? 'missing' : stored.surface.split(/[,，;；/]\s*/).map((v) => v.trim().replace(/^\*/, '')).includes(g.surface) ? 'same' : 'diff'
        return { slot: s, generated: g?.surface ?? '', trace: g?.trace ?? [], stored: stored?.surface ?? '', status }
      })
  })
  const stageNames = (rsId: Id | null): string[] => {
    const rs = project.ruleSets.find((r) => r.id === rsId)
    return rs ? parseRuleText(rs.text).markers : []
  }

  $effect(() => {
    inspectorTitle = active ? pickText(active.name, glossLangs) || t('paradigms.untitled') : t('paradigms.title')
  })

  function touch(): void {
    projectState.touch()
  }
  function addParadigm(): void {
    const p: Paradigm = { id: newId(), name: { [glossLangs[0] ?? 'zh']: t('paradigms.untitled') }, dimensionIds: [], disabledSlots: [], generators: {}, inheritsFrom: null }
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
    ;[active.dimensionIds[i], active.dimensionIds[j]] = [active.dimensionIds[j], active.dimensionIds[i]]
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
    let g: SlotGenerator
    switch (kind) {
      case 'affix':
        g = { kind, stem, prefix: cur && 'prefix' in cur ? cur.prefix : '', suffix: cur && 'suffix' in cur ? cur.suffix : '', infix: '', infixAt: '' }
        break
      case 'affix-sca':
        g = { kind, stem, prefix: cur && 'prefix' in cur ? cur.prefix : '', suffix: cur && 'suffix' in cur ? cur.suffix : '', ruleSetId: project.ruleSets[0]?.id ?? null, fromStage: '', toStage: '' }
        break
      case 'pattern':
        g = { kind, stem, pattern: '' }
        break
      case 'reduplication':
        g = { kind, stem, scope: 'full', length: 1 }
        break
      default:
        g = { kind } as SlotGenerator
    }
    active.generators[key] = g
    touch()
  }
  function isInherited(key: string): boolean {
    if (!active) return false
    const own = active.generators[key]
    return (!own || own.kind === 'none') && !!active.inheritsFrom && resolveGenerator(active, key, project.paradigms).kind !== 'none'
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
    ui.toast(t('paradigms.derivedCount', { n, words: 1 }))
  }
  function deriveAllBound(): void {
    if (!active) return
    let n = 0
    for (const l of boundLexemes) {
      const ctx = ctxFor(l.languageId)
      if (ctx) n += deriveForms(ctx, l, active)
    }
    touch()
    ui.toast(t('paradigms.derivedCount', { n, words: boundLexemes.length }))
  }
  function runReport(): void {
    if (!active) return
    // 按语言分组对账，再按槽位合并
    const byLang = new Map<Id, typeof boundLexemes>()
    for (const l of boundLexemes) byLang.set(l.languageId, [...(byLang.get(l.languageId) ?? []), l])
    const merged = new Map<string, SlotReport>()
    for (const [lid, ls] of byLang) {
      const ctx = ctxFor(lid)
      if (!ctx) continue
      for (const r of reconcile(ctx, ls, active)) {
        const m = merged.get(r.slot.key)
        if (!m) merged.set(r.slot.key, r)
        else {
          m.same += r.same
          m.diff += r.diff
          m.missing += r.missing
          m.examples.push(...r.examples.slice(0, Math.max(0, 30 - m.examples.length)))
        }
      }
    }
    report = [...merged.values()]
    view = 'report'
  }
  function pct(r: SlotReport): string {
    const total = r.same + r.diff
    return total ? `${Math.round((r.same / total) * 100)}%` : '—'
  }
  const lexemeDatalist = $derived((boundLexemes.length ? boundLexemes : project.lexemes).slice(0, 2000))
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('paradigms.title')}</h1>
    <div class="tabs grow">
      {#each project.paradigms as p (p.id)}
        <button class="tab" class:active={active?.id === p.id} onclick={() => { activeId = p.id; view = 'slots' }}>{pickText(p.name, glossLangs) || t('paradigms.untitled')}</button>
      {/each}
    </div>
    <button class="btn primary" onclick={addParadigm}><Plus size={16} />{t('paradigms.newParadigm')}</button>
  </div>

  {#if !active}
    <p class="muted">{t('paradigms.empty')}</p>
  {:else if view === 'report' && report}
    <div class="scroll">
      <div class="row"><button class="btn sm" onclick={() => (view = 'slots')}><ArrowLeft size={14} />{t('paradigms.backToSlots')}</button><span class="small muted">{t('paradigms.reportTitle', { n: boundLexemes.length })}</span></div>
      <table class="tbl">
        <thead><tr><th>{t('paradigms.slot')}</th><th>{t('paradigms.same')}</th><th>{t('paradigms.diff')}</th><th>{t('paradigms.missing')}</th><th>%</th></tr></thead>
        <tbody>
          {#each report as r (r.slot.key)}
            <tr>
              <td>{r.slot.label} <span class="mono muted small">{r.slot.abbr}</span></td>
              {#if r.skipped}<td colspan="4" class="muted small">{t('paradigms.kinds.none')}</td>{:else}
                <td class="ok">{r.same}</td><td class="bad">{r.diff}</td><td class="muted">{r.missing}</td><td><b>{pct(r)}</b></td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
      {#each report.filter((r) => r.examples.length) as r (r.slot.key + 'x')}
        <h3>{t('paradigms.examples')} · {r.slot.label}</h3>
        <table class="tbl small">
          <thead><tr><th>{t('lexicon.lemma')}</th><th>{t('paradigms.stored')}</th><th>{t('paradigms.generated')}</th></tr></thead>
          <tbody>{#each r.examples as e (e.lemma)}<tr><td class="data">{e.lemma}</td><td class="data">{e.stored}</td><td class="data bad">{e.generated}</td></tr>{/each}</tbody>
        </table>
      {/each}
    </div>
  {:else}
    <div class="scroll">
      <section class="block">
        <h3>{t('paradigms.dimensions')}</h3>
        <p class="small muted">{t('paradigms.dimensionsHint')}</p>
        <div class="dims">
          {#each active.dimensionIds as id, i (id)}
            {@const c = project.categories.find((x) => x.id === id)}
            <span class="chip on">
              <b>{i + 1}</b> {c ? pickText(c.name, glossLangs) : '?'}
              <button class="x" onclick={() => moveDimension(i, -1)}><ChevronUp size={11} /></button>
              <button class="x" onclick={() => moveDimension(i, 1)}><ChevronDown size={11} /></button>
              <button class="x" onclick={() => toggleDimension(id)}><X size={11} /></button>
            </span>
          {/each}
          {#each project.categories.filter((c) => !active!.dimensionIds.includes(c.id)) as c (c.id)}
            <button class="chip" onclick={() => toggleDimension(c.id)}><Plus size={11} />{pickText(c.name, glossLangs)} <span class="muted small">({c.values.length})</span></button>
          {/each}
          {#if project.categories.length === 0}<span class="small muted">{t('lexicon.noFeatures')}</span>{/if}
        </div>
      </section>

      <section class="block">
        <h3>{t('paradigms.slots')} <span class="badge">{slots.length}</span></h3>
        {#if slots.length === 0}
          <p class="small muted">{t('paradigms.noSlots')}</p>
        {:else}
          <table class="tbl slots">
            <thead><tr><th></th><th>{t('paradigms.slot')}</th><th>{t('paradigms.gloss')}</th><th>{t('paradigms.generator')}</th><th>{t('paradigms.params')}</th><th>{t('paradigms.adjust')}</th></tr></thead>
            <tbody>
              {#each slots as s (s.key)}
                {@const disabled = active.disabledSlots.includes(s.key)}
                {@const g = active.generators[s.key] ?? { kind: 'none' }}
                <tr class:off={disabled}>
                  <td><input type="checkbox" checked={!disabled} title={t('paradigms.enabled')} onchange={() => toggleSlot(s.key)} /></td>
                  <td class="label">{s.label}</td>
                  <td class="mono small muted">{s.abbr}</td>
                  <td>
                    <select class="select kind" value={g.kind} onchange={(e) => setKind(s.key, (e.currentTarget as HTMLSelectElement).value as SlotGenerator['kind'])}>
                      {#each ['none', 'table', 'affix', 'affix-sca', 'pattern', 'reduplication'] as k (k)}<option value={k}>{t(`paradigms.kinds.${k}`)}</option>{/each}
                    </select>
                    {#if isInherited(s.key)}<span class="badge">{t('paradigms.inherited')}</span>{/if}
                  </td>
                  <td>
                    <div class="formula">
                      <div class="frow">
                      {#if g.kind === 'affix' || g.kind === 'affix-sca'}
                        <label class="pf"><span>{t('paradigms.prefix')}</span><input class="input data" bind:value={g.prefix} oninput={touch} /></label>
                        <span class="op">+</span>
                        <label class="pf"><span>{t('paradigms.stem')}</span><input class="input" list="dl-stems" placeholder="lemma" bind:value={g.stem} oninput={touch} /></label>
                        <span class="op">+</span>
                        <label class="pf"><span>{t('paradigms.suffix')}</span><input class="input data" bind:value={g.suffix} oninput={touch} /></label>
                      {:else if g.kind === 'pattern' || g.kind === 'reduplication'}
                        <label class="pf"><span>{t('paradigms.stem')}</span><input class="input" list="dl-stems" placeholder="lemma" bind:value={g.stem} oninput={touch} /></label>
                      {/if}
                      {#if g.kind === 'affix'}
                        <span class="op">·</span>
                        <label class="pf"><span>{t('paradigms.infix')}</span><input class="input data" bind:value={g.infix} oninput={touch} /></label>
                        <label class="pf sm"><span>{t('paradigms.infixAt')}</span><input class="input" placeholder="V1" title={t('paradigms.infixAtHint')} bind:value={g.infixAt} oninput={touch} /></label>
                      {/if}
                      </div>
                      {#if g.kind === 'affix-sca' || g.kind === 'pattern' || g.kind === 'reduplication'}
                      <div class="frow">
                      {#if g.kind === 'affix-sca'}
                        <span class="op arrow">→</span>
                        <label class="pf wide"><span>{t('paradigms.ruleSet')}</span>
                          <select class="select" bind:value={g.ruleSetId} onchange={touch}>
                            <option value={null}>—</option>
                            {#each project.ruleSets as rs (rs.id)}<option value={rs.id}>{rs.name}</option>{/each}
                          </select></label>
                        <label class="pf sm"><span>{t('paradigms.fromStage')}</span>
                          <select class="select" bind:value={g.fromStage} onchange={touch}>
                            <option value="">—</option>
                            {#each stageNames(g.ruleSetId) as st (st)}<option value={st}>{st}</option>{/each}
                          </select></label>
                        <label class="pf sm"><span>{t('paradigms.toStage')}</span>
                          <select class="select" bind:value={g.toStage} onchange={touch}>
                            <option value="">—</option>
                            {#each stageNames(g.ruleSetId) as st (st)}<option value={st}>{st}</option>{/each}
                          </select></label>
                      {/if}
                      {#if g.kind === 'pattern'}
                        <span class="op arrow">→</span>
                        <label class="pf wide"><span>{t('paradigms.kinds.pattern')}</span><input class="input data" placeholder="C1aC2aC3" title={t('paradigms.patternHint')} bind:value={g.pattern} oninput={touch} /></label>
                      {/if}
                      {#if g.kind === 'reduplication'}
                        <span class="op arrow">→</span>
                        <label class="pf"><span>{t('paradigms.kinds.reduplication')}</span>
                          <select class="select" bind:value={g.scope} onchange={touch}>
                            {#each ['full', 'initial', 'final'] as sc (sc)}<option value={sc}>{t(`paradigms.scopes.${sc}`)}</option>{/each}
                          </select></label>
                        {#if g.scope !== 'full'}<label class="pf sm"><span>{t('paradigms.length')}</span><input type="number" min="1" class="input" bind:value={g.length} onchange={touch} /></label>{/if}
                      {/if}
                      </div>
                      {/if}
                    </div>
                  </td>
                  <td>
                    <div class="adjust">
                      {#if g.kind === 'affix-sca' || g.kind === 'pattern' || g.kind === 'reduplication'}
                        <textarea class="textarea adj" rows="1" placeholder={g.kind === 'affix-sca' ? t('paradigms.adjustPre') : t('paradigms.adjustStem')} title={t('paradigms.adjustHint')} bind:value={g.pre} oninput={touch}></textarea>
                      {/if}
                      {#if g.kind !== 'none' && g.kind !== 'table'}
                        <textarea class="textarea adj" rows="1" placeholder={t('paradigms.adjustPost')} title={t('paradigms.adjustHint')} bind:value={g.post} oninput={touch}></textarea>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <datalist id="dl-stems"><option value="lemma"></option>{#each stemNames as s (s)}<option value={s}></option>{/each}</datalist>
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
        <label class="row check"><input type="checkbox" checked={pos.paradigmId === p.id} onchange={(e) => bindPos(pos.id, (e.currentTarget as HTMLInputElement).checked)} />{pickText(pos.name, glossLangs) || pos.abbr}{#if pos.paradigmId && pos.paradigmId !== p.id}<span class="small muted">({pickText(project.paradigms.find((x) => x.id === pos.paradigmId)?.name ?? {}, glossLangs)})</span>{/if}</label>
      {/each}
      {#if project.posList.length === 0}<span class="small muted">{t('taxonomy.pos')}: 0</span>{/if}
    </div>
    <div class="field">
      <label for="pd-inh">{t('paradigms.inheritsFrom')}</label>
      <select id="pd-inh" class="select" value={p.inheritsFrom ?? ''} onchange={(e) => { p.inheritsFrom = (e.currentTarget as HTMLSelectElement).value || null; touch() }}>
        <option value="">{t('paradigms.noInherit')}</option>
        {#each project.paradigms.filter((x) => x.id !== p.id) as x (x.id)}<option value={x.id}>{pickText(x.name, glossLangs)}</option>{/each}
      </select>
    </div>

    <div class="field">
      <div class="row"><span class="small muted grow">{t('paradigms.testBench')}</span><span class="small muted">{boundLexemes.length}</span></div>
      <input class="input data" list="dl-lexemes-p" placeholder={t('paradigms.pickLexeme')} bind:value={testLemma} />
      <datalist id="dl-lexemes-p">{#each lexemeDatalist as l (l.id)}<option value={l.lemma}></option>{/each}</datalist>
      {#if testLexeme}
        <table class="tbl small test">
          <tbody>
            {#each testRows as r (r.slot.key)}
              <tr title={r.trace.join('\n')}>
                <td class="muted">{r.slot.label}</td>
                <td class="data">{r.generated || '—'}</td>
                <td class="st">
                  {#if r.status === 'same'}<span class="ok"><Check size={12} /></span>
                  {:else if r.status === 'diff'}<span class="bad" title={r.stored}><X size={12} /> <span class="data small">{r.stored}</span></span>
                  {:else if r.status === 'missing'}<span class="muted"><Minus size={12} /></span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="row">
          <button class="btn sm" onclick={deriveOne}><Play size={14} />{t('paradigms.deriveOne')}</button>
        </div>
      {/if}
    </div>
    <div class="row wrap">
      <button class="btn sm" disabled={!boundLexemes.length} onclick={deriveAllBound}><Play size={14} />{t('paradigms.deriveAll', { n: boundLexemes.length })}</button>
      <button class="btn sm" disabled={!boundLexemes.length} onclick={runReport}><ClipboardCheck size={14} />{t('paradigms.report')}</button>
    </div>
    <button class="btn sm danger" onclick={() => removeParadigm(p)}><Trash2 size={14} />{t('common.delete')}</button>
  </Portal>
{/if}

<style>
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
  .formula {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .frow {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    white-space: nowrap;
  }
  .pf {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 96px;
  }
  .pf.sm {
    width: 72px;
  }
  .pf.wide {
    width: 170px;
  }
  .pf > span {
    font-size: 10px;
    line-height: 1.2;
    color: var(--text-3);
    padding-left: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pf .input,
  .pf .select {
    height: 28px;
    padding: 2px 7px;
    font-size: 13px;
    border-radius: 6px;
  }
  .pf .select {
    padding-right: 22px;
    background-position: right 6px center;
  }
  .pf .input.data {
    font-size: 14px;
  }
  .op {
    color: var(--text-3);
    padding: 0 1px 6px;
    font-size: 14px;
    user-select: none;
  }
  .op.arrow {
    color: var(--accent-text);
    padding-left: 4px;
  }
  .adjust {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 150px;
  }
  .adj {
    min-height: 28px;
    height: 28px;
    padding: 4px 7px;
    font-family: var(--font-mono);
    font-size: 12px;
    border-radius: 6px;
    resize: vertical;
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
