/**
 * 页签分组的默认分法（音变：共时 / 历时；构形：按词类）、分段；构形粘贴换新 id；背景图样式。
 */
import { describe, it, expect } from 'vitest'
import { createProject, newId } from '$lib/core/factory'
import type { Paradigm, Project, RuleSet } from '$lib/core/model'
import { defaultParadigmGroups, defaultRuleSetGroups, groupTabs } from '$lib/core/tabGroups'
import { pastedGenerator } from '$lib/core/pasteGenerator'
import { backgroundStyle, DEFAULT_BACKGROUND } from '$lib/skin/presets'

function project(): Project {
  return createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
}
function ruleSet(
  p: Project,
  name: string,
  stageLanguages: RuleSet['stageLanguages'] = {}
): RuleSet {
  const rs: RuleSet = {
    id: newId(),
    name,
    notes: '',
    text: '',
    stageLanguages,
    testWords: '',
    updatedAt: ''
  }
  p.ruleSets.push(rs)
  return rs
}
function paradigm(p: Project, name: string): Paradigm {
  const x: Paradigm = {
    id: newId(),
    name: { zh: name },
    variants: [],
    dimensionIds: [],
    disabledSlots: [],
    generators: {},
    inheritsFrom: null
  }
  p.paradigms.push(x)
  return x
}

describe('页签分组', () => {
  it('音变：阶段跨两门语言的是历时，同一门语言里的、构形流水线里跑的是共时，都不是的不分组', () => {
    const p = project()
    const hist = ruleSet(p, '古到今', { 古: 'proto', 今: p.languages[0].id })
    const register = ruleSet(p, '书面语到口语', {
      书面: p.languages[0].id,
      口语: p.languages[0].id
    })
    const sync = ruleSet(p, '连读')
    const loose = ruleSet(p, '草稿')
    const para = paradigm(p, '名词')
    para.generators.x = {
      kind: 'pipeline',
      stem: 'lemma',
      steps: [{ id: 's', kind: 'sca', ruleSetId: sync.id, fromStage: '', toStage: '' }]
    }
    const set = defaultRuleSetGroups(p, { synchronic: '共时', diachronic: '历时' })
    expect(set.groups.map((g) => g.name)).toEqual(['共时', '历时'])
    expect(set.members[hist.id]).toBe('diachronic')
    expect(set.members[sync.id]).toBe('synchronic')
    expect(set.members[register.id]).toBe('synchronic')
    expect(set.members[loose.id]).toBeUndefined()
    const rows = groupTabs(p.ruleSets, set)
    expect(rows.map((r) => r.items.map((x) => x.item.name))).toEqual([
      ['书面语到口语', '连读'],
      ['古到今'],
      ['草稿']
    ])
    // 分段里记着原来的下标，拖动排序按它挪
    expect(rows[2].items[0].index).toBe(3)
  })

  it('构形：按绑定的词类分组，没绑的不分组', () => {
    const p = project()
    const verb = paradigm(p, '动词变位')
    const noun = paradigm(p, '名词变格')
    const extra = paradigm(p, '名词二式')
    paradigm(p, '散的')
    p.posList.push(
      { id: 'v', name: { zh: '动词' }, abbr: 'v', paradigmId: verb.id },
      {
        id: 'n',
        name: { zh: '名词' },
        abbr: 'n',
        paradigmId: noun.id,
        extraParadigmIds: [extra.id]
      },
      { id: 'a', name: { zh: '形容词' }, abbr: 'adj', paradigmId: null }
    )
    const set = defaultParadigmGroups(p, (name) => name.zh ?? '')
    expect(set.groups.map((g) => g.name)).toEqual(['动词', '名词'])
    const rows = groupTabs(p.paradigms, set)
    expect(rows.map((r) => r.items.map((x) => x.item.name.zh))).toEqual([
      ['动词变位'],
      ['名词变格', '名词二式'],
      ['散的']
    ])
  })
})

describe('构形粘贴', () => {
  it('流水线整份拷贝、每一步换新 id，原来的不跟着变', () => {
    const g = {
      kind: 'pipeline' as const,
      stem: 'lemma',
      steps: [{ id: 'a', kind: 'suffix' as const, text: 'en' }]
    }
    const c = pastedGenerator(g)
    expect(c.kind).toBe('pipeline')
    if (c.kind !== 'pipeline') return
    expect(c.steps[0].id).not.toBe('a')
    expect(c.steps[0]).toMatchObject({ kind: 'suffix', text: 'en' })
    c.stem = 'x'
    expect(g.stem).toBe('lemma')
  })
})

describe('背景图', () => {
  it('没图不出样式；平铺按缩过的尺寸乘缩放；模糊往外多铺', () => {
    expect(backgroundStyle(undefined)).toBe('')
    expect(backgroundStyle(DEFAULT_BACKGROUND)).toBe('')
    const s = backgroundStyle({
      ...DEFAULT_BACKGROUND,
      image: 'data:image/webp;base64,AAAA',
      width: 400,
      height: 200,
      fit: 'tile',
      scale: 0.5,
      opacity: 0.3,
      blur: 4
    })
    expect(s).toContain('background-size:200px 100px')
    expect(s).toContain('background-repeat:repeat')
    expect(s).toContain('opacity:0.3')
    expect(s).toContain('inset:-8px')
  })
})
