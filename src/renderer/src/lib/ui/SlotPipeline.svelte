<script lang="ts">
  /**
   * 构形槽位的流水线编辑器：起点只有词干，需要什么就加一步，
   * 前缀、后缀、中缀、环缀、模板、重叠、跑音变、微调都是同一种「步骤」，可以任意排序。
   */
  import { t } from '$lib/i18n/index.svelte'
  import { newId } from '$lib/core/factory'
  import type { Id, MorphStep, MorphStepKind, RuleSet } from '$lib/core/model'
  import { Plus, X, ChevronLeft, ChevronRight } from '@lucide/svelte'

  let {
    stem = $bindable(),
    steps = $bindable(),
    ruleSets,
    stemNames = [],
    onchange
  }: {
    stem: string
    steps: MorphStep[]
    ruleSets: RuleSet[]
    stemNames?: string[]
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
    'adjust'
  ]

  let adding = $state(false)

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

<div class="pipe">
  <label class="step stem">
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
    <div class="step">
      <span class="tag">{t(`paradigms.steps.${st.kind}`)}</span>
      {#if st.kind === 'prefix' || st.kind === 'suffix' || st.kind === 'adjust'}
        <input
          class="input data"
          placeholder={st.kind === 'adjust' ? t('paradigms.adjustPlaceholder') : '@语素 / -s'}
          bind:value={st.text}
          oninput={onchange}
        />
      {:else if st.kind === 'circumfix'}
        <input class="input data sm" bind:value={st.text} oninput={onchange} placeholder="a-" />
        <span class="dots">…</span>
        <input class="input data sm" bind:value={st.text2} oninput={onchange} placeholder="-o" />
      {:else if st.kind === 'infix'}
        <input class="input data sm" bind:value={st.text} oninput={onchange} placeholder="-i-" />
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
  <div class="add">
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
  {#if stemNames.length}
    <datalist id="dl-stems"
      >{#each stemNames as n (n)}<option value={n}></option>{/each}</datalist
    >
  {/if}
</div>

<style>
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
