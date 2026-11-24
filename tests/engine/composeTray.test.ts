import { describe, expect, it } from 'vitest'
import { createLexeme, createMorpheme, createProject, createSentence } from '$lib/core/factory'
import type { Project } from '$lib/core/model'
import {
  COMPOSE_OCCURRENCE_LIMIT,
  composeCandidates,
  type ComposeCandidate
} from '$lib/engine/compose'
import {
  claimComposeCandidate,
  expandComposeCandidates,
  expandComposeCandidateView,
  COMPOSE_TRAY_LIMIT,
  loadComposeTray,
  partitionComposeTray,
  planComposeAddAll,
  reconcileComposeTray,
  restoreComposeCandidate,
  seedComposeTrayOwners,
  type ComposeTrayCandidate
} from '$lib/engine/composeTray'

function fixture(): Project {
  return createProject({
    name: 'Candidate tray QA',
    template: 'blank',
    appVersion: '1.0.5',
    uiLocale: 'zh'
  })
}
function word(p: Project, surface: string, meaning: string): string {
  const entry = createLexeme(p.languages[0].id, surface)
  entry.senses[0].definition = { zh: meaning, en: meaning }
  p.lexemes.push(entry)
  return entry.id
}
const query = (p: Project, text: string): ComposeCandidate[] =>
  composeCandidates(p, p.languages[0].id, text, ['zh', 'en'])
const tray = (p: Project, text: string): ComposeTrayCandidate[] =>
  expandComposeCandidates(query(p, text), text)
const labels = (candidates: readonly ComposeTrayCandidate[]): string[] =>
  candidates.map((c) => c.surface)

function simple() {
  const p = fixture()
  word(p, 'alpha', '光')
  word(p, 'beta', '光')
  word(p, 'gamma', '影')
  const translation = '光与影',
    candidates = tray(p, translation)
  return {
    p,
    translation,
    candidates,
    a: candidates.find((c) => c.surface === 'alpha')!,
    b: candidates.find((c) => c.surface === 'beta')!
  }
}

describe('按同一固定译文位置收纳候选', () => {
  it('选中项不落桶，仅同位置的其他候选收起', () => {
    const { translation, candidates, a, b } = simple()
    expect(a.group).toBe(b.group)
    const state = claimComposeCandidate(loadComposeTray(undefined, translation), a, 'w:one')
    const partition = partitionComposeTray(candidates, state)
    expect(labels(partition.floating)).toEqual(['gamma'])
    expect(labels(partition.stashed)).toEqual(['beta'])
  })

  it('词义范围重叠不等于可替代，不收起云鸟或框架槽内的光', () => {
    const p = fixture()
    for (const [surface, meaning] of [
      ['cloud', '云'],
      ['bird', '云鸟'],
      ['frame', '在…中'],
      ['light', '光'],
      ['whole', '在光中']
    ])
      word(p, surface, meaning)
    const text = '云鸟在光中',
      candidates = tray(p, text),
      initial = loadComposeTray(null, text)
    const cloud = candidates.find((c) => c.surface === 'cloud')!
    expect(
      labels(
        partitionComposeTray(candidates, claimComposeCandidate(initial, cloud, 'w:cloud')).floating
      )
    ).toEqual(expect.arrayContaining(['bird', 'frame', 'light', 'whole']))
    const frame = candidates.find((c) => c.surface === 'frame')!
    expect(
      labels(
        partitionComposeTray(candidates, claimComposeCandidate(initial, frame, 'w:frame')).floating
      )
    ).toEqual(expect.arrayContaining(['light', 'whole']))
  })

  it('等价省略号框架有相同锚点，精确完整短语仍是另一组', () => {
    const p = fixture()
    for (const [surface, meaning] of [
      ['a', '在...中'],
      ['b', '在……中'],
      ['exact', '在光中']
    ])
      word(p, surface, meaning)
    const text = '在光中',
      candidates = tray(p, text),
      a = candidates.find((c) => c.surface === 'a')!,
      b = candidates.find((c) => c.surface === 'b')!,
      exact = candidates.find((c) => c.surface === 'exact')!
    expect(a.group).toBe(b.group)
    expect(exact.group).not.toBe(a.group)
    const partition = partitionComposeTray(
      candidates,
      claimComposeCandidate(loadComposeTray(null, text), a, 'w:a')
    )
    expect(labels(partition.stashed)).toEqual(['b'])
    expect(labels(partition.floating)).toEqual(['exact'])
  })

  it('同词出现多次分别展开，选择第一处不影响第二处', () => {
    const p = fixture()
    word(p, 'a', '光')
    word(p, 'b', '光')
    const text = '光，光',
      candidates = tray(p, text)
    expect(candidates.map((c) => [c.surface, c.at])).toEqual([
      ['a', 0],
      ['b', 0],
      ['a', 2],
      ['b', 2]
    ])
    expect(new Set(candidates.map((c) => c.id)).size).toBe(4)
    const partition = partitionComposeTray(
      candidates,
      claimComposeCandidate(loadComposeTray(null, text), candidates[0], 'w:first')
    )
    expect(partition.stashed.map((c) => c.at)).toEqual([0])
    expect(partition.floating.map((c) => c.at)).toEqual([2, 2])
  })

  it('同形异义保持各词条身份，恢复时仍可准确选择另一个ID', () => {
    const p = fixture(),
      first = word(p, 'same', '光'),
      second = word(p, 'same', '光')
    const text = '光',
      candidates = tray(p, text),
      a = candidates.find((c) => c.lexemeId === first)!,
      b = candidates.find((c) => c.lexemeId === second)!
    let state = claimComposeCandidate(loadComposeTray(null, text), a, 'w:first')
    state = restoreComposeCandidate(state, b.id)
    expect(partitionComposeTray(candidates, state).floating[0].lexemeId).toBe(second)
    state = claimComposeCandidate(state, b, 'w:second')
    expect(state.claims.map((claim) => claim.candidateId)).toEqual([a.id, b.id])
    expect(partitionComposeTray(candidates, state)).toEqual({ floating: [], stashed: [] })
  })

  it('同词的不同释义、位置与语素都带独立来源', () => {
    const p = fixture()
    word(p, 'multi', '光；影')
    const morpheme = createMorpheme(p.languages[0].id)
    morpheme.form = '-x'
    morpheme.meaning = { zh: '光' }
    p.morphemes.push(morpheme)
    const candidates = tray(p, '光与影')
    expect(
      candidates.filter((c) => c.surface === 'multi').map((c) => [c.matched, c.at, c.end])
    ).toEqual([
      ['光', 0, 1],
      ['影', 2, 3]
    ])
    expect(candidates.find((c) => c.morphemeId === morpheme.id)?.group).toBe(
      candidates.find((c) => c.at === 0 && c.surface === 'multi')?.group
    )
  })

  it('旧候选API仍一词一个最佳位置，新元数据包含重复位置', () => {
    const p = fixture()
    word(p, 'a', '光')
    const candidates = query(p, '光，光')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ at: 0, end: 1 })
    expect(candidates[0].occurrences?.map((o) => [o.at, o.end])).toEqual([
      [0, 1],
      [2, 3]
    ])
  })

  it('重复同义项只展开一次，同一语素的其他位置不会被全局隐藏', () => {
    const p = fixture()
    word(p, 'a', 'light；light')
    const candidates = tray(p, 'light and light')
    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => c.at)).toEqual([0, 10])
  })

  it('原有框架固定短词抑制规则保留，但独立出现的位置完整展开', () => {
    const p = fixture()
    word(p, 'frame', '在…中')
    word(p, 'at', '在')
    expect(
      tray(p, '在光中，在岸边，在山上')
        .filter((c) => c.surface === 'at')
        .map((c) => c.at)
    ).toEqual([4, 8])
  })

  it('经验评分作用到各位置，不累积或改写工程数据', () => {
    const p = fixture(),
      id = word(p, 'a', '光'),
      sentence = createSentence(p.languages[0].id)
    const base = query(p, '光，光')[0].occurrences!.map((o) => o.score)
    sentence.translation = { zh: '光' }
    sentence.tokens = [
      { surface: 'a', chosen: 0, analyses: [{ lexemeId: id, slot: null, morphs: [] }] }
    ]
    p.sentences.push(sentence)
    const before = JSON.stringify(p)
    expect(query(p, '光，光')[0].occurrences!.map((o) => o.score)).toEqual(base.map((n) => n + 2))
    expect(query(p, '光，光')).toEqual(query(p, '光，光'))
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('候选桶状态与实际承载对象', () => {
  it.each([undefined, null, {}, { version: 0 }, { version: 1, translation: '旧译文' }])(
    '旧草稿或不同译文回退为空状态 %j',
    (saved) => {
      expect(loadComposeTray(saved, '光')).toEqual({
        version: 1,
        translation: '光',
        claims: [],
        restored: []
      })
    }
  )

  it('草稿JSON往返保留收纳和手动恢复，不持有原数组', () => {
    const { translation, candidates, a, b } = simple()
    const original = restoreComposeCandidate(
      claimComposeCandidate(loadComposeTray(null, translation), a, 'w:a'),
      b.id
    )
    const loaded = loadComposeTray(JSON.parse(JSON.stringify(original)), translation)
    expect(loaded).toEqual(original)
    expect(loaded.claims).not.toBe(original.claims)
    expect(labels(partitionComposeTray(candidates, loaded).floating)).toEqual(['beta', 'gamma'])
  })

  it('损坏的可选草稿字段被丢弃，重复owner不会留下两个claim', () => {
    const loaded = loadComposeTray(
      {
        version: 1,
        translation: '光',
        claims: [
          null,
          { owner: '', candidateId: 'x', group: null },
          { owner: 'w:a', candidateId: 'a', group: 'g' },
          { owner: 'w:a', candidateId: 'b', group: 'g' },
          { owner: 'w:b', candidateId: 'b', group: 4 }
        ],
        restored: [null, 'a', 'a', 3]
      },
      '光'
    )
    expect(loaded.claims).toEqual([{ owner: 'w:a', candidateId: 'a', group: 'g' }])
    expect(loaded.restored).toEqual(['a'])
  })

  it('重排与改形不改变owner，删除最后一个owner才释放整组', () => {
    const { translation, candidates, a } = simple()
    let state = claimComposeCandidate(loadComposeTray(null, translation), a, 'w:first')
    state = claimComposeCandidate(state, a, 'piece:host:marker')
    expect(reconcileComposeTray(state, translation, ['piece:host:marker', 'w:first'])).toBe(state)
    state = reconcileComposeTray(state, translation, ['piece:host:marker'])
    expect(labels(partitionComposeTray(candidates, state).stashed)).toEqual(['beta'])
    state = reconcileComposeTray(state, translation, [])
    expect(labels(partitionComposeTray(candidates, state).floating)).toEqual([
      'alpha',
      'beta',
      'gamma'
    ])
  })

  it('承载对象改选另组会释放旧组，其他owner的选择不受影响', () => {
    const { translation, candidates, a } = simple(),
      gamma = candidates.find((c) => c.surface === 'gamma')!
    let state = claimComposeCandidate(loadComposeTray(null, translation), a, 'w:a')
    state = claimComposeCandidate(state, gamma, 'w:a')
    expect(state.claims).toHaveLength(1)
    expect(labels(partitionComposeTray(candidates, state).floating)).toEqual(['alpha', 'beta'])
  })

  it('恢复后再选会重新收起同组其他项，原已选项不会落桶', () => {
    const { translation, candidates, a, b } = simple()
    let state = claimComposeCandidate(loadComposeTray(null, translation), a, 'w:a')
    state = restoreComposeCandidate(state, b.id)
    expect(labels(partitionComposeTray(candidates, state).floating)).toEqual(['beta', 'gamma'])
    state = claimComposeCandidate(state, b, 'w:b')
    expect(state.restored).toEqual([])
    expect(partitionComposeTray(candidates, state).stashed).toEqual([])
    state = reconcileComposeTray(state, translation, ['w:b'])
    expect(labels(partitionComposeTray(candidates, state).stashed)).toEqual(['alpha'])
  })

  it('明确恢复已选项允许重复使用，同candidate可以有多个owner', () => {
    const { translation, candidates, a } = simple()
    let state = claimComposeCandidate(loadComposeTray(null, translation), a, 'w:a')
    state = restoreComposeCandidate(state, a.id)
    expect(labels(partitionComposeTray(candidates, state).floating)).toEqual(['alpha', 'gamma'])
    state = claimComposeCandidate(state, a, 'w:again')
    expect(state.claims.map((c) => c.owner)).toEqual(['w:a', 'w:again'])
    expect(labels(partitionComposeTray(candidates, state).floating)).toEqual(['gamma'])
  })

  it('新译文立即清空旧桶，旧防抖候选不能被错误claim或全添', () => {
    const { translation, candidates, a } = simple()
    const state = claimComposeCandidate(loadComposeTray(null, translation), a, 'w:a')
    const next = reconcileComposeTray(state, '新的译文', ['w:a'])
    expect(next).toEqual(loadComposeTray(null, '新的译文'))
    expect(claimComposeCandidate(next, a, 'w:old')).toBe(next)
    expect(planComposeAddAll(candidates, next)).toEqual([])
    expect(partitionComposeTray(candidates, next).stashed).toEqual([])
  })

  it('还原同一ID幂等，所有操作不修改输入状态或候选', () => {
    const { translation, candidates, a, b } = simple(),
      state = loadComposeTray(null, translation),
      before = JSON.stringify({ state, candidates })
    const claimed = claimComposeCandidate(state, a, 'w:a'),
      restored = restoreComposeCandidate(claimed, b.id)
    expect(restoreComposeCandidate(restored, b.id)).toBe(restored)
    partitionComposeTray(candidates, restored)
    planComposeAddAll(candidates, restored)
    expect(JSON.stringify({ state, candidates })).toBe(before)
  })
})

describe('载入旧词块与手打识别的来源补录', () => {
  it('只凭已知记录唯一位置可补录，避免全添重复已有词块', () => {
    const { translation, candidates, a } = simple(),
      initial = loadComposeTray(null, translation)
    const state = seedComposeTrayOwners(initial, candidates, [
      { owner: 'w:old', lexemeId: a.lexemeId }
    ])
    expect(state.claims).toEqual([{ owner: 'w:old', candidateId: a.id, group: a.group }])
    expect(labels(planComposeAddAll(candidates, state))).toEqual(['gamma'])
  })

  it('多位置不猜落点，只消耗该记录数量而不收其他位置的同义项', () => {
    const p = fixture(),
      id = word(p, 'a', '光')
    word(p, 'b', '光')
    const text = '光，光',
      candidates = tray(p, text)
    const state = seedComposeTrayOwners(loadComposeTray(null, text), candidates, [
      { owner: 'w:old', lexemeId: id }
    ])
    expect(state.claims[0].group).toBeNull()
    const partition = partitionComposeTray(candidates, state)
    expect(partition.stashed).toEqual([])
    expect(partition.floating.filter((c) => c.lexemeId === id).map((c) => c.at)).toEqual([2])
    expect(partition.floating.filter((c) => c.surface === 'b').map((c) => c.at)).toEqual([0, 2])
  })

  it('多个已有词块消耗同数量位置，反复补录不换claim或创建新状态', () => {
    const p = fixture(),
      id = word(p, 'a', '光'),
      text = '光，光，光',
      candidates = tray(p, text)
    const owners = [
      { owner: 'w:one', lexemeId: id },
      { owner: 'w:two', lexemeId: id }
    ]
    const state = seedComposeTrayOwners(loadComposeTray(null, text), candidates, owners)
    expect(new Set(state.claims.map((c) => c.candidateId)).size).toBe(2)
    expect(partitionComposeTray(candidates, state).floating.map((c) => c.at)).toEqual([4])
    expect(seedComposeTrayOwners(state, candidates, [...owners].reverse())).toBe(state)
  })

  it('明确当前快照位置可以收该位置的同义候选', () => {
    const p = fixture(),
      id = word(p, 'a', '光')
    word(p, 'b', '光')
    const text = '光，光',
      candidates = tray(p, text)
    const state = seedComposeTrayOwners(loadComposeTray(null, text), candidates, [
      { owner: 'w:two', lexemeId: id, sourceTranslation: text, sourceAt: 2, sourceEnd: 3 }
    ])
    expect(partitionComposeTray(candidates, state).stashed.map((c) => [c.surface, c.at])).toEqual([
      ['b', 2]
    ])
    expect(partitionComposeTray(candidates, state).floating.map((c) => c.at)).toEqual([0, 0])
  })

  it('旧快照的明确来源不根据新译文重新猜测位置', () => {
    const { translation, candidates, a } = simple(),
      state = loadComposeTray(null, translation)
    expect(
      seedComposeTrayOwners(state, candidates, [
        {
          owner: 'w:old',
          lexemeId: a.lexemeId,
          sourceTranslation: '旧译文',
          sourceAt: 0,
          sourceEnd: 1
        }
      ])
    ).toBe(state)
  })

  it('当前快照明确位置不再存在时不回退消耗别处', () => {
    const { translation, candidates, a } = simple(),
      state = loadComposeTray(null, translation)
    expect(
      seedComposeTrayOwners(state, candidates, [
        {
          owner: 'w:old',
          lexemeId: a.lexemeId,
          sourceTranslation: translation,
          sourceAt: 2,
          sourceEnd: 3
        }
      ])
    ).toBe(state)
  })

  it('恢复标志优先保留，来源补录不会再次收走用户取回的候选', () => {
    const { translation, candidates, a, b } = simple()
    const initial = restoreComposeCandidate(loadComposeTray(null, translation), b.id)
    const state = seedComposeTrayOwners(initial, candidates, [
      { owner: 'w:a', lexemeId: a.lexemeId }
    ])
    expect(state.restored).toBe(initial.restored)
    expect(labels(partitionComposeTray(candidates, state).floating)).toEqual(['beta', 'gamma'])
  })

  it('只匹配记录身份，其他同形词与自由词都不被猜成已有记录', () => {
    const p = fixture(),
      id = word(p, 'same', '光'),
      otherId = word(p, 'same', '光'),
      text = '光',
      candidates = tray(p, text)
    const state = seedComposeTrayOwners(loadComposeTray(null, text), candidates, [
      { owner: 'w:known', lexemeId: id },
      { owner: 'w:free' }
    ])
    expect(state.claims).toHaveLength(1)
    expect(state.claims[0].candidateId).toBe(candidates.find((c) => c.lexemeId === id)!.id)
    expect(partitionComposeTray(candidates, state).stashed[0].lexemeId).toBe(otherId)
  })

  it('词内语素与词块可以分别补录，不改变既有显式claim', () => {
    const p = fixture(),
      id = word(p, 'a', '光'),
      morpheme = createMorpheme(p.languages[0].id)
    morpheme.form = '-s'
    morpheme.meaning = { zh: '影' }
    p.morphemes.push(morpheme)
    const text = '光影',
      candidates = tray(p, text),
      selected = candidates.find((c) => c.lexemeId === id)!
    const initial = claimComposeCandidate(loadComposeTray(null, text), selected, 'w:host')
    const state = seedComposeTrayOwners(initial, candidates, [
      { owner: 'w:host', lexemeId: id },
      { owner: 'piece:host:m:' + morpheme.id, morphemeId: morpheme.id }
    ])
    expect(state.claims[0]).toBe(initial.claims[0])
    expect(state.claims).toHaveLength(2)
  })

  it('已有位置都被消费后不凭空增加位置，删除owner后才重新分配', () => {
    const { translation, candidates, a } = simple(),
      owners = [
        { owner: 'w:first', lexemeId: a.lexemeId },
        { owner: 'w:second', lexemeId: a.lexemeId }
      ]
    const state = seedComposeTrayOwners(loadComposeTray(null, translation), candidates, owners)
    expect(state.claims).toHaveLength(1)
    const released = reconcileComposeTray(state, translation, ['w:second'])
    expect(seedComposeTrayOwners(released, candidates, owners.slice(1)).claims[0].owner).toBe(
      'w:second'
    )
  })

  it('两个词块有同一个明确位置时均保留归属，删除一个仍保留收纳', () => {
    const { translation, candidates, a } = simple(),
      owner = {
        lexemeId: a.lexemeId,
        sourceTranslation: translation,
        sourceAt: a.at,
        sourceEnd: a.end
      }
    const state = seedComposeTrayOwners(loadComposeTray(null, translation), candidates, [
      { ...owner, owner: 'w:a' },
      { ...owner, owner: 'w:b' }
    ])
    expect(state.claims).toHaveLength(2)
    expect(
      labels(
        partitionComposeTray(candidates, reconcileComposeTray(state, translation, ['w:b'])).stashed
      )
    ).toEqual(['beta'])
  })
})

describe('加全部与候选身份', () => {
  it('大量同义词及重复译文只投影最终词条，候选面板预算有界', () => {
    const p = fixture()
    for (let i = 0; i < 10000; i++) word(p, 'qa-' + String(i).padStart(5, '0'), '光')
    const text = Array.from({ length: 80 }, () => '光').join('，'),
      candidates = query(p, text)
    expect(candidates).toHaveLength(40)
    expect(candidates.every((c) => c.occurrences!.length <= COMPOSE_OCCURRENCE_LIMIT)).toBe(true)
    expect(candidates.every((c) => c.occurrencesTruncated)).toBe(true)
    const view = expandComposeCandidateView(candidates, text)
    expect(view.candidates).toHaveLength(COMPOSE_TRAY_LIMIT)
    expect(view.truncated).toBe(true)
    expect(new Set(view.candidates.map((c) => c.key)).size).toBe(40)
    expect(
      planComposeAddAll(view.candidates, loadComposeTray(null, text)).length
    ).toBeLessThanOrEqual(64)
  })

  it('位置截断仍保留较晚的最佳长义项，并沿用原评分', () => {
    const p = fixture()
    word(p, 'multi', '光；影长')
    const text = '光，'.repeat(100) + '影长',
      candidate = query(p, text)[0]
    expect(candidate.matched).toBe('影长')
    const best = candidate.occurrences!.find(
      (o) => o.at === candidate.at && o.end === candidate.end
    )!
    expect(best.score).toBe(candidate.score)
    expect(candidate.occurrences).toHaveLength(COMPOSE_OCCURRENCE_LIMIT)
    expect(candidate.occurrencesTruncated).toBe(true)
    expect(expandComposeCandidateView([candidate], text, 1).candidates[0].at).toBe(candidate.at)
  })

  it('零或非法视图预算不会形成无界面板', () => {
    const { candidates, translation } = simple()
    expect(expandComposeCandidateView(candidates, translation, 0)).toEqual({
      candidates: [],
      truncated: true
    })
    expect(
      expandComposeCandidateView(candidates, translation, Number.POSITIVE_INFINITY).candidates
        .length
    ).toBeLessThanOrEqual(COMPOSE_TRAY_LIMIT)
  })

  it('按译文位置每组取第一个，保留独立重叠词与重复位置', () => {
    const p = fixture()
    for (const [surface, meaning] of [
      ['a', '光'],
      ['b', '光'],
      ['frame', '在…中'],
      ['cloud', '云'],
      ['bird', '云鸟']
    ])
      word(p, surface, meaning)
    const text = '在光中，云鸟，光',
      candidates = tray(p, text)
    const plan = planComposeAddAll(candidates, loadComposeTray(null, text))
    expect(plan.map((c) => [c.surface, c.at])).toEqual([
      ['frame', 0],
      ['a', 1],
      ['bird', 4],
      ['cloud', 4],
      ['a', 7]
    ])
  })

  it('全添跳过收起项，手动恢复后可明确加入另一替代项', () => {
    const { translation, candidates, a, b } = simple()
    const claimed = claimComposeCandidate(loadComposeTray(null, translation), a, 'w:a')
    expect(labels(planComposeAddAll(candidates, claimed))).toEqual(['gamma'])
    expect(labels(planComposeAddAll(candidates, restoreComposeCandidate(claimed, b.id)))).toEqual([
      'beta',
      'gamma'
    ])
  })

  it('候选稳定身份不受字形、评分或输入顺序变更影响', () => {
    const { translation, p, candidates } = simple(),
      before = new Map(candidates.map((c) => [c.key, c.id]))
    p.lexemes.reverse()
    p.lexemes.find((l) => l.lemma === 'alpha')!.lemma = 'new surface'
    expect(
      tray(p, translation)
        .map((c) => c.id)
        .sort()
    ).toEqual([...before.values()].sort())
  })

  it('旧候选无元数据时可使用但不猜同义关系', () => {
    const legacy: ComposeCandidate[] = ['a', 'b'].map((key) => ({
      key,
      surface: key,
      matched: '光',
      at: 0,
      end: 1,
      score: 1
    }))
    const candidates = expandComposeCandidates(legacy, '光')
    expect(candidates.every((c) => c.group === null)).toBe(true)
    const state = claimComposeCandidate(loadComposeTray(null, '光'), candidates[0], 'w:a')
    expect(labels(partitionComposeTray(candidates, state).floating)).toEqual(['b'])
    expect(partitionComposeTray(candidates, state).stashed).toEqual([])
  })

  it('非法或不完整锚点不触发同义收纳', () => {
    const base = query(simple().p, '光')[0]
    const variants = [[], [{ at: -1, end: 1 }], [{ at: 0, end: 2 }], [{ at: 1, end: 1 }]]
    for (const anchors of variants) {
      const candidate = {
        ...base,
        occurrences: [
          { matched: '光', at: 0, end: 1, anchors, template: false, score: 1, priority: 0 }
        ]
      }
      expect(expandComposeCandidates([candidate], '光')[0].group).toBeNull()
    }
  })
})
