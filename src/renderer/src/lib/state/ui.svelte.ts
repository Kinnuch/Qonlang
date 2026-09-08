import { platform, DEFAULT_PREFS, type Prefs } from '$lib/platform'
import { i18n, type LocaleCode } from '$lib/i18n/index.svelte'
import { applySkin } from '$lib/skin/apply'
import { DEFAULT_SKIN, EMPTY_FONTS } from '$lib/skin/presets'

export type Section =
  | 'languages'
  | 'phonology'
  | 'script'
  | 'soundChanges'
  | 'morphemes'
  | 'lexicon'
  | 'paradigms'
  | 'corpus'
  | 'phrasebook'
  | 'docs'
  | 'skin'
  | 'settings'

export const SECTIONS: Section[] = [
  'languages',
  'phonology',
  'script',
  'soundChanges',
  'morphemes',
  'lexicon',
  'paradigms',
  'corpus',
  'phrasebook',
  'docs',
  'skin',
  'settings'
]

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
  action?: { label: string; run: () => void }
  secondary?: { label: string; run: () => void }
  timeout: number
}

let toastSeq = 0

class UiState {
  section = $state<Section>('languages')
  /** 上一个页面（再次点击当前页的导航按钮时回到它） */
  previousSection = $state<Section | null>(null)
  inspectorOpen = $state(true)

  go(s: Section): void {
    if (s === this.section) {
      if (this.previousSection && this.previousSection !== s) {
        const back = this.previousSection
        this.previousSection = s
        this.section = back
      }
      return
    }
    this.previousSection = this.section
    this.section = s
  }
  /** 新建项目后要自动打开的导入向导 */
  pendingImport = $state<'csv' | null>(null)
  /** 跳到词库页时要选中的词位 */
  pendingLexemeId = $state<string | null>(null)
  /** 命令面板等跳转后要选中的对象：各页面按 kind 取走 */
  pendingSelect = $state<{ kind: string; id: string } | null>(null)
  /** 命令面板开关 */
  paletteOpen = $state(false)
  /** 应用内输入框请求（Electron 不支持 window.prompt） */
  promptReq = $state<{ title: string; value: string; resolve: (v: string | null) => void } | null>(
    null
  )
  prompt(title: string, value = ''): Promise<string | null> {
    return new Promise((resolve) => {
      if (this.promptReq) this.promptReq.resolve(null)
      this.promptReq = { title, value, resolve }
    })
  }
  /** 跳到某页并选中某对象 */
  jump(section: Section, kind: string, id: string): void {
    if (kind === 'lexeme') this.pendingLexemeId = id
    else this.pendingSelect = { kind, id }
    if (this.section !== section) this.go(section)
  }
  takePending(kind: string): string | null {
    if (this.pendingSelect?.kind !== kind) return null
    const id = this.pendingSelect.id
    this.pendingSelect = null
    return id
  }
  prefs = $state<Prefs>({ ...DEFAULT_PREFS })
  prefsLoaded = $state(false)
  toasts = $state<Toast[]>([])
  /** 系统是否为深色（跟随系统时用） */
  systemDark = $state(false)

  get resolvedTheme(): 'light' | 'dark' {
    if (this.prefs.theme === 'system') return this.systemDark ? 'dark' : 'light'
    return this.prefs.theme
  }

  async loadPrefs(): Promise<void> {
    this.prefs = await platform.getPrefs()
    if (!this.prefs.skin) this.prefs.skin = structuredClone(DEFAULT_SKIN)
    this.prefs.skin.fonts = { ...EMPTY_FONTS, ...(this.prefs.skin.fonts ?? {}) }
    this.prefs.skin.light ??= {}
    this.prefs.skin.dark ??= {}
    this.prefs.skin.mirror ??= ''
    if (!Array.isArray(this.prefs.skinPresets)) this.prefs.skinPresets = []
    i18n.locale = this.prefs.locale as LocaleCode
    this.prefsLoaded = true
    this.applyTheme()
  }

  async savePrefs(): Promise<void> {
    i18n.locale = this.prefs.locale as LocaleCode
    this.applyTheme()
    await platform.setPrefs($state.snapshot(this.prefs))
  }

  applyTheme(): void {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = this.resolvedTheme
    applySkin(this.prefs.skin ?? DEFAULT_SKIN, this.resolvedTheme)
  }

  watchSystemTheme(): () => void {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => {
      this.systemDark = mq.matches
      this.applyTheme()
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }

  toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): number {
    const id = ++toastSeq
    const toast: Toast = { id, message, kind: 'info', timeout: opts.action ? 8000 : 4000, ...opts }
    this.toasts = [...this.toasts, toast]
    if (toast.timeout > 0) setTimeout(() => this.dismiss(id), toast.timeout)
    return id
  }

  error(message: string): number {
    return this.toast(message, { kind: 'error', timeout: 8000 })
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id)
  }
}

export const ui = new UiState()
