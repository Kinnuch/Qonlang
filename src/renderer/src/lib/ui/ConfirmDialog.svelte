<script lang="ts">
  /** 危险操作的确认框（清空数据这类）：ui.confirm(标题, 说明, 按钮文字) 调用，确认了才返回 true。 */
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'

  function done(ok: boolean): void {
    const req = ui.confirmReq
    if (!req) return
    ui.confirmReq = null
    req.resolve(ok)
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      done(false)
    }
  }
</script>

<svelte:window onkeydown={ui.confirmReq ? onKey : undefined} />

{#if ui.confirmReq}
  <div class="backdrop" role="presentation" onclick={() => done(false)}></div>
  <div class="dlg card" role="alertdialog" aria-modal="true" aria-label={ui.confirmReq.title}>
    <strong>{ui.confirmReq.title}</strong>
    {#if ui.confirmReq.body}<p class="small muted">{ui.confirmReq.body}</p>{/if}
    <div class="row foot">
      <span class="grow"></span>
      <button class="btn sm" onclick={() => done(false)}>{t('common.cancel')}</button>
      <button class="btn sm danger" onclick={() => done(true)}
        >{ui.confirmReq.okLabel || t('common.ok')}</button
      >
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 25%);
    z-index: 400;
  }
  .dlg {
    position: fixed;
    z-index: 401;
    left: 50%;
    top: 32%;
    transform: translate(-50%, -50%);
    width: min(420px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 18px;
    box-shadow: var(--shadow-lg);
  }
  .foot {
    margin-top: 4px;
  }
</style>
