import { describe, it, expect } from 'vitest'
import { createLanguage, newId } from '$lib/core/factory'
import {
  displayPathTo,
  languageAncestors,
  nearestCommonNode,
  treePath
} from '$lib/core/languageTree'
import type { Language, LanguageGroup, Project } from '$lib/core/model'

function group(name: string, parentId: string | null = null): LanguageGroup {
  return {
    id: newId(),
    name,
    abbr: '',
    level: parentId ? 'branch' : 'family',
    parentId,
    protoLanguageId: null,
    notes: ''
  }
}

/** 只用到语言和分类节点，别的字段测试里用不上 */
function project(languages: Language[], languageGroups: LanguageGroup[]): Project {
  return { languages, languageGroups } as unknown as Project
}

describe('nearestCommonNode', () => {
  it('姐妹语：公共祖先是共同的那门父语言', () => {
    const p = createLanguage({ name: 'P' })
    const a = createLanguage({ name: 'A', parentId: p.id })
    const b = createLanguage({ name: 'B', parentId: p.id })
    const r = nearestCommonNode(project([p, a, b], []), a.id, b.id)
    expect(r?.node).toEqual({ kind: 'language', id: p.id })
    expect(r?.pathA.map((x) => x.id)).toEqual([a.id, p.id])
    expect(r?.pathB.map((x) => x.id)).toEqual([b.id, p.id])
  })

  it('一门是另一门的祖先：公共祖先就是那门祖先，不再往上爬', () => {
    const a = createLanguage({ name: 'A' })
    const mid = createLanguage({ name: 'M', parentId: a.id })
    const b = createLanguage({ name: 'B', parentId: mid.id })
    const p = project([a, mid, b], [])
    const r = nearestCommonNode(p, b.id, a.id)
    expect(r?.node).toEqual({ kind: 'language', id: a.id })
    expect(r?.pathA.map((x) => x.id)).toEqual([b.id, mid.id, a.id])
    expect(r?.pathB.map((x) => x.id)).toEqual([a.id])
    // 反过来问也是同一门祖先
    expect(nearestCommonNode(p, a.id, b.id)?.node).toEqual({ kind: 'language', id: a.id })
  })

  it('祖先与后代挂在不同分类节点下：照样算出那门祖先', () => {
    const g1 = group('G1')
    const g2 = group('G2')
    const p = createLanguage({ name: 'P' })
    p.groupId = g1.id
    const child = createLanguage({ name: 'C', parentId: p.id })
    child.groupId = g2.id
    const proj = project([p, child], [g1, g2])
    // 树里 child 摆在 G2 下（摆法没变），但公共祖先只看语言
    expect(treePath(proj, { kind: 'language', id: child.id }).map((x) => x.id)).toEqual([
      child.id,
      g2.id
    ])
    const r = nearestCommonNode(proj, child.id, p.id)
    expect(r?.node).toEqual({ kind: 'language', id: p.id })
    expect(r?.pathA.map((x) => x.id)).toEqual([child.id, p.id])
    expect(r?.pathB.map((x) => x.id)).toEqual([p.id])
  })

  it('跨语支的两门语言：公共祖先是共同的祖语，路径里没有分类节点', () => {
    const fam = group('Fam')
    const g1 = group('G1', fam.id)
    const g2 = group('G2', fam.id)
    const proto = createLanguage({ name: 'Proto' })
    proto.groupId = fam.id
    const x = createLanguage({ name: 'X', parentId: proto.id })
    x.groupId = g1.id
    const y = createLanguage({ name: 'Y', parentId: proto.id })
    y.groupId = g2.id
    const a = createLanguage({ name: 'A', parentId: x.id })
    const b = createLanguage({ name: 'B', parentId: y.id })
    const proj = project([proto, x, y, a, b], [fam, g1, g2])
    const r = nearestCommonNode(proj, a.id, b.id)
    expect(r?.node).toEqual({ kind: 'language', id: proto.id })
    expect(r?.pathA.map((n) => n.id)).toEqual([a.id, x.id, proto.id])
    expect(r?.pathB.map((n) => n.id)).toEqual([b.id, y.id, proto.id])
    expect([...(r?.pathA ?? []), ...(r?.pathB ?? [])].every((n) => n.kind === 'language')).toBe(
      true
    )
  })

  it('只在分类节点上碰得到、语言层面碰不上：返回 null', () => {
    const g = group('G')
    const x = createLanguage({ name: 'X' })
    const y = createLanguage({ name: 'Y' })
    x.groupId = g.id
    y.groupId = g.id
    const a = createLanguage({ name: 'A', parentId: x.id })
    const b = createLanguage({ name: 'B', parentId: y.id })
    expect(nearestCommonNode(project([x, y, a, b], [g]), a.id, b.id)).toBe(null)
  })

  it('八竿子打不着：返回 null；问的不是语言也返回 null', () => {
    const g = group('G')
    const a = createLanguage({ name: 'A' })
    const b = createLanguage({ name: 'B' })
    a.groupId = g.id
    expect(nearestCommonNode(project([a, b], [g]), a.id, b.id)).toBe(null)
    expect(nearestCommonNode(project([a, b], [g]), a.id, 'nope')).toBe(null)
    // 分类节点本身不参与算公共祖先
    expect(nearestCommonNode(project([a, b], [g]), a.id, g.id)).toBe(null)
  })
})

describe('languageAncestors', () => {
  it('顺着祖语往上排，分类节点不掺进来', () => {
    const g = group('G')
    const p = createLanguage({ name: 'P' })
    const child = createLanguage({ name: 'C', parentId: p.id })
    child.groupId = g.id
    expect(languageAncestors(project([p, child], [g]), child.id).map((l) => l.id)).toEqual([
      child.id,
      p.id
    ])
  })

  it('父语言绕成圈时到此为止，不会死循环', () => {
    const a = createLanguage({ name: 'A' })
    const b = createLanguage({ name: 'B', parentId: a.id })
    a.parentId = b.id
    expect(languageAncestors(project([a, b], []), a.id).map((l) => l.id)).toEqual([a.id, b.id])
  })
})

describe('treePath', () => {
  it('父语言跟自己同一个节点时跟着父语言走（树的摆法没变）', () => {
    const g = group('G')
    const p = createLanguage({ name: 'P' })
    p.groupId = g.id
    const child = createLanguage({ name: 'C', parentId: p.id })
    child.groupId = g.id
    const proj = project([p, child], [g])
    expect(treePath(proj, { kind: 'language', id: child.id }).map((x) => x.id)).toEqual([
      child.id,
      p.id,
      g.id
    ])
  })
})

describe('displayPathTo', () => {
  it('画出来的那条链经过语支，并且先经过语系的代表原始语', () => {
    // 语系（原始语 P）› 语支 A / 语支 B，两门语言各挂一支下面
    const fam = group('语系')
    const a = group('语支A', fam.id)
    const b = group('语支B', fam.id)
    const proto = createLanguage({ name: 'P' })
    proto.groupId = fam.id
    fam.protoLanguageId = proto.id
    const x = createLanguage({ name: 'X', parentId: proto.id })
    x.groupId = a.id
    const y = createLanguage({ name: 'Y', parentId: proto.id })
    y.groupId = b.id
    const proj = project([proto, x, y], [fam, a, b])
    // 公共祖先是原始语本身
    expect(nearestCommonNode(proj, x.id, y.id)?.node.id).toBe(proto.id)
    // 链条：X → 语支A → P（到公共祖语为止，不再往上到语系）
    expect(displayPathTo(proj, x.id, proto.id).map((r) => r.id)).toEqual([x.id, a.id, proto.id])
    expect(displayPathTo(proj, y.id, proto.id).map((r) => r.id)).toEqual([y.id, b.id, proto.id])
  })

  it('同一个节点里的祖语与子语言：直接连上，中间不插节点', () => {
    const g = group('语支')
    const p = createLanguage({ name: 'P' })
    p.groupId = g.id
    const c = createLanguage({ name: 'C', parentId: p.id })
    c.groupId = g.id
    const proj = project([p, c], [g])
    expect(displayPathTo(proj, c.id, p.id).map((r) => r.id)).toEqual([c.id, p.id])
  })
})
