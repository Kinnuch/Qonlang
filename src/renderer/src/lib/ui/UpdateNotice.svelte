<script lang="ts">
  /**
   * 新版本提示。用户点「下载并安装」才动手：应用内下载安装包，下好先把未保存的项目存盘，
   * 再静默安装（沿用上次的安装目录）并重开。没有本机安装包时只打开下载页。
   */
  import { onMount } from 'svelte'
  import { platform, type UpdateInfo } from '$lib/platform'
  import { ui } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { Download, X } from '@lucide/svelte'

  let info = $state<UpdateInfo | null>(null)
  let phase = $state<'idle' | 'downloading' | 'installing' | 'failed'>('idle')
  let received = $state(0)
  let total = $state(0)
  let error = $state('')

  onMount(() => {
    platform.onUpdateProgress((p) => {
      received = p.received
      total = p.total
    })
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
  function openPage(): void {
    if (info) void platform.openExternal(info.url)
    info = null
  }
  async function install(): Promise<void> {
    if (!info?.installer) return openPage()
    phase = 'downloading'
    received = 0
    total = info.installer.size
    const r = await platform.downloadUpdate(info.installer.url, info.installer.name)
    if (!r.ok || !r.path) {
      phase = 'failed'
      error = r.error ?? ''
      return
    }
    // 没保存的先存：安装会关掉软件
    if (projectState.dirty) {
      const saved = await projectState.save()
      if (!saved) {
        phase = 'idle'
        return
      }
    }
    phase = 'installing'
    await platform.installUpdate(r.path)
  }
  const pct = $derived(total ? Math.min(100, Math.round((received / total) * 100)) : 0)
  const mb = (n: number): string => (n / 1048576).toFixed(1)
</script>

{#if info}
  <div class="wrap card" role="dialog" aria-label={t('update.title')}>
    <div class="row head">
      <strong class="grow">{t('update.title', { version: info.version })}</strong>
      {#if phase === 'idle' || phase === 'failed'}
        <button class="btn ghost icon sm" onclick={later}><X size={14} /></button>
      {/if}
    </div>
    {#if phase === 'downloading'}
      <p class="small muted">
        {t('update.downloading', { pct, done: mb(received), total: mb(total) })}
      </p>
      <div class="bar"><div class="fill" style:width="{pct}%"></div></div>
    {:else if phase === 'installing'}
      <p class="small muted">{t('update.installing')}</p>
    {:else}
      <p class="small muted">{info.installer ? t('update.bodyAuto') : t('update.body')}</p>
      {#if phase === 'failed'}
        <p class="small bad">{t('update.failed', { err: error })}</p>
      {/if}
      {#if info.notes}
        <pre class="notes small">{info.notes}</pre>
      {/if}
      <div class="row foot">
        <button class="btn primary sm" onclick={install}
          ><Download size={14} />{info.installer
            ? t('update.install')
            : t('update.download')}</button
        >
        {#if info.installer}
          <button class="btn ghost sm" onclick={openPage}>{t('update.page')}</button>
        {/if}
        <button class="btn ghost sm" onclick={later}>{t('update.later')}</button>
        <span class="grow"></span>
        <button class="btn ghost sm" onclick={skip}>{t('update.skip')}</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .wrap {
    position: fixed;
    right: 16px;
    bottom: 16px;
    width: min(380px, 90vw);
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
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
  }
  .foot {
    gap: 6px;
    flex-wrap: wrap;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--bg-sunken);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .bad {
    color: var(--danger);
  }
</style>
