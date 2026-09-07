<script lang="ts">
  /**
   * 规则列表视图：把规则文本投影成可逐条编辑的条目。
   * 文本仍是唯一真值；这里的每个改动都换算成对某一行的替换 / 插入 / 删除。
   */
  import { t } from '$lib/i18n/index.svelte'
  import {
    formatRule,
    formatMarker,
    formatClassLine,
    formatReplacementLine,
    parseClassLine,
    parseReplacementLine,
    type ParsedLine,
    type ParsedRule,
    type RuleDraft,
    type RuleProgram
  } from '$lib/engine/sca'
  import { Plus, Trash2, ChevronUp, ChevronDown, Copy, Check, X, AlertTriangle } from '@lucide/svelte'

  let {
    text = $bindable(''),
    program,
    hits = new Map<number, number>(),
    onchange
  }: { text?: string; program: RuleProgram | null; hits?: Map<number, number>; onchange?: () => void } = $props()

  // ───── 文本行操作 ─────
  function lines(): string[] {
    return text.split('\n')
  }
  function commit(ls: string[]): void {
    text = ls.join('\n')
    onchange?.()
  }
  function replaceLine(line: number, s: string): void {
    const ls = lines()
    ls[line - 1] = s
    commit(ls)
  }
  function insertAfter(line: number, s: string): number {
    const ls = lines()
    if (line <= 0 && ls.length === 1 && ls[0] === '') {
      ls[0] = s
      commit(ls)
      return 1
    }
    ls.splice(line, 0, s)
    commit(ls)
    return line + 1
  }
  function deleteLine(line: number): void {
    const ls = lines()
    ls.splice(line - 1, 1)
    commit(ls.length ? ls : [''])
  }
  function swapLines(a: number, b: number): void {
    const ls = lines()
    if (a < 1 || b < 1 || a > ls.length || b > ls.length) return
    ;[ls[a - 1], ls[b - 1]] = [ls[b - 1], ls[a - 1]]
    commit(ls)
  }

  // ───── 分组：按阶段标记切段 ─────
  interface Section {
    marker: (ParsedLine & { kind: 'marker' }) | null
    items: ParsedLine[]
    /** 段落最后一行的行号（用于「在此段末尾添加」） */
    endLine: number
  }
  const sections = $derived.by((): Section[] => {
    if (!program) return []
    const out: Section[] = []
    let cur: Section = { marker: null, items: [], endLine: 0 }
    for (const l of program.lines) {
      if (l.kind === 'class' || l.kind === 'replacement') continue
      if (l.kind === 'marker') {
        if (cur.marker || cur.items.some((x) => x.kind !== 'blank')) out.push(cur)
        cur = { marker: l, items: [], endLine: l.line }
        continue
      }
      cur.items.push(l)
      cur.endLine = l.line
    }
    out.push(cur)
    return out
  })
  const classLines = $derived(program ? program.lines.filter((l) => l.kind === 'class') : [])
  const digraphLines = $derived(program ? program.lines.filter((l) => l.kind === 'replacement') : [])
  const classNames = $derived(program ? [...program.classes.keys()] : [])

  // ───── 编辑状态 ─────
  let editingLine = $state<number | null>(null)
  let draft = $state<RuleDraft>({ target: '', replacement: '', contexts: [{ left: '', right: '' }], exception: null, comment: '' })
  let lastField = $state<HTMLInputElement | null>(null)
  let editingMarker = $state<number | null>(null)
  let markerDraft = $state('')
  let editingClass = $state<number | null | 'new'>(null)
  let classDraft = $state({ name: '', members: '' })
  let editingDigraph = $state<number | null | 'new'>(null)
  let digraphDraft = $state({ from: '', to: '' })

  function openRule(r: ParsedRule): void {
    editingLine = r.line
    draft = {
      target: r.target,
      replacement: r.replacement,
      contexts: r.contexts.map((c) => ({ ...c })),
      exception: r.exception ? { ...r.exception } : null,
      comment: r.comment
    }
    if (draft.contexts.length === 0) draft.contexts = [{ left: '', right: '' }]
  }
  function saveRule(): void {
    if (editingLine == null) return
    replaceLine(editingLine, formatRule($state.snapshot(draft) as RuleDraft))
    editingLine = null
  }
  function addRuleAfter(line: number): void {
    const l = insertAfter(line, ' > ')
    editingLine = l
    draft = { target: '', replacement: '', contexts: [{ left: '', right: '' }], exception: null, comment: '' }
  }
  function addStageAfter(line: number): void {
    const l = insertAfter(line, formatMarker(t('soundChanges.unnamedStage')))
    editingMarker = l
    markerDraft = t('soundChanges.unnamedStage')
  }
  function removeRule(line: number): void {
    if (editingLine === line) editingLine = null
    deleteLine(line)
  }
  function duplicateRule(r: ParsedRule): void {
    insertAfter(r.line, r.raw)
  }
  function moveRule(line: number, dir: -1 | 1): void {
    const ls = lines()
    const other = line + dir
    if (other < 1 || other > ls.length) return
    swapLines(line, other)
    if (editingLine === line) editingLine = other
  }
  function insertClassName(name: string): void {
    const token = name.length === 1 ? name : `{${name}}`
    const el = lastField
    if (!el) return
    const s = el.selectionStart ?? el.value.length
    const e = el.selectionEnd ?? s
    const v = el.value
    el.value = v.slice(0, s) + token + v.slice(e)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
    el.setSelectionRange(s + token.length, s + token.length)
  }

  function describeCtx(r: ParsedRule): string {
    const ctx = r.contexts.filter((c) => c.left || c.right)
    if (!ctx.length) return t('soundChanges.anyEnv')
    return ctx.map((c) => `${c.left}_${c.right}`).join(' , ')
  }

  // 音类
  function openClass(line: number | 'new'): void {
    editingClass = line
    if (line === 'new') classDraft = { name: '', members: '' }
    else {
      const raw = lines()[line - 1]
      const p = parseClassLine(raw)
      classDraft = { name: p?.name ?? '', members: p ? (p.members.some((m) => Array.from(m).length > 1) ? p.members.join(' ') : p.members.join('')) : '' }
    }
  }
  function saveClass(): void {
    const name = classDraft.name.trim().replace(/^\{|\}$/g, '')
    if (!name) return
    const membersRaw = classDraft.members.trim()
    const members = /[\s,]/.test(membersRaw) ? membersRaw.split(/[\s,]+/).filter(Boolean) : Array.from(membersRaw)
    const s = formatClassLine(name, members)
    if (editingClass === 'new') {
      const last = classLines[classLines.length - 1]
      insertAfter(last ? last.line : 0, s)
    } else if (editingClass != null) replaceLine(editingClass, s)
    editingClass = null
  }
  function openDigraph(line: number | 'new'): void {
    editingDigraph = line
    if (line === 'new') digraphDraft = { from: '', to: '' }
    else {
      const p = parseReplacementLine(lines()[line - 1])
      digraphDraft = { from: p?.from ?? '', to: p?.to ?? '' }
    }
  }
  function saveDigraph(): void {
    if (!digraphDraft.from.trim() || !digraphDraft.to.trim()) return
    const s = formatReplacementLine(digraphDraft.from, digraphDraft.to)
    if (editingDigraph === 'new') {
      const last = digraphLines[digraphLines.length - 1] ?? classLines[classLines.length - 1]
      insertAfter(last ? last.line : 0, s)
    } else if (editingDigraph != null) replaceLine(editingDigraph, s)
    editingDigraph = null
  }

  const lastLine = $derived(program ? Math.max(0, ...program.lines.map((l) => l.line)) : 0)
</script>

{#snippet ruleForm(line: number)}
  <div class="form card">
    <div class="form-row">
      <label class="f grow">
        <span>{t('soundChanges.target')}</span>
        <input class="input data" bind:value={draft.target} onfocus={(e) => (lastField = e.currentTarget)} />
      </label>
      <span class="arrow">→</span>
      <label class="f grow">
        <span>{t('soundChanges.replacement')}</span>
        <input class="input data" bind:value={draft.replacement} onfocus={(e) => (lastField = e.currentTarget)} />
      </label>
      <div class="quick">
        <button class="btn sm" onclick={() => (draft.replacement = '')}>{t('soundChanges.quickDelete')}</button>
        <button class="btn sm" onclick={() => (draft.replacement = '\\')}>{t('soundChanges.quickMetathesis')}</button>
        <button class="btn sm" onclick={() => (draft.replacement = '2')}>{t('soundChanges.quickGeminate')}</button>
      </div>
    </div>

    <div class="form-block">
      <span class="small muted">{t('soundChanges.contexts')}</span>
      {#each draft.contexts as c, i (i)}
        <div class="ctx-row">
          <input class="input data" placeholder={t('soundChanges.leftEnv')} bind:value={c.left} onfocus={(e) => (lastField = e.currentTarget)} />
          <span class="mono">_</span>
          <input class="input data" placeholder={t('soundChanges.rightEnv')} bind:value={c.right} onfocus={(e) => (lastField = e.currentTarget)} />
          <button class="btn ghost icon sm" title={t('common.delete')} disabled={draft.contexts.length === 1} onclick={() => draft.contexts.splice(i, 1)}><X size={14} /></button>
        </div>
      {/each}
      <div class="row">
        <button class="btn ghost sm" onclick={() => draft.contexts.push({ left: '', right: '' })}><Plus size={14} />{t('soundChanges.addContext')}</button>
        {#if !draft.exception}
          <button class="btn ghost sm" onclick={() => (draft.exception = { left: '', right: '' })}><Plus size={14} />{t('soundChanges.addException')}</button>
        {/if}
      </div>
    </div>

    {#if draft.exception}
      <div class="form-block">
        <span class="small muted">{t('soundChanges.exception')}</span>
        <div class="ctx-row">
          <input class="input data" placeholder={t('soundChanges.leftEnv')} bind:value={draft.exception.left} onfocus={(e) => (lastField = e.currentTarget)} />
          <span class="mono">_</span>
          <input class="input data" placeholder={t('soundChanges.rightEnv')} bind:value={draft.exception.right} onfocus={(e) => (lastField = e.currentTarget)} />
          <button class="btn ghost icon sm" title={t('common.delete')} onclick={() => (draft.exception = null)}><X size={14} /></button>
        </div>
      </div>
    {/if}

    <label class="f">
      <span>{t('soundChanges.comment')}</span>
      <input class="input" bind:value={draft.comment} />
    </label>

    {#if classNames.length}
      <div class="chips">
        <span class="small muted">{t('soundChanges.insertClass')}</span>
        {#each classNames as c (c)}
          <button class="chip" onclick={() => insertClassName(c.replace(/^\{|\}$/g, ''))}>{c}</button>
        {/each}
      </div>
    {/if}
    <p class="small muted">{t('soundChanges.formHint')}</p>
    <div class="row">
      <button class="btn primary sm" onclick={saveRule}><Check size={14} />{t('soundChanges.done')}</button>
      <button class="btn ghost sm" onclick={() => (editingLine = null)}>{t('common.cancel')}</button>
      <span class="grow"></span>
      <button class="btn ghost sm danger" onclick={() => removeRule(line)}><Trash2 size={14} />{t('soundChanges.deleteRule')}</button>
    </div>
  </div>
{/snippet}

<div class="list">
  <!-- 音类与多合字母 -->
  <section class="decl">
    <div class="row decl-head">
      <h3 class="grow">{t('soundChanges.classes')}</h3>
      <button class="btn ghost sm" onclick={() => openClass('new')}><Plus size={14} />{t('soundChanges.addClass')}</button>
    </div>
    <div class="chips wrap">
      {#each classLines as l (l.line)}
        {@const p = parseClassLine(l.raw)}
        {#if p}
          <button class="chip cls" class:active={editingClass === l.line} onclick={() => openClass(l.line)}>
            <b>{p.name.length === 1 ? p.name : `{${p.name}}`}</b><span class="data">{p.members.some((m) => Array.from(m).length > 1) ? p.members.join(' ') : p.members.join('')}</span>
          </button>
        {/if}
      {/each}
    </div>
    {#if editingClass !== null}
      <div class="mini-form card">
        <label class="f"><span>{t('soundChanges.className')}</span><input class="input" bind:value={classDraft.name} /><span class="hint">{t('soundChanges.classNameHint')}</span></label>
        <label class="f grow"><span>{t('soundChanges.classMembers')}</span><input class="input data" bind:value={classDraft.members} /><span class="hint">{t('soundChanges.membersHint')}</span></label>
        <div class="row">
          <button class="btn primary sm" onclick={saveClass}><Check size={14} />{t('soundChanges.done')}</button>
          <button class="btn ghost sm" onclick={() => (editingClass = null)}>{t('common.cancel')}</button>
          {#if typeof editingClass === 'number'}
            {@const l = editingClass}
            <button class="btn ghost sm danger" onclick={() => { deleteLine(l); editingClass = null }}><Trash2 size={14} />{t('common.delete')}</button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="row decl-head">
      <h3 class="grow">{t('soundChanges.digraphs')}</h3>
      <button class="btn ghost sm" onclick={() => openDigraph('new')}><Plus size={14} />{t('soundChanges.addDigraph')}</button>
    </div>
    <div class="chips wrap">
      {#each digraphLines as l (l.line)}
        {@const p = parseReplacementLine(l.raw)}
        {#if p}
          <button class="chip cls" class:active={editingDigraph === l.line} onclick={() => openDigraph(l.line)}><span class="data">{p.from}</span><span class="muted">→</span><span class="data">{p.to}</span></button>
        {/if}
      {/each}
    </div>
    {#if editingDigraph !== null}
      <div class="mini-form card">
        <label class="f"><span>{t('soundChanges.digraphFrom')}</span><input class="input data" bind:value={digraphDraft.from} /></label>
        <label class="f"><span>{t('soundChanges.digraphTo')}</span><input class="input data" bind:value={digraphDraft.to} /></label>
        <div class="row">
          <button class="btn primary sm" onclick={saveDigraph}><Check size={14} />{t('soundChanges.done')}</button>
          <button class="btn ghost sm" onclick={() => (editingDigraph = null)}>{t('common.cancel')}</button>
          {#if typeof editingDigraph === 'number'}
            {@const l = editingDigraph}
            <button class="btn ghost sm danger" onclick={() => { deleteLine(l); editingDigraph = null }}><Trash2 size={14} />{t('common.delete')}</button>
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <!-- 规则分段 -->
  {#each sections as sec, si (sec.marker?.line ?? -si)}
    <section class="stage">
      {#if sec.marker}
        {@const m = sec.marker}
        <div class="stage-head row">
          {#if editingMarker === m.line}
            <input
              class="input stage-input"
              bind:value={markerDraft}
              onkeydown={(e) => {
                if (e.key === 'Enter') { replaceLine(m.line, formatMarker(markerDraft, m.comment)); editingMarker = null }
                if (e.key === 'Escape') editingMarker = null
              }}
            />
            <button class="btn primary sm" onclick={() => { replaceLine(m.line, formatMarker(markerDraft, m.comment)); editingMarker = null }}><Check size={14} /></button>
            <button class="btn ghost icon sm" onclick={() => (editingMarker = null)}><X size={14} /></button>
            <button class="btn ghost icon sm danger" title={t('common.delete')} onclick={() => { deleteLine(m.line); editingMarker = null }}><Trash2 size={14} /></button>
          {:else}
            <button class="stage-name" onclick={() => { editingMarker = m.line; markerDraft = m.name }}>-* {m.name}</button>
            {#if m.comment}<span class="small muted">{m.comment}</span>{/if}
          {/if}
          <span class="grow"></span>
          <button class="btn ghost icon sm" title={t('soundChanges.moveUp')} onclick={() => moveRule(m.line, -1)}><ChevronUp size={14} /></button>
          <button class="btn ghost icon sm" title={t('soundChanges.moveDown')} onclick={() => moveRule(m.line, 1)}><ChevronDown size={14} /></button>
        </div>
      {:else if sections.length > 1}
        <div class="stage-head row"><span class="small muted">{t('soundChanges.beforeFirstStage')}</span></div>
      {/if}

      {#each sec.items as item (item.line)}
        {#if item.kind === 'rule'}
          {@const r = item}
          {#if editingLine === r.line}
            {@render ruleForm(r.line)}
          {:else}
            <div class="rule row" role="button" tabindex="0" onclick={() => openRule(r)} onkeydown={(e) => e.key === 'Enter' && openRule(r)}>
              <span class="num mono">{r.line}</span>
              <span class="rule-body data">
                {#if !r.target && !r.replacement}
                  <span class="muted">{t('soundChanges.emptyRule')}</span>
                {:else}
                  <span class="tg">{r.target || '∅'}</span>
                  <span class="muted">→</span>
                  <span class="rp">{r.replacement === '\\' ? '⇄' : r.replacement === '2' ? '×2' : r.replacement || '∅'}</span>
                  <span class="muted">/</span>
                  <span class="ctx">{describeCtx(r)}</span>
                  {#if r.exception}<span class="muted">−</span><span class="exc">{r.exception.left}_{r.exception.right}</span>{/if}
                {/if}
              </span>
              {#if r.comment}<span class="small muted comment">{r.comment}</span>{/if}
              {#if hits.get(r.line)}<span class="badge accent">{t('soundChanges.hits', { n: hits.get(r.line)! })}</span>{/if}
              <span class="actions">
                <button class="btn ghost icon sm" title={t('soundChanges.moveUp')} onclick={(e) => { e.stopPropagation(); moveRule(r.line, -1) }}><ChevronUp size={14} /></button>
                <button class="btn ghost icon sm" title={t('soundChanges.moveDown')} onclick={(e) => { e.stopPropagation(); moveRule(r.line, 1) }}><ChevronDown size={14} /></button>
                <button class="btn ghost icon sm" title={t('soundChanges.duplicate')} onclick={(e) => { e.stopPropagation(); duplicateRule(r) }}><Copy size={14} /></button>
                <button class="btn ghost icon sm danger" title={t('soundChanges.deleteRule')} onclick={(e) => { e.stopPropagation(); removeRule(r.line) }}><Trash2 size={14} /></button>
              </span>
            </div>
          {/if}
        {:else if item.kind === 'error'}
          <div class="rule err row">
            <span class="num mono">{item.line}</span>
            <AlertTriangle size={14} />
            <input class="input data grow" value={item.raw} onchange={(e) => replaceLine(item.line, (e.currentTarget as HTMLInputElement).value)} />
            <span class="small">{item.message}</span>
            <button class="btn ghost icon sm danger" onclick={() => removeRule(item.line)}><Trash2 size={14} /></button>
          </div>
        {:else if item.kind === 'comment'}
          <div class="note row"><span class="num mono">{item.line}</span><span class="small muted">{item.raw.replace(/^\s*[;#]\s?/, '')}</span></div>
        {/if}
      {/each}

      <div class="row stage-foot">
        <button class="btn ghost sm" onclick={() => addRuleAfter(sec.endLine)}><Plus size={14} />{sec.marker ? t('soundChanges.addRuleHere') : t('soundChanges.addRule')}</button>
        <button class="btn ghost sm" onclick={() => addStageAfter(sec.endLine)}><Plus size={14} />{t('soundChanges.addStage')}</button>
      </div>
    </section>
  {/each}

  {#if program && program.steps.length === 0}
    <p class="muted">{t('soundChanges.noRules')}</p>
    {#if sections.length === 0}
      <div class="row">
        <button class="btn primary sm" onclick={() => addRuleAfter(lastLine)}><Plus size={14} />{t('soundChanges.addRule')}</button>
        <button class="btn sm" onclick={() => addStageAfter(lastLine)}><Plus size={14} />{t('soundChanges.addStage')}</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 40px;
  }
  .decl {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .decl-head {
    margin-top: 4px;
  }
  .chips {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .chips.wrap {
    flex-wrap: wrap;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
    cursor: pointer;
    font-size: 13px;
  }
  .chip:hover,
  .chip.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .chip.cls b {
    color: #8b5cf6;
    font-family: var(--font-mono);
  }
  .mini-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 12px;
    align-items: flex-end;
  }
  .mini-form .row {
    width: 100%;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 160px;
  }
  .f > span {
    font-size: 12px;
    color: var(--text-2);
  }
  .f .hint {
    font-size: 11px;
    color: var(--text-3);
  }
  .stage {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .stage-head {
    padding: 6px 0 2px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }
  .stage-name {
    border: 0;
    background: none;
    padding: 2px 6px;
    margin-left: -6px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--accent-text);
    cursor: text;
  }
  .stage-name:hover {
    background: var(--bg-hover);
  }
  .stage-input {
    width: 240px;
  }
  .rule {
    gap: 10px;
    padding: 2px 8px;
    min-height: 30px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .rule .actions .btn {
    padding: 2px;
  }
  .rule:hover {
    background: var(--bg-hover);
  }
  .rule.err {
    color: var(--danger);
    cursor: default;
  }
  .num {
    width: 28px;
    text-align: right;
    color: var(--text-3);
    font-size: 11px;
    flex: none;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .rule-body {
    display: inline-flex;
    gap: 8px;
    align-items: baseline;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
  }
  .tg {
    color: #b45309;
  }
  .rp {
    color: #0f766e;
  }
  .ctx {
    color: #1d4ed8;
  }
  .exc {
    color: var(--danger);
  }
  :global([data-theme='dark']) .tg {
    color: #fbbf24;
  }
  :global([data-theme='dark']) .rp {
    color: #5eead4;
  }
  :global([data-theme='dark']) .ctx {
    color: #93c5fd;
  }
  .comment {
    max-width: 30%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: none;
    gap: 0;
  }
  .rule:hover .actions {
    display: inline-flex;
  }
  .note {
    gap: 10px;
    padding: 2px 8px;
  }
  .stage-foot {
    padding: 2px 0 0 28px;
  }
  .form {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-color: var(--accent);
  }
  .form-row {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .arrow {
    padding-bottom: 8px;
    color: var(--text-3);
    font-size: 18px;
  }
  .quick {
    display: flex;
    gap: 4px;
    padding-bottom: 1px;
  }
  .form-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ctx-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .ctx-row .input {
    max-width: 220px;
  }
</style>
