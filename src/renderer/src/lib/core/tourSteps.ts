/**
 * 「使用指南」的图文引导：每个模块一串步骤，指着界面上真实的元素讲。
 *
 * 每一步可以先把界面切到该讲的地方再讲：go 换模块，view 换模块里的子页 / 视图
 * （走各页面自己的位置恢复机制，跟「返回」同一套），inspector 决定右侧检视器开着还是收着。
 * 切完由 GuideTour 轮询等目标元素出现，等不到就把气泡放在屏幕中央、不画框。
 * 选择器一律用 data-tour 或结构性的类名，别挨着会变的文字与位置下标。
 * 文案在 i18n 的 tour.steps.<模块>.<序号>，中英一一对应（tests/core/i18n.test.ts 卡着）。
 */
import type { Section } from '$lib/state/ui.svelte'

export interface TourStep {
  /** 指向的元素（默认取第一个可见的） */
  selector: string
  /** 圈住所有匹配到的元素（挨着的一组控件，比如「导入」加「导出」） */
  all?: boolean
  /** 讲这一步之前先切到哪个模块 */
  go?: Section
  /** 再切到这个模块里的哪个子页 / 视图；键名跟该页 reportView 报上来的一致 */
  view?: Record<string, string>
  /** 右侧检视器：true 打开、false 收起，不写就不动 */
  inspector?: boolean
  /**
   * 要讲的东西得先选中点什么才出来（例句的分词栏、文档的编辑器）：
   * 目标没出现时点一下这个元素。选中的对象是页面报上来的位置的一部分，讲完会一并还原。
   */
  click?: string
}

export const TOUR_STEPS: Record<string, TourStep[]> = {
  // 第一次打开软件时在开始页讲一遍：新建 / 打开、起步模板、最近项目、小游戏、左下角与底部那一排
  welcome: [
    { selector: '[data-tour="welcome-actions"]' },
    { selector: '[data-tour="welcome-new"]' },
    { selector: '[data-tour="welcome-recent"]' },
    { selector: '[data-tour="welcome-games"]' },
    { selector: '[data-tour="welcome-foot"]' },
    { selector: '[data-tour="welcome-footer"]' },
    { selector: '[data-tour="welcome-syntax"]' }
  ],
  languages: [
    { selector: '.page-head h1', go: 'languages' },
    { selector: '[data-tour="languages-tree"]', go: 'languages' },
    { selector: '[data-tour="languages-add"]', go: 'languages' },
    { selector: '[data-tour="languages-addchild"]', go: 'languages' },
    { selector: '[data-tour="languages-group"]', go: 'languages' },
    { selector: '[data-tour="languages-layout"]', go: 'languages' },
    { selector: '[data-tour="languages-compare"]', go: 'languages' },
    { selector: '[data-tour="topbar-language"]', go: 'languages' }
  ],
  phonology: [
    { selector: '[data-tour="phonology-tabs"]', go: 'phonology', view: { tab: 'phonemes' } },
    { selector: '.inv-row', all: true, go: 'phonology', view: { tab: 'phonemes' } },
    { selector: '[data-tour="phonology-chart"]', go: 'phonology', view: { tab: 'phonemes' } },
    { selector: '.inspector', go: 'phonology', view: { tab: 'phonemes' }, inspector: true },
    { selector: '[data-tour="phonology-classes"]', go: 'phonology', view: { tab: 'classes' } },
    { selector: '[data-tour="phonology-ortho"]', go: 'phonology', view: { tab: 'orthography' } },
    { selector: '[data-tour="phonology-syllable"]', go: 'phonology', view: { tab: 'syllable' } },
    {
      selector: '[data-tour="phonology-phonotactics"]',
      go: 'phonology',
      view: { tab: 'phonotactics' }
    },
    {
      selector: '[data-tour="phonology-generator"]',
      go: 'phonology',
      view: { tab: 'phonotactics' }
    }
  ],
  script: [
    { selector: '.booktabs', go: 'script' },
    { selector: '[data-tour="script-add"]', go: 'script' },
    { selector: '[data-tour="script-tabs"]', go: 'script', view: { tab: 'glyphs' } },
    { selector: '[data-tour="script-glyph-tools"]', go: 'script', view: { tab: 'glyphs' } },
    { selector: '.gcard', go: 'script', view: { tab: 'glyphs' }, inspector: true },
    { selector: '[data-tour="script-rules"]', go: 'script', view: { tab: 'rules' } },
    { selector: '[data-tour="script-preview"]', go: 'script', view: { tab: 'preview' } }
  ],
  soundChanges: [
    { selector: '.booktabs', go: 'soundChanges' },
    { selector: '[data-tour="sc-list"]', go: 'soundChanges', view: { view: 'list' } },
    { selector: '[data-tour="sc-views"]', go: 'soundChanges', view: { view: 'list' } },
    { selector: '[data-tour="sc-chain"]', go: 'soundChanges', view: { view: 'chain' } },
    { selector: '[data-tour="sc-evolve"]', go: 'soundChanges', view: { view: 'list' } },
    { selector: '.inspector', go: 'soundChanges', view: { view: 'list' }, inspector: true }
  ],
  morphemes: [
    { selector: '[data-tour="morphemes-add"]', go: 'morphemes', view: { mode: 'entries' } },
    { selector: '.topbar .bar', go: 'morphemes', view: { mode: 'entries' } },
    { selector: 'table.tbl thead', go: 'morphemes', view: { mode: 'entries' } },
    { selector: '[data-tour="morphemes-mode"]', go: 'morphemes', view: { mode: 'entries' } },
    {
      selector: '.inspector',
      go: 'morphemes',
      view: { mode: 'entries', edit: '1' },
      inspector: true
    },
    {
      selector: '[data-tour="morphemes-io"]',
      all: true,
      go: 'morphemes',
      view: { mode: 'entries' }
    },
    { selector: '[data-tour="morphemes-tabs"]', go: 'morphemes', view: { mode: 'stats' } }
  ],
  lexicon: [
    { selector: '.topbar .bar', go: 'lexicon', view: { mode: 'entries' } },
    { selector: 'table.tbl thead', go: 'lexicon', view: { mode: 'entries' } },
    { selector: '[data-tour="lexicon-tabs"]', go: 'lexicon', view: { mode: 'entries' } },
    { selector: '[data-tour="lexicon-taxonomy"]', go: 'lexicon', view: { mode: 'taxonomy' } },
    { selector: '[data-tour="lexicon-mode"]', go: 'lexicon', view: { mode: 'entries' } },
    {
      selector: '.inspector',
      go: 'lexicon',
      view: { mode: 'entries', edit: '1' },
      inspector: true
    },
    { selector: '[data-tour="lexicon-fav"]', go: 'lexicon', view: { mode: 'entries' } },
    { selector: '[data-tour="lexicon-io"]', all: true, go: 'lexicon', view: { mode: 'entries' } }
  ],
  paradigms: [
    { selector: '.booktabs', go: 'paradigms', view: { view: 'slots' } },
    { selector: '.dims', go: 'paradigms', view: { view: 'slots' } },
    { selector: '[data-tour="paradigms-slots"]', go: 'paradigms', view: { view: 'slots' } },
    { selector: '[data-tour="paradigms-layout"]', go: 'paradigms', view: { view: 'slots' } },
    { selector: '[data-tour="paradigms-variants"]', go: 'paradigms', view: { view: 'slots' } },
    {
      selector: '[data-tour="paradigms-bench"]',
      go: 'paradigms',
      view: { view: 'slots' },
      inspector: true
    },
    { selector: '[data-tour="paradigms-report"]', go: 'paradigms', view: { view: 'slots' } }
  ],
  corpus: [
    { selector: '[data-tour="corpus-add"]', go: 'corpus', view: { mode: 'entries' } },
    { selector: '.item', go: 'corpus', view: { mode: 'entries' } },
    {
      selector: '[data-tour="corpus-analyze"]',
      click: '.item',
      go: 'corpus',
      view: { mode: 'entries' }
    },
    { selector: '[data-tour="corpus-tabs"]', go: 'corpus', view: { mode: 'entries' } },
    { selector: '[data-tour="corpus-abbr"]', go: 'corpus', view: { mode: 'abbr' } },
    { selector: '[data-tour="corpus-io"]', all: true, go: 'corpus', view: { mode: 'entries' } }
  ],
  phrasebook: [
    { selector: '[data-tour="phrasebook-add"]', go: 'phrasebook' },
    { selector: '[data-tour="phrasebook-cats"]', go: 'phrasebook' },
    { selector: '.item', go: 'phrasebook' },
    { selector: '[data-tour="phrasebook-io"]', all: true, go: 'phrasebook' }
  ],
  docs: [
    { selector: '[data-tour="docs-add"]', go: 'docs' },
    { selector: '[data-tour="docs-list"]', go: 'docs' },
    {
      selector: '[data-tour="docs-views"]',
      click: '[data-tour="docs-list"] .pg',
      go: 'docs',
      view: { docView: 'split' }
    },
    {
      selector: '[data-tour="docs-toolbar"]',
      click: '[data-tour="docs-list"] .pg',
      go: 'docs',
      view: { docView: 'split' }
    },
    {
      selector: '[data-tour="docs-preview"]',
      click: '[data-tour="docs-list"] .pg',
      go: 'docs',
      view: { docView: 'preview' }
    }
  ],
  skin: [
    { selector: '.presets-wrap', go: 'skin' },
    { selector: '[data-tour="skin-io"]', all: true, go: 'skin' },
    { selector: '.colors', go: 'skin', inspector: true },
    { selector: '.fonts', all: true, go: 'skin' },
    { selector: '[data-tour="skin-library"]', go: 'skin' },
    { selector: '[data-tour="skin-card"]', go: 'skin' }
  ],
  settings: [
    { selector: '[data-tour="settings-app"]', go: 'settings' },
    { selector: '[data-tour="settings-guide"]', go: 'settings' },
    { selector: '[data-tour="settings-project"]', go: 'settings' },
    { selector: '[data-tour="settings-data"]', go: 'settings' },
    { selector: '.topbar .bar', go: 'settings' }
  ],
  // 设置页上面那两张卡片：MCP 与插件（对应指南的同一页 extending）
  extending: [
    { selector: '[data-tour="mcp-card"]', go: 'settings' },
    { selector: '[data-tour="mcp-conn"]', go: 'settings' },
    { selector: '[data-tour="plugins-card"]', go: 'settings' },
    { selector: '[data-tour="plugins-acts"]', all: true, go: 'settings' }
  ]
}
