<script lang="ts">
  import { navScroll } from '$lib/ui/navScroll'
  import { scrollToItem } from '$lib/ui/reveal'
  import { sectionCollapsed, setSectionsCollapsed } from '$lib/ui/section.svelte'
  import { focusField } from '$lib/ui/focus'
  import type { PageView } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { platform } from '$lib/platform'
  import { createRuleSet, now } from '$lib/core/factory'
  import type { RuleSet } from '$lib/core/model'
  import {
    parseRuleText,
    runRules,
    ruleOrdinals,
    type RuleProgram,
    type RunResult
  } from '$lib/engine/sca'
  import {
    convertRuleFiles,
    yinbianjiPart,
    type RuleFile,
    type RuleFormat
  } from '$lib/importers/ruleFiles'
  import Portal from '$lib/ui/Portal.svelte'
  import ImportPreview from '$lib/ui/ImportPreview.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import RuleEditor from '$lib/ui/RuleEditor.svelte'
  import RuleList from '$lib/ui/RuleList.svelte'
  import TabStrip from '$lib/ui/TabStrip.svelte'
  import RuleChainGraph from '$lib/ui/RuleChainGraph.svelte'
  import StressText from '$lib/ui/StressText.svelte'
  import Menu from '$lib/ui/Menu.svelte'
  import EvolvePanel from '$lib/ui/EvolvePanel.svelte'
  import { languageParseOptions } from '$lib/engine/phon'
  import { stressForWord } from '$lib/core/stressInfo'
  import {
    Plus,
    Trash2,
    Download,
    Upload,
    Copy,
    List,
    Code,
    GitBranch,
    Sprout,
    X
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import { moveItem } from '$lib/core/move'
  let evolveOpen = $state(false)

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  /** 回到这一页时接着用上次的规则集、视图、选中的行与测试词 */
  const memo = ui.memo<{
    activeId: string | null
    view: 'list' | 'chain' | 'source'
    selectedLine: number | null
    selectedWord: string | null
  }>('soundChanges')
  let activeId = $state<string | null>(memo.activeId ?? null)
  const active = $derived(
    project.ruleSets.find((r) => r.id === activeId) ?? project.ruleSets[0] ?? null
  )
  $effect(() => {
    const id = ui.takePending('ruleSet')
    if (!id) return
    const stage = ui.takePendingSub()
    activeId = id
    // 文档里写的 [[音变:某套#某阶段]]：连阶段一起定位
    if (stage) void revealStage(id, stage)
  })
  /** 切到列表视图，展开这个阶段并滚过去闪一下 */
  async function revealStage(ruleSetId: string, name: string): Promise<void> {
    view = 'list'
    const foldId = `rules.stage:${ruleSetId}:${name}`
    if (sectionCollapsed(foldId)) setSectionsCollapsed([foldId], false)
    const el = await scrollToItem('soundChanges', `section.stage[data-stage="${CSS.escape(name)}"]`)
    if (!(el instanceof HTMLElement)) return
    el.classList.remove('flash-ok')
    void el.offsetWidth
    el.classList.add('flash-ok')
    setTimeout(() => el.classList.remove('flash-ok'), 900)
  }
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('soundChanges', {
      kind: 'ruleSet',
      lang: projectState.currentLanguageId,
      id: activeId,
      view
    })
  })
  $effect(() => {
    const r = ui.takeRestore('soundChanges')
    if (!r) return
    const v: PageView = r.view ?? {}
    if (v.id) activeId = v.id
    if (v.view === 'list' || v.view === 'chain' || v.view === 'source') view = v.view
    ui.restoreScroll('soundChanges', r.scroll)
  })
  $effect(() => {
    if (active && activeId !== active.id) activeId = active.id
  })
  $effect(() => {
    inspectorTitle = rulePending ? t('importPreview.title') : t('soundChanges.testBench')
  })

  // 解析（去抖）。规则集第一个绑定了语言的阶段所属语言的音类和多合字母作为基础。
  let program = $state<RuleProgram | null>(null)
  let parseTimer: ReturnType<typeof setTimeout> | null = null
  const baseLanguage = $derived.by(() => {
    if (!active) return null
    const boundId = Object.values(active.stageLanguages).find((id) => !!id)
    return project.languages.find((l) => l.id === boundId) ?? projectState.currentLanguage ?? null
  })
  $effect(() => {
    const text = active?.text ?? ''
    const opts = languageParseOptions(baseLanguage, project)
    if (parseTimer) clearTimeout(parseTimer)
    parseTimer = setTimeout(() => {
      program = parseRuleText(text, opts)
    }, 120)
    return () => {
      if (parseTimer) clearTimeout(parseTimer)
    }
  })

  // 测试台（测试词随规则集保存）
  let selectedWord = $state<string | null>(memo.selectedWord ?? null)
  const words = $derived(
    (active?.testWords ?? '')
      .split(/[\s,，、]+/)
      .map((w) => w.trim())
      .filter(Boolean)
  )
  const results = $derived.by((): RunResult[] => {
    if (!program) return []
    try {
      // 敲的词对上这门语言里勾了「对重音影响」的词条、语素时，把它的词类与特殊重音交给重音规则
      return words.map((w) =>
        runRules(program!, w, { word: stressForWord(project, baseLanguage?.id, w) })
      )
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
  const errorCount = $derived(
    program?.diagnostics.filter((d) => d.severity === 'error').length ?? 0
  )
  const warnCount = $derived(
    program?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0
  )

  let editor = $state<RuleEditor | null>(null)
  let view = $state<'list' | 'chain' | 'source'>(memo.view ?? 'list')
  let selectedLine = $state<number | null>(memo.selectedLine ?? null)
  $effect(() => {
    Object.assign(memo, { activeId, view, selectedLine, selectedWord })
  })
  if (!ui.restoring('soundChanges')) ui.restoreScroll('soundChanges', ui.lastScroll('soundChanges'))
  const ordinals = $derived(program ? ruleOrdinals(program) : new Map<number, number>())
  const selectedOrdinal = $derived(
    selectedLine != null ? (ordinals.get(selectedLine) ?? null) : null
  )
  /** 推到选中规则为止的形式 */
  const upTo = $derived.by((): RunResult[] | null => {
    if (!program || selectedLine == null) return null
    try {
      return words.map((w) =>
        runRules(program!, w, {
          stopAtLine: selectedLine!,
          word: stressForWord(project, baseLanguage?.id, w)
        })
      )
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

  /** 引用行上的「打开」：跳到被引用的那套音变 */
  function openRef(name: string): void {
    const key = name.trim().toLowerCase()
    const rs = project.ruleSets.find((r) => r.name.trim().toLowerCase() === key)
    if (rs) activeId = rs.id
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

  /** 选好、还没导入的规则文件：主区挑格式、起名字，检视器里显示转换出来的规则 */
  let rulePending = $state.raw<RuleFile[] | null>(null)
  let ruleFormat = $state<RuleFormat>('plain')
  let ruleName = $state('')

  const ruleText = $derived(convertRuleFiles(rulePending ?? [], ruleFormat))
  const ruleLines = $derived(ruleText.replace(/\s+$/, '').split(/\r?\n/))
  /** 测试台：敲的这段按现在选的格式转一遍，跟真导入同一条路 */
  function testRules(text: string): { lines: string[] } | null {
    const out = convertRuleFiles([{ name: '', content: text }], ruleFormat)
    const lines = out.replace(/\s+$/, '').split(/\r?\n/)
    return lines.some((l) => l.trim()) ? { lines: lines.slice(0, 400) } : null
  }

  async function importYinbianji(): Promise<void> {
    const files = await platform.readTextFiles({ multiple: true, extensions: ['txt'] })
    if (!files.length) return
    const rule = files.filter((f) => yinbianjiPart(f) === 'rule').pop()
    openRuleImport(
      files,
      'yinbianji',
      rule ? rule.name.replace(/rule\.txt$/i, '').replace(/\.txt$/i, '') : ''
    )
  }

  async function importConverted(kind: 'lexicanter' | 'sca2' | 'plain'): Promise<void> {
    const [f] = await platform.readTextFiles({ multiple: false, extensions: ['txt'] })
    if (!f) return
    openRuleImport([f], kind, f.name.replace(/\.txt$/i, ''))
  }
  function openRuleImport(files: RuleFile[], format: RuleFormat, name: string): void {
    rulePending = files.map((f) => ({ name: f.name, content: f.content }))
    ruleFormat = format
    ruleName = name
  }
  function runRuleImport(): void {
    if (!rulePending || !ruleText.trim()) return
    addSet(ruleText, ruleName.trim() || t('soundChanges.untitledSet'))
    rulePending = null
  }

  /** 每个规则集一份 .txt，放进一个文件夹；重名的加序号 */
  async function exportAllRuleSets(): Promise<void> {
    const files: Record<string, string> = {}
    const taken = new Set<string>()
    for (const rs of project.ruleSets) {
      const base = (rs.name || 'rules').replace(/[\\/:*?"<>|]+/g, '_')
      let name = `${base}.txt`
      // 文件系统多半不分大小写：Main 与 main 算重名
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-${i}.txt`
      taken.add(name.toLowerCase())
      files[name] = rs.text
    }
    await platform.exportFolder(files, `${project.meta.name || 'rules'}-rules`)
  }
  async function exportText(): Promise<void> {
    if (!active) return
    await platform.saveTextFile(`${active.name || 'rules'}.txt`, active.text)
  }

  async function copyResults(): Promise<void> {
    if (projectState.readOnly) return void ui.toast(t('readonly.exportBlocked'))
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
  <div class="page-head row tabbed">
    <h1>{t('soundChanges.title')}</h1>
    <GuideLink section="soundChanges" />
    <TabStrip
      kind="ruleSets"
      items={project.ruleSets.map((rs) => ({
        id: rs.id,
        label: rs.name || t('soundChanges.untitledSet')
      }))}
      activeId={active?.id ?? null}
      onselect={(id) => (activeId = id)}
      onrename={(id) => {
        activeId = id
        ui.inspectorOpen = true
        ui.syntaxOpen = false
        focusField('#rs-name')
      }}
      onmove={(from, to) => {
        if (!moveItem(project.ruleSets, from, to)) return false
        projectState.touch()
        return true
      }}
    />
    <Menu label={t('soundChanges.import')} icon={Download}>
      <button onclick={importYinbianji}>{t('soundChanges.importYinbianji')}</button>
      <button onclick={() => importConverted('lexicanter')}
        >{t('soundChanges.importLexicanter')}</button
      >
      <button onclick={() => importConverted('sca2')}>{t('soundChanges.importSca2')}</button>
      <button onclick={() => importConverted('plain')}>{t('soundChanges.importPlain')}</button>
    </Menu>
    <Menu label={t('common.export')} icon={Upload}>
      <button disabled={!active} onclick={exportText}>{t('io.exportRuleSet')}</button>
      <button disabled={!project.ruleSets.length} onclick={exportAllRuleSets}
        >{t('io.exportAllRuleSets')}</button
      >
    </Menu>
    <button class="btn primary" onclick={() => addSet()}
      ><Plus size={16} />{t('soundChanges.newSet')}</button
    >
  </div>
  <Hint id="soundchanges" text={t('soundChanges.hint')} />

  {#if rulePending}
    <div class="rule-import-wrap">
      <div class="card rule-import">
        <div class="row">
          <strong class="grow">{t('soundChanges.importTitle')}</strong>
          <button
            class="btn ghost icon sm"
            title={t('common.close')}
            onclick={() => (rulePending = null)}><X size={16} /></button
          >
        </div>
        <span class="small muted"
          >{t('soundChanges.importFiles', {
            names: rulePending.map((f) => f.name).join('、')
          })}</span
        >
        <label class="field"
          ><span class="small muted">{t('soundChanges.setName')}</span>
          <input class="input" bind:value={ruleName} /></label
        >
        <label class="field"
          ><span class="small muted">{t('soundChanges.importFormat')}</span>
          <select class="select" bind:value={ruleFormat}>
            <option value="yinbianji">{t('soundChanges.importYinbianji')}</option>
            <option value="lexicanter">{t('soundChanges.importLexicanter')}</option>
            <option value="sca2">{t('soundChanges.importSca2')}</option>
            <option value="plain">{t('soundChanges.importPlain')}</option>
          </select></label
        >
        <div class="row">
          <span class="grow"></span>
          <button class="btn" onclick={() => (rulePending = null)}>{t('common.cancel')}</button>
          <button class="btn primary" disabled={!ruleText.trim()} onclick={runRuleImport}
            >{t('io.import')}</button
          >
        </div>
      </div>
    </div>
  {:else if !active}
    <p class="muted">{t('soundChanges.empty')}</p>
  {:else}
    {@const rs = active}
    <div class="workspace">
      {#if evolveOpen}
        <EvolvePanel ruleSet={rs} {program} onclose={() => (evolveOpen = false)} />
      {/if}
      {#if view === 'source'}
        <div class="editor-wrap">
          <RuleEditor
            bind:this={editor}
            bind:value={rs.text}
            diagnostics={program?.diagnostics ?? []}
            placeholder={t('soundChanges.editorPlaceholder')}
            oninput={() => touch(rs)}
          />
        </div>
      {:else if view === 'chain'}
        <div class="list-wrap chain" data-tour="sc-chain">
          <RuleChainGraph {program} bind:selectedLine />
        </div>
      {:else}
        <div class="list-wrap" data-tour="sc-list" use:navScroll={'soundChanges'}>
          <RuleList
            bind:text={rs.text}
            {program}
            {hits}
            query={ui.search}
            bind:selectedLine
            onchange={() => touch(rs)}
            foldKey={rs.id}
            onopenref={openRef}
          />
        </div>
      {/if}
      <div class="status row">
        <div class="seg" data-tour="sc-views">
          <button class:active={view === 'list'} onclick={() => (view = 'list')}
            ><List size={14} />{t('soundChanges.viewList')}</button
          >
          <button class:active={view === 'chain'} onclick={() => (view = 'chain')}
            ><GitBranch size={14} />{t('soundChanges.viewChain')}</button
          >
          <button class:active={view === 'source'} onclick={() => (view = 'source')}
            ><Code size={14} />{t('soundChanges.viewSource')}</button
          >
        </div>
        <button
          class="btn sm"
          data-tour="sc-evolve"
          class:active={evolveOpen}
          onclick={() => (evolveOpen = !evolveOpen)}><Sprout size={14} />{t('evolve.title')}</button
        >
        <span class="small muted grow">
          {#if program}
            {t('soundChanges.stats', {
              rules: program.steps.filter((s) => s.kind === 'rule').length,
              stages: program.markers.length,
              classes: [...program.classes.keys()].filter((k) => !k.startsWith('@')).length
            })}
          {/if}
        </span>
        {#if errorCount}<span class="badge err">{t('soundChanges.errors', { n: errorCount })}</span
          >{/if}
        {#if warnCount}<span class="badge warn">{t('soundChanges.warnings', { n: warnCount })}</span
          >{/if}
        {#if !errorCount && !warnCount}<span class="badge">{t('soundChanges.noDiagnostics')}</span
          >{/if}
      </div>
      {#if program && program.diagnostics.length}
        <ul class="diags">
          {#each program.diagnostics as d, di (di)}
            <li class:err={d.severity === 'error'}>
              <button class="link" onclick={() => jump(d.line)}
                >{t('soundChanges.lineN', { n: d.line })}</button
              >
              {d.message}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

{#if rulePending}
  <Portal>
    <ImportPreview
      kind={ruleText.trim() ? 'lines' : 'empty'}
      total={ruleLines.length}
      lines={ruleLines.slice(0, 400)}
      source={rulePending.map((f) => f.name).join('|')}
      testParse={testRules}
      testPlaceholder={t('importPreview.phRules')}
    />
  </Portal>
{:else if active}
  {@const rs = active}
  <Portal>
    <div class="field">
      <label for="rs-name">{t('soundChanges.setName')}</label>
      <input id="rs-name" class="input" bind:value={rs.name} oninput={() => touch(rs)} />
    </div>

    <div class="field">
      <label for="test-input">{t('soundChanges.testInput')}</label>
      <textarea
        id="test-input"
        class="textarea data"
        bind:value={rs.testWords}
        placeholder={t('soundChanges.testPlaceholder')}
        rows="3"
        onchange={() => touch(rs)}
      ></textarea>
    </div>

    {#if results.length}
      <div class="results-head row">
        <h3 class="grow">{t('soundChanges.output')}</h3>
        <button
          class="btn ghost icon sm"
          title={t('soundChanges.copyResults')}
          onclick={copyResults}><Copy size={14} /></button
        >
      </div>
      <div class="table-wrap">
        <table class="results">
          <thead>
            <tr>
              <th>{columns[0] || t('soundChanges.output')}</th>
              {#if upTo && selectedOrdinal != null}<th class="upto"
                  >{t('soundChanges.upTo', { n: selectedOrdinal })}</th
                >{/if}
              {#each columns.slice(1) as c, i (i)}<th>{c || t('soundChanges.output')}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each results as r, ri (r.input)}
              {@const changed =
                selectedLine != null && r.trace.some((e) => e.line === selectedLine)}
              {@const cs = cells(r)}
              <tr
                class:sel={selectedWord === r.input}
                class:changed
                onclick={() => (selectedWord = r.input)}
              >
                <td class="data"><StressText text={cs[0]} /></td>
                {#if upTo && selectedOrdinal != null}<td class="data upto" class:hit={changed}
                    ><StressText text={upTo[ri]?.output ?? ''} /></td
                  >{/if}
                {#each cs.slice(1) as c, i (i)}<td class="data"><StressText text={c} /></td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <h3 class="trace-head">
        {selected ? t('soundChanges.traceFor', { word: selected.input }) : t('soundChanges.trace')}
      </h3>
      {#if !selected}
        <p class="small muted">{t('soundChanges.pickWord')}</p>
      {:else if selected.trace.length === 0}
        <p class="small muted">{t('soundChanges.noTrace')}</p>
      {:else}
        <ol class="trace">
          {#each selected.trace as e, i (i)}
            <li>
              <button
                class="link mono"
                title={t('soundChanges.lineN', { n: e.line })}
                onclick={() => (selectedLine = e.line)}
                >{e.kind === 'stress' ? e.target : (ordinals.get(e.line) ?? e.line)}</button
              >
              <span class="data"><StressText text={e.before} /></span>
              <span class="muted">→</span>
              <span class="data"><StressText text={e.after} /></span>
              <span class="small muted rule"
                >{e.kind === 'stress'
                  ? `${e.target} = ${e.replacement}`
                  : `${e.target || '∅'} → ${e.replacement || '∅'}`}{e.stage
                  ? ` · ${e.stage}`
                  : ''}</span
              >
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
            <select
              class="select"
              value={rs.stageLanguages[m] ?? ''}
              onchange={(e) => {
                rs.stageLanguages[m] = (e.currentTarget as HTMLSelectElement).value || null
                // 换了语言，原来挑的阶段不一定还在
                if (rs.stageLanguageStages) delete rs.stageLanguageStages[m]
                touch(rs)
              }}
            >
              <option value="">{t('soundChanges.unbound')}</option>
              {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
            </select>
            {#if project.languages.find((l) => l.id === rs.stageLanguages[m])?.stages?.length}
              {@const bl = project.languages.find((l) => l.id === rs.stageLanguages[m])!}
              <select
                class="select stage-sel"
                title={t('soundChanges.stageOfLanguage')}
                value={rs.stageLanguageStages?.[m] ?? ''}
                onchange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value || null
                  rs.stageLanguageStages = { ...(rs.stageLanguageStages ?? {}), [m]: v }
                  touch(rs)
                }}
              >
                <option value="">{t('soundChanges.anyStage')}</option>
                {#each bl.stages ?? [] as st (st.id)}<option value={st.id}
                    >{st.abbr ? `${st.abbr} · ${st.name}` : st.name}</option
                  >{/each}
              </select>
            {/if}
          </label>
        {/each}
      {/if}
    </div>

    <div class="field">
      <label for="rs-notes">{t('common.notes')}</label>
      <textarea id="rs-notes" class="textarea" bind:value={rs.notes} oninput={() => touch(rs)}
      ></textarea>
    </div>
    <button class="btn sm danger" onclick={() => removeSet(rs)}
      ><Trash2 size={14} />{t('soundChanges.deleteSet')}</button
    >
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
    padding-inline-end: 4px;
  }
  .list-wrap.chain {
    overflow: hidden;
    display: flex;
    flex-direction: column;
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
    margin-inline-end: 6px;
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
    text-align: start;
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
  /* 底色画在格子上：第一列是 sticky 的实底，画在行上会被它盖住，深色下隔行就成了半截黑条 */
  .results tbody tr:nth-child(even) td {
    background: var(--bg-sunken);
  }
  .results tbody tr:hover td {
    background: var(--bg-hover);
  }
  .results tbody tr.sel td {
    background: var(--accent-soft);
  }
  .results .upto {
    border-inline-start: 2px solid var(--accent);
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
    padding-inline-start: 0;
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
    margin-inline-start: auto;
  }
  .bindings {
    margin-top: 8px;
  }
  .binding {
    gap: 8px;
    margin: 4px 0;
    flex-wrap: wrap;
  }
  .binding .select.stage-sel {
    width: 130px;
  }
  .binding .select {
    width: 180px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .rule-import-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .rule-import {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 640px;
    padding: 14px 16px;
  }
</style>
