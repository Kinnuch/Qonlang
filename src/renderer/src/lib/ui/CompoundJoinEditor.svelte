<script lang="ts">
  import type {
    CompoundJoinResult,
    CompoundJoinState,
    CompoundJoinStep
  } from '$lib/core/compoundJoin'
  import { newId } from '$lib/core/factory'
  import { moveItem } from '$lib/core/move'
  import { t } from '$lib/i18n/index.svelte'
  import { Plus, X, ChevronUp, ChevronDown, RotateCcw } from '@lucide/svelte'
  import HelpDot from './HelpDot.svelte'
  let {
    steps = $bindable<CompoundJoinStep[]>([]),
    result,
    readOnly = false
  }: { steps?: CompoundJoinStep[]; result: CompoundJoinResult; readOnly?: boolean } = $props()
  type Kind = CompoundJoinStep['kind']
  const kinds: Kind[] = ['drop-left', 'drop-right', 'insert', 'separator']
  const names: Record<Kind, string> = {
    'drop-left': 'dropLeft',
    'drop-right': 'dropRight',
    insert: 'insert',
    separator: 'separator'
  }
  let adding = $state<Kind>('drop-left')
  function make(kind: Kind, previous?: CompoundJoinStep): CompoundJoinStep {
    const id = previous?.id ?? newId()
    if (kind === 'drop-left' || kind === 'drop-right')
      return {
        id,
        kind,
        count:
          previous && (previous.kind === 'drop-left' || previous.kind === 'drop-right')
            ? previous.count
            : 1,
        times:
          previous && (previous.kind === 'drop-left' || previous.kind === 'drop-right')
            ? previous.times
            : 1
      }
    if (kind === 'insert')
      return {
        id,
        kind,
        side: previous?.kind === 'insert' ? previous.side : 'left',
        text: previous && 'text' in previous ? previous.text : ''
      }
    return { id, kind, text: previous && 'text' in previous ? previous.text : '' }
  }
  function add(): void {
    if (!readOnly && steps.length < 100) steps = [...steps, make(adding)]
  }
  function kindChanged(index: number, value: Kind): void {
    if (!readOnly && kinds.includes(value))
      steps = steps.map((step, i) => (i === index ? make(value, step) : step))
  }
  function move(index: number, delta: number): void {
    if (!readOnly) moveItem(steps, index, index + delta)
  }
  function remove(index: number): void {
    if (!readOnly) steps = steps.filter((_, i) => i !== index)
  }
  const visible = (value: string): string =>
    value ? value.replace(/ /g, '␣').replace(/\t/g, '⇥').replace(/\r?\n/g, '↵') : '∅'
</script>

{#snippet statePreview(state: CompoundJoinState)}<span class="data piece">{state.left || '∅'}</span
  ><span class="join-symbol" title={state.separator}>{visible(state.separator)}</span><span
    class="data piece">{state.right || '∅'}</span
  ><span aria-hidden="true">→</span><strong class="data piece">{state.surface || '∅'}</strong
  >{/snippet}
<section class="join-editor" data-compound-join aria-label={t('compoundJoin.title')}>
  <div class="row join-heading">
    <strong>{t('compoundJoin.title')}</strong><HelpDot
      tip={t('compoundJoin.hint') + '\n' + t('compoundJoin.boundaryHint')}
    /><span class="grow"></span><button
      type="button"
      class="btn ghost sm"
      data-join-reset
      disabled={readOnly || !steps.length}
      title={t('compoundJoin.resetHint')}
      onclick={() => {
        if (!readOnly) steps = []
      }}><RotateCcw size={12} />{t('compoundJoin.reset')}</button
    >
  </div>
  <span class="small muted unit-counts" data-join-unit-counts
    >{t('compoundJoin.units', {
      left: result.initialUnits.left.length,
      right: result.initialUnits.right.length
    })}</span
  >
  {#if !steps.length}<span class="small muted" data-join-no-steps>{t('compoundJoin.noSteps')}</span
    >{/if}
  <div class="join-steps">
    {#each steps as step, i (step.id)}
      {@const trace = result.trace[i]}
      <article class="join-step" data-join-step={step.id}>
        <div class="step-controls">
          <span class="badge number">{i + 1}</span>
          <select
            class="select operation"
            data-join-kind
            value={step.kind}
            aria-label={t('compoundJoin.operation')}
            disabled={readOnly}
            onchange={(event) => kindChanged(i, event.currentTarget.value as Kind)}
            >{#each kinds as kind (kind)}<option value={kind}
                >{t(`compoundJoin.${names[kind]}`)}</option
              >{/each}</select
          >
          {#if step.kind === 'drop-left' || step.kind === 'drop-right'}
            <label class="number-field"
              ><span>{t('compoundJoin.count')}</span><input
                class="input"
                type="number"
                min="1"
                step="1"
                data-join-count
                disabled={readOnly}
                bind:value={step.count}
              /></label
            >
            <label class="number-field"
              ><span>{t('compoundJoin.times')}</span><input
                class="input"
                type="number"
                min="1"
                step="1"
                data-join-times
                disabled={readOnly}
                bind:value={step.times}
              /></label
            >
          {:else if step.kind === 'insert'}
            <select
              class="select side"
              data-join-side
              aria-label={t('compoundJoin.location')}
              disabled={readOnly}
              bind:value={step.side}
              ><option value="left">{t('compoundJoin.left')}</option><option value="right"
                >{t('compoundJoin.right')}</option
              ></select
            >
            <input
              class="input data step-text"
              data-join-text
              aria-label={t('compoundJoin.text')}
              placeholder={t('compoundJoin.text')}
              disabled={readOnly}
              bind:value={step.text}
            />
          {:else if step.kind === 'separator'}
            <input
              class="input data step-text"
              data-join-text
              aria-label={t('compoundJoin.separatorText')}
              placeholder={t('compoundJoin.separatorText')}
              disabled={readOnly}
              bind:value={step.text}
            />
            <button
              type="button"
              class="btn ghost sm"
              data-join-none
              disabled={readOnly}
              onclick={() => {
                if (!readOnly && step.kind === 'separator') step.text = ''
              }}>{t('compoundJoin.none')}</button
            >
          {/if}
          <span class="grow"></span>
          <div class="step-buttons">
            <button
              type="button"
              class="btn ghost icon sm"
              data-join-up
              title={t('lexicon.moveUp')}
              aria-label={t('lexicon.moveUp')}
              disabled={readOnly || i === 0}
              onclick={() => move(i, -1)}><ChevronUp size={13} /></button
            >
            <button
              type="button"
              class="btn ghost icon sm"
              data-join-down
              title={t('lexicon.moveDown')}
              aria-label={t('lexicon.moveDown')}
              disabled={readOnly || i === steps.length - 1}
              onclick={() => move(i, 1)}><ChevronDown size={13} /></button
            >
            <button
              type="button"
              class="btn ghost icon sm danger"
              data-join-remove
              title={t('common.delete')}
              aria-label={t('common.delete')}
              disabled={readOnly}
              onclick={() => remove(i)}><X size={13} /></button
            >
          </div>
        </div>
        {#if trace}<div class="step-preview small" data-join-preview>
            <span class="muted">{t('compoundJoin.preview')}</span>{@render statePreview(
              trace.after
            )}
          </div>
          {#if trace.removed.length}<span class="small muted removed"
              >{t('compoundJoin.removed', { units: trace.removed.map(visible).join(' · ') })}</span
            >{/if}{#if trace.issue}<span class="small error" role="alert"
              >{t(`compoundJoin.${trace.issue}`)}</span
            >{/if}{/if}
      </article>
    {/each}
  </div>
  <div class="row add-row">
    <select
      class="select operation"
      data-join-add-kind
      aria-label={t('compoundJoin.operation')}
      disabled={readOnly}
      bind:value={adding}
      >{#each kinds as kind (kind)}<option value={kind}>{t(`compoundJoin.${names[kind]}`)}</option
        >{/each}</select
    ><button
      type="button"
      class="btn sm"
      data-join-add
      disabled={readOnly || steps.length >= 100}
      onclick={add}><Plus size={13} />{t('compoundJoin.addStep')}</button
    >
  </div>
  {#if result.issue && !result.trace.some((trace) => trace.issue === result.issue)}<span
      class="small error"
      role="alert">{t(`compoundJoin.${result.issue}`)}</span
    >{/if}
  <div class="join-result small" data-join-result>
    <span class="muted">{t('compoundJoin.result')}</span>{@render statePreview(result)}
  </div>
</section>

<style>
  .join-editor {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-inline-size: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
  }
  .join-heading {
    gap: 5px;
    font-size: 12px;
  }
  .unit-counts {
    font-size: 11px;
  }
  .join-steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .join-step {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-inline-size: 0;
  }
  .step-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }
  .operation {
    inline-size: 158px;
    min-inline-size: 0;
  }
  .side {
    inline-size: 120px;
    min-inline-size: 0;
  }
  .step-text {
    flex: 1 1 110px;
    min-inline-size: 80px;
  }
  .number-field {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--text-2);
  }
  .number-field input {
    inline-size: 62px;
    min-inline-size: 0;
    padding-inline: 5px;
  }
  .step-buttons {
    display: inline-flex;
    gap: 1px;
    flex: none;
  }
  .step-preview,
  .join-result {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    overflow-wrap: anywhere;
    min-inline-size: 0;
  }
  .join-result {
    padding: 7px;
    background: var(--bg-sunken);
    border-radius: 5px;
  }
  .piece {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-inline-size: 100%;
  }
  .join-symbol {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
    min-inline-size: 15px;
    text-align: center;
    white-space: pre-wrap;
  }
  .error {
    color: var(--danger);
  }
  .removed {
    overflow-wrap: anywhere;
  }
  .add-row {
    gap: 6px;
    flex-wrap: wrap;
  }
  @media (max-width: 600px) {
    .operation {
      flex: 1 1 150px;
    }
    .join-editor {
      padding: 8px;
    }
    .step-buttons {
      margin-inline-start: auto;
    }
    .side {
      flex: 1 1 110px;
    }
  }
</style>
