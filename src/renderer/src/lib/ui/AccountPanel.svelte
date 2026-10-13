<script lang="ts">
  import { onMount } from 'svelte'
  import {
    platform,
    type AccountOperation,
    type AccountInput,
    type AccountState
  } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import HelpDot from './HelpDot.svelte'

  const id = $props.id()
  let accountState = $state<AccountState>({
    supported: platform.kind === 'electron',
    online: true,
    persisted: false,
    user: null
  })
  let mode = $state<'login' | 'register'>('login')
  let username = $state('')
  let password = $state('')
  let nickname = $state('')
  let busy = $state(false)
  let error = $state('')
  const errorCodes = new Set([
    'OFFLINE',
    'INVALID_CREDENTIALS',
    'USERNAME_TAKEN',
    'RATE_LIMITED',
    'INVALID_INPUT',
    'INVALID_USERNAME',
    'INVALID_PASSWORD',
    'INVALID_NICKNAME',
    'UNAUTHORIZED',
    'SESSION_EXPIRED',
    'SERVICE_UNAVAILABLE',
    'STORAGE_FAILURE',
    'LOGOUT_OFFLINE'
  ])
  async function request(operation: AccountOperation, input?: AccountInput): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    try {
      const result = await platform.account(operation, input)
      accountState = result.state
      error =
        result.error && errorCodes.has(result.error)
          ? result.error
          : result.ok
            ? ''
            : 'SERVICE_UNAVAILABLE'
      if (accountState.user && result.ok) nickname = accountState.user.nickname
      if (operation === 'logout' && !accountState.user) nickname = ''
    } catch {
      error = 'SERVICE_UNAVAILABLE'
    } finally {
      password = ''
      busy = false
    }
  }
  onMount(() => {
    void request('session')
  })
</script>

<section class="card account" data-account-panel>
  <h3>{t('account.title')}<HelpDot tip={t('account.help')} /></h3>
  <p class="intro">{t('account.optional')}</p>
  {#if !accountState.supported}
    <p>{t('account.desktopOnly')}</p>
  {:else}
    {#if !accountState.online}<p class="status" role="status">{t('account.offline')}</p>{/if}
    {#if accountState.user}
      <div class="status" data-account-signed-in>
        <span
          >{t('account.signedIn')}：<strong>{accountState.user.nickname}</strong> (@{accountState
            .user.username})</span
        >
        <button class="btn" disabled={busy} onclick={() => request('logout')}
          >{t('account.logout')}</button
        >
      </div>
      {#if !accountState.persisted}<p class="status">{t('account.temporary')}</p>{/if}
      <form
        onsubmit={(event) => {
          event.preventDefault()
          void request('profile', { nickname })
        }}
      >
        <label for={`${id}-nickname`}>{t('account.nickname')}</label>
        <div class="actions">
          <input
            id={`${id}-nickname`}
            class="input"
            data-account-nickname
            bind:value={nickname}
            maxlength="40"
            required
            disabled={busy}
            autocomplete="nickname"
          />
          <button class="btn" disabled={busy || !nickname.trim()}
            >{t('account.saveNickname')}</button
          >
        </div>
      </form>
    {:else}
      <div class="actions modes">
        <button
          class="btn"
          type="button"
          aria-pressed={mode === 'login'}
          disabled={busy}
          onclick={() => {
            mode = 'login'
            error = ''
          }}>{t('account.login')}</button
        >
        <button
          class="btn"
          type="button"
          aria-pressed={mode === 'register'}
          disabled={busy}
          onclick={() => {
            mode = 'register'
            error = ''
          }}>{t('account.register')}</button
        >
      </div>
      <form
        onsubmit={(event) => {
          event.preventDefault()
          void request(mode, {
            username,
            password,
            ...(mode === 'register' && nickname.trim() ? { nickname } : {})
          })
        }}
      >
        <div class="field">
          <label for={`${id}-username`}
            >{t('account.username')}<HelpDot tip={t('account.usernameHint')} /></label
          >
          <input
            id={`${id}-username`}
            class="input"
            data-account-username
            bind:value={username}
            minlength="3"
            maxlength="32"
            pattern={'[A-Za-z0-9_]{3,32}'}
            required
            disabled={busy}
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
          />
        </div>
        <div class="field">
          <label for={`${id}-password`}
            >{t('account.password')}<HelpDot tip={t('account.passwordHint')} /></label
          >
          <input
            id={`${id}-password`}
            class="input"
            data-account-password
            type="password"
            bind:value={password}
            minlength="10"
            maxlength="128"
            required
            disabled={busy}
            autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
        </div>
        {#if mode === 'register'}
          <div class="field">
            <label for={`${id}-register-nickname`}>{t('account.nickname')}</label>
            <input
              id={`${id}-register-nickname`}
              class="input"
              data-account-nickname
              bind:value={nickname}
              maxlength="40"
              disabled={busy}
              autocomplete="nickname"
            />
          </div>
        {/if}
        <button class="btn primary" data-account-submit disabled={busy}
          >{mode === 'login' ? t('account.login') : t('account.register')}</button
        >
      </form>
    {/if}
    {#if busy}<p role="status">{t('account.checking')}</p>{/if}
    {#if error}<p class="error" role="alert">{t(`account.errors.${error}`)}</p>{/if}
    <button class="btn retry" type="button" disabled={busy} onclick={() => request('session')}
      >{t('account.retry')}</button
    >
  {/if}
</section>

<style>
  .account {
    padding: 14px 18px;
    min-width: 0;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 14px;
    margin: 0 0 8px;
  }
  .intro {
    color: var(--text-2);
    font-size: 12px;
    margin: 0 0 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-block-end: 10px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    margin-block-end: 4px;
  }
  .actions,
  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .actions input {
    flex: 1 1 160px;
    min-width: 0;
    width: auto;
  }
  .modes {
    margin-block-end: 10px;
  }
  .status {
    margin-block-end: 10px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--danger);
    font-size: 12px;
  }
  .retry {
    margin-block-start: 10px;
  }
</style>
