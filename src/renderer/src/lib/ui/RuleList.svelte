<script lang="ts">
  import { matchText, parseQuery } from '$lib/core/query'
  /**
   * 规则列表视图：把规则文本投影成可逐条编辑的卡片。
   * 文本仍是唯一真值；这里的每个改动都换算成对某一行的替换 / 插入 / 删除。
   * 单击选中（联动测试台预览），双击或铅笔进入编辑。
   */
  import { t } from '$lib/i18n/index.svelte'
  import HelpDot from './HelpDot.svelte'
  import StressRuleEditor from './StressRuleEditor.svelte'
  import { describeClause, describeSplit } from './stressSummary'
  import { sortable } from './sortable.svelte'
  import { fiveRows } from './fiveRows'
  import {
    formatRule,
    formatMarker,
    formatClassLine,
    formatReplacementLine,
    formatFeatureLine,
    formatStressLine,
    parseClassLine,
    parseReplacementLine,
    parseStressText,
    ruleOrdinals,
    runSingleRule,
    sampleForRule,
    diffSpan,
    type FeatureLine,
    type ParsedLine,
    type ParsedRule,
    type RuleDraft,
    type RuleProgram,
    type StressLine
  } from '$lib/engine/sca'
  import {
    Plus,
    Trash2,
    ChevronUp,
    ChevronDown,
    Copy,
    Check,
    X,
    AlertTriangle,
    Pencil,
    RotateCcw,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    Link2
  } from '@lucide/svelte'
  import { sectionCollapsed, setSectionsCollapsed, toggleSection } from './section.svelte'

  let {
    text = $bindable(''),
    program,
    query = '',
    hits = new Map<number, number>(),
    selectedLine = $bindable<number | null>(null),
    onchange,
    foldKey = '',
    onopenref
  }: {
    text?: string
    program: RuleProgram | null
    /** 顶栏搜索：只显示原文含它的行 */
    query?: string
    hits?: Map<number, number>
    selectedLine?: number | null
    onchange?: () => void
    /** 各阶段收起状态记在本机时用的名字（规则集 id 这类），不同的规则列表各记各的 */
    foldKey?: string
    /** 点「打开」跳到被引用的那套音变（`-@` 引用行上才有） */
    onopenref?: (name: string) => void
  } = $props()

  const ordinals = $derived(program ? ruleOrdinals(program) : new Map<number, number>())

  /** 阶段收起记在本机：按这个列表的 foldKey 和阶段名记 */
  const stageFoldId = (name: string): string => `rules.stage:${foldKey}:${name}`

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
  // ───── 拖动：同一段里换位置，也可以拖到别的阶段 ─────
  let dragLine = $state<number | null>(null)
  let dropStage = $state<number | null>(null)
  /** 松手会插到哪一行前面：拖动时那儿空出一行，用户一眼看得到落点 */
  let dropBefore = $state<number | null>(null)
  /** 把某一行挪到 before 那一行前面（before 比末行大就是放到最后） */
  function moveLineBefore(from: number, before: number): void {
    const ls = lines()
    if (from < 1 || from > ls.length || from === before) return
    const [s] = ls.splice(from - 1, 1)
    const at = from < before ? before - 2 : before - 1
    ls.splice(Math.max(0, Math.min(ls.length, at)), 0, s)
    commit(ls)
  }
  function dropOnLine(before: number): void {
    const from = dragLine
    dragLine = null
    dropStage = null
    dropBefore = null
    if (from !== null) moveLineBefore(from, before)
  }
  /** 现在这个占位空白把它后面的内容推下去了多少（自身高度 + 上下外边距 + 栏间距） */
  function gapShift(host: HTMLElement): number {
    const el = document.querySelector<HTMLElement>('.drop-gap')
    if (!el) return 0
    const cs = getComputedStyle(el)
    const my = (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
    return el.getBoundingClientRect().height + my + (parseFloat(getComputedStyle(host).rowGap) || 0)
  }
  /**
   * 按指针的高度算落点，不看鼠标底下压着哪一行：占位空白一出现就把下面的行推开，
   * 再照「鼠标在哪一行上」判断的话，推开与没推开会互相触发，看着就是一直在抖。
   * 所以量位置时先把被推开的那段高度补回去，算出来的落点就跟占位在不在无关了。
   */
  function dropTargetLine(host: HTMLElement, y: number, end: number): number {
    const shift = gapShift(host)
    for (const el of host.querySelectorAll<HTMLElement>('[data-line]')) {
      const line = Number(el.dataset.line)
      if (!Number.isFinite(line)) continue
      const b = el.getBoundingClientRect()
      const top = dropBefore !== null && dropBefore <= line ? b.top - shift : b.top
      if (y < top + b.height / 2) return line
    }
    return end
  }
  /** 松手真能挪位置才空出一行：落回自己原来的地方等于没动，不必让人以为会变 */
  function gapAt(line: number): boolean {
    return dragLine !== null && dropBefore === line && line !== dragLine && line !== dragLine + 1
  }

  /** 圆框拖到另一个圆框上：这一行挪到那一行的位置（往后拖放在它后面，往前拖放在它前面） */
  function moveLineOnto(from: number, onto: number): void {
    if (from === onto) return
    moveLineBefore(from, from < onto ? onto + 1 : onto)
  }
  const chipGroup = `rulechips-${Math.random().toString(36).slice(2, 8)}`

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
    endLine: number
  }
  const pq = $derived(parseQuery(query))
  const needle = $derived(pq.terms.length > 0)
  const lineHit = (raw: string): boolean => matchText(pq, [raw])
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
      if (lineHit(l.raw)) cur.items.push(l)
      cur.endLine = l.line
    }
    out.push(cur)
    // 搜索时空的阶段就别占地方了
    return needle ? out.filter((s) => s.items.length || (s.marker && lineHit(s.marker.raw))) : out
  })
  /** 有名字的阶段各自的收起 id；两个以上才给「全部收起 / 全部展开」 */
  const stageFoldIds = $derived(
    sections.filter((sec) => sec.marker).map((sec) => stageFoldId(sec.marker!.name))
  )
  const allStagesFolded = $derived(
    stageFoldIds.length > 0 && stageFoldIds.every((id) => sectionCollapsed(id))
  )
  const classLines = $derived(
    program ? program.lines.filter((l) => l.kind === 'class' && lineHit(l.raw)) : []
  )
  const digraphLines = $derived(
    program ? program.lines.filter((l) => l.kind === 'replacement' && lineHit(l.raw)) : []
  )
  const classNames = $derived(program ? [...new Set(program.classes.keys())] : [])
  /** 规则里定义过的特征（插入时写成 [+名]、[-名]） */
  const featureNames = $derived(
    program
      ? [
          ...new Set(
            program.lines.filter((l): l is FeatureLine => l.kind === 'feature').map((l) => l.name)
          )
        ]
      : []
  )

  // ───── 编辑状态 ─────
  let editingLine = $state<number | null>(null)
  let draft = $state<RuleDraft>({
    target: '',
    replacement: '',
    contexts: [{ left: '', right: '' }],
    exceptions: [],
    comment: ''
  })
  let lastField = $state<HTMLInputElement | null>(null)
  let editingMarker = $state<number | null>(null)
  let markerDraft = $state('')
  let editingClass = $state<number | null | 'new'>(null)
  let classDraft = $state({ name: '', members: '' })
  let editingDigraph = $state<number | null | 'new'>(null)
  let digraphDraft = $state({ from: '', to: '' })
  let editingStress = $state<number | null>(null)
  let stressDraft = $state({ level: 'primary' as 'primary' | 'secondary', text: '', comment: '' })
  let editingFeature = $state<number | null>(null)
  let featureDraft = $state({ sign: '+' as '+' | '-', name: '', members: '', comment: '' })
  let replayKey = $state(0)

  function openRule(r: ParsedRule): void {
    editingLine = r.line
    selectedLine = r.line
    draft = {
      target: r.target,
      replacement: r.replacement,
      contexts: r.contexts.map((c) => ({ ...c })),
      exceptions: r.exceptions.map((c) => ({ ...c })),
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
    selectedLine = l
    draft = {
      target: '',
      replacement: '',
      contexts: [{ left: '', right: '' }],
      exceptions: [],
      comment: ''
    }
  }
  function addStageAfter(line: number): void {
    const l = insertAfter(line, formatMarker(t('soundChanges.unnamedStage')))
    editingMarker = l
    markerDraft = t('soundChanges.unnamedStage')
  }
  function openStress(st: StressLine): void {
    editingStress = st.line
    stressDraft = { level: st.level, text: st.text, comment: st.comment }
  }
  function addStressAfter(line: number): void {
    const text = '-2 , -3'
    const l = insertAfter(line, formatStressLine('primary', parseStressText(text)))
    editingStress = l
    stressDraft = { level: 'primary', text, comment: '' }
  }
  function saveStress(): void {
    if (editingStress == null) return
    const d = parseStressText(stressDraft.text)
    replaceLine(editingStress, formatStressLine(stressDraft.level, d, stressDraft.comment))
    editingStress = null
  }
  function openFeature(f: FeatureLine): void {
    editingFeature = f.line
    featureDraft = { sign: f.sign, name: f.name, members: f.members.join(' '), comment: f.comment }
  }
  function addFeatureAfter(line: number): void {
    const name = t('stressRule.newFeature')
    const l = insertAfter(line, formatFeatureLine('+', name, []))
    editingFeature = l
    featureDraft = { sign: '+', name, members: '', comment: '' }
  }
  function saveFeature(): void {
    if (editingFeature == null || !featureDraft.name.trim()) return
    replaceLine(
      editingFeature,
      formatFeatureLine(
        featureDraft.sign,
        featureDraft.name.replace(/[\s[\]+=-]/g, ''),
        featureDraft.members.split(/[\s,，、]+/),
        featureDraft.comment
      )
    )
    editingFeature = null
  }
  function removeRule(line: number): void {
    if (editingLine === line) editingLine = null
    if (selectedLine === line) selectedLine = null
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
    if (selectedLine === line) selectedLine = other
  }
  function insertClassName(name: string): void {
    insertToken(name.length === 1 ? name : `{${name}}`)
  }
  function insertToken(token: string): void {
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

  /** 选中规则的示例与变化 */
  const preview = $derived.by(() => {
    if (!program || selectedLine == null) return null
    const r = program.steps.find((s) => s.kind === 'rule' && s.line === selectedLine) as
      ParsedRule | undefined
    if (!r) return null
    const sample = sampleForRule(program, r)
    if (!sample) return { sample, after: sample, diff: null }
    const after = runSingleRule(program, r, sample)
    return { sample, after, diff: after === sample ? null : diffSpan(sample, after) }
  })

  // 音类
  function openClass(line: number | 'new'): void {
    editingClass = line
    if (line === 'new') classDraft = { name: '', members: '' }
    else {
      const p = parseClassLine(lines()[line - 1])
      classDraft = {
        name: p?.name ?? '',
        members: p
          ? p.members.some((m) => Array.from(m).length > 1)
            ? p.members.join(' ')
            : p.members.join('')
          : ''
      }
    }
  }
  function saveClass(): void {
    const name = classDraft.name.trim().replace(/^\{|\}$/g, '')
    if (!name) return
    const membersRaw = classDraft.members.trim()
    const members = /[\s,]/.test(membersRaw)
      ? membersRaw.split(/[\s,]+/).filter(Boolean)
      : Array.from(membersRaw)
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

{#snippet insertChips()}
  <div class="chips insert" use:fiveRows>
    <span class="small muted">{t('soundChanges.insertClass')}</span>
    <button class="chip sym" title={t('stressRule.sigmaTip')} onclick={() => insertToken('σ')}
      >σ</button
    >
    <button class="chip sym" title={t('stressRule.stressTip')} onclick={() => insertToken('ˈ')}
      >ˈ</button
    >
    {#each featureNames as f (f)}
      <button class="chip feat" onclick={() => insertToken(`[+${f}]`)}>[+{f}]</button>
      <button class="chip feat" onclick={() => insertToken(`[-${f}]`)}>[-{f}]</button>
    {/each}
    {#each classNames as c (c)}
      <button class="chip" onclick={() => insertClassName(c.replace(/^\{|\}$/g, ''))}>{c}</button>
    {/each}
  </div>
{/snippet}

{#snippet stressForm(line: number)}
  <div class="form card">
    <div class="form-row">
      <label class="f">
        <span>{t('stressRule.level')}</span>
        <select class="select" bind:value={stressDraft.level}>
          <option value="primary">{t('stressRule.primary')}</option>
          <option value="secondary">{t('stressRule.secondary')}</option>
        </select>
      </label>
      <HelpDot tip={t('stressRule.hint')} />
    </div>
    <StressRuleEditor
      value={stressDraft.text}
      onchange={(text) => (stressDraft.text = text)}
      onfocusfield={(el) => (lastField = el)}
    />
    <label class="f">
      <span>{t('soundChanges.comment')}</span>
      <input class="input" bind:value={stressDraft.comment} />
    </label>
    {@render insertChips()}
    <div class="row">
      <button class="btn primary sm" onclick={saveStress}
        ><Check size={14} />{t('soundChanges.done')}</button
      >
      <button class="btn ghost sm" onclick={() => (editingStress = null)}
        >{t('common.cancel')}</button
      >
      <span class="grow"></span>
      <button
        class="btn ghost sm danger"
        onclick={() => {
          editingStress = null
          removeRule(line)
        }}><Trash2 size={14} />{t('soundChanges.deleteRule')}</button
      >
    </div>
  </div>
{/snippet}

{#snippet featureForm(line: number)}
  <div class="form card">
    <div class="form-row">
      <label class="f">
        <span>{t('stressRule.featureSign')}</span>
        <select class="select" bind:value={featureDraft.sign}>
          <option value="+">{t('stressRule.featurePlus')}</option>
          <option value="-">{t('stressRule.featureMinus')}</option>
        </select>
      </label>
      <label class="f">
        <span>{t('stressRule.featureName')}</span>
        <input class="input" bind:value={featureDraft.name} />
      </label>
      <label class="f grow">
        <span>{t('stressRule.featureMembers')}</span>
        <input class="input data" bind:value={featureDraft.members} placeholder="ph th kh" />
      </label>
      <HelpDot tip={t('stressRule.featureHint')} />
    </div>
    <label class="f">
      <span>{t('soundChanges.comment')}</span>
      <input class="input" bind:value={featureDraft.comment} />
    </label>
    <div class="row">
      <button class="btn primary sm" onclick={saveFeature}
        ><Check size={14} />{t('soundChanges.done')}</button
      >
      <button class="btn ghost sm" onclick={() => (editingFeature = null)}
        >{t('common.cancel')}</button
      >
      <span class="grow"></span>
      <button
        class="btn ghost sm danger"
        onclick={() => {
          editingFeature = null
          removeRule(line)
        }}><Trash2 size={14} />{t('soundChanges.deleteRule')}</button
      >
    </div>
  </div>
{/snippet}

{#snippet ruleForm(line: number)}
  <div class="form card">
    <div class="form-row">
      <label class="f grow">
        <span>{t('soundChanges.target')}</span>
        <input
          class="input data"
          bind:value={draft.target}
          onfocus={(e) => (lastField = e.currentTarget)}
        />
      </label>
      <span class="arrow">→</span>
      <label class="f grow">
        <span>{t('soundChanges.replacement')}</span>
        <input
          class="input data"
          bind:value={draft.replacement}
          onfocus={(e) => (lastField = e.currentTarget)}
        />
      </label>
      <div class="quick">
        <button class="btn sm" onclick={() => (draft.replacement = '')}
          >{t('soundChanges.quickDelete')}</button
        >
        <button class="btn sm" onclick={() => (draft.replacement = '\\')}
          >{t('soundChanges.quickMetathesis')}</button
        >
        <button class="btn sm" onclick={() => (draft.replacement = '2')}
          >{t('soundChanges.quickGeminate')}</button
        >
      </div>
    </div>

    <div class="form-block">
      <span class="small muted">{t('soundChanges.contexts')}</span>
      {#each draft.contexts as c, i (i)}
        <div class="ctx-row">
          <input
            class="input data"
            placeholder={t('soundChanges.leftEnv')}
            bind:value={c.left}
            onfocus={(e) => (lastField = e.currentTarget)}
          />
          <span class="mono">_</span>
          <input
            class="input data"
            placeholder={t('soundChanges.rightEnv')}
            bind:value={c.right}
            onfocus={(e) => (lastField = e.currentTarget)}
          />
          <button
            class="btn ghost icon sm"
            title={t('common.delete')}
            disabled={draft.contexts.length === 1}
            onclick={() => draft.contexts.splice(i, 1)}><X size={14} /></button
          >
        </div>
      {/each}
      <div class="row">
        <button class="btn ghost sm" onclick={() => draft.contexts.push({ left: '', right: '' })}
          ><Plus size={14} />{t('soundChanges.addContext')}</button
        >
        <button class="btn ghost sm" onclick={() => draft.exceptions.push({ left: '', right: '' })}
          ><Plus size={14} />{t('soundChanges.addException')}</button
        >
      </div>
    </div>

    {#if draft.exceptions.length}
      <div class="form-block">
        <span class="small muted">{t('soundChanges.exception')}</span>
        {#each draft.exceptions as ex, i (i)}
          <div class="ctx-row">
            <input
              class="input data"
              placeholder={t('soundChanges.leftEnv')}
              bind:value={ex.left}
              onfocus={(e) => (lastField = e.currentTarget)}
            />
            <span class="mono">_</span>
            <input
              class="input data"
              placeholder={t('soundChanges.rightEnv')}
              bind:value={ex.right}
              onfocus={(e) => (lastField = e.currentTarget)}
            />
            <button
              class="btn ghost icon sm"
              title={t('common.delete')}
              onclick={() => draft.exceptions.splice(i, 1)}><X size={14} /></button
            >
          </div>
        {/each}
      </div>
    {/if}

    <label class="f">
      <span>{t('soundChanges.comment')}</span>
      <input class="input" bind:value={draft.comment} />
    </label>

    {@render insertChips()}
    <div class="row">
      <button class="btn primary sm" onclick={saveRule}
        ><Check size={14} />{t('soundChanges.done')}</button
      >
      <button class="btn ghost sm" onclick={() => (editingLine = null)}>{t('common.cancel')}</button
      >
      <HelpDot tip={t('soundChanges.formHint')} />
      <span class="grow"></span>
      <button class="btn ghost sm danger" onclick={() => removeRule(line)}
        ><Trash2 size={14} />{t('soundChanges.deleteRule')}</button
      >
    </div>
  </div>
{/snippet}

<div class="list">
  <!-- 音类与多合字母 -->
  <section class="decl">
    <div class="row decl-head">
      <h3 class="grow">{t('soundChanges.classes')}</h3>
      <button class="btn ghost sm" onclick={() => openClass('new')}
        ><Plus size={14} />{t('soundChanges.addClass')}</button
      >
    </div>
    <div class="chips wrap" use:fiveRows>
      {#each classLines as l, li (l.line)}
        {@const p = parseClassLine(l.raw)}
        {#if p}
          <button
            class="chip cls"
            class:active={editingClass === l.line}
            {...sortable(`${chipGroup}-classes`, li, (from, to) =>
              moveLineOnto(classLines[from].line, classLines[to].line)
            )}
            onclick={() => openClass(l.line)}
          >
            <b>{p.name.length === 1 ? p.name : `{${p.name}}`}</b><span class="data"
              >{p.members.some((m) => Array.from(m).length > 1)
                ? p.members.join(' ')
                : p.members.join('')}</span
            >
          </button>
        {/if}
      {/each}
    </div>
    {#if editingClass !== null}
      <div class="mini-form card">
        <label class="f"
          ><span>{t('soundChanges.className')}</span><input
            class="input"
            bind:value={classDraft.name}
          /><span class="hint">{t('soundChanges.classNameHint')}</span></label
        >
        <label class="f grow"
          ><span>{t('soundChanges.classMembers')}</span><input
            class="input data"
            bind:value={classDraft.members}
          /><span class="hint">{t('soundChanges.membersHint')}</span></label
        >
        <div class="row">
          <button class="btn primary sm" onclick={saveClass}
            ><Check size={14} />{t('soundChanges.done')}</button
          >
          <button class="btn ghost sm" onclick={() => (editingClass = null)}
            >{t('common.cancel')}</button
          >
          {#if typeof editingClass === 'number'}
            {@const l = editingClass}
            <button
              class="btn ghost sm danger"
              onclick={() => {
                deleteLine(l)
                editingClass = null
              }}><Trash2 size={14} />{t('common.delete')}</button
            >
          {/if}
        </div>
      </div>
    {/if}

    <div class="row decl-head">
      <h3 class="grow">{t('soundChanges.digraphs')}</h3>
      <button class="btn ghost sm" onclick={() => openDigraph('new')}
        ><Plus size={14} />{t('soundChanges.addDigraph')}</button
      >
    </div>
    <div class="chips wrap" use:fiveRows>
      {#each digraphLines as l, li (l.line)}
        {@const p = parseReplacementLine(l.raw)}
        {#if p}
          <button
            class="chip cls"
            class:active={editingDigraph === l.line}
            {...sortable(`${chipGroup}-digraphs`, li, (from, to) =>
              moveLineOnto(digraphLines[from].line, digraphLines[to].line)
            )}
            onclick={() => openDigraph(l.line)}
            ><span class="data">{p.from}</span><span class="muted">→</span><span class="data"
              >{p.to}</span
            ></button
          >
        {/if}
      {/each}
    </div>
    {#if editingDigraph !== null}
      <div class="mini-form card">
        <label class="f"
          ><span>{t('soundChanges.digraphFrom')}</span><input
            class="input data"
            bind:value={digraphDraft.from}
          /></label
        >
        <label class="f"
          ><span>{t('soundChanges.digraphTo')}</span><input
            class="input data"
            bind:value={digraphDraft.to}
          /></label
        >
        <div class="row">
          <button class="btn primary sm" onclick={saveDigraph}
            ><Check size={14} />{t('soundChanges.done')}</button
          >
          <button class="btn ghost sm" onclick={() => (editingDigraph = null)}
            >{t('common.cancel')}</button
          >
          {#if typeof editingDigraph === 'number'}
            {@const l = editingDigraph}
            <button
              class="btn ghost sm danger"
              onclick={() => {
                deleteLine(l)
                editingDigraph = null
              }}><Trash2 size={14} />{t('common.delete')}</button
            >
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <!-- 规则分段 -->
  {#if stageFoldIds.length > 1}
    <div class="row stage-tools">
      <span class="grow"></span>
      <button
        class="btn ghost sm"
        onclick={() => setSectionsCollapsed(stageFoldIds, !allStagesFolded)}
        >{#if allStagesFolded}<ChevronsUpDown size={14} />{t(
            'soundChanges.expandStages'
          )}{:else}<ChevronsDownUp size={14} />{t('soundChanges.collapseStages')}{/if}</button
      >
    </div>
  {/if}
  {#each sections as sec, si (sec.marker?.line ?? -si)}
    {@const folded = !!sec.marker && sectionCollapsed(stageFoldId(sec.marker.name))}
    <!-- 整段都能接住拖过来的规则：放在这一段的末尾 -->
    <section
      class="stage"
      class:drop={dropStage === si && dragLine !== null}
      role="list"
      ondragover={(e) => {
        if (dragLine === null) return
        e.preventDefault()
        dropStage = si
        dropBefore = dropTargetLine(e.currentTarget as HTMLElement, e.clientY, sec.endLine + 1)
      }}
      ondragleave={(e) => {
        // 真的移出这一段才清掉：在段里的行之间移动时 dragleave 也会冒上来
        const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const out =
          e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom
        if (out && dropStage === si) {
          dropStage = null
          dropBefore = null
        }
      }}
      ondrop={(e) => {
        e.preventDefault()
        dropOnLine(dropBefore ?? sec.endLine + 1)
      }}
    >
      {#if sec.marker}
        {@const m = sec.marker}
        <div class="stage-head row">
          {#if editingMarker === m.line}
            <input
              class="input stage-input"
              bind:value={markerDraft}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  replaceLine(m.line, formatMarker(markerDraft, m.comment))
                  editingMarker = null
                }
                if (e.key === 'Escape') editingMarker = null
              }}
            />
            <button
              class="btn primary sm"
              onclick={() => {
                replaceLine(m.line, formatMarker(markerDraft, m.comment))
                editingMarker = null
              }}><Check size={14} /></button
            >
            <button class="btn ghost icon sm" onclick={() => (editingMarker = null)}
              ><X size={14} /></button
            >
            <button
              class="btn ghost icon sm danger"
              title={t('common.delete')}
              onclick={() => {
                deleteLine(m.line)
                editingMarker = null
              }}><Trash2 size={14} /></button
            >
          {:else}
            <button
              class="stage-fold"
              title={folded ? t('common.expand') : t('common.collapse')}
              aria-expanded={!folded}
              onclick={() => toggleSection(stageFoldId(m.name))}
              >{#if folded}<ChevronRight size={15} />{:else}<ChevronDown size={15} />{/if}</button
            >
            <button
              class="stage-name"
              onclick={() => {
                editingMarker = m.line
                markerDraft = m.name
              }}>-* {m.name}</button
            >
            {#if m.comment}<span class="small muted">{m.comment}</span>{/if}
            {#if folded}<button
                class="small muted stage-count"
                onclick={() => toggleSection(stageFoldId(m.name))}
                >{t('soundChanges.stageItems', { n: sec.items.length })}</button
              >{/if}
          {/if}
          <span class="grow"></span>
          <button
            class="btn ghost icon sm"
            title={t('soundChanges.moveUp')}
            onclick={() => moveRule(m.line, -1)}><ChevronUp size={14} /></button
          >
          <button
            class="btn ghost icon sm"
            title={t('soundChanges.moveDown')}
            onclick={() => moveRule(m.line, 1)}><ChevronDown size={14} /></button
          >
        </div>
      {:else if sections.length > 1}
        <div class="stage-head row">
          <span class="small muted">{t('soundChanges.beforeFirstStage')}</span>
        </div>
      {/if}

      {#each folded ? [] : sec.items as item (item.line)}
        {#if gapAt(item.line)}
          <div class="drop-gap"></div>
        {/if}
        {#if item.kind === 'rule'}
          {@const r = item}
          {#if editingLine === r.line}
            {@render ruleForm(r.line)}
          {:else}
            <div
              class="rule card"
              data-line={r.line}
              class:selected={selectedLine === r.line}
              class:dragging={dragLine === r.line}
              role="button"
              tabindex="0"
              draggable="true"
              ondragstart={(e) => {
                dragLine = r.line
                e.dataTransfer?.setData('text/plain', String(r.line))
              }}
              ondragend={() => {
                dragLine = null
                dropStage = null
                dropBefore = null
              }}
              onclick={() => (selectedLine = selectedLine === r.line ? null : r.line)}
              ondblclick={() => openRule(r)}
              onkeydown={(e) => e.key === 'Enter' && openRule(r)}
            >
              <div class="rule-main row">
                <span class="num">{ordinals.get(r.line) ?? ''}</span>
                <span class="rule-body data">
                  {#if !r.target && !r.replacement}
                    <span class="muted">{t('soundChanges.emptyRule')}</span>
                  {:else}
                    <span class="tg">{r.target || '∅'}</span>
                    <span class="muted">→</span>
                    <span class="rp"
                      >{r.replacement === '\\'
                        ? '⇄'
                        : r.replacement === '2'
                          ? '×2'
                          : r.replacement || '∅'}</span
                    >
                    <span class="muted">/</span>
                    <span class="ctx">{describeCtx(r)}</span>
                    {#if r.exceptions.length}<span class="muted">−</span><span class="exc"
                        >{r.exceptions.map((c) => `${c.left}_${c.right}`).join(' , ')}</span
                      >{/if}
                  {/if}
                </span>
                {#if r.comment}<span class="small muted comment">{r.comment}</span>{/if}
                {#if hits.get(r.line)}<span class="badge accent"
                    >{t('soundChanges.hits', { n: hits.get(r.line)! })}</span
                  >{/if}
                <span class="actions">
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.editRule')}
                    onclick={(e) => {
                      e.stopPropagation()
                      openRule(r)
                    }}><Pencil size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.moveUp')}
                    onclick={(e) => {
                      e.stopPropagation()
                      moveRule(r.line, -1)
                    }}><ChevronUp size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.moveDown')}
                    onclick={(e) => {
                      e.stopPropagation()
                      moveRule(r.line, 1)
                    }}><ChevronDown size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.duplicate')}
                    onclick={(e) => {
                      e.stopPropagation()
                      duplicateRule(r)
                    }}><Copy size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm danger"
                    title={t('soundChanges.deleteRule')}
                    onclick={(e) => {
                      e.stopPropagation()
                      removeRule(r.line)
                    }}><Trash2 size={14} /></button
                  >
                </span>
              </div>
              {#if selectedLine === r.line && preview}
                <div class="preview row">
                  <span class="small muted">{t('soundChanges.sample')}</span>
                  {#if !preview.sample}
                    <span class="small muted">{t('soundChanges.noPreview')}</span>
                  {:else if !preview.diff}
                    <span class="data">{preview.sample}</span>
                    <span class="small muted">{t('soundChanges.noPreview')}</span>
                  {:else}
                    {#key replayKey}
                      <span class="morph data">
                        <span>{preview.diff.prefix}</span>
                        <span class="diff-seg">
                          <span class="old">{preview.diff.beforeMid || '∅'}</span>
                          <span class="new">{preview.diff.afterMid || '∅'}</span>
                        </span>
                        <span>{preview.diff.suffix}</span>
                      </span>
                    {/key}
                    <span class="muted">→</span>
                    <span class="data result">{preview.after}</span>
                    <button
                      class="btn ghost icon sm"
                      title={t('soundChanges.replay')}
                      onclick={(e) => {
                        e.stopPropagation()
                        replayKey++
                      }}><RotateCcw size={13} /></button
                    >
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {:else if item.kind === 'stress'}
          {@const st = item}
          {#if editingStress === st.line}
            {@render stressForm(st.line)}
          {:else}
            <div
              class="rule card special"
              data-line={st.line}
              class:dragging={dragLine === st.line}
              role="button"
              tabindex="0"
              draggable="true"
              ondragstart={(e) => {
                dragLine = st.line
                e.dataTransfer?.setData('text/plain', String(st.line))
              }}
              ondragend={() => {
                dragLine = null
                dropStage = null
                dropBefore = null
              }}
              ondblclick={() => openStress(st)}
              onkeydown={(e) => e.key === 'Enter' && openStress(st)}
            >
              <div class="rule-main row">
                <span class="kind stress" title={t('stressRule.title')}
                  >{st.level === 'secondary' ? 'ˌ' : 'ˈ'}</span
                >
                <span class="rule-body">
                  <b class="small"
                    >{t(st.level === 'secondary' ? 'stressRule.secondary' : 'stressRule.title')}</b
                  >
                  {#if st.special}<span class="clause-chip">{t('stressRule.sumSpecial')}</span>{/if}
                  {#each st.clauses as c, ci (ci)}
                    {#if ci || st.special}<span class="muted small"
                        >{t('stressRule.otherwise')}</span
                      >{/if}
                    <span class="clause-chip data">{describeClause(c)}</span>
                  {:else}
                    {#if !st.special}<span class="muted small">{t('stressRule.none')}</span>{/if}
                  {/each}
                  {#if st.split}<span class="muted small">{describeSplit(st.split, st.head)}</span
                    >{/if}
                </span>
                {#if st.comment}<span class="small muted comment">{st.comment}</span>{/if}
                {#if hits.get(st.line)}<span class="badge accent"
                    >{t('soundChanges.hits', { n: hits.get(st.line)! })}</span
                  >{/if}
                <span class="actions">
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.editRule')}
                    onclick={(e) => {
                      e.stopPropagation()
                      openStress(st)
                    }}><Pencil size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.moveUp')}
                    onclick={(e) => {
                      e.stopPropagation()
                      moveRule(st.line, -1)
                    }}><ChevronUp size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.moveDown')}
                    onclick={(e) => {
                      e.stopPropagation()
                      moveRule(st.line, 1)
                    }}><ChevronDown size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm danger"
                    title={t('soundChanges.deleteRule')}
                    onclick={(e) => {
                      e.stopPropagation()
                      removeRule(st.line)
                    }}><Trash2 size={14} /></button
                  >
                </span>
              </div>
            </div>
          {/if}
        {:else if item.kind === 'feature'}
          {@const f = item}
          {#if editingFeature === f.line}
            {@render featureForm(f.line)}
          {:else}
            <div
              class="rule card special"
              data-line={f.line}
              class:dragging={dragLine === f.line}
              role="button"
              tabindex="0"
              draggable="true"
              ondragstart={(e) => {
                dragLine = f.line
                e.dataTransfer?.setData('text/plain', String(f.line))
              }}
              ondragend={() => {
                dragLine = null
                dropStage = null
                dropBefore = null
              }}
              ondblclick={() => openFeature(f)}
              onkeydown={(e) => e.key === 'Enter' && openFeature(f)}
            >
              <div class="rule-main row">
                <span class="kind feat" title={t('stressRule.feature')}>±</span>
                <span class="rule-body data">
                  <b class="feat-name">[{f.sign}{f.name}]</b>
                  <span class="muted">=</span>
                  <span>{f.members.join(' ') || '∅'}</span>
                </span>
                {#if f.comment}<span class="small muted comment">{f.comment}</span>{/if}
                <span class="actions">
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.editRule')}
                    onclick={(e) => {
                      e.stopPropagation()
                      openFeature(f)
                    }}><Pencil size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.moveUp')}
                    onclick={(e) => {
                      e.stopPropagation()
                      moveRule(f.line, -1)
                    }}><ChevronUp size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('soundChanges.moveDown')}
                    onclick={(e) => {
                      e.stopPropagation()
                      moveRule(f.line, 1)
                    }}><ChevronDown size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm danger"
                    title={t('soundChanges.deleteRule')}
                    onclick={(e) => {
                      e.stopPropagation()
                      removeRule(f.line)
                    }}><Trash2 size={14} /></button
                  >
                </span>
              </div>
            </div>
          {/if}
        {:else if item.kind === 'error'}
          <div class="rule card err row">
            <span class="num mono">{item.line}</span>
            <AlertTriangle size={14} />
            <input
              class="input data grow"
              value={item.raw}
              onchange={(e) => replaceLine(item.line, (e.currentTarget as HTMLInputElement).value)}
            />
            <span class="small">{item.message}</span>
            <button class="btn ghost icon sm danger" onclick={() => removeRule(item.line)}
              ><Trash2 size={14} /></button
            >
          </div>
        {:else if item.kind === 'comment'}
          <div class="note row" data-line={item.line}>
            <span class="small muted">{item.raw.replace(/^\s*[;#]\s?/, '')}</span>
          </div>
        {:else if item.kind === 'include'}
          <!-- 引用另一套音变的一段：这里只占一行，跑的时候把那一段原样跑一遍 -->
          <div class="rule card special row" class:err={!!item.error} data-line={item.line}>
            <span class="num mono">{item.line}</span>
            {#if item.error}<AlertTriangle size={14} />{:else}<Link2 size={14} />{/if}
            <span class="grow"
              >{item.error
                ? item.error
                : item.program
                  ? t('soundChanges.include.label', {
                      name: item.ref,
                      range: item.markers.length
                        ? item.markers[0] +
                          (item.markers.length > 1
                            ? ' → ' + item.markers[item.markers.length - 1]
                            : '')
                        : t('soundChanges.include.whole')
                    })
                  : t('soundChanges.include.missing', { name: item.ref })}</span
            >
            {#if item.program && onopenref}
              <button class="btn ghost sm" onclick={() => onopenref?.(item.ref)}
                >{t('soundChanges.include.open')}</button
              >
            {/if}
            <input
              class="input data"
              value={item.raw}
              title={t('soundChanges.include.hint')}
              onchange={(e) => replaceLine(item.line, (e.currentTarget as HTMLInputElement).value)}
            />
            <button class="btn ghost icon sm danger" onclick={() => removeRule(item.line)}
              ><Trash2 size={14} /></button
            >
          </div>
        {/if}
      {/each}
      {#if dropStage === si && gapAt(sec.endLine + 1)}
        <div class="drop-gap"></div>
      {/if}

      <div class="row stage-foot">
        <button class="btn ghost sm" onclick={() => addRuleAfter(sec.endLine)}
          ><Plus size={14} />{sec.marker
            ? t('soundChanges.addRuleHere')
            : t('soundChanges.addRule')}</button
        >
        <button class="btn ghost sm" onclick={() => addStressAfter(sec.endLine)}
          ><Plus size={14} />{t('stressRule.add')}</button
        >
        <button class="btn ghost sm" onclick={() => addFeatureAfter(sec.endLine)}
          ><Plus size={14} />{t('stressRule.addFeature')}</button
        >
        <button class="btn ghost sm" onclick={() => addStageAfter(sec.endLine)}
          ><Plus size={14} />{t('soundChanges.addStage')}</button
        >
      </div>
    </section>
  {/each}

  {#if program && program.steps.length === 0}
    <p class="muted">{t('soundChanges.noRules')}</p>
    {#if sections.length === 0}
      <div class="row">
        <button class="btn primary sm" onclick={() => addRuleAfter(lastLine)}
          ><Plus size={14} />{t('soundChanges.addRule')}</button
        >
        <button class="btn sm" onclick={() => addStageAfter(lastLine)}
          ><Plus size={14} />{t('soundChanges.addStage')}</button
        >
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
  /* 音类、语素那排按钮排不下时换行，别横着溢出去盖住别的 */
  .chips {
    flex-wrap: wrap;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .chips.wrap {
    flex-wrap: wrap;
  }
  .chip.sym {
    font-family: var(--font-data);
    min-width: 28px;
    justify-content: center;
    font-weight: 600;
  }
  .chip.feat {
    font-family: var(--font-mono);
    color: #be185d;
  }
  :global([data-theme='dark']) .chip.feat {
    color: #f9a8d4;
  }
  .kind {
    min-width: 24px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    display: inline-grid;
    place-items: center;
    flex: none;
  }
  .kind.stress {
    font-size: 18px;
    line-height: 1;
    padding-top: 4px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .kind.feat {
    background: color-mix(in srgb, #be185d 14%, transparent);
    color: #be185d;
  }
  :global([data-theme='dark']) .kind.feat {
    color: #f9a8d4;
  }
  .rule.special {
    background: var(--bg-sunken);
  }
  .clause-chip {
    padding: 0 6px;
    border-radius: 4px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    font-size: 13px;
  }
  .feat-name {
    color: #be185d;
    font-family: var(--font-mono);
  }
  :global([data-theme='dark']) .feat-name {
    color: #f9a8d4;
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
  :global([data-theme='dark']) .chip.cls b {
    color: #c4b5fd;
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
    gap: 6px;
  }
  .stage-head {
    padding: 6px 0 2px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }
  .stage-tools {
    margin: 2px 0 -4px;
  }
  .stage-fold,
  .stage-count {
    display: inline-flex;
    align-items: center;
    border: 0;
    background: none;
    padding: 0 2px;
    color: var(--text-3);
    cursor: pointer;
  }
  .stage-fold:hover,
  .stage-count:hover {
    color: var(--text);
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
    padding: 6px 10px;
    cursor: pointer;
    transition:
      border-color 0.12s,
      box-shadow 0.12s;
  }
  .rule[draggable='true'] {
    cursor: grab;
  }
  .rule.dragging {
    opacity: 0.45;
  }
  .stage.drop {
    background: var(--accent-soft);
    border-radius: var(--radius);
  }
  /* 拖动时的落点：空出一行，松手就插在这儿 */
  .drop-gap {
    pointer-events: none;
    height: 34px;
    margin: 2px 0;
    border: 2px dashed var(--accent);
    border-radius: var(--radius);
    background: var(--bg-elev);
  }
  .rule:hover {
    border-color: var(--border-strong);
  }
  .rule.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .rule.err {
    color: var(--danger);
    cursor: default;
    gap: 10px;
  }
  .rule-main {
    gap: 10px;
    min-height: 26px;
  }
  .num {
    min-width: 24px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-sunken);
    color: var(--text-2);
    font-size: 11px;
    font-family: var(--font-mono);
    display: inline-grid;
    place-items: center;
    flex: none;
  }
  .rule.selected .num {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
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
    color: #8fd3c6;
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
  .rule:hover .actions,
  .rule.selected .actions {
    display: inline-flex;
  }
  .actions .btn {
    padding: 2px;
  }
  .note {
    gap: 10px;
    padding: 0 10px;
  }
  .stage-foot {
    padding: 2px 0 0 4px;
  }
  .preview {
    gap: 10px;
    margin-top: 6px;
    padding: 6px 10px;
    border-top: 1px dashed var(--border);
    font-size: 16px;
  }
  .morph {
    display: inline-flex;
    align-items: baseline;
  }
  .diff-seg {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
    padding: 0 3px;
    border-radius: 4px;
    background: var(--accent-soft);
  }
  .diff-seg .old {
    color: var(--danger);
    animation: strike 1.6s ease forwards;
  }
  .diff-seg .new {
    display: inline-block;
    color: var(--accent-text);
    font-weight: 600;
    animation: fadeIn 1.6s ease forwards;
  }
  @keyframes strike {
    0%,
    45% {
      opacity: 1;
      text-decoration: none;
    }
    75%,
    100% {
      opacity: 0.45;
      text-decoration: line-through;
    }
  }
  @keyframes fadeIn {
    0%,
    45% {
      opacity: 0;
      max-width: 0;
      transform: translateY(6px);
    }
    75%,
    100% {
      opacity: 1;
      max-width: 4em;
      transform: translateY(0);
    }
  }
  .result {
    font-weight: 600;
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
