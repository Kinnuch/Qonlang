/**
 * 主进程里跟界面语言有关的两件事：第一次启动按系统语言挑界面语言；
 * 原生的菜单、右键菜单、关窗对话框用的文字（界面那边按当前语言发过来，没发来之前用中文或英文兜底）。
 */

/** 系统语言（按偏好先后）→ 九种界面语言之一；一个都对不上就用英文 */
export function pickLocale(languages: readonly string[]): string {
  for (const raw of languages) {
    const l = raw.toLowerCase().replace(/_/g, '-')
    if (/^zh-(hant|tw|hk|mo)(-|$)/.test(l)) return 'zh-Hant'
    if (l === 'zh' || l.startsWith('zh-')) return 'zh'
    const base = l.split('-')[0]
    if (['en', 'ja', 'ko', 'fr', 'es', 'ru', 'ar'].includes(base)) return base
  }
  return 'en'
}

/** 原生界面要用的文字：键跟界面文案里的 native.* 一一对应 */
export const NATIVE_FALLBACK: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    closeTitle: '有未保存的改动',
    closeBody: '要在关闭前保存吗？',
    closeSave: '保存并关闭',
    closeDiscard: '不保存',
    closeCancel: '取消',
    undoTyping: '撤销输入',
    redoTyping: '重做输入',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    copyLink: '复制链接',
    undoChange: '撤销上一步改动',
    redo: '重做',
    back: '返回上一页',
    palette: '命令面板',
    chars: '字符面板',
    save: '保存',
    saveAs: '另存为…',
    open: '打开…',
    guide: '使用指南',
    reportIssue: '报告问题',
    menuAbout: '关于千语集',
    menuFile: '文件',
    menuEdit: '编辑',
    menuView: '视图',
    menuWindow: '窗口',
    menuHelp: '帮助',
    menuUndo: '撤销',
    menuRedo: '重做',
    menuDelete: '删除',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    fullscreen: '切换全屏',
    devTools: '开发者工具',
    minimize: '最小化',
    quit: '退出',
    closeWindow: '关闭窗口',
    zoomWindow: '缩放',
    front: '前置全部窗口',
    services: '服务',
    hide: '隐藏千语集',
    hideOthers: '隐藏其他',
    unhide: '全部显示'
  },
  en: {
    closeTitle: 'Unsaved changes',
    closeBody: 'Save before closing?',
    closeSave: 'Save and close',
    closeDiscard: "Don't save",
    closeCancel: 'Cancel',
    undoTyping: 'Undo typing',
    redoTyping: 'Redo typing',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    copyLink: 'Copy link',
    undoChange: 'Undo last change',
    redo: 'Redo',
    back: 'Back',
    palette: 'Command palette',
    chars: 'Character panel',
    save: 'Save',
    saveAs: 'Save as…',
    open: 'Open…',
    guide: 'User guide',
    reportIssue: 'Report a problem',
    menuAbout: 'About Qonlang',
    menuFile: 'File',
    menuEdit: 'Edit',
    menuView: 'View',
    menuWindow: 'Window',
    menuHelp: 'Help',
    menuUndo: 'Undo',
    menuRedo: 'Redo',
    menuDelete: 'Delete',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    fullscreen: 'Toggle Full Screen',
    devTools: 'Developer Tools',
    minimize: 'Minimize',
    quit: 'Quit',
    closeWindow: 'Close Window',
    zoomWindow: 'Zoom',
    front: 'Bring All to Front',
    services: 'Services',
    hide: 'Hide Qonlang',
    hideOthers: 'Hide Others',
    unhide: 'Show All'
  }
}

/** 取一条原生文字：界面发来的优先，没有就按界面语言用中文或英文兜底 */
export function nativeLabel(sent: Record<string, string>, locale: string, key: string): string {
  return sent[key] || NATIVE_FALLBACK[locale.startsWith('zh') ? 'zh' : 'en'][key] || key
}
