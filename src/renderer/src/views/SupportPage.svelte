<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowLeft, Coffee, RefreshCw, UserRound } from '@lucide/svelte'
  import {
    platform,
    type AccountState,
    type SupportCapability,
    type SupportOrder,
    type SupportOperation,
    type SupportInput,
    type SupportResult
  } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import AccountPanel from '$lib/ui/AccountPanel.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import SupportPaymentDialog from '$lib/ui/SupportPaymentDialog.svelte'
  import {
    supportAmountFen,
    supportYuan,
    unresolvedSupportOrder,
    supportDialogFocus
  } from '$lib/ui/supportPayment'

  let { onback }: { onback: () => void } = $props()
  let account = $state<AccountState>({
    supported: platform.kind === 'electron',
    online: false,
    persisted: false,
    user: null
  })
  let capability = $state<SupportCapability | null>(null)
  let orders = $state<SupportOrder[]>([])
  let ordersLoaded = $state(false)
  let selected = $state<SupportOrder | null>(null)
  let selectedVerified = $state(false)
  let confirmAmount = $state<number | null>(null)
  let busy = $state('')
  let error = $state('')
  let manageAccount = $state(false)
  let heading: HTMLHeadingElement | undefined
  let generation = 0
  let disposed = false
  let reloadQueued = false
  let confirmationOwner = ''
  const pending = $derived(unresolvedSupportOrder(orders))
  const amountFen = $derived(
    supportAmountFen(
      ui.supportAmount,
      capability?.minAmountFen ?? 1,
      capability?.maxAmountFen ?? 60000
    )
  )
  const enabled = $derived(!!capability?.enabled && capability.provider === 'yungouos')
  const canCreate = $derived(
    !!account.user &&
      account.online &&
      enabled &&
      ordersLoaded &&
      !pending &&
      !busy &&
      !error &&
      amountFen !== null
  )
  const accountErrors = new Set([
    'OFFLINE',
    'UNAUTHORIZED',
    'SESSION_EXPIRED',
    'RATE_LIMITED',
    'INVALID_INPUT',
    'STORAGE_FAILURE'
  ])
  const knownErrors = new Set([
    'PAYMENTS_DISABLED',
    'PAYMENT_STATUS_UNKNOWN',
    'PENDING_ORDER',
    'ORDER_NOT_FOUND',
    'SERVICE_UNAVAILABLE',
    'DESKTOP_ONLY',
    'PAYMENT_UNAVAILABLE',
    'REQUEST_PENDING',
    'REQUEST_ID_CONFLICT'
  ])
  function errorText(code?: string): string {
    const aliases: Record<string, string> = {
      SUPPORT_ORDER_PENDING: 'PENDING_ORDER',
      SUPPORT_REQUEST_PENDING: 'REQUEST_PENDING',
      IDEMPOTENCY_CONFLICT: 'REQUEST_ID_CONFLICT',
      INVALID_AMOUNT: 'INVALID_INPUT',
      PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_UNAVAILABLE',
      PAYMENT_PROVIDER_INVALID: 'PAYMENT_UNAVAILABLE',
      PAYMENT_NOT_CONFIRMED: 'PAYMENT_STATUS_UNKNOWN',
      PAYMENT_CHECK_BUSY: 'PAYMENT_STATUS_UNKNOWN'
    }
    if (code) code = aliases[code] ?? code
    return code
      ? accountErrors.has(code)
        ? t(`account.errors.${code}`)
        : t(`account.support.errors.${knownErrors.has(code) ? code : 'SERVICE_UNAVAILABLE'}`)
      : ''
  }
  function clearPrivate(): void {
    capability = null
    orders = []
    ordersLoaded = false
    selected = null
    selectedVerified = false
    confirmAmount = null
    confirmationOwner = ''
    error = ''
  }
  function acceptAccount(next: AccountState): boolean {
    const changed = (account.user?.id ?? '') !== (next.user?.id ?? '')
    if (changed) {
      generation++
      clearPrivate()
    }
    account = next
    return changed
  }
  function accountChanged(next: AccountState): void {
    if (disposed) return
    if (acceptAccount(next) && next.user) {
      if (busy) reloadQueued = true
      else void load()
    }
  }
  function accept(result: SupportResult, expected: number, owner: string): boolean {
    if (disposed || generation !== expected || account.user?.id !== owner) return false
    if (result.state.user?.id !== owner) {
      acceptAccount(result.state)
      return false
    }
    account = result.state
    error = result.ok ? '' : errorText(result.error)
    if (result.capability) capability = result.capability
    if (result.orders) {
      orders = result.orders
      ordersLoaded = result.ok
    }
    if (result.order) {
      const current = result.order
      orders = [current, ...orders.filter((order) => order.id !== current.id)]
      if (selected?.id === current.id) {
        selected = current
      }
    }
    return true
  }
  function afterRequest(): void {
    busy = ''
    if (reloadQueued && !disposed) {
      reloadQueued = false
      void load()
    }
  }
  async function load(): Promise<void> {
    if (busy || disposed) return
    busy = 'load'
    error = ''
    const initial = generation
    let current = initial
    try {
      const session = await platform.account('session')
      if (disposed || generation !== initial) return
      acceptAccount(session.state)
      if (!session.ok && session.state.user) error = errorText(session.error)
      const owner = account.user?.id
      if (!owner || !account.supported) return
      current = generation
      const status = await platform.support('status')
      if (!accept(status, current, owner)) return
      if (!status.ok) return
      const history = await platform.support('orders')
      accept(history, current, owner)
    } catch {
      if (!disposed && generation === current) error = errorText('OFFLINE')
    } finally {
      afterRequest()
    }
  }
  async function request(operation: SupportOperation, input?: SupportInput): Promise<void> {
    const owner = account.user?.id
    if (!owner || busy || disposed || !account.online) return
    const current = generation
    busy = operation
    error = ''
    if (operation === 'close') selectedVerified = false
    try {
      const result = await platform.support(operation, input)
      if (!accept(result, current, owner)) return
      if (operation === 'refresh' && result.ok && result.order?.id === selected?.id)
        selectedVerified = true
      if (operation === 'create' && result.order) {
        selected = result.order
        selectedVerified = result.ok
      }
      if (operation === 'close' && result.ok && result.order) selected = result.order
      // 结果不明时重新读取同一账号的记录，不从界面猜测订单已经关闭。
      if (!result.ok && operation === 'create') {
        const history = await platform.support('orders')
        const originalError = error
        if (accept(history, current, owner)) error = originalError
      }
    } catch {
      if (!disposed && generation === current) {
        account = { ...account, online: false }
        error = errorText('PAYMENT_STATUS_UNKNOWN')
      }
    } finally {
      afterRequest()
    }
  }
  function review(): void {
    if (!canCreate || amountFen === null) return
    confirmationOwner = account.user!.id
    confirmAmount = amountFen
  }
  function purchase(): void {
    const amount = confirmAmount
    confirmAmount = null
    if (
      amount === null ||
      confirmationOwner !== account.user?.id ||
      !canCreate ||
      amount !== amountFen
    )
      return
    confirmationOwner = ''
    void request('create', { amountFen: amount })
  }
  function viewOrder(order: SupportOrder): void {
    selectedVerified = false
    selected = order
    if (account.online && !busy) void request('refresh', { orderId: order.id })
  }
  function orderStatus(order: SupportOrder): string {
    return t(
      `account.support.${order.status === 'refund_review' ? 'refundReview' : order.status === 'pending' && order.payment?.state === 'creating' ? 'creating' : order.status}`
    )
  }
  onMount(() => {
    heading?.focus({ preventScroll: true })
    const listener = (event: Event): void =>
      accountChanged((event as CustomEvent<AccountState>).detail)
    window.addEventListener('qonlang-account-state', listener)
    void load()
    return () => {
      disposed = true
      generation++
      clearPrivate()
      window.removeEventListener('qonlang-account-state', listener)
    }
  })
</script>

<div class="support-root" data-support-page>
  <section
    class="support-page"
    inert={confirmAmount !== null || selected !== null}
    aria-labelledby="support-title"
  >
    <button class="btn back" data-support-page-back onclick={onback}
      ><ArrowLeft size={16} />{t('account.support.back')}</button
    >
    <header class="intro">
      <span class="mark"><Coffee size={31} strokeWidth={1.4} /></span>
      <div>
        <h1 id="support-title" tabindex="-1" bind:this={heading}>{t('account.support.title')}</h1>
        <p>{t('account.support.intro')}</p>
      </div>
    </header>
    {#if !account.supported}<p class="notice">{t('account.support.desktopOnly')}</p>
    {:else if !account.user}
      <p class="notice">{t('account.support.loginHint')}</p>
      <AccountPanel />
    {:else}
      <div class="account-summary">
        <span><UserRound size={16} />{account.user.nickname} (@{account.user.username})</span>
        <button class="btn sm" onclick={() => (manageAccount = !manageAccount)}
          >{t('account.support.manageAccount')}</button
        >
      </div>
      {#if manageAccount}<AccountPanel />{/if}
      {#if !account.online}<p class="notice" role="status">{t('account.support.offlineOrder')}</p>
      {:else if !enabled && !busy}<p class="notice" role="status">
          {t('account.support.unavailable')}
        </p>{/if}
      {#if pending}<div class="notice pending" data-support-pending-order>
          <div>
            <strong>{t('account.support.pendingTitle')}</strong>
            <p>{t('account.support.pendingHint')}</p>
          </div>
          <button
            class="btn"
            data-support-resume-order
            disabled={!!busy}
            onclick={() => viewOrder(pending!)}>{t('account.support.resume')}</button
          >
        </div>{/if}
      <div class="card amount-card">
        <label for="support-amount"
          >{t('account.support.amount')}<HelpDot
            tip={t('account.support.amountHint', {
              min: supportYuan(capability?.minAmountFen ?? 1),
              max: supportYuan(capability?.maxAmountFen ?? 60000)
            })}
          /></label
        >
        <div class="amount-entry">
          <span aria-hidden="true">¥</span><input
            id="support-amount"
            data-support-custom-amount
            type="text"
            inputmode="decimal"
            autocomplete="off"
            maxlength="8"
            bind:value={ui.supportAmount}
            disabled={!!busy || !!pending}
            aria-describedby="support-amount-hint"
            aria-invalid={!!ui.supportAmount && amountFen === null}
          />
        </div>
        <p id="support-amount-hint" class="small muted">
          {t('account.support.amountHint', {
            min: supportYuan(capability?.minAmountFen ?? 1),
            max: supportYuan(capability?.maxAmountFen ?? 60000)
          })}
        </p>
        {#if ui.supportAmount && amountFen === null}<p class="error" role="status">
            {t('account.support.invalidAmount')}
          </p>{/if}
        <div class="amount-bottom">
          <p>{t('account.support.purpose')}</p>
          <button class="btn primary" data-support-create disabled={!canCreate} onclick={review}
            >{t('account.support.review')}</button
          >
        </div>
      </div>
      <section class="history" aria-labelledby="support-history-title">
        <div class="history-head">
          <h2 id="support-history-title">{t('account.support.history')}</h2>
          <button class="btn sm" data-support-orders disabled={!!busy} onclick={() => void load()}
            ><RefreshCw size={14} />{busy === 'load'
              ? t('common.loading')
              : t('account.support.refreshOrders')}</button
          >
        </div>
        {#if ordersLoaded && !orders.length}<p class="muted small">
            {t('account.support.noOrders')}
          </p>{/if}
        {#each orders as order (order.id)}<div class="order-row" data-support-order={order.id}>
            <div>
              <strong>¥{supportYuan(order.amountFen)}</strong><span>{orderStatus(order)}</span
              ><small>{order.id}</small>
            </div>
            <button
              class="btn sm"
              data-support-order-view={order.id}
              disabled={!!busy}
              onclick={() => viewOrder(order)}>{t('account.support.view')}</button
            >
          </div>{/each}
      </section>
    {/if}
    {#if busy}<p class="small muted" role="status">{t('account.support.checking')}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="privacy"><HelpDot tip={t('account.help')} />{t('account.support.privacy')}</p>
  </section>
</div>

{#if confirmAmount !== null}<div class="confirm-overlay" data-support-confirmation>
    <button
      class="scrim"
      tabindex="-1"
      aria-label={t('common.cancel')}
      onclick={() => (confirmAmount = null)}
    ></button>
    <div
      class="confirmation"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="support-confirm-title"
      aria-describedby="support-confirm-description"
      tabindex="-1"
      use:supportDialogFocus={() => (confirmAmount = null)}
    >
      <h2 id="support-confirm-title">{t('account.support.confirmTitle')}</h2>
      <strong class="confirm-amount">¥{supportYuan(confirmAmount)}</strong>
      <p id="support-confirm-description">{t('account.support.confirmDescription')}</p>
      <div class="confirm-actions">
        <button class="btn" data-support-confirm-cancel onclick={() => (confirmAmount = null)}
          >{t('common.cancel')}</button
        >
        <button
          class="btn primary"
          data-support-confirm-create
          disabled={!canCreate}
          onclick={purchase}>{t('account.support.confirmPay')}</button
        >
      </div>
    </div>
  </div>{/if}
{#if selected}<SupportPaymentDialog
    order={selected}
    verified={selectedVerified}
    online={account.online}
    {enabled}
    busy={!!busy}
    {error}
    onrefresh={() => void request('refresh', { orderId: selected!.id })}
    oncloseorder={() => void request('close', { orderId: selected!.id })}
    onhide={() => (selected = null)}
  />{/if}

<style>
  .support-root {
    height: 100%;
    overflow-y: auto;
    background: var(--bg);
    color: var(--text);
  }
  .support-page {
    max-width: 900px;
    margin-inline: auto;
    padding: 26px clamp(20px, 5vw, 58px) 36px;
  }
  .back {
    margin-block-end: 26px;
  }
  .intro {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-block-end: 28px;
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 70px;
    height: 70px;
    background: var(--accent-soft);
    border: 1px solid var(--border);
    border-radius: 20px;
    color: var(--accent-text);
  }
  h1 {
    font-size: 28px;
    line-height: 1.35;
    margin: 0;
    outline: none;
  }
  .intro p {
    font-size: 13px;
    margin: 8px 0 0;
    color: var(--text-2);
    line-height: 1.7;
  }
  .notice {
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.8;
    color: var(--text-2);
    background: var(--bg-elev);
    margin-block: 16px;
  }
  .pending,
  .account-summary,
  .history-head,
  .amount-bottom,
  .order-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .pending p {
    margin: 5px 0 0;
    font-size: 12px;
  }
  .account-summary {
    margin-block-end: 18px;
    font-size: 13px;
    flex-wrap: wrap;
  }
  .account-summary > span {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    overflow-wrap: anywhere;
  }
  .amount-card {
    padding: 24px;
    margin-block: 22px;
    background: var(--bg-elev);
  }
  label {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 14px;
  }
  .amount-entry {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 210px;
    max-width: 100%;
    padding: 10px 13px;
    margin-block: 14px 8px;
    border: 1px solid var(--border);
    border-radius: 9px;
    font-size: 24px;
    background: var(--bg);
  }
  .amount-entry:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .amount-bottom {
    margin-block-start: 21px;
    padding-block-start: 15px;
    border-block-start: 1px solid var(--border);
  }
  .amount-bottom p {
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.7;
    max-width: 500px;
    margin: 0;
  }
  .amount-bottom .btn,
  .pending .btn {
    flex-shrink: 0;
  }
  h2 {
    font-size: 17px;
    margin: 0;
  }
  .history {
    margin-block-start: 30px;
  }
  .order-row {
    border-block-end: 1px solid var(--border);
    padding-block: 16px;
  }
  .order-row > div {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 5px 14px;
  }
  .order-row strong {
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  .order-row span {
    font-size: 12px;
    color: var(--text-2);
  }
  .order-row small {
    flex-basis: 100%;
    font-size: 11px;
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .error {
    font-size: 12px;
    line-height: 1.8;
    color: var(--danger);
  }
  .privacy {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text-2);
    font-size: 11px;
    line-height: 1.7;
    margin-block-start: 25px;
  }
  .confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: 1300;
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
  .confirmation {
    position: relative;
    width: min(100%, 470px);
    max-height: calc(100dvh - 40px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 26px;
    border: 1px solid var(--border, #7f887d);
    border-radius: 18px;
    background: var(--bg-elev, #ffffff);
    color: var(--text, #202820);
    box-shadow: 0 24px 80px #0006;
    outline: none;
  }
  .confirm-amount {
    display: block;
    margin-block: 20px;
    font-size: 32px;
    font-variant-numeric: tabular-nums;
  }
  .confirmation p {
    font-size: 13px;
    line-height: 1.8;
    color: var(--text-2);
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
    margin-block-start: 22px;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (max-width: 650px) {
    .amount-bottom,
    .pending {
      align-items: flex-start;
      flex-direction: column;
    }
    .amount-bottom .btn {
      width: 100%;
    }
    .intro {
      gap: 14px;
    }
    .mark {
      width: 55px;
      height: 55px;
    }
    h1 {
      font-size: 24px;
    }
    .amount-card {
      padding: 18px;
    }
  }
</style>
