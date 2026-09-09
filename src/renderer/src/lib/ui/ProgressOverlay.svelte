<script lang="ts">
  /** 长任务的进度条：ui.runProgress 期间盖在最上层 */
  import { ui } from '$lib/state/ui.svelte'

  const p = $derived(ui.progress)
  const pct = $derived(p && p.total ? Math.round((p.done / p.total) * 100) : 0)
</script>

{#if p}
  <div class="wrap" role="status" aria-live="polite">
    <div class="box card">
      <div class="row">
        <span class="grow">{p.label}</span>
        <span class="small muted">{p.done} / {p.total}</span>
      </div>
      <div class="track"><div class="bar" style={`width:${pct}%`}></div></div>
    </div>
  </div>
{/if}

<style>
  .wrap {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, #000 22%, transparent);
    z-index: 120;
  }
  .box {
    width: min(420px, 84vw);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: var(--shadow-lg);
  }
  .track {
    height: 8px;
    border-radius: 999px;
    background: var(--bg-sunken);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.12s linear;
  }
</style>
