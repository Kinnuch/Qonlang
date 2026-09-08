import type { AppInfo, OpenResult, PlatformAPI, Prefs, RecentEntry, SaveTarget } from './types'
import { DEFAULT_PREFS } from './types'

type Bridge = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, cb: (...args: unknown[]) => void) => void
}

function bridge(): Bridge {
  const b = (window as unknown as { qianyuji?: Bridge }).qianyuji
  if (!b) throw new Error('Electron bridge 未注入')
  return b
}

export const electronPlatform: PlatformAPI = {
  kind: 'electron',

  async info() {
    return (await bridge().invoke('app:info')) as AppInfo
  },

  async openProject() {
    const r = (await bridge().invoke('project:open')) as { path: string; content: string } | null
    if (!r) return null
    return { target: { path: r.path, handleKey: null, name: baseName(r.path) }, content: r.content }
  },

  async openRecent(entry) {
    if (!entry.path) return null
    const r = (await bridge().invoke('project:read', entry.path)) as { content: string } | null
    if (!r) return null
    return { target: { path: entry.path, handleKey: null, name: baseName(entry.path) }, content: r.content } satisfies OpenResult
  },

  async saveProject(target, content, suggestedName) {
    let path = target?.path ?? null
    if (!path) {
      path = (await bridge().invoke('project:saveAs', suggestedName)) as string | null
      if (!path) return null
    }
    await bridge().invoke('project:write', path, content)
    return { path, handleKey: null, name: baseName(path) } satisfies SaveTarget
  },

  async exportFolder(files, suggestedName) {
    return (await bridge().invoke('project:exportFolder', files, suggestedName)) as boolean
  },

  async readTextFiles(opts) {
    return (await bridge().invoke('file:readText', opts)) as { name: string; content: string }[]
  },
  async readBinaryFiles(opts) {
    return (await bridge().invoke('file:readBinary', opts)) as { name: string; base64: string }[]
  },
  async saveTextFile(suggestedName, content) {
    return (await bridge().invoke('file:saveText', suggestedName, content)) as boolean
  },

  async getRecent() {
    return (await bridge().invoke('recent:get')) as RecentEntry[]
  },
  async addRecent(entry) {
    await bridge().invoke('recent:add', entry)
  },
  async clearRecent() {
    await bridge().invoke('recent:clear')
  },

  async getPrefs() {
    const p = (await bridge().invoke('prefs:get')) as Partial<Prefs> | null
    return { ...DEFAULT_PREFS, ...(p ?? {}) }
  },
  async setPrefs(p) {
    await bridge().invoke('prefs:set', p)
  },

  async loadSnapshot() {
    return (await bridge().invoke('snapshot:load')) as string | null
  },
  async saveSnapshot(content) {
    await bridge().invoke('snapshot:save', content)
  },

  setDirty(dirty) {
    void bridge().invoke('app:setDirty', dirty)
  },
  onSaveAndClose(cb) {
    bridge().on('app:save-and-close', () => {
      void cb()
    })
  },
  closeNow() {
    void bridge().invoke('app:closeNow')
  },

  async showInFolder(path) {
    await bridge().invoke('shell:showInFolder', path)
  },
  async openExternal(url) {
    await bridge().invoke('shell:openExternal', url)
  }
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
