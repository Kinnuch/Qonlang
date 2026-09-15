<script lang="ts">
  /**
   * 构形槽位的流水线编辑器：起点只有词干，需要什么就加一步，
   * 前缀、后缀、中缀、环缀、模板、重叠、跑音变、微调都是同一种「步骤」，可以任意排序。
   */
  import { t } from '$lib/i18n/index.svelte'
  import { newId } from '$lib/core/factory'
  import type { Id, MorphStep, MorphStepKind, RuleSet } from '$lib/core/model'
  import { Plus, X, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from '@lucide/svelte'
  import { conditionVariants, hasConditions } from '$lib/engine/morph/conditions'
  import { sortable } from '$lib/ui/sortable.svelte'
  import { moveItem } from '$lib/core/move'

  /** 「构形」这一步能套的构形：名字、各槽位、各变体（不含正在编辑的这个构形） */
  interface ParadigmChoice {
    id: Id
    name: string
    slots: { key: string; label: string }[]
    variants: { id: Id; name: string }[]
  }

  let {
    stem = $bindable(),
    steps = $bindable(),
    ruleSets,
    paradigms = [],
    onchange
  }: {
    stem: string
    steps: MorphStep[]
    ruleSets: RuleSet[]
    paradigms?: ParadigmChoice[]
    onchange: () => void
  } = $props()

  const KINDS: MorphStepKind[] = [
    'prefix',
    'suffix',
    'infix',
    'circumfix',
    'sca',
    'pattern',
    'reduplication',
    'adjust',
    'paradigm'
  ]

  let adding = $state(false)
  /**
   * 「增加步骤」的菜单：鼠标移出按钮连同菜单的范围就收起。按钮和菜单之间有 4px 空隙，
   * 收起前等一小会儿，移到菜单上就取消，免得还没够着菜单它就没了。
   */
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  function keepAdding(): void {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
  }
  function closeAddingSoon(): void {
    keepAdding()
    closeTimer = setTimeout(() => (adding = false), 250)
  }
  $effect(() => keepAdding)
  /** 展开成多行的微调步骤 */
  let expanded = $state<string | null>(null)

  function make(kind: MorphStepKind): MorphStep {
    const id: Id = newId()
    switch (kind) {
      case 'prefix':
      case 'suffix':
        return { id, kind, text: '' }
      case 'infix':
        return { id, kind, text: '', at: '' }
      case 'circumfix':
        return { id, kind, text: '', text2: '' }
      case 'sca':
        return { id, kind, ruleSetId: ruleSets[0]?.id ?? null, fromStage: '', toStage: '' }
      case 'pattern':
        return { id, kind, pattern: '' }
      case 'reduplication':
        return { id, kind, scope: 'full', length: 1 }
      case 'paradigm':
        return {
          id,
          kind,
          paradigmId: paradigms[0]?.id ?? null,
          slotKey: paradigms[0]?.slots[0]?.key ?? '',
          variantId: null
        }
      default:
        return { id, kind: 'adjust', text: '' }
    }
  }
  function add(kind: MorphStepKind): void {
    steps.push(make(kind))
    adding = false
    onchange()
  }
  function remove(i: number): void {
    steps.splice(i, 1)
    onchange()
  }
  /** 拖着换步骤顺序：每份流水线自己一组，不会拖到别的槽位里去 */
  const sortGroup = `pipe-${newId()}`
  function move(i: number, dir: -1 | 1): void {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    ;[steps[i], steps[j]] = [steps[j], steps[i]]
    onchange()
  }
  const stagesOf = (id: Id | null): string[] =>
    (ruleSets.find((r) => r.id === id)?.text ?? '')
      .split('\n')
      .map((l) => /^\s*-\*\s*(.+)$/.exec(l)?.[1]?.trim() ?? '')
      .filter(Boolean)
</script>

<!-- 按条件换字母（{阴:g|k}）的词缀：旁边小字列出每种挑法 -->
{#snippet alts(text: string)}
  {#if hasConditions(text)}
    {@const line = conditionVariants(text, 8)
      .map((v) => `${v.when || t('paradigms.otherwise')} ${v.text || '∅'}`)
      .join(' · ')}
    <span class="alts" title={line}>{line}</span>
  {/if}
{/snippet}

<div class="pipe">
  <label class="step stem" title={t('paradigms.stemHint')}>
    <span class="tag">{t('paradigms.stem')}</span>
    <input
      class="input data"
      list="dl-stems"
      placeholder="lemma"
      bind:value={stem}
      oninput={onchange}
    />
  </label>
  {#each steps as st, i (st.id)}
    <span class="arrow">→</span>
    <div
      class="step"
      {...sortable(sortGroup, i, (from, to) => {
        if (moveItem(steps, from, to)) onchange()
      })}
    >
      <span class="tag">{t(`paradigms.steps.${st.kind}`)}</span>
      {#if st.kind === 'adjust'}
        {#if expanded === st.id}
          <textarea
            class="textarea data adj"
            rows="4"
            placeholder={t('paradigms.adjustPlaceholder')}
            title={t('paradigms.adjustHint')}
            bind:value={st.text}
            oninput={onchange}
          ></textarea>
        {:else}
          <input
            class="input data"
            placeholder={t('paradigms.adjustPlaceholder')}
            title={st.text || t('paradigms.adjustHint')}
            bind:value={st.text}
            oninput={onchange}
          />
        {/if}
        <button
          class="btn ghost icon xs"
          title={t('paradigms.expandAdjust')}
          onclick={() => (expanded = expanded === st.id ? null : st.id)}
          >{#if expanded === st.id}<Minimize2 size={12} />{:else}<Maximize2
              size={12}
            />{/if}</button
        >
      {:else if st.kind === 'prefix' || st.kind === 'suffix'}
        <input
          class="input data"
          placeholder="@语素 / -s"
          bind:value={st.text}
          oninput={onchange}
        />
        {@render alts(st.text)}
      {:else if st.kind === 'circumfix'}
        <input class="input data sm" bind:value={st.text} oninput={onchange} placeholder="a-" />
        <span class="dots">…</span>
        <input class="input data sm" bind:value={st.text2} oninput={onchange} placeholder="-o" />
        {@render alts(`${st.text}…${st.text2}`)}
      {:else if st.kind === 'infix'}
        <input class="input data sm" bind:value={st.text} oninput={onchange} placeholder="-i-" />
        {@render alts(st.text)}
        <input
          class="input sm"
          list="dl-infix-at"
          bind:value={st.at}
          oninput={onchange}
          placeholder="V1"
          title={t('paradigms.infixAtHint')}
        />
      {:else if st.kind === 'pattern'}
        <input
          class="input data"
          bind:value={st.pattern}
          oninput={onchange}
          placeholder="C1aC2aC3"
          title={t('paradigms.patternHint')}
        />
      {:else if st.kind === 'reduplication'}
        <select class="select sm" bind:value={st.scope} {onchange}>
          {#each ['full', 'initial', 'final'] as sc (sc)}<option value={sc}
              >{t(`paradigms.scopes.${sc}`)}</option
            >{/each}
        </select>
        <input
          class="input sm num"
          type="number"
          min="1"
          bind:value={st.length}
          oninput={onchange}
        />
      {:else if st.kind === 'sca'}
        <select
          class="select"
          value={st.ruleSetId ?? ''}
          onchange={(e) => {
            st.ruleSetId = (e.currentTarget as HTMLSelectElement).value || null
            onchange()
          }}
        >
          <option value="">{t('paradigms.ruleSet')}</option>
          {#each ruleSets as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
        </select>
        <input
          class="input sm"
          list={`dl-stages-${st.id}`}
          bind:value={st.fromStage}
          oninput={onchange}
          placeholder={t('paradigms.fromStage')}
        />
        <span class="dots">→</span>
        <input
          class="input sm"
          list={`dl-stages-${st.id}`}
          bind:value={st.toStage}
          oninput={onchange}
          placeholder={t('paradigms.toStage')}
        />
        <datalist id={`dl-stages-${st.id}`}
          >{#each stagesOf(st.ruleSetId) as sg (sg)}<option value={sg}></option>{/each}</datalist
        >
      {:else if st.kind === 'paradigm'}
        {@const chosen = paradigms.find((p) => p.id === st.paradigmId)}
        <select
          class="select"
          title={t('paradigms.nestHint')}
          value={st.paradigmId ?? ''}
          onchange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value || null
            st.paradigmId = id
            st.slotKey = paradigms.find((p) => p.id === id)?.slots[0]?.key ?? ''
            st.variantId = null
            onchange()
          }}
        >
          <option value="">{t('paradigms.nestPick')}</option>
          {#each paradigms as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
        {#if chosen}
          <select
            class="select"
            value={st.slotKey}
            onchange={(e) => {
              st.slotKey = (e.currentTarget as HTMLSelectElement).value
              onchange()
            }}
          >
            {#each chosen.slots as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
          </select>
          {#if chosen.variants.length}
            <select
              class="select sm"
              value={st.variantId ?? ''}
              onchange={(e) => {
                st.variantId = (e.currentTarget as HTMLSelectElement).value || null
                onchange()
              }}
            >
              <option value="">{t('paradigms.variantBase')}</option>
              {#each chosen.variants as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
            </select>
          {/if}
        {/if}
      {/if}
      <button class="btn ghost icon xs" title={t('lexicon.moveUp')} onclick={() => move(i, -1)}
        ><ChevronLeft size={12} /></button
      >
      <button class="btn ghost icon xs" title={t('lexicon.moveDown')} onclick={() => move(i, 1)}
        ><ChevronRight size={12} /></button
      >
      <button class="btn ghost icon xs" title={t('common.delete')} onclick={() => remove(i)}
        ><X size={12} /></button
      >
    </div>
  {/each}
  <span class="arrow">→</span>
  <div
    class="add"
    role="presentation"
    onmouseenter={keepAdding}
    onmouseleave={closeAddingSoon}
    onfocusout={(e) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) adding = false
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') adding = false
    }}
  >
    <button class="btn ghost sm" onclick={() => (adding = !adding)}
      ><Plus size={13} />{t('paradigms.addStep')}</button
    >
    {#if adding}
      <div class="menu card">
        {#each KINDS as k (k)}
          <button onclick={() => add(k)}>{t(`paradigms.steps.${k}`)}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .alts {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--accent-text);
  }
  .pipe {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  .step {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 4px 2px 6px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
  }
  .step.stem {
    background: var(--accent-soft);
    border-color: var(--accent-soft);
  }
  .tag {
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
  }
  .arrow {
    color: var(--text-3);
    font-size: 12px;
  }
  .dots {
    color: var(--text-3);
  }
  .step .input,
  .step .select {
    padding: 1px 6px;
    font-size: 12px;
    height: 22px;
    width: 110px;
  }
  .step .input.sm,
  .step .select.sm {
    width: 72px;
  }
  .step .input.num {
    width: 46px;
  }
  .step .adj {
    width: 260px;
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
  }
  .add {
    position: relative;
  }
  .menu {
    position: absolute;
    left: 0;
    top: calc(100% + 4px);
    z-index: 30;
    display: flex;
    flex-direction: column;
    padding: 4px;
    min-width: 130px;
    box-shadow: var(--shadow-lg);
  }
  .menu button {
    text-align: left;
    border: 0;
    background: none;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 13px;
    color: inherit;
  }
  .menu button:hover {
    background: var(--bg-hover);
  }
  :global(.btn.xs) {
    padding: 1px 3px;
  }
</style>
