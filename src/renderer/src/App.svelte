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

  let ready = $state(false)
  let snapshot = $state<string | null>(null)

  onMount(() => {
    const stopTheme = ui.watchSystemTheme()
    const stopChars = chars.install()
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

  function onKeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
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

<style>
  .boot {
    height: 100%;
    display: grid;
    place-items: center;
  }
</style>
