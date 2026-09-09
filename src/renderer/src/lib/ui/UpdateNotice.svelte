<script lang="ts">
  /**
   * 新版本提示。只提示与打开下载页，不碰用户的项目：
   * 不自动下载、不自动重启，当前工程始终留在原处。
   */
  import { onMount } from 'svelte'
  import { platform, type UpdateInfo } from '$lib/platform'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { Download, X } from '@lucide/svelte'

  let info = $state<UpdateInfo | null>(null)

  onMount(() => {
    // 等界面先跑起来，别跟启动抢
    const timer = setTimeout(async () => {
      if (!ui.prefs.checkUpdates) return
      try {
        const found = await platform.checkUpdate()
        if (found && found.version !== ui.prefs.skippedVersion) info = found
      } catch {
        // 离线或接口出错都当没有更新
      }
    }, 4000)
    return () => clearTimeout(timer)
  })

  function later(): void {
    info = null
  }
  function skip(): void {
    if (info) ui.prefs.skippedVersion = info.version
    void ui.savePrefs()
    info = null
  }
  function open(): void {
    if (info) void platform.openExternal(info.url)
    info = null
  }
</script>

{#if info}
  <div class="wrap card" role="dialog" aria-label={t('update.title')}>
    <div class="row head">
      <strong class="grow">{t('update.title', { version: info.version })}</strong>
      <button class="btn ghost icon sm" onclick={later}><X size={14} /></button>
    </div>
    <p class="small muted">{t('update.body')}</p>
    {#if info.notes}
      <pre class="notes small">{info.notes}</pre>
    {/if}
    <div class="row foot">
      <button class="btn primary sm" onclick={open}
        ><Download size={14} />{t('update.download')}</button
      >
      <button class="btn ghost sm" onclick={later}>{t('update.later')}</button>
      <span class="grow"></span>
      <button class="btn ghost sm" onclick={skip}>{t('update.skip')}</button>
    </div>
  </div>
{/if}

<style>
  .wrap {
    position: fixed;
    right: 16px;
    bottom: 16px;
    width: min(360px, 90vw);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: var(--shadow-lg);
    z-index: 110;
    animation: rise 0.16s ease-out;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .notes {
    margin: 0;
    max-height: 140px;
    overflow: auto;
    white-space: pre-wrap;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    color: var(--text-2);
  }
  .foot {
    gap: 6px;
  }
</style>
