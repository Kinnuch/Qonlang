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
  let phase = $state<'idle' | 'downloading' | 'installing' | 'manual' | 'failed'>('idle')
  let received = $state(0)
  let total = $state(0)
  let error = $state('')

  /** 这次运行里点过「稍后再说」的版本：同一个版本不再反复弹，出了更新的版本照样提示 */
  let dismissed = ''
  async function check(): Promise<void> {
    // 正在下载或安装时不再查；已经在提示了也不再查——除非那时 Release 上还没有本机的安装包（另一个平台的包先传完了），
    // 再查一次，传上来了就换成能直接装的
    if (!ui.prefs.checkUpdates || phase !== 'idle' || (info && info.installer)) return
    try {
      const found = await platform.checkUpdate()
      if (info && found?.version !== info.version) return
      if (found && found.version !== ui.prefs.skippedVersion && found.version !== dismissed)
        info = found
    } catch {
      // 离线或接口出错都当没有更新
    }
  }

  onMount(() => {
    platform.onUpdateProgress((p) => {
      received = p.received
      total = p.total
    })
    // 等界面先跑起来，别跟启动抢
    const timer = setTimeout(check, 4000)
    return () => clearTimeout(timer)
  })
  // 之后程序开着就按设置里的间隔一直查（默认 5 分钟）；改了间隔或开关立刻按新的来
  $effect(() => {
    if (!ui.prefs.checkUpdates) return
    const minutes = Math.min(1440, Math.max(1, Number(ui.prefs.updateCheckMinutes) || 5))
    const id = setInterval(check, minutes * 60_000)
    return () => clearInterval(id)
  })

  function later(): void {
    if (info) dismissed = info.version
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
  /**
   * 装之前把项目存好（安装会关掉软件）。存过盘的（有文件位置）直接存；
   * 没存过的弹另存为，取消了先问一句「更新进度会归零」——确定放弃就不装这次的更新，不放弃就再弹一次另存为
   */
  async function saveBeforeInstall(): Promise<boolean> {
    if (projectState.target) return projectState.save()
    for (;;) {
      if (await projectState.save(true)) return true
      const giveUp = await ui.confirm(
        t('update.cancelSaveTitle'),
        t('update.cancelSaveBody'),
        t('update.cancelSaveOk')
      )
      if (giveUp) return false
    }
  }
  async function install(): Promise<void> {
    if (!info?.installer) return openPage()
    // 真正开始下载（增量要先比对出要下多少）之前没有进度，显示「校验中」，进度条等第一次进度来了才出
    phase = 'downloading'
    received = 0
    total = 0
    const r = await platform.downloadUpdate(info.installer.url, info.installer.name, info.version)
    if (!r.ok || !r.path) {
      phase = 'failed'
      error = r.error ?? ''
      return
    }
    if (projectState.dirty && !(await saveBeforeInstall())) {
      phase = 'idle'
      received = 0
      total = 0
      return
    }
    phase = 'installing'
    const done = await platform.installUpdate(r.path)
    if (!done.ok) {
      phase = 'failed'
      error = done.error ?? ''
    } else if (done.manual) phase = 'manual'
  }
  const pct = $derived(total ? Math.min(100, Math.round((received / total) * 100)) : 0)
  /** 还没开始下（增量在比对）、或者下完了在核对 sha：都显示「校验中」 */
  const verifying = $derived(phase === 'downloading' && (!total || received >= total))
  const mb = (n: number): string => (n / 1048576).toFixed(1)
</script>

{#if info}
  <div class="wrap card" role="dialog" aria-label={t('update.title')}>
    <div class="row head">
      <strong class="grow">{t('update.title', { version: info.version })}</strong>
      {#if phase === 'idle' || phase === 'failed' || phase === 'manual'}
        <button class="btn ghost icon sm" onclick={later}><X size={14} /></button>
      {/if}
    </div>
    {#if phase === 'downloading' && verifying}
      <p class="small muted">{t('update.verifying')}</p>
    {:else if phase === 'downloading'}
      <p class="small muted">
        {t('update.downloading', { pct, done: mb(received), total: mb(total) })}
      </p>
      <div class="bar"><div class="fill" style:width="{pct}%"></div></div>
    {:else if phase === 'installing'}
      <p class="small muted">{t('update.installing')}</p>
    {:else if phase === 'manual'}
      <p class="small">{t('update.manualNext')}</p>
    {:else}
      <p class="small muted">
        {info.installer
          ? info.installer.auto === false
            ? t('update.bodyManual')
            : t('update.bodyAuto')
          : t('update.body')}
      </p>
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
