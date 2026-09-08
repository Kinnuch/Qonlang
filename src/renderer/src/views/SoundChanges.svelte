<script lang="ts">
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { platform } from '$lib/platform'
  import { createRuleSet, now } from '$lib/core/factory'
  import type { RuleSet } from '$lib/core/model'
  import { parseRuleText, runRules, ruleOrdinals, fromYinbianji, fromLexicanter, fromSca2, type RuleProgram, type RunResult } from '$lib/engine/sca'
  import Portal from '$lib/ui/Portal.svelte'
  import RuleEditor from '$lib/ui/RuleEditor.svelte'
  import RuleList from '$lib/ui/RuleList.svelte'
  import RuleChainGraph from '$lib/ui/RuleChainGraph.svelte'
  import { Plus, Trash2, Download, Upload, Copy, BookOpen, List, Code, GitBranch } from '@lucide/svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  let activeId = $state<string | null>(null)
  const active = $derived(project.ruleSets.find((r) => r.id === activeId) ?? project.ruleSets[0] ?? null)
  $effect(() => {
    if (active && activeId !== active.id) activeId = active.id
  })
  $effect(() => {
    inspectorTitle = t('soundChanges.testBench')
  })

  // 解析（去抖）
  let program = $state<RuleProgram | null>(null)
  let parseTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    const text = active?.text ?? ''
    if (parseTimer) clearTimeout(parseTimer)
    parseTimer = setTimeout(() => {
      program = parseRuleText(text)
    }, 120)
    return () => {
      if (parseTimer) clearTimeout(parseTimer)
    }
  })

  // 测试台（测试词随规则集保存）
  let selectedWord = $state<string | null>(null)
  const words = $derived((active?.testWords ?? '').split(/[\s,，、]+/).map((w) => w.trim()).filter(Boolean))
  const results = $derived.by((): RunResult[] => {
    if (!program) return []
    try {
      return words.map((w) => runRules(program!, w))
    } catch {
      return []
    }
  })
  const columns = $derived.by(() => {
    if (!program) return []
    const cols = [...program.markers]
    const last = program.steps[program.steps.length - 1]
    if (!last || last.kind !== 'marker') cols.push('')
    return cols
  })
  const selected = $derived(results.find((r) => r.input === selectedWord) ?? null)
  const errorCount = $derived(program?.diagnostics.filter((d) => d.severity === 'error').length ?? 0)
  const warnCount = $derived(program?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0)

  let editor = $state<RuleEditor | null>(null)
  let view = $state<'list' | 'chain' | 'source'>('list')
  let selectedLine = $state<number | null>(null)
  const ordinals = $derived(program ? ruleOrdinals(program) : new Map<number, number>())
  const selectedOrdinal = $derived(selectedLine != null ? (ordinals.get(selectedLine) ?? null) : null)
  /** 推到选中规则为止的形式 */
  const upTo = $derived.by((): RunResult[] | null => {
    if (!program || selectedLine == null) return null
    try {
      return words.map((w) => runRules(program!, w, { stopAtLine: selectedLine! }))
    } catch {
      return null
    }
  })

  /** 每条规则在测试词上的命中次数 */
  const hits = $derived.by(() => {
    const m = new Map<number, number>()
    for (const r of results) for (const e of r.trace) m.set(e.line, (m.get(e.line) ?? 0) + 1)
    return m
  })

  function jump(line: number): void {
    if (view !== 'source') {
      view = 'source'
      setTimeout(() => editor?.goToLine(line), 30)
    } else editor?.goToLine(line)
  }

  function touch(rs: RuleSet): void {
    rs.updatedAt = now()
    projectState.touch()
  }

  function addSet(text = '', name = t('soundChanges.untitledSet')): void {
    const rs = createRuleSet(name, text)
    project.ruleSets.push(rs)
    activeId = rs.id
    projectState.touch()
  }

  function removeSet(rs: RuleSet): void {
    const idx = project.ruleSets.indexOf(rs)
    if (idx < 0) return
    const snapshot = $state.snapshot(rs) as RuleSet
    project.ruleSets.splice(idx, 1)
    activeId = project.ruleSets[0]?.id ?? null
    projectState.touch()
    ui.toast(t('soundChanges.deletedSet', { name: snapshot.name }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.ruleSets.splice(Math.min(idx, project.ruleSets.length), 0, snapshot)
          activeId = snapshot.id
          projectState.touch()
        }
      }
    })
  }

  async function importYinbianji(): Promise<void> {
    const files = await platform.readTextFiles({ multiple: true, extensions: ['txt'] })
    if (!files.length) return
    let category = ''
    let replace = ''
    let rule = ''
    let name = ''
    for (const f of files) {
      const lower = f.name.toLowerCase()
      const body = f.content
      if (lower.includes('categor') || (!body.includes('>') && /^[A-Z]=/m.test(body))) category += body + '\n'
      else if (lower.includes('replace') || (!body.includes('>') && /^\S+\|\S+/m.test(body))) replace += body + '\n'
      else if (lower.includes('lexicon')) continue
      else {
        rule += body + '\n'
        name = f.name.replace(/rule\.txt$/i, '').replace(/\.txt$/i, '')
      }
    }
    addSet(fromYinbianji(category, replace, rule), name || t('soundChanges.untitledSet'))
  }

  async function importConverted(kind: 'lexicanter' | 'sca2' | 'plain'): Promise<void> {
    const [f] = await platform.readTextFiles({ multiple: false, extensions: ['txt'] })
    if (!f) return
    const text = kind === 'lexicanter' ? fromLexicanter(f.content) : kind === 'sca2' ? fromSca2(f.content) : f.content
    addSet(text, f.name.replace(/\.txt$/i, ''))
  }

  async function exportText(): Promise<void> {
    if (!active) return
    await platform.saveTextFile(`${active.name || 'rules'}.txt`, active.text)
  }

  async function copyResults(): Promise<void> {
    const header = columns.map((c) => c || t('soundChanges.output')).join(' | ')
    const rows = results.map((r) => cells(r).join(' → '))
    await navigator.clipboard.writeText([header, ...rows].join('\n'))
    ui.toast(t('soundChanges.copied'))
  }

  function cells(r: RunResult): string[] {
    const out: string[] = []
    for (const c of columns) {
      if (c === '') out.push(r.output)
      else out.push(r.stages.find((s) => s.name === c)?.form ?? '')
    }
    return out
  }

  function stageNames(rs: RuleSet): string[] {
    return program && rs === active ? program.markers : parseRuleText(rs.text).markers
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('soundChanges.title')}</h1>
    <div class="tabs grow">
      {#each project.ruleSets as rs (rs.id)}
        <button class="tab" class:active={active?.id === rs.id} onclick={() => (activeId = rs.id)}>{rs.name || t('soundChanges.untitledSet')}</button>
      {/each}
    </div>
    <div class="menu">
      <button class="btn"><Upload size={16} />{t('soundChanges.import')}</button>
      <div class="menu-list card">
        <button onclick={importYinbianji}>{t('soundChanges.importYinbianji')}</button>
        <button onclick={() => importConverted('lexicanter')}>{t('soundChanges.importLexicanter')}</button>
        <button onclick={() => importConverted('sca2')}>{t('soundChanges.importSca2')}</button>
        <button onclick={() => importConverted('plain')}>{t('soundChanges.importPlain')}</button>
      </div>
    </div>
    <button class="btn primary" onclick={() => addSet()}><Plus size={16} />{t('soundChanges.newSet')}</button>
  </div>

  {#if !active}
    <p class="muted">{t('soundChanges.empty')}</p>
  {:else}
    {@const rs = active}
    <div class="workspace">
      {#if view === 'source'}
        <div class="editor-wrap">
          <RuleEditor bind:this={editor} bind:value={rs.text} diagnostics={program?.diagnostics ?? []} placeholder={t('soundChanges.editorPlaceholder')} oninput={() => touch(rs)} />
        </div>
      {:else if view === 'chain'}
        <div class="list-wrap">
          <RuleChainGraph {program} bind:selectedLine />
        </div>
      {:else}
        <div class="list-wrap">
          <RuleList bind:text={rs.text} {program} {hits} bind:selectedLine onchange={() => touch(rs)} />
        </div>
      {/if}
      <div class="status row">
        <div class="seg">
          <button class:active={view === 'list'} onclick={() => (view = 'list')}><List size={14} />{t('soundChanges.viewList')}</button>
          <button class:active={view === 'chain'} onclick={() => (view = 'chain')}><GitBranch size={14} />{t('soundChanges.viewChain')}</button>
          <button class:active={view === 'source'} onclick={() => (view = 'source')}><Code size={14} />{t('soundChanges.viewSource')}</button>
        </div>
        <span class="small muted grow">
          {#if program}
            {t('soundChanges.stats', { rules: program.steps.filter((s) => s.kind === 'rule').length, stages: program.markers.length, classes: program.classes.size })}
          {/if}
        </span>
        {#if errorCount}<span class="badge err">{t('soundChanges.errors', { n: errorCount })}</span>{/if}
        {#if warnCount}<span class="badge warn">{t('soundChanges.warnings', { n: warnCount })}</span>{/if}
        {#if !errorCount && !warnCount}<span class="badge">{t('soundChanges.noDiagnostics')}</span>{/if}
        <button class="btn ghost sm" onclick={exportText}><Download size={14} />{t('soundChanges.exportText')}</button>
        <a class="btn ghost sm" href="https://github.com/kinnuch/qianyuji/blob/main/docs/rules.md" target="_blank" rel="noreferrer"><BookOpen size={14} />{t('soundChanges.syntaxHelp')}</a>
      </div>
      {#if program && program.diagnostics.length}
        <ul class="diags">
          {#each program.diagnostics as d (d.line + d.message)}
            <li class:err={d.severity === 'error'}>
              <button class="link" onclick={() => jump(d.line)}>{t('soundChanges.lineN', { n: d.line })}</button>
              {d.message}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

{#if active}
  {@const rs = active}
  <Portal>
    <div class="field">
      <label for="rs-name">{t('soundChanges.setName')}</label>
      <input id="rs-name" class="input" bind:value={rs.name} oninput={() => touch(rs)} />
    </div>

    <div class="field">
      <label for="test-input">{t('soundChanges.testInput')}</label>
      <textarea id="test-input" class="textarea data" bind:value={rs.testWords} placeholder={t('soundChanges.testPlaceholder')} rows="3" onchange={() => touch(rs)}></textarea>
    </div>

    {#if results.length}
      <div class="results-head row">
        <h3 class="grow">{t('soundChanges.output')}</h3>
        <button class="btn ghost icon sm" title={t('soundChanges.copyResults')} onclick={copyResults}><Copy size={14} /></button>
      </div>
      <div class="table-wrap">
        <table class="results">
          <thead>
            <tr>
              <th>{columns[0] || t('soundChanges.output')}</th>
              {#if upTo && selectedOrdinal != null}<th class="upto">{t('soundChanges.upTo', { n: selectedOrdinal })}</th>{/if}
              {#each columns.slice(1) as c, i (i)}<th>{c || t('soundChanges.output')}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each results as r, ri (r.input)}
              {@const changed = selectedLine != null && r.trace.some((e) => e.line === selectedLine)}
              {@const cs = cells(r)}
              <tr class:sel={selectedWord === r.input} class:changed onclick={() => (selectedWord = r.input)}>
                <td class="data">{cs[0]}</td>
                {#if upTo && selectedOrdinal != null}<td class="data upto" class:hit={changed}>{upTo[ri]?.output ?? ''}</td>{/if}
                {#each cs.slice(1) as c, i (i)}<td class="data">{c}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <h3 class="trace-head">{selected ? t('soundChanges.traceFor', { word: selected.input }) : t('soundChanges.trace')}</h3>
      {#if !selected}
        <p class="small muted">{t('soundChanges.pickWord')}</p>
      {:else if selected.trace.length === 0}
        <p class="small muted">{t('soundChanges.noTrace')}</p>
      {:else}
        <ol class="trace">
          {#each selected.trace as e, i (i)}
            <li>
              <button class="link mono" title={t('soundChanges.lineN', { n: e.line })} onclick={() => (selectedLine = e.line)}>{ordinals.get(e.line) ?? e.line}</button>
              <span class="data">{e.before}</span>
              <span class="muted">→</span>
              <span class="data">{e.after}</span>
              <span class="small muted rule">{e.target || '∅'} → {e.replacement || '∅'}{e.stage ? ` · ${e.stage}` : ''}</span>
            </li>
          {/each}
        </ol>
      {/if}
    {/if}

    <div class="field bindings">
      <span class="small muted">{t('soundChanges.stageBindings')}</span>
      {#if stageNames(rs).length === 0}
        <p class="small muted">{t('soundChanges.noStages')}</p>
      {:else}
        {#each stageNames(rs) as m (m)}
          <label class="row binding">
            <span class="mono grow">{m}</span>
            <select class="select" value={rs.stageLanguages[m] ?? ''} onchange={(e) => {
              rs.stageLanguages[m] = (e.currentTarget as HTMLSelectElement).value || null
              touch(rs)
            }}>
              <option value="">{t('soundChanges.unbound')}</option>
              {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
            </select>
          </label>
        {/each}
      {/if}
    </div>

    <div class="field">
      <label for="rs-notes">{t('common.notes')}</label>
      <textarea id="rs-notes" class="textarea" bind:value={rs.notes} oninput={() => touch(rs)}></textarea>
    </div>
    <button class="btn sm danger" onclick={() => removeSet(rs)}><Trash2 size={14} />{t('soundChanges.deleteSet')}</button>
  </Portal>
{/if}

<style>
  .page {
    padding: 20px 24px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
  .menu {
    position: relative;
  }
  .menu-list {
    display: none;
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 260px;
    padding: 4px;
    z-index: 10;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .menu:hover .menu-list,
  .menu:focus-within .menu-list {
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
  .workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .editor-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .list-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-right: 4px;
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
    padding: 3px 10px;
    font-size: 13px;
    cursor: pointer;
    color: var(--text-2);
  }
  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .badge.err {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .badge.warn {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .diags {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 120px;
    overflow: auto;
    font-size: 13px;
  }
  .diags li {
    padding: 2px 0;
    color: var(--warn);
  }
  .diags li.err {
    color: var(--danger);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    cursor: pointer;
    margin-right: 6px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .results-head {
    margin-top: 4px;
  }
  .table-wrap {
    overflow-x: auto;
    margin: 6px 0 14px;
  }
  .results {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  .results th:first-child,
  .results td:first-child {
    position: sticky;
    left: 0;
    background: var(--bg-elev);
  }
  .results th {
    text-align: left;
    font-weight: 600;
    color: var(--text-2);
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .results td {
    padding: 4px 8px;
    white-space: nowrap;
  }
  .results tbody tr {
    cursor: pointer;
  }
  .results tbody tr:nth-child(even) {
    background: var(--bg-sunken);
  }
  .results tbody tr:hover {
    background: var(--bg-hover);
  }
  .results tbody tr.sel {
    background: var(--accent-soft);
  }
  .results .upto {
    border-left: 2px solid var(--accent);
  }
  .results td.upto.hit {
    color: var(--accent-text);
    font-weight: 600;
  }
  .results tbody tr.changed td:first-child {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .trace-head {
    margin-bottom: 6px;
    text-transform: none;
    letter-spacing: 0;
  }
  .trace {
    margin: 0 0 14px;
    padding-left: 0;
    list-style: none;
    font-size: 13px;
  }
  .trace li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    padding: 3px 0;
    border-bottom: 1px dashed var(--border);
  }
  .trace .rule {
    margin-left: auto;
  }
  .bindings {
    margin-top: 8px;
  }
  .binding {
    gap: 8px;
    margin: 4px 0;
  }
  .binding .select {
    width: 180px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
</style>
