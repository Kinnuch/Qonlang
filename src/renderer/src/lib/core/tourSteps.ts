/**
 * 「使用指南」的图文引导：每个模块几步，指着界面上真实的元素讲最基本的用法。
 * 文案在 i18n 的 tour.steps.<模块>.<序号>；选择器找不到元素时那一步居中显示、不画箭头。
 */
export interface TourStep {
  /** 指向的元素（取第一个可见的） */
  selector: string
}

export const TOUR_STEPS: Record<string, TourStep[]> = {
  languages: [
    { selector: '.page-head h1' },
    { selector: '.tree' },
    { selector: '.page-head .btn.primary' },
    { selector: '.lang-select' }
  ],
  phonology: [
    { selector: '.page-head .seg' },
    { selector: '.inv-row' },
    { selector: '.inspector' }
  ],
  script: [
    { selector: '.booktabs' },
    { selector: '.page-head .btn.primary' },
    { selector: '.page-head .seg' },
    { selector: '.gcard' }
  ],
  soundChanges: [
    { selector: '.booktabs' },
    { selector: '.workspace' },
    { selector: '.status .seg' },
    { selector: '.inspector' }
  ],
  morphemes: [
    { selector: '.topbar .bar' },
    { selector: 'table.tbl thead' },
    { selector: '.page-head .seg' }
  ],
  lexicon: [
    { selector: '.topbar .bar' },
    { selector: 'table.tbl thead' },
    { selector: '.page-head .seg' },
    { selector: '.inspector' }
  ],
  paradigms: [
    { selector: '.booktabs' },
    { selector: '.dims' },
    { selector: 'table.tbl' },
    { selector: '.page-head .btn:not(.primary)' }
  ],
  corpus: [
    { selector: '.page-head .btn.primary' },
    { selector: '.item' },
    { selector: '.page-head .seg' }
  ],
  phrasebook: [{ selector: '.page-head .btn.primary' }, { selector: '.item' }],
  docs: [{ selector: '.page-head .btn.primary' }, { selector: '.pg' }, { selector: '.seg' }],
  skin: [{ selector: '.presets' }, { selector: '.colors' }, { selector: '.fonts' }],
  settings: [{ selector: 'section' }, { selector: '.topbar .bar' }]
}
