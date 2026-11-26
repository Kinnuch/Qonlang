<script lang="ts">
  import type { Script, Sentence } from '$lib/core/model'
  import { t } from '$lib/i18n/index.svelte'
  import HelpDot from './HelpDot.svelte'
  let {
    sentence,
    scripts,
    readOnly = false,
    onchange
  }: {
    sentence: Sentence
    scripts: readonly Script[]
    readOnly?: boolean
    onchange: (id: string, visible: boolean) => void
  } = $props()
  function stopCardEvents(node: HTMLElement): { destroy: () => void } {
    const stop = (event: Event): void => event.stopPropagation()
    for (const type of ['click', 'pointerdown', 'keydown']) node.addEventListener(type, stop)
    return {
      destroy(): void {
        for (const type of ['click', 'pointerdown', 'keydown']) node.removeEventListener(type, stop)
      }
    }
  }
</script>

{#if scripts.length >= 2}<fieldset
    use:stopCardEvents
    class="script-picker"
    data-sentence-script-picker={sentence.id}
  >
    <legend>{t('scriptScope.sentenceTitle')}<HelpDot tip={t('scriptScope.sentenceHint')} /></legend>
    <div class="row wrap">
      {#each scripts as script (script.id)}<label class="row small"
          ><input
            type="checkbox"
            data-sentence-script={script.id}
            checked={!sentence.hiddenScriptIds?.includes(script.id)}
            disabled={readOnly}
            onchange={(event) => {
              if (!readOnly) onchange(script.id, event.currentTarget.checked)
            }}
          />{script.name}</label
        >{/each}
    </div>
  </fieldset>{/if}

<style>
  .script-picker {
    border: 0;
    padding: 4px 0;
    margin: 0;
    min-width: 0;
  }
  .script-picker legend {
    font-size: 11px;
    color: var(--text-3);
  }
  .script-picker .row {
    gap: 6px;
  }
  .script-picker > div {
    gap: 8px 14px;
  }
</style>
