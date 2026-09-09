<script lang="ts">
  import { onMount } from 'svelte'
  import { platform } from '$lib/platform'
  import { ui } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { parseProject } from '$lib/core/serialize'
  import { SECTIONS, type Section } from '$lib/state/ui.svelte'
  import { chars } from '$lib/state/chars.svelte'
  import { fontLibrary } from '$lib/state/fonts.svelte'
  import Welcome from './views/Welcome.svelte'
  import Shell from './views/Shell.svelte'
  import Toasts from '$lib/ui/Toasts.svelte'
  import ProgressOverlay from '$lib/ui/ProgressOverlay.svelte'
  import UpdateNotice from '$lib/ui/UpdateNotice.svelte'

  let ready = $state(false)
  let snapshot = $state<string | null>(null)

  onMount(() => {
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
      snapshot = await platform.loadSnapshot()
      if (!snapshot && ui.prefs.reopenLast) {
        const recent = await platform.getRecent()
        if (recent[0]) {
          const r = await platform.openRecent(recent[0]).catch(() => null)
          if (r) {
            try {
              projectState.load(parseProject(r.content), r.target)
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
      stopTheme()
      stopChars()
    }
  })

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
  <Welcome
    {snapshot}
    onsnapshothandled={() => {
      snapshot = null
    }}
  />
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
