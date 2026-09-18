/**
 * 语系 / 语族 / 语支节点、语言内部的历时阶段、合并为阶段、历史形式链、分组统计；
 * 构形的槽位键跟维度先后无关、槽位继承、槽位的发音流水线。
 */
import { describe, it, expect } from 'vitest'
import {
  createLanguage,
  createLexeme,
  createMorpheme,
  createProject,
  createRuleSet,
  newId
} from '$lib/core/factory'
import type {
  GrammaticalCategory,
  LanguageGroup,
  MorphStep,
  Paradigm,
  Project
} from '$lib/core/model'
import { effectiveGroupId, groupLanguages, languageTree } from '$lib/core/languageTree'
import { mergeAsStages, stageChain } from '$lib/core/mergeStages'
import { historyChain } from '$lib/core/history'
import { cognateMatrix, correspondenceTable, groupCounts, phonemeTable } from '$lib/core/groupStats'
import { canonicalizeSlotKeys, slotKey } from '$lib/core/slotKeys'
import { deriveLexemeForms, generateForm, makeContext, paradigmSlots } from '$lib/engine/morph'

function project(): Project {
  const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  p.languages = []
  return p
}
const group = (
  name: string,
  level: LanguageGroup['level'],
  parentId: string | null = null
): LanguageGroup => ({
  id: newId(),
  name,
  abbr: '',
  level,
  parentId,
  protoLanguageId: null,
  notes: ''
})

describe('语言分组', () => {
  it('语言挂在节点下，子语言跟着父语言；统计时没写节点的子语言算进父语言的节点', () => {
    const p = project()
    const fam = group('甲语系', 'family')
    const br = group('乙语族', 'branch', fam.id)
    p.languageGroups = [fam, br]
    const proto = createLanguage({ name: '原始语', parentId: null })
    proto.groupId = br.id
    const a = createLanguage({ name: 'A', parentId: proto.id })
    const b = createLanguage({ name: 'B', parentId: proto.id })
    const loose = createLanguage({ name: '孤立语', parentId: null })
    p.languages.push(proto, a, b, loose)
    const tree = languageTree(p)
    expect(tree.map((x) => (x.kind === 'group' ? x.group.name : x.language.name))).toEqual([
      '甲语系',
      '孤立语'
    ])
    const famItem = tree[0]
    const brItem = famItem.children[0]
    expect(brItem.kind === 'group' && brItem.group.name).toBe('乙语族')
    expect(brItem.children.map((x) => x.kind === 'language' && x.language.name)).toEqual(['原始语'])
    expect(
      brItem.children[0].children.map((x) => x.kind === 'language' && x.language.name)
    ).toEqual(['A', 'B'])
    expect(effectiveGroupId(p, a.id)).toBe(br.id)
    expect(groupLanguages(p, fam.id).map((l) => l.name)).toEqual(['原始语', 'A', 'B'])
  })
})

describe('合并为阶段', () => {
  function chainProject() {
    const p = project()
    const old = createLanguage({ name: '上古语', parentId: null })
    old.abbr = 'OX'
    const mid = createLanguage({ name: '中古语', parentId: old.id })
    mid.abbr = 'MX'
    const now = createLanguage({ name: '现代语', parentId: mid.id })
    now.abbr = 'X'
    const other = createLanguage({ name: '旁支', parentId: mid.id })
    p.languages.push(old, mid, now, other)
    const oldWord = createLexeme(old.id, 'kata')
    oldWord.pronunciations[old.orthographies[0].id] = { ipa: 'kata', irregular: false }
    const midWord = createLexeme(mid.id, 'kada')
    p.lexemes.push(oldWord, midWord)
    const rs = createRuleSet(
      '上古到现代',
      ['-* OX', 't > d / a_a', '-* MX', 'd > ð / a_a', '-* X'].join('\n')
    )
    rs.stageLanguages = { OX: old.id, MX: mid.id, X: now.id }
    p.ruleSets.push(rs)
    return { p, old, mid, now, other, oldWord, midWord, rs }
  }

  it('几门语言变成最后那门的阶段，词条挪过去记下阶段，音变绑定改到阶段，旁支改挂', () => {
    const { p, old, mid, now, other, oldWord, midWord, rs } = chainProject()
    const chain = stageChain(p, old.id, now.id)!
    expect(chain.map((l) => l.name)).toEqual(['上古语', '中古语', '现代语'])
    const r = mergeAsStages(p, chain)
    expect(r).toMatchObject({ stages: 3, lexemes: 2, droppedPronunciations: 0 })
    expect(p.languages.map((l) => l.name)).toEqual(['现代语', '旁支'])
    expect(now.stages!.map((s) => s.abbr)).toEqual(['OX', 'MX', 'X'])
    expect(oldWord.languageId).toBe(now.id)
    expect(oldWord.stageId).toBe(now.stages![0].id)
    expect(midWord.stageId).toBe(now.stages![1].id)
    // 正字法按主正字法对上：发音挪到现代语的正字法下
    expect(Object.keys(oldWord.pronunciations)).toEqual([now.orthographies[0].id])
    expect(rs.stageLanguages).toEqual({ OX: now.id, MX: now.id, X: now.id })
    expect(rs.stageLanguageStages).toEqual({
      OX: now.stages![0].id,
      MX: now.stages![1].id,
      X: now.stages![2].id
    })
    expect(other.parentId).toBe(now.id)
    expect(now.parentId).toBeNull()
    void mid
  })

  it('历史形式链：词源来源是祖先阶段的词条，按阶段一路推下来', () => {
    const { p, old, now, oldWord } = chainProject()
    mergeAsStages(p, stageChain(p, old.id, now.id)!)
    const w = createLexeme(now.id, 'kaða')
    w.etymology.sources = [{ kind: 'lexeme', id: oldWord.id }]
    p.lexemes.push(w)
    const chain = historyChain(p, w)!
    expect(chain.steps.map((s) => `${s.label} ${s.form}`)).toEqual(['OX kata', 'MX kada', 'X kaða'])
    expect(chain.matches).toBe(true)
  })

  it('没合并时也行：阶段绑的是几门语言；中间有阶段没绑就不给链', () => {
    const { p, now, rs } = chainProject()
    const w = createLexeme(now.id, 'kaða')
    w.etymology.sources = [{ kind: 'external', language: '上古语', form: '*kata', meaning: '' }]
    p.lexemes.push(w)
    expect(historyChain(p, w)!.steps.map((s) => s.form)).toEqual(['*kata', 'kada', 'kaða'])
    rs.stageLanguages.MX = null
    expect(historyChain(p, w)).toBeNull()
  })
})

describe('分组统计', () => {
  it('数量、音位并集、同源比例、对应词表', () => {
    const p = project()
    const proto = createLanguage({ name: 'P', parentId: null })
    const a = createLanguage({ name: 'A', parentId: proto.id })
    const b = createLanguage({ name: 'B', parentId: proto.id })
    p.languages.push(proto, a, b)
    const ph = (sym: string) => ({
      id: newId(),
      symbol: sym,
      features: {},
      graphemes: {},
      notes: ''
    })
    a.phonemes = [ph('p'), ph('a')]
    b.phonemes = [ph('p'), ph('i')]
    const root = createLexeme(proto.id, '*pata')
    const wa = createLexeme(a.id, 'pata')
    const wb = createLexeme(b.id, 'pita')
    const lone = createLexeme(b.id, 'zu')
    wa.etymology.sources = [{ kind: 'lexeme', id: root.id }]
    wb.etymology.sources = [{ kind: 'external', language: 'P', form: '*pata', meaning: '' }]
    p.lexemes.push(root, wa, wb, lone)
    p.morphemes.push(createMorpheme(a.id))
    expect(groupCounts(p, [a, b]).map((r) => [r.lexemes, r.morphemes])).toEqual([
      [1, 1],
      [2, 0]
    ])
    const rows = phonemeTable([a, b])
    expect(rows.map((r) => `${r.symbol}${r.in.size}`)).toEqual(['p2', 'a1', 'i1'])
    const m = cognateMatrix(p, [a, b])
    expect(m.get(`${a.id}|${b.id}`)).toEqual({ shared: 1, ratio: 1 })
    expect(m.get(`${b.id}|${a.id}`)).toEqual({ shared: 1, ratio: 0.5 })
    const table = correspondenceTable(p, [a, b])
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0].cells.get(a.id)!.map((x) => x.lemma)).toEqual(['pata'])
    expect(table.rows[0].cells.get(b.id)!.map((x) => x.lemma)).toEqual(['pita'])
  })
})

describe('构形：槽位键、继承、发音流水线', () => {
  function setup() {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '0', uiLocale: 'zh' })
    const L = p.languages[0]
    const tense: GrammaticalCategory = {
      id: 'tense',
      name: { zh: '时' },
      values: [
        { id: 'prs', name: { zh: '现在' }, abbr: 'PRS' },
        { id: 'pst', name: { zh: '过去' }, abbr: 'PST' }
      ]
    }
    const person: GrammaticalCategory = {
      id: 'person',
      name: { zh: '人称' },
      values: [
        { id: '1sg', name: { zh: '第一人称' }, abbr: '1SG' },
        { id: '3sg', name: { zh: '第三人称' }, abbr: '3SG' }
      ]
    }
    p.categories.push(tense, person)
    const suf = (text: string): MorphStep => ({ id: newId(), kind: 'suffix', text })
    const para: Paradigm = {
      id: 'verb',
      name: { zh: '动词' },
      variants: [],
      dimensionIds: ['tense', 'person'],
      disabledSlots: [],
      generators: {},
      inheritsFrom: null
    }
    p.paradigms.push(para)
    return { p, L, para, suf }
  }

  it('A.B 与 B.A 是同一个键：换维度先后、旧文件按先后拼的键都对得上', () => {
    const k1 = slotKey([
      { categoryId: 'tense', valueId: 'prs' },
      { categoryId: 'person', valueId: '3sg' }
    ])
    const k2 = slotKey([
      { categoryId: 'person', valueId: '3sg' },
      { categoryId: 'tense', valueId: 'prs' }
    ])
    expect(k1).toBe(k2)
    const { p, para } = setup()
    para.generators['prs|3sg#v'] = { kind: 'table' }
    para.disabledSlots = ['pst|1sg']
    canonicalizeSlotKeys(p)
    expect(Object.keys(para.generators)).toEqual(['3sg|prs#v'])
    expect(para.disabledSlots).toEqual(['1sg|pst'])
    para.dimensionIds = ['person', 'tense']
    expect(paradigmSlots(para, p.categories, ['zh']).map((s) => s.key)).not.toContain('pst|1sg')
  })

  it('槽位继承另一格推出来的形式再加步骤；那一格手改过就用手改的', () => {
    const { p, L, para, suf } = setup()
    const slots = paradigmSlots(para, p.categories, ['zh'])
    const prs1 = slots.find((s) => s.label === '现在.第一人称')!
    const prs3 = slots.find((s) => s.label === '现在.第三人称')!
    para.generators[prs1.key] = { kind: 'pipeline', stem: '', steps: [suf('-an')] }
    para.generators[prs3.key] = {
      kind: 'pipeline',
      stem: '',
      steps: [suf('-t')],
      base: { paradigmId: null, slotKey: prs1.key }
    }
    const w = createLexeme(L.id, 'kal')
    p.lexemes.push(w)
    const ctx = makeContext(p, L)
    expect(generateForm(ctx, w, para, prs3)?.surface).toBe('kalant')
    w.forms['现在.第一人称'] = { surface: 'kolan', derived: false, override: true, trace: [] }
    expect(generateForm(ctx, w, para, prs3)?.surface).toBe('kolant')
  })

  it('简洁模式：维度多的槽位没写法时接着维度少的那个；复杂模式各算各的', () => {
    const { p, L, para, suf } = setup()
    // 只有「时」这一维的槽位写了法，「时 + 人称」的没写
    para.dimensionIds = ['tense']
    const tenseOnly = paradigmSlots(para, p.categories, ['zh'])
    para.generators[tenseOnly[0].key] = { kind: 'pipeline', stem: '', steps: [suf('-ba')] }
    para.dimensionIds = ['tense', 'person']
    const full = paradigmSlots(para, p.categories, ['zh']).find((s) => s.label === '现在.第一人称')!
    const w = createLexeme(L.id, 'kal')
    p.lexemes.push(w)
    const ctx = makeContext(p, L)
    expect(generateForm(ctx, w, para, full)?.surface).toBe('kalba')
    p.settings.complexSlots = true
    expect(generateForm(ctx, w, para, full)).toBeNull()
  })

  it('写了写法的槽位一直算数：维度改了也还在，重新挑维度不会丢', () => {
    const { p, para, suf } = setup()
    para.dimensionIds = ['tense', 'person']
    const slots = paradigmSlots(para, p.categories, ['zh'])
    para.generators[slots[0].key] = { kind: 'pipeline', stem: '', steps: [suf('-x')] }
    // 只留「时」一维：那一格照样在（排在后面）
    para.dimensionIds = ['tense']
    const after = paradigmSlots(para, p.categories, ['zh'])
    expect(after.some((s) => s.key === slots[0].key)).toBe(true)
    expect(after.find((s) => s.key === slots[0].key)!.label).toBe(slots[0].label)
  })

  it('勾了影响发音的槽位：从这一格的拼写转 IPA 开始，再跑发音流水线，存在形式上', () => {
    const { p, L, para, suf } = setup()
    L.orthographies[0].rulesToIpa = 'c > k'
    const slots = paradigmSlots(para, p.categories, ['zh'])
    const s = slots[0]
    para.generators[s.key] = {
      kind: 'pipeline',
      stem: '',
      steps: [suf('-a')],
      pron: { on: true, from: 'form', steps: [suf('-ʔ')] }
    }
    p.posList.push({ id: 'v', name: { zh: '动词' }, abbr: 'v', paradigmId: para.id })
    const w = createLexeme(L.id, 'cal')
    w.posId = 'v'
    p.lexemes.push(w)
    const ctx = makeContext(p, L)
    const g = generateForm(ctx, w, para, s)!
    expect(g.surface).toBe('cala')
    expect(g.ipa).toBe('kalaʔ')
    deriveLexemeForms(ctx, w)
    expect(w.forms[s.label].ipa).toBe('kalaʔ')
    // 关掉就不推发音
    ;(para.generators[s.key] as { pron: { on: boolean } }).pron.on = false
    expect(generateForm(ctx, w, para, s)!.ipa).toBeUndefined()
  })
})
