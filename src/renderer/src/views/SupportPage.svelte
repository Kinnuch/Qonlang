<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowLeft, Coffee } from '@lucide/svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { SUPPORT_PAYMENT_MODE } from '../../../shared/support-mode'
  import personalQr from '../assets/img/wechat-qr.png'
  import ApiSupportPage from './ApiSupportPage.svelte'

  let { onback }: { onback: () => void } = $props()
  let heading = $state<HTMLHeadingElement | undefined>()
  onMount(() => heading?.focus({ preventScroll: true }))
</script>

{#if SUPPORT_PAYMENT_MODE === 'api'}
  <ApiSupportPage {onback} />
{:else}
  <div class="support-root" data-support-page data-support-mode="personal-qr">
    <section class="support-page" aria-labelledby="personal-support-title">
      <button class="btn back" data-support-page-back onclick={onback}
        ><ArrowLeft size={16} />{t('account.support.back')}</button
      >
      <header class="intro">
        <span class="mark"><Coffee size={31} strokeWidth={1.4} /></span>
        <div>
          <h1 id="personal-support-title" tabindex="-1" bind:this={heading}>
            {t('account.support.title')}
          </h1>
          <p>{t('account.support.personalIntro')}</p>
        </div>
      </header>
      <figure class="qr-card" aria-describedby="personal-support-caption">
        <img
          class="personal-qr"
          data-personal-support-qr
          src={personalQr}
          alt={t('account.support.personalAlt')}
          width="640"
          height="707"
        />
        <figcaption id="personal-support-caption" data-personal-support-caption>
          <strong>{t('account.support.personalCode')}</strong>
          <p>{t('account.support.personalHint')}</p>
        </figcaption>
      </figure>
    </section>
  </div>
{/if}

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
  .intro p,
  figcaption p {
    font-size: 13px;
    margin-block: 8px 0;
    color: var(--text-2);
    line-height: 1.7;
  }
  .qr-card {
    width: min(100%, 400px);
    margin: 0 auto;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elev);
    text-align: center;
  }
  .personal-qr {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 10px;
  }
  figcaption {
    margin-block-start: 16px;
  }
  figcaption strong {
    font-size: 14px;
  }
  @media (max-width: 600px) {
    .support-page {
      padding: 20px 16px 28px;
    }
    .intro {
      gap: 14px;
    }
    .mark {
      width: 52px;
      height: 52px;
      border-radius: 16px;
    }
    h1 {
      font-size: 24px;
    }
    .qr-card {
      padding: 14px;
    }
  }
</style>
