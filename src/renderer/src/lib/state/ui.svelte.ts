import type { DupPair } from '$lib/core/sentenceDedup'
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

/** 页面报上来的当前位置：选中的对象（kind + id）、当前语言（lang），以及子页、视图、窗口这些，都是短字符串 */
export type PageView = Record<string, string | null>

/** 「返回」要回到的地方：页面、那一页的位置、列表滚到哪、搜索框里写着什么 */
export interface NavEntry {
  section: Section
  view: PageView | null
  scroll: number
  search: string
}

const sameView = (a: PageView | null | undefined, b: PageView | null | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

class UiState {
  section = $state<Section>('languages')
  /** 顶栏统一搜索框的内容；换页面时清空，各页面按自己的字段过滤 */
  search = $state('')
  /** 上一个页面（再次点击当前页的导航按钮时回到它） */
  previousSection = $state<Section | null>(null)
  inspectorOpen = $state(true)
  /** 右侧检视器里正开着规则语法说明；syntaxAnchor 是要滚到的那一节 */
  syntaxOpen = $state(false)
  syntaxAnchor = $state('')
  openSyntax(anchor = ''): void {
    this.syntaxAnchor = anchor
    this.syntaxOpen = true
    this.inspectorOpen = true
  }

  /** 走过的位置（最多 100 步），供「返回」 */
  navHistory = $state<NavEntry[]>([])
  canBack = $derived(this.navHistory.length > 0)
  /** 各页面最近报上来的位置与滚动（不需要响应式） */
  private views: Partial<Record<Section, PageView>> = {}
  private scrolls: Partial<Record<Section, number>> = {}
  /** 跳转、返回之后这一小会儿里，页面自己调整位置（选中目标、切语言）不另记一步 */
  private quietUntil = 0
  /** 由项目状态注册进来：读写当前语言、判断记下的对象还在不在（ui 不直接 import 项目状态） */
  navAccess: {
    getLanguage: () => string | null
    setLanguage: (id: string | null) => void
    exists: (kind: string, id: string) => boolean
  } | null = null
  /** 「返回」时交给页面恢复的位置 */
  restoreReq = $state<{ section: Section; view: PageView | null; scroll: number } | null>(null)

  resetHistory(): void {
    this.navHistory = []
    this.previousSection = null
    this.views = {}
    this.scrolls = {}
  }
  private quiet(): void {
    this.quietUntil = performance.now() + 700
  }
  private snapshot(): NavEntry {
    return {
      section: this.section,
      view: this.views[this.section] ?? null,
      scroll: this.scrolls[this.section] ?? 0,
      search: this.search
    }
  }
  private push(entry: NavEntry): void {
    const last = this.navHistory[this.navHistory.length - 1]
    if (last && last.section === entry.section && sameView(last.view, entry.view)) return
    this.navHistory = [...this.navHistory.slice(-99), entry]
  }
  /**
   * 页面报位置：选中了别的对象、切了子页、打开了关系图、换了语言……跟上一次不一样，就把上一次记成一步。
   * 跳转、返回之后页面自己调整的那一下不记。
   */
  reportView(section: Section, view: PageView): void {
    const prev = this.views[section]
    this.views[section] = view
    if (section !== this.section || !prev || sameView(prev, view)) return
    if (performance.now() < this.quietUntil) return
    this.push({ section, view: prev, scroll: this.scrolls[section] ?? 0, search: this.search })
  }
  /** 主列表滚到哪（navScroll 动作报上来） */
  noteScroll(section: Section, top: number): void {
    this.scrolls[section] = top
  }
  back(): void {
    while (this.navHistory.length) {
      const prev = this.navHistory[this.navHistory.length - 1]
      this.navHistory = this.navHistory.slice(0, -1)
      const v = prev.view
      // 指向已经删掉的东西的那一步直接跳过
      if (v?.kind && v.id && this.navAccess && !this.navAccess.exists(v.kind, v.id)) continue
      this.quiet()
      // 先换回当时的语言（那门语言删了就不换）：别的语言的列表里找不到原来那条
      const lang = v && 'lang' in v ? v.lang : undefined
      if (
        this.navAccess &&
        lang !== undefined &&
        lang !== this.navAccess.getLanguage() &&
        (lang === null || this.navAccess.exists('language', lang))
      )
        this.navAccess.setLanguage(lang)
      this.search = prev.search
      this.restoreReq = { section: prev.section, view: v, scroll: prev.scroll }
      if (prev.section !== this.section) {
        this.previousSection = this.section
        this.section = prev.section
      }
      return
    }
  }
  takeRestore(section: Section): { view: PageView | null; scroll: number } | null {
    const r = this.restoreReq
    if (!r || r.section !== section) return null
    this.restoreReq = null
    return r
  }
  /** 恢复主列表的滚动：列表可能还在渲染，多试几帧 */
  restoreScroll(section: Section, top: number): void {
    let tries = 12
    const apply = (): void => {
      const el = document.querySelector<HTMLElement>(`[data-nav-scroll="${section}"]`)
      if (el) el.scrollTop = top
      if ((!el || Math.abs(el.scrollTop - top) > 2) && tries-- > 0) requestAnimationFrame(apply)
    }
    requestAnimationFrame(apply)
  }
  go(s: Section): void {
    if (s === this.section) {
      // 再点一次当前页的导航按钮：回到上一个页面
      if (this.previousSection && this.previousSection !== s) {
        this.push(this.snapshot())
        this.quiet()
        const back = this.previousSection
        this.previousSection = s
        this.search = ''
        this.section = back
      }
      return
    }
    this.push(this.snapshot())
    this.quiet()
    this.search = ''
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
  /** 语料查重确认框：返回用户勾选要合并的那些 */
  mergeReq = $state<{ pairs: DupPair[]; resolve: (v: DupPair[]) => void } | null>(null)
  askMerge(pairs: DupPair[]): Promise<DupPair[]> {
    return new Promise((resolve) => {
      if (this.mergeReq) this.mergeReq.resolve([])
      this.mergeReq = { pairs, resolve }
    })
  }
  /**
   * 跳到某页并选中某对象。languageId：目标在哪门语言——先记下原来的位置再切语言，
   * 「返回」才回得到原来那门语言。
   */
  jump(section: Section, kind: string, id: string, languageId?: string | null): void {
    this.push(this.snapshot())
    this.quiet()
    if (languageId !== undefined && this.navAccess && languageId !== this.navAccess.getLanguage())
      this.navAccess.setLanguage(languageId)
    if (kind === 'lexeme') this.pendingLexemeId = id
    else this.pendingSelect = { kind, id }
    if (this.section !== section) {
      this.search = ''
      this.previousSection = this.section
      this.section = section
    }
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
    this.prefs.lexiconColWidths ??= {}
    this.prefs.panelSizes ??= {}
    this.prefs.highlightDuplicates ??= true
    this.prefs.showHelpDots ??= true
    this.prefs.examplesPerEntry ??= 3
    this.prefs.showDerivedMark ??= true
    this.prefs.checkUpdates ??= true
    this.prefs.skippedVersion ??= ''
    this.prefs.guideTourAlways ??= false
    if (!Array.isArray(this.prefs.seenTours)) this.prefs.seenTours = []
    i18n.locale = this.prefs.locale as LocaleCode
    this.prefsLoaded = true
    this.applyTheme()
  }

  /** 耗时操作的进度；null 表示没有正在跑的任务 */
  progress = $state<{ label: string; done: number; total: number } | null>(null)
  /**
   * 分批跑一个长任务，中间让出线程好让进度条画出来。
   * each 抛错时进度条也会收掉。
   */
  async runProgress<T>(
    label: string,
    items: readonly T[],
    each: (item: T, i: number) => void,
    chunk = 25
  ): Promise<void> {
    this.progress = { label, done: 0, total: items.length }
    try {
      for (let i = 0; i < items.length; i++) {
        each(items[i], i)
        if (i % chunk === chunk - 1 || i === items.length - 1) {
          this.progress = { label, done: i + 1, total: items.length }
          await new Promise((r) => setTimeout(r, 0))
        }
      }
    } finally {
      this.progress = null
    }
  }

  #prefsTimer: ReturnType<typeof setTimeout> | null = null
  /** 高频改动（列宽、面板尺寸）用这个，避免每拖一像素就写盘 */
  savePrefsSoon(): void {
    if (this.#prefsTimer) clearTimeout(this.#prefsTimer)
    this.#prefsTimer = setTimeout(() => {
      this.#prefsTimer = null
      void this.savePrefs()
    }, 500)
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
