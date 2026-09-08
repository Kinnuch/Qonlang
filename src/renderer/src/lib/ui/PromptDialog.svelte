<script lang="ts">
  /** 应用内输入框：替代 window.prompt（Electron 不支持）。通过 ui.prompt(title, value) 调用。 */
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'

  let inputEl = $state<HTMLInputElement | null>(null)
  let value = $state('')
  $effect(() => {
    if (ui.promptReq) {
      value = ui.promptReq.value
      queueMicrotask(() => {
        inputEl?.focus()
        inputEl?.select()
      })
    }
  })
  function done(ok: boolean): void {
    const req = ui.promptReq
    if (!req) return
    ui.promptReq = null
    req.resolve(ok ? value : null)
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      done(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      done(false)
    }
  }
</script>

{#if ui.promptReq}
  <div class="backdrop" role="presentation" onclick={() => done(false)}></div>
  <div class="dlg card" role="dialog" aria-modal="true" aria-label={ui.promptReq.title}>
    <label class="field">
      <span>{ui.promptReq.title}</span>
      <input bind:this={inputEl} class="input" bind:value onkeydown={onKey} />
    </label>
    <div class="row end">
      <button class="btn sm" onclick={() => done(false)}>{t('common.cancel')}</button>
      <button class="btn primary sm" onclick={() => done(true)}>{t('common.ok')}</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.18);
  }
  .dlg {
    position: fixed;
    z-index: 91;
    left: 50%;
    top: 30vh;
    transform: translateX(-50%);
    width: min(420px, 90vw);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow-lg);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .end {
    justify-content: flex-end;
    gap: 8px;
  }
</style>
