/**
 * 插件宿主：列出装了哪些插件、载入 / 卸载它们。
 * 插件是 ES 模块，用 `qnlplugin://<目录>/<入口>` 载入（主进程里注册的协议，只能取插件目录里的文件）。
 * 跟应用同权限跑，所以设置页里写明了「装别人的插件前先看代码」。
 */
import { platform } from '$lib/platform'
import { ui } from '$lib/state/ui.svelte'
import { makePluginApi } from './api'
import { pluginRegistry } from './registry.svelte'
import type { InstalledPlugin, PluginManifest, PluginModule } from './types'

/** 关掉哪些插件记在本机（prefs 里的 disabledPlugins） */
function disabled(): string[] {
  return ui.prefs.disabledPlugins ?? []
}

class PluginHost {
  list = $state<InstalledPlugin[]>([])
  loading = $state(false)
  /** 插件目录（设置页里显示、可以点开） */
  dir = $state('')
  private modules = new Map<string, PluginModule>()

  async refresh(): Promise<void> {
    this.loading = true
    try {
      const raw = await platform.listPlugins()
      this.dir = await platform.pluginsDir()
      const off = new Set(disabled())
      this.list = raw.map((r) => {
        const m = (r.manifest ?? {}) as PluginManifest
        const id = m.id || r.dir
        return {
          manifest: { ...m, id, name: m.name || id },
          dir: r.dir,
          enabled: !off.has(id),
          error: r.error ?? (r.manifest ? undefined : 'plugin.json 读不出来'),
          loaded: this.modules.has(id)
        }
      })
    } finally {
      this.loading = false
    }
  }

  /** 载入所有开着的插件（启动时、点「重新载入」时调） */
  async loadAll(): Promise<void> {
    await this.refresh()
    for (const p of this.list) if (p.enabled && !p.error) await this.load(p)
  }

  async load(p: InstalledPlugin): Promise<void> {
    const id = p.manifest.id
    this.unload(id)
    try {
      const main = p.manifest.main || 'index.js'
      // 加个版本号参数，重新载入时不吃缓存
      const url = `qnlplugin://${p.dir}/${main}?v=${Date.now()}`
      const mod = (await import(/* @vite-ignore */ url)) as {
        default?: PluginModule
      } & PluginModule
      const api = makePluginApi(id)
      // 插件可以用全局，也可以在 activate 里拿到同一个 api
      ;(window as unknown as Record<string, unknown>).qonlang = api
      const entry = mod.default ?? mod
      await entry?.activate?.(api)
      this.modules.set(id, entry)
      this.mark(id, { loaded: true, error: undefined })
    } catch (e) {
      this.mark(id, { loaded: false, error: (e as Error).message })
      ui.error(`插件「${p.manifest.name}」载入失败：${(e as Error).message}`)
    }
  }

  unload(id: string): void {
    const mod = this.modules.get(id)
    try {
      mod?.deactivate?.()
    } catch {
      // 插件自己的收尾出错就算了，别挡着卸载
    }
    this.modules.delete(id)
    pluginRegistry.removeAll(id)
    this.mark(id, { loaded: false })
  }

  async setEnabled(p: InstalledPlugin, on: boolean): Promise<void> {
    const off = new Set(disabled())
    if (on) off.delete(p.manifest.id)
    else off.add(p.manifest.id)
    ui.prefs.disabledPlugins = [...off]
    await ui.savePrefs()
    this.mark(p.manifest.id, { enabled: on })
    if (on) await this.load({ ...p, enabled: true })
    else this.unload(p.manifest.id)
  }

  private mark(id: string, patch: Partial<InstalledPlugin>): void {
    this.list = this.list.map((x) => (x.manifest.id === id ? { ...x, ...patch } : x))
  }
}

export const pluginHost = new PluginHost()
