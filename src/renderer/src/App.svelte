<script lang="ts">
  import { onMount } from 'svelte'
  import { pluginHost } from '$lib/plugins/host.svelte'
  import { wireMcp } from '$lib/mcp/bridge.svelte'
  import { platform } from '$lib/platform'
  import { ui } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { i18n, t } from '$lib/i18n/index.svelte'
  import { errorMessage } from '$lib/ui/errorText'
  import { parseProject, readProjectText } from '$lib/core/serialize'
  import { SECTIONS, type Section } from '$lib/state/ui.svelte'
  import { chars } from '$lib/state/chars.svelte'
  import { fontLibrary } from '$lib/state/fonts.svelte'
  import Welcome from './views/Welcome.svelte'
  import Shell from './views/Shell.svelte'
  import Toasts from '$lib/ui/Toasts.svelte'
  import ProgressOverlay from '$lib/ui/ProgressOverlay.svelte'
  import UpdateNotice from '$lib/ui/UpdateNotice.svelte'
  import { refreshPage } from '$lib/ui/refresh'
  import { backgroundStyle } from '$lib/skin/presets'

  let ready = $state(false)
  let snapshot = $state<string | null>(null)

  onMount(() => {
    // 页面边界接不到的错（点按钮时的处理函数、异步任务）：也挂一条红条，不让它悄悄没了
    const shown = (e: unknown): void => {
      const msg = errorMessage(e, i18n.locale)
      // 窗口大小变化时浏览器自己报的良性警告，不算出错
      if (/ResizeObserver loop/i.test(msg)) return
      ui.crash(t('errors.unexpectedTitle'), msg)
    }
    const onError = (e: ErrorEvent): void => shown(e.error ?? e.message)
    const onRejection = (e: PromiseRejectionEvent): void => shown(e.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    const stopTheme = ui.watchSystemTheme()
    const stopChars = chars.install()
    platform.onMenu((a) => {
      if (a === 'save' && projectState.project) void projectState.save()
      else if (a === 'saveAs' && projectState.project) void projectState.save(true)
      else if (a === 'open') void projectState.open()
      else if (a === 'undo') projectState.undo()
      else if (a === 'redo') projectState.redo()
      else if (a === 'back') ui.back()
      else if (a === 'palette' && projectState.project) ui.paletteOpen = !ui.paletteOpen
      else if (a === 'chars') chars.toggle()
    })
    void (async () => {
      await ui.loadPrefs()
      fontLibrary.onProgress()
      void fontLibrary.refresh()
      // 插件：设置读出来之后再载（要看 disabledPlugins），失败不挡启动
      void pluginHost.loadAll().catch(() => {})
      // MCP：接上主进程转来的请求；设置里开着就把服务起起来
      wireMcp()
      if (ui.prefs.mcpEnabled && ui.prefs.mcpToken)
        void platform.mcpStart(ui.prefs.mcpPort ?? 7421, ui.prefs.mcpToken)
      snapshot = await platform.loadSnapshot()
      if (!snapshot && ui.prefs.reopenLast) {
        const recent = await platform.getRecent()
        if (recent[0]) {
          const r = await platform.openRecent(recent[0]).catch(() => null)
          if (r) {
            try {
              projectState.load(parseProject(await readProjectText(r.content)), r.target)
              const initial = (await platform.info()).initialSection
              if (initial && SECTIONS.includes(initial as Section)) ui.section = initial as Section
            } catch {
              /* 留在欢迎页 */
            }
          }
        }
      }
      ready = true
    })()

    platform.onSaveAndClose(async () => {
      if (await projectState.save()) platform.closeNow()
    })

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      stopTheme()
      stopChars()
    }
  })

  /** 这套皮肤有没有花纹（星月夜的星点）：没有就不画那一层 */
  const hasPattern = $derived(
    !!ui.prefs.skin?.[ui.resolvedTheme]?.['--skin-pattern'] ||
      !!ui.prefs.skin?.light?.['--skin-pattern'] ||
      !!ui.prefs.skin?.dark?.['--skin-pattern']
  )

  // 标题栏
  $effect(() => {
    const name = projectState.project?.meta.name || ''
    document.title = (projectState.dirty ? '● ' : '') + (name ? `${name} — ` : '') + t('app.name')
  })

  // 自动保存
  $effect(() => {
    const secs = ui.prefs.autosaveSeconds
    if (!secs || secs <= 0) return
    const id = setInterval(() => {
      if (projectState.dirty && projectState.target && !projectState.saving)
        void projectState.save()
    }, secs * 1000)
    return () => clearInterval(id)
  })

  // 崩溃恢复快照：脏了 5 秒后写一份
  $effect(() => {
    if (!projectState.dirty) return
    const id = setTimeout(() => void projectState.snapshot(), 5000)
    return () => clearTimeout(id)
  })

  function isEditable(el: EventTarget | null): boolean {
    const h = el as HTMLElement | null
    return !!h && (h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.isContentEditable)
  }
  function onKeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'F5' && projectState.project) {
      e.preventDefault()
      refreshPage()
      return
    }
    if (e.altKey && e.key === 'ArrowLeft' && projectState.project) {
      e.preventDefault()
      ui.back()
      return
    }
    if (!mod) return
    // 撤销 / 重做：焦点在输入框里时交给输入框自己的撤销
    if ((e.key === 'z' || e.key === 'Z') && !isEditable(e.target) && projectState.project) {
      e.preventDefault()
      if (e.shiftKey) projectState.redo()
      else projectState.undo()
      return
    }
    if ((e.key === 'y' || e.key === 'Y') && !isEditable(e.target) && projectState.project) {
      e.preventDefault()
      projectState.redo()
      return
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault()
      if (projectState.project) void projectState.save(e.shiftKey)
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault()
      void projectState.open()
    } else if (e.key === '\\') {
      e.preventDefault()
      ui.inspectorOpen = !ui.inspectorOpen
    } else if (e.key === 'k' || e.key === 'K') {
      e.preventDefault()
      if (projectState.project) ui.paletteOpen = !ui.paletteOpen
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault()
      chars.toggle()
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if !ready}
  <div class="boot muted">{t('common.loading')}</div>
{:else if projectState.project}
  <Shell />
{:else}
  <svelte:boundary
    onerror={(e, reset) => {
      console.error(e)
      ui.crash(t('errors.crashTitle', { page: t('nav.welcome') }), errorMessage(e, i18n.locale))
      setTimeout(reset, 0)
    }}
  >
    <Welcome
      {snapshot}
      onsnapshothandled={() => {
        snapshot = null
      }}
    />
  </svelte:boundary>
{/if}
<!-- 皮肤盖在窗口上的两层：预设的花纹（星月夜的星点）和自定义背景图，都不接鼠标。
     没花纹时这一层不画，省一层盖住整个窗口的合成层 -->
{#if hasPattern}
  <div class="skin-pattern" aria-hidden="true"></div>
{/if}
{#if ui.prefs.skin?.background?.image}
  <div class="skin-bg" aria-hidden="true" style={backgroundStyle(ui.prefs.skin.background)}></div>
{/if}
<Toasts />
<ProgressOverlay />
<UpdateNotice />

<style>
  .boot {
    height: 100%;
    display: grid;
    place-items: center;
  }
</style>
