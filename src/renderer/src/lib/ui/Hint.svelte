<script lang="ts">
  /** 模块联动提示：一条可关闭的说明，关闭状态记在偏好里 */
  import { ui } from '$lib/state/ui.svelte'
  import { Info, X } from '@lucide/svelte'

  let { id, text }: { id: string; text: string } = $props()
  const shown = $derived(!ui.prefs.dismissedHints.includes(id))
  function dismiss(): void {
    ui.prefs.dismissedHints = [...ui.prefs.dismissedHints, id]
    void ui.savePrefs()
  }
</script>

{#if shown}
  <div class="hint-bar">
    <Info size={14} />
    <span class="grow">{text}</span>
    <button class="x" onclick={dismiss} aria-label="dismiss"><X size={13} /></button>
  </div>
{/if}

<style>
  .hint-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--accent-text);
  }
  .x {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    display: grid;
    place-items: center;
    opacity: 0.7;
  }
  .x:hover {
    opacity: 1;
  }
</style>
