<script lang="ts">
  import { onMount } from 'svelte'
  import { Check, Clock3, RefreshCw, Smartphone, X } from '@lucide/svelte'
  import type { SupportOrder } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import { paymentQr, supportDialogFocus, supportYuan } from './supportPayment'

  let {
    order,
    online,
    verified,
    enabled,
    busy,
    error,
    onrefresh,
    oncloseorder,
    onhide
  }: {
    order: SupportOrder
    online: boolean
    verified: boolean
    enabled: boolean
    busy: boolean
    error: string
    onrefresh: () => void
    oncloseorder: () => void
    onhide: () => void
  } = $props()
  let now = $state(Date.now())
  let remainingCheck = $state(15)
  let nextCheck = 0
  let closeRequested = $state(false)
  const payment = $derived(order.payment)
  const expired = $derived(!!payment?.expiresAt && now >= payment.expiresAt)
  const qr = $derived(paymentQr(payment?.qrCodeUrl ?? ''))
  const showQr = $derived(
    online &&
      verified &&
      enabled &&
      order.status === 'pending' &&
      payment?.state === 'pending' &&
      !expired &&
      !closeRequested &&
      !!qr
  )
  const seconds = $derived(Math.max(0, Math.ceil(((payment?.expiresAt ?? now) - now) / 1000)))
  const countdown = $derived(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)
  const terminal = $derived(order.status !== 'pending')
  $effect(() => {
    if (terminal) closeRequested = false
  })
  const stateKey = $derived(
    payment?.state === 'refund_review' || order.status === 'refund_review'
      ? 'refundReview'
      : order.status === 'paid'
        ? 'paid'
        : order.status === 'refunded'
          ? 'refunded'
          : order.status === 'closed' || payment?.state === 'closed'
            ? 'closed'
            : expired
              ? 'expired'
              : payment?.state === 'creating'
                ? 'creating'
                : 'pending'
  )

  function refresh(): void {
    if (!online || busy || remainingCheck > 0) return
    nextCheck = performance.now() + 15000
    remainingCheck = 15
    onrefresh()
  }
  onMount(() => {
    nextCheck = performance.now() + 15000
    const interval = window.setInterval(() => {
      now = Date.now()
      remainingCheck = Math.max(0, Math.ceil((nextCheck - performance.now()) / 1000))
      if (!document.hidden && !terminal && !closeRequested && remainingCheck === 0) refresh()
    }, 1000)
    return () => window.clearInterval(interval)
  })
</script>

<div class="support-overlay" data-support-payment-dialog data-payment-order-id={order.id}>
  <button class="scrim" tabindex="-1" aria-label={t('account.support.hide')} onclick={onhide}
  ></button>
  <div
    class="support-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="support-payment-title"
    aria-describedby="support-payment-description"
    tabindex="-1"
    use:supportDialogFocus={onhide}
  >
    <header>
      <h2 id="support-payment-title">{t('account.support.scanTitle')}</h2>
      <button
        class="btn icon"
        data-support-payment-close
        aria-label={t('account.support.hide')}
        onclick={onhide}><X size={18} /></button
      >
    </header>
    <div class="amount">
      <span>{t('account.support.orderTotal')}</span><strong data-support-payment-amount
        >¥{supportYuan(order.amountFen)}</strong
      >
    </div>
    <div
      class="status"
      class:success={order.status === 'paid'}
      role="status"
      data-support-payment-status
    >
      {#if order.status === 'paid'}<Check size={19} />{:else}<Clock3 size={19} />{/if}
      <strong>{t(`account.support.${stateKey}`)}</strong>
    </div>
    {#if showQr && qr}
      <div class="qr" data-support-payment-qr>
        <svg
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          role="img"
          aria-label={t('account.support.scanTitle')}
          shape-rendering="crispEdges"
        >
          <rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.path} fill="#101810" />
        </svg>
      </div>
      <p class="scan"><Smartphone size={16} />{t('account.support.scan')}</p>
      <p class="small muted countdown" data-support-payment-countdown>
        {t('account.support.countdown', { time: countdown })}
      </p>
    {:else if closeRequested}
      <div class="notice" data-support-payment-close-confirmation>
        <strong>{t('account.support.closeTitle')}</strong>
        <p>{t('account.support.closeDescription')}</p>
        <div class="actions">
          <button
            class="btn"
            data-support-payment-keep-order
            disabled={busy}
            onclick={() => (closeRequested = false)}>{t('account.support.keep')}</button
          >
          <button
            class="btn"
            data-support-payment-confirm-close
            disabled={!online || busy}
            onclick={oncloseorder}>{t('account.support.confirmClose')}</button
          >
        </div>
      </div>
    {:else if !online && !terminal}<p class="notice" data-support-payment-offline>
        {t('account.support.offlineOrder')}
      </p>
    {:else if expired && !terminal}<p class="notice">{t('account.support.expiredHint')}</p>
    {:else if stateKey === 'refundReview'}<p class="notice">{t('account.support.refundHint')}</p>
    {:else if !terminal && (!enabled || !verified || !qr || payment?.state === 'creating')}<p
        class="notice"
      >
        {t('account.support.qrUnavailable')}
      </p>{/if}
    <p id="support-payment-description" class="description">
      {order.status === 'paid' ? t('account.support.thanks') : t('account.support.hideHint')}
    </p>
    <dl>
      <dt>{t('account.support.orderId')}</dt>
      <dd>{order.id}</dd>
    </dl>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if order.status === 'pending' && !closeRequested}<button
        class="close-order"
        data-support-payment-close-order
        disabled={!online || busy}
        onclick={() => (closeRequested = true)}>{t('account.support.closeOrder')}</button
      >{/if}
    <footer>
      <button
        class="btn"
        data-support-payment-refresh
        disabled={!online || busy || closeRequested || remainingCheck > 0}
        onclick={refresh}
      >
        <RefreshCw size={15} />{busy
          ? t('account.support.checking')
          : remainingCheck > 0
            ? t('account.support.checkIn', { seconds: remainingCheck })
            : t('account.support.refreshPayment')}</button
      >
      <button class="btn primary" data-support-payment-done onclick={onhide}
        >{order.status === 'paid' ? t('common.ok') : t('account.support.hide')}</button
      >
    </footer>
  </div>
</div>

<style>
  .support-overlay {
    position: fixed;
    inset: 0;
    z-index: 1250;
    isolation: isolate;
    display: grid;
    place-items: center;
    padding: 20px;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    background: #101510b8;
    cursor: default;
  }
  .support-dialog {
    position: relative;
    width: min(100%, 510px);
    max-height: calc(100dvh - 40px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 26px;
    border: 1px solid var(--border, #7f887d);
    border-radius: 18px;
    color: var(--text, #202820);
    background: var(--bg-elev, #ffffff);
    box-shadow: 0 24px 80px #0006;
    outline: none;
  }
  header,
  footer,
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
  }
  h2 {
    font-size: 20px;
    margin: 0;
  }
  .amount {
    margin: 20px 0 15px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 11px;
  }
  .amount span {
    display: block;
    font-size: 12px;
    color: var(--text-2);
  }
  .amount strong {
    font-size: 30px;
    font-variant-numeric: tabular-nums;
  }
  .status,
  .scan {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .status.success {
    color: var(--accent-text);
    padding-block: 22px;
  }
  .qr {
    width: min(240px, 100%);
    aspect-ratio: 1;
    margin: 16px auto;
    padding: 8px;
    border: 1px solid #d8ddcf;
    border-radius: 12px;
    background: #fff;
  }
  .qr svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .countdown {
    text-align: center;
  }
  .notice {
    padding: 14px;
    margin-block-start: 18px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elev, #ffffff);
  }
  .notice p,
  .description {
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.8;
  }
  .notice strong {
    font-size: 14px;
  }
  .description {
    margin-block: 18px 12px;
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    font-size: 11px;
    color: var(--text-2);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--danger);
    font-size: 12px;
    line-height: 1.7;
  }
  .close-order {
    color: var(--text-2);
    background: var(--bg-elev, #ffffff);
    border: 0;
    padding: 5px 0;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    font-size: 12px;
  }
  .close-order:disabled {
    opacity: 0.5;
    cursor: default;
  }
  footer {
    margin-block-start: 20px;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (max-width: 600px) {
    .support-overlay {
      padding: 12px;
    }
    .support-dialog {
      padding: 20px;
      max-height: calc(100dvh - 24px);
    }
  }
</style>
