/**
 * 全局字符面板的状态：开关、记住最后聚焦的输入框、插入、最近与收藏。
 */
import { ui } from './ui.svelte'

type Editable = HTMLInputElement | HTMLTextAreaElement

const MAX_RECENT = 40

class CharState {
  open = $state(false)
  /** 面板内的搜索框等自身输入不算目标 */
  target = $state<Editable | null>(null)
  /** 面板位置（px，相对视口左下） */
  pos = $state({ x: 64, y: 12 })
  size = $state({ w: 620, h: 440 })
  /** 组合区的当前内容 */
  compose = $state('')

  toggle(): void {
    this.open = !this.open
  }

  /** 在 App 挂载时调用一次 */
  install(): () => void {
    const onFocus = (e: FocusEvent): void => {
      const el = e.target as HTMLElement | null
      if (!el || el.closest('.char-panel')) return
      if (el instanceof HTMLTextAreaElement) this.target = el
      else if (el instanceof HTMLInputElement && (!el.type || ['text', 'search', 'url', 'email'].includes(el.type))) this.target = el
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }

  /** 把文本插到目标输入框的光标处；没有目标就复制到剪贴板 */
  async insert(text: string): Promise<boolean> {
    const el = this.target
    this.remember(text)
    if (el && el.isConnected) {
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      el.setRangeText(text, start, end, 'end')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.focus()
      return true
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
    return false
  }

  remember(text: string): void {
    const list = ui.prefs.recentSymbols.filter((s) => s !== text)
    list.unshift(text)
    ui.prefs.recentSymbols = list.slice(0, MAX_RECENT)
    void ui.savePrefs()
  }

  save(text: string): void {
    if (!text || ui.prefs.savedSymbols.includes(text)) return
    ui.prefs.savedSymbols = [...ui.prefs.savedSymbols, text]
    void ui.savePrefs()
  }

  unsave(text: string): void {
    ui.prefs.savedSymbols = ui.prefs.savedSymbols.filter((s) => s !== text)
    void ui.savePrefs()
  }
}

export const chars = new CharState()
