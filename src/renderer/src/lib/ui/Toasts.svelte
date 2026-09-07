<script lang="ts">
  import { ui } from '$lib/state/ui.svelte'
  import { X } from '@lucide/svelte'
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast card" class:error={toast.kind === 'error'}>
      <span class="grow">{toast.message}</span>
      {#if toast.action}
        <button
          class="btn sm"
          onclick={() => {
            toast.action?.run()
            ui.dismiss(toast.id)
          }}>{toast.action.label}</button
        >
      {/if}
      <button class="btn ghost icon sm" aria-label="close" onclick={() => ui.dismiss(toast.id)}><X size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 280px;
    max-width: 520px;
    padding: 8px 8px 8px 14px;
    box-shadow: var(--shadow-lg);
    animation: rise 0.16s ease-out;
  }
  .toast.error {
    border-color: var(--danger);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
