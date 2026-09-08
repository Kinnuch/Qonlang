<script lang="ts">
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { createSentence, createLexeme, newId } from '$lib/core/factory'
  import type { Analysis, Id, Sentence, Token } from '$lib/core/model'
  import { analyzeSentence, analyzeToken, buildIndex, interlinear, toLeipzig, toMarkdown, toHtml, toLatex, renderTemplate, coverage, corpusStats, LEIPZIG } from '$lib/engine/gloss'
  import Portal from '$lib/ui/Portal.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import { flashOn } from '$lib/ui/flash'
  import { wordHover } from '$lib/state/wordHover.svelte'
  import { renderScript } from '$lib/script/render'
  import { fontCss } from '$lib/script/fonts'
  import { Plus, Trash2, X, Copy, Wand2, RefreshCw, CheckCheck, Check, Sparkles } from '@lucide/svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const langId = $derived(projectState.currentLanguageId ?? project.settings.defaultLanguageId ?? project.languages[0]?.id ?? null)
  const language = $derived(project.languages.find((l) => l.id === langId) ?? null)

  let mode = $state<'entries' | 'stats' | 'abbr'>('entries')
  let selectedId = $state<Id | null>(null)
  let query = $state('')
  let exportFormat = $state<'leipzig' | 'markdown' | 'html' | 'latex' | 'template'>('leipzig')
  let templateId = $state<string>('')
  let templateDraft = $state({ name: '', template: '' })
  /** 全部确认后编辑器渐隐中 */
  let fading = $state(false)
  /** 刚确认完、需要闪一下的句子 */
  let justConfirmed = $state<Id | null>(null)

  const list = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return project.sentences.filter((s) => (!langId || s.languageId === langId) && (!q || s.text.toLowerCase().includes(q) || Object.values(s.translation).some((v) => v.toLowerCase().includes(q))))
  })
  const selected = $derived(project.sentences.find((s) => s.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.sentences.flatMap((s) => s.tags))].sort())
  const abbrMap = $derived(new Map(project.abbreviations.map((a) => [a.abbr, pickText(a.name, glossLangs)])))
  const stats = $derived(mode === 'stats' && langId ? corpusStats(project, langId) : null)
  const templates = $derived(project.settings.exportTemplates.filter((x) => x.kind === 'gloss'))

  $effect(() => {
    inspectorTitle = mode === 'abbr' ? t('corpus.abbr.title') : mode === 'stats' ? t('corpus.modes.stats') : selected ? t('corpus.sentence') : t('corpus.title')
  })
  $effect(() => {
    const id = ui.takePending('sentence')
    if (id) {
      selectedId = id
      mode = 'entries'
    }
  })
  // 选中尚未分析的句子时自动分析
  $effect(() => {
    if (selected && selected.tokens.length === 0 && selected.text.trim()) {
      analyzeSentence(project, selected)
      projectState.touch()
    }
  })

  function touch(): void {
    projectState.touch()
  }
  function add(): void {
    if (!langId) return
    const s = createSentence(langId)
    project.sentences.unshift(s)
    selectedId = s.id
    mode = 'entries'
    touch()
    queueMicrotask(() => document.getElementById('st-text')?.focus())
  }
  function remove(s: Sentence): void {
    const idx = project.sentences.indexOf(s)
    const snap = $state.snapshot(s) as Sentence
    project.sentences.splice(idx, 1)
    if (selectedId === s.id) selectedId = null
    touch()
    ui.toast(t('corpus.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.sentences.splice(Math.min(idx, project.sentences.length), 0, snap)
          selectedId = snap.id
          touch()
        }
      }
    })
  }
  function analyze(force = false): void {
    if (!selected) return
    analyzeSentence(project, selected, { force })
    touch()
  }
  function confirmAll(): void {
    if (!selected || fading) return
    const id = selected.id
    for (const tk of selected.tokens) if (tk.analyses[tk.chosen]) tk.confirmed = true
    touch()
    // 渐隐编辑器 → 取消选中 → 列表卡片长出第三行 gloss 并闪一下
    fading = true
    setTimeout(() => {
      fading = false
      selectedId = null
      justConfirmed = id
      setTimeout(() => (justConfirmed = null), 1200)
    }, 420)
  }
  function fullyConfirmed(s: Sentence): boolean {
    const c = coverage(s)
    return c.total > 0 && c.confirmed === c.total
  }
  function lexemeOf(tk: Token): Id | null {
    return tk.analyses[tk.chosen]?.lexemeId ?? null
  }
  function hoverWord(e: MouseEvent, tk: Token): void {
    const id = lexemeOf(tk)
    if (!id) return
    wordHover.show(id, (e.currentTarget as HTMLElement).getBoundingClientRect())
  }
  function clickWord(e: MouseEvent, tk: Token): void {
    const id = lexemeOf(tk)
    if (!id) return
    e.stopPropagation()
    const lx = project.lexemes.find((l) => l.id === id)
    ui.pendingLexemeId = id
    if (lx) projectState.currentLanguageId = lx.languageId
    wordHover.hide(true)
    ui.go('lexicon')
  }
  function analysisLabel(a: Analysis): string {
    return a.morphs.map((m) => m.form).join('-') + ' → ' + a.morphs.map((m) => m.gloss).join('-')
  }
  /** 手工修改语素切分 / gloss：写成自定义分析放到首位并选中 */
  function customize(tk: Token, morphsText: string, glossText: string): void {
    const forms = morphsText.split(/[-=]/).map((x) => x.trim())
    const glosses = glossText.split(/[-=]/).map((x) => x.trim())
    const n = Math.max(forms.length, glosses.length, 1)
    const cur = tk.analyses[tk.chosen]
    const morphs = Array.from({ length: n }, (_, i) => ({ form: forms[i] ?? '', gloss: glosses[i] ?? '', morphemeId: cur?.morphs[i]?.morphemeId ?? null }))
    const custom: Analysis = { lexemeId: cur?.lexemeId ?? null, slot: cur?.slot ?? null, morphs }
    if (cur && tk.analyses.length && (tk as Token & { customIdx?: number }).customIdx === tk.chosen) tk.analyses[tk.chosen] = custom
    else {
      tk.analyses.unshift(custom)
      tk.chosen = 0
      ;(tk as Token & { customIdx?: number }).customIdx = 0
    }
    touch()
  }
  function morphsOf(tk: Token): string {
    const a = tk.analyses[tk.chosen]
    return a ? a.morphs.map((m) => m.form).join('-') : tk.surface
  }
  function glossOf(tk: Token): string {
    const a = tk.analyses[tk.chosen]
    return a ? a.morphs.map((m) => m.gloss).join('-') : ''
  }
  function unresolved(tk: Token): boolean {
    const a = tk.analyses[tk.chosen]
    return !a || a.morphs.some((m) => m.gloss === '?' || !m.gloss)
  }
  function glossTitle(g: string): string {
    return g
      .split(/[-=.]/)
      .map((part) => (abbrMap.has(part) ? `${part} = ${abbrMap.get(part)}` : ''))
      .filter(Boolean)
      .join('\n')
  }
  function newLexeme(tk: Token): void {
    if (!selected) return
    const l = createLexeme(selected.languageId, tk.surface)
    project.lexemes.push(l)
    const a: Analysis = { lexemeId: l.id, slot: null, morphs: [{ form: tk.surface, gloss: tk.surface, morphemeId: null }] }
    tk.analyses.unshift(a)
    tk.chosen = 0
    tk.confirmed = true
    touch()
    ui.toast(t('corpus.lexemeCreated', { w: tk.surface }))
  }
  function refreshCandidates(tk: Token): void {
    if (!selected) return
    const idx = buildIndex(project, selected.languageId)
    const fresh = analyzeToken(idx, tk.surface, project.settings.morphemeBoundaries)
    const cur = tk.analyses[tk.chosen]
    tk.analyses = cur ? [cur, ...fresh.filter((a) => JSON.stringify(a) !== JSON.stringify(cur))] : fresh
    tk.chosen = 0
    touch()
  }

  const exportText = $derived.by(() => {
    if (!selected) return ''
    const il = interlinear(project, selected)
    switch (exportFormat) {
      case 'leipzig':
        return toLeipzig(il)
      case 'markdown':
        return toMarkdown(il)
      case 'html':
        return toHtml(il)
      case 'latex':
        return toLatex(il)
      case 'template': {
        const tp = templates.find((x) => x.id === templateId) ?? templates[0]
        return tp ? renderTemplate(tp.template, il, selected) : ''
      }
    }
  })
  async function copyExport(): Promise<void> {
    await navigator.clipboard.writeText(exportText)
    ui.toast(t('soundChanges.copied'))
  }
  function saveTemplate(): void {
    if (!templateDraft.name.trim()) return
    const existing = project.settings.exportTemplates.find((x) => x.kind === 'gloss' && x.name === templateDraft.name.trim())
    if (existing) existing.template = templateDraft.template
    else project.settings.exportTemplates.push({ id: newId(), name: templateDraft.name.trim(), kind: 'gloss', template: templateDraft.template })
    templateId = (existing ?? project.settings.exportTemplates[project.settings.exportTemplates.length - 1]).id
    touch()
  }
  function loadTemplate(id: string): void {
    templateId = id
    const tp = templates.find((x) => x.id === id)
    if (tp) templateDraft = { name: tp.name, template: tp.template }
  }
  function deleteTemplate(): void {
    const i = project.settings.exportTemplates.findIndex((x) => x.id === templateId)
    if (i >= 0) project.settings.exportTemplates.splice(i, 1)
    templateId = ''
    touch()
  }
  function fillLeipzig(): void {
    let n = 0
    for (const a of LEIPZIG) {
      if (!project.abbreviations.some((x) => x.abbr === a.abbr)) {
        project.abbreviations.push({ abbr: a.abbr, name: { zh: a.zh, en: a.en } })
        n++
      }
    }
    touch()
    ui.toast(t('corpus.abbr.filled', { n }))
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('corpus.title')}</h1>
    <div class="seg">
      <button class:active={mode === 'entries'} onclick={() => (mode = 'entries')}>{t('corpus.modes.entries')}</button>
      <button class:active={mode === 'stats'} onclick={() => (mode = 'stats')}>{t('corpus.modes.stats')}</button>
      <button class:active={mode === 'abbr'} onclick={() => (mode = 'abbr')}>{t('corpus.modes.abbreviations')}</button>
    </div>
    <span class="grow"></span>
    {#if mode === 'entries'}
      <input class="input search" placeholder={t('corpus.search')} bind:value={query} />
      <button class="btn primary" onclick={add}><Plus size={16} />{t('corpus.add')}</button>
    {/if}
  </div>

  {#if !language}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if mode === 'stats'}
    <div class="scroll stats">
      {#if stats}
        <p class="small muted">{t('corpus.stats.coverage', { pct: Math.round(stats.lexemeCoverage * 100) })}</p>
        <div class="two-col">
          <section>
            <h3>{t('corpus.stats.frequency')}</h3>
            <table class="tbl"><tbody>{#each stats.frequency.slice(0, 200) as f (f.surface)}<tr><td class="data">{f.surface}</td><td class="muted">{f.n}</td></tr>{/each}</tbody></table>
          </section>
          <section>
            <h3>{t('corpus.stats.unresolved')} <span class="badge">{stats.unresolved.length}</span></h3>
            <div class="chips">{#each stats.unresolved as w (w)}<span class="chip data warn">{w}</span>{/each}</div>
          </section>
        </div>
      {/if}
    </div>
  {:else if mode === 'abbr'}
    <div class="scroll">
      <div class="row">
        <p class="small muted grow">{t('corpus.abbr.hint')}</p>
        <button class="btn sm" onclick={fillLeipzig}><Sparkles size={14} />{t('corpus.abbr.fillLeipzig')}</button>
        <button class="btn primary sm" onclick={() => { project.abbreviations.unshift({ abbr: '', name: {} }); touch() }}><Plus size={14} />{t('corpus.abbr.add')}</button>
      </div>
      <table class="tbl abbr">
        <thead><tr><th>{t('corpus.abbr.abbr')}</th>{#each glossLangs as g (g)}<th>{t('corpus.abbr.name')} ({g})</th>{/each}<th></th></tr></thead>
        <tbody>
          {#each project.abbreviations as a, i (i)}
            <tr>
              <td><input class="input mono" bind:value={a.abbr} oninput={touch} /></td>
              {#each glossLangs as g (g)}<td><input class="input" bind:value={a.name[g]} oninput={touch} /></td>{/each}
              <td><button class="btn ghost icon sm" onclick={() => { project.abbreviations.splice(i, 1); touch() }}><X size={14} /></button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="scroll">
      <Hint id="corpus" text={t('corpus.hint')} />
      {#if selected}
        {@const s = selected}
        <div class="card editor" class:fading>
          <div class="row toolbar">
            <span class="small muted grow">{t('corpus.coverageLabel', { confirmed: coverage(s).confirmed, total: coverage(s).total })}</span>
            <button class="btn sm" onclick={() => analyze(false)}><Wand2 size={14} />{t('corpus.analyze')}</button>
            <button class="btn ghost sm" onclick={() => analyze(true)}><RefreshCw size={14} />{t('corpus.reanalyze')}</button>
            <button class="btn ghost sm" onclick={confirmAll}><CheckCheck size={14} />{t('corpus.confirmAll')}</button>
          </div>
          {#each language.scripts as sc (sc.id)}
            {@const st = renderScript(language, sc, s.text)}
            {#if st}<div class="scr" style={fontCss(sc)} dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'} title={sc.name}>{st}</div>{/if}
          {/each}
          {#if s.tokens.length === 0}
            <p class="small muted">{t('corpus.noTokens')}</p>
          {:else}
            <div class="il">
              {#each s.tokens as tk, i (i)}
                <div class="tok" class:bad={unresolved(tk)} class:ok={tk.confirmed}>
                  <div class="surface data" class:link={!!lexemeOf(tk)} role="link" tabindex="-1" onmouseenter={(e) => hoverWord(e, tk)} onmouseleave={() => wordHover.hide()} onclick={(e) => clickWord(e, tk)} onkeydown={() => {}}>{tk.surface}</div>
                  <input class="input data m" value={morphsOf(tk)} title={t('corpus.morphs')} onchange={(e) => customize(tk, (e.currentTarget as HTMLInputElement).value, glossOf(tk))} />
                  <input class="input g" value={glossOf(tk)} title={glossTitle(glossOf(tk)) || t('corpus.gloss')} onchange={(e) => customize(tk, morphsOf(tk), (e.currentTarget as HTMLInputElement).value)} />
                  <div class="row ctl">
                    <select class="select cand" value={String(tk.chosen)} title={t('corpus.candidates')} onchange={(e) => { tk.chosen = Number((e.currentTarget as HTMLSelectElement).value); touch() }}>
                      {#each tk.analyses as a, j (j)}<option value={String(j)}>{analysisLabel(a)}</option>{/each}
                      {#if tk.analyses.length === 0}<option value="0">—</option>{/if}
                    </select>
                    <button class="btn ghost icon sm" class:on={tk.confirmed} title={t('corpus.confirmed')} onclick={() => { tk.confirmed = !tk.confirmed; touch() }}><Check size={14} /></button>
                    <button class="btn ghost icon sm" title={t('corpus.refresh')} onclick={() => refreshCandidates(tk)}><RefreshCw size={12} /></button>
                    {#if unresolved(tk)}<button class="btn ghost sm new" onclick={() => newLexeme(tk)}><Plus size={12} />{t('corpus.newLexeme')}</button>{/if}
                  </div>
                </div>
              {/each}
            </div>
            <p class="tr">{interlinear(project, s).translation}</p>
          {/if}
        </div>
      {/if}

      {#if list.length === 0}
        <p class="muted">{t('corpus.empty')}</p>
      {:else}
        <div class="list">
          {#each list as s (s.id)}
            {@const c = coverage(s)}
            {@const done = fullyConfirmed(s)}
            <div class="card item" class:sel={selectedId === s.id} use:flashOn={justConfirmed === s.id} role="button" tabindex="0" onclick={() => (selectedId = s.id)} onkeydown={(e) => e.key === 'Enter' && (selectedId = s.id)}>
              {#each language.scripts as sc (sc.id)}
                {@const st = renderScript(language, sc, s.text)}
                {#if st}<div class="scr" style={fontCss(sc)} dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'} title={sc.name}>{st}</div>{/if}
              {/each}
              <div class="row">
                {#if s.tokens.length}
                  <span class="data text grow words">
                    {#each s.tokens as tk, i (i)}<span class="w" class:link={!!lexemeOf(tk)} role="link" tabindex="-1" onmouseenter={(e) => hoverWord(e, tk)} onmouseleave={() => wordHover.hide()} onclick={(e) => clickWord(e, tk)} onkeydown={() => {}}>{tk.surface}</span>{/each}
                  </span>
                {:else}
                  <span class="data text grow">{s.text || '—'}</span>
                {/if}
                <span class="badge" class:accent={done}>{c.confirmed}/{c.total}</span>
              </div>
              {#if done}
                {@const il = interlinear(project, s)}
                <div class="gl" class:slide-in={justConfirmed === s.id}>
                  {#each il.words as w, i (i)}<span class="gw"><span class="data m">{w.morphs}</span><span class="g">{w.gloss}</span></span>{/each}
                </div>
              {/if}
              <div class="small muted">{pickText(s.translation, glossLangs)}</div>
              {#if s.tags.length || s.source}<div class="small muted">{[s.source, ...s.tags].filter(Boolean).join(' · ')}</div>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if selected && mode === 'entries'}
  {@const s = selected}
  <Portal>
    <div class="field">
      <label for="st-text">{t('corpus.text')}</label>
      <textarea id="st-text" class="textarea data" rows="2" bind:value={s.text} onchange={() => { analyzeSentence(project, s); touch() }}></textarea>
    </div>
    <div class="field">
      <span class="small muted">{t('corpus.translation')}</span>
      <LocalizedInput bind:value={s.translation} languages={glossLangs} onchange={touch} />
    </div>
    {#if language && language.orthographies.length > 1}
      <div class="field">
        <span class="small muted">{t('corpus.orthoTexts')}</span>
        {#each language.orthographies.filter((o) => !o.isPrimary) as o (o.id)}
          <div class="row kv"><span class="small oname">{o.name}</span><input class="input data" bind:value={s.orthoTexts[o.id]} oninput={touch} /></div>
        {/each}
      </div>
    {/if}
    <div class="row two">
      <div class="field grow"><label for="st-src">{t('corpus.source')}</label><input id="st-src" class="input" bind:value={s.source} oninput={touch} /></div>
    </div>
    <div class="field">
      <span class="small muted">{t('common.tags')}</span>
      <TagInput bind:tags={s.tags} suggestions={allTags} onchange={touch} />
    </div>
    <div class="field">
      <div class="row"><span class="small muted grow">{t('corpus.extraLines')}</span><button class="btn ghost sm" onclick={() => { s.extraLines.push({ label: '', text: '' }); touch() }}><Plus size={14} />{t('corpus.addLine')}</button></div>
      {#each s.extraLines as line, i (i)}
        <div class="row kv">
          <input class="input lbl" placeholder={t('corpus.lineLabel')} bind:value={line.label} oninput={touch} />
          <input class="input grow" bind:value={line.text} oninput={touch} />
          <button class="btn ghost icon sm" onclick={() => { s.extraLines.splice(i, 1); touch() }}><X size={14} /></button>
        </div>
      {/each}
    </div>
    <div class="field">
      <label for="st-notes">{t('common.notes')}</label>
      <textarea id="st-notes" class="textarea" bind:value={s.notes} oninput={touch}></textarea>
    </div>

    <div class="field export">
      <div class="row">
        <span class="small muted grow">{t('corpus.export')}</span>
        <select class="select fmt" bind:value={exportFormat}>
          {#each ['leipzig', 'markdown', 'html', 'latex', 'template'] as f (f)}<option value={f}>{t(`corpus.formats.${f}`)}</option>{/each}
        </select>
        <button class="btn ghost icon sm" title={t('corpus.copy')} onclick={copyExport}><Copy size={14} /></button>
      </div>
      {#if exportFormat === 'template'}
        <div class="row kv">
          <select class="select" value={templateId} onchange={(e) => loadTemplate((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">{t('corpus.templateNew')}</option>
            {#each templates as tp (tp.id)}<option value={tp.id}>{tp.name}</option>{/each}
          </select>
          {#if templateId}<button class="btn ghost icon sm danger" onclick={deleteTemplate}><Trash2 size={14} /></button>{/if}
        </div>
        <input class="input" placeholder={t('corpus.templateName')} bind:value={templateDraft.name} />
        <textarea class="textarea mono" rows="4" placeholder={t('corpus.templateHint')} bind:value={templateDraft.template}></textarea>
        <button class="btn sm self-start" onclick={saveTemplate}><Check size={14} />{t('corpus.saveTemplate')}</button>
      {/if}
      <pre class="out">{exportText}</pre>
    </div>
    <button class="btn sm danger" onclick={() => remove(s)}><Trash2 size={14} />{t('common.delete')}</button>
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
    gap: 10px;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button {
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
    width: 220px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
  }
  .editor {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .il {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: flex-start;
  }
  .tok {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 140px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }
  .tok.bad {
    border-color: var(--warn);
    background: var(--warn-soft);
  }
  .tok.ok {
    border-color: var(--accent);
  }
  .surface {
    font-size: 17px;
    font-weight: 500;
    font-family: var(--font-corpus-text);
  }
  .tok .m,
  .words,
  .gw .m {
    font-family: var(--font-corpus-text);
  }
  .tok .input {
    padding: 2px 6px;
    font-size: 13px;
  }
  .tok .g {
    font-family: var(--font-gloss);
    font-size: 12px;
  }
  .ctl {
    gap: 2px;
  }
  .cand {
    flex: 1;
    min-width: 0;
    padding: 2px 20px 2px 6px;
    font-size: 11px;
    background-position: right 4px center;
  }
  .btn.on {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .new {
    font-size: 11px;
    padding: 2px 6px;
    color: var(--accent-text);
  }
  .tr,
  .item .muted {
    font-family: var(--font-corpus-tr);
  }
  .tr {
    color: var(--text-2);
    font-style: italic;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item:hover {
    border-color: var(--border-strong);
  }
  .item.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .text {
    font-size: 15px;
  }
  .scr {
    font-size: 22px;
    line-height: 1.3;
  }
  .words {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.45em;
  }
  .link {
    cursor: pointer;
    border-radius: 3px;
    transition: background-color 0.15s;
  }
  .link:hover {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .gl {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin: 2px 0;
  }
  .gw {
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }
  .gw .m {
    font-size: 13px;
  }
  .gw .g {
    font-family: var(--font-gloss);
    font-size: 11px;
    color: var(--text-2);
  }
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .tbl {
    border-collapse: collapse;
    font-size: 13px;
    width: 100%;
  }
  .tbl td,
  .tbl th {
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  .tbl.abbr td .input {
    padding: 3px 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 13px;
  }
  .chip.warn {
    border-color: var(--warn);
    background: var(--warn-soft);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .kv {
    gap: 6px;
    margin-bottom: 4px;
  }
  .lbl {
    width: 90px;
    flex: none;
  }
  .oname {
    width: 90px;
    flex: none;
    color: var(--text-2);
  }
  .two {
    gap: 8px;
  }
  .fmt {
    width: 150px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .out {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 220px;
    overflow: auto;
  }
  .self-start {
    align-self: flex-start;
  }
  .export {
    margin-top: 6px;
  }
  h3 {
    margin-bottom: 6px;
  }
</style>
