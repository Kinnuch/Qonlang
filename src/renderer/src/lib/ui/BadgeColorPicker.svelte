<script lang="ts">
  import { Palette, RotateCcw } from '@lucide/svelte'
  import { normalizeBadgeColor } from '$lib/core/lexemeColors'
  import { t } from '$lib/i18n/index.svelte'
  let {
    value,
    label,
    readOnly = false,
    dataKey = '',
    onchange
  }: {
    value?: string
    label: string
    readOnly?: boolean
    dataKey?: string
    onchange: (value: string | undefined) => void
  } = $props()
  const color = $derived(normalizeBadgeColor(value))
</script>

<span class="badge-colors" data-badge-color-picker={dataKey}>
  <label class="swatch" class:custom={!!color} style:background-color={color} title={label}>
    {#if !color}<Palette size={14} />{/if}
    <input
      type="color"
      value={color ?? '#3b82f6'}
      disabled={readOnly}
      aria-label={label}
      data-badge-color={dataKey}
      oninput={(event) => {
        if (!readOnly) onchange(event.currentTarget.value)
      }}
    />
  </label>
  {#if color}<button
      type="button"
      class="reset"
      title={t('badgeColors.reset')}
      aria-label={t('badgeColors.reset')}
      data-badge-color-reset={dataKey}
      disabled={readOnly}
      onclick={() => {
        if (!readOnly) onchange(undefined)
      }}><RotateCcw size={12} /></button
    >{/if}
</span>

<style>
  .badge-colors {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: none;
    vertical-align: middle;
  }
  .swatch {
    position: relative;
    display: grid;
    place-items: center;
    inline-size: 22px;
    block-size: 22px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    color: var(--text-2);
    background: var(--bg-elev);
    cursor: pointer;
  }
  .swatch:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .swatch:has(input:disabled) {
    opacity: 0.5;
    cursor: default;
  }
  .reset {
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 4px;
    padding: 3px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
  }
  .reset:hover {
    background: var(--bg-hover);
  }
  .reset:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
