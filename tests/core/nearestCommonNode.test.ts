import { describe, it, expect } from 'vitest'
import { createLanguage, newId } from '$lib/core/factory'
import { nearestCommonNode, treePath } from '$lib/core/languageTree'
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
  it('两门语言有同一个父语言：公共节点是那门父语言', () => {
    const p = createLanguage({ name: 'P' })
    const a = createLanguage({ name: 'A', parentId: p.id })
    const b = createLanguage({ name: 'B', parentId: p.id })
    const r = nearestCommonNode(project([p, a, b], []), a.id, b.id)
    expect(r?.node).toEqual({ kind: 'language', id: p.id })
    expect(r?.pathA.map((x) => x.id)).toEqual([a.id, p.id])
    expect(r?.pathB.map((x) => x.id)).toEqual([b.id, p.id])
  })

  it('两条谱系只在分类节点上碰头：公共节点是那个节点', () => {
    const g = group('G')
    const x = createLanguage({ name: 'X' })
    const y = createLanguage({ name: 'Y' })
    x.groupId = g.id
    y.groupId = g.id
    const a = createLanguage({ name: 'A', parentId: x.id })
    const b = createLanguage({ name: 'B', parentId: y.id })
    const r = nearestCommonNode(project([x, y, a, b], [g]), a.id, b.id)
    expect(r?.node).toEqual({ kind: 'group', id: g.id })
    expect(r?.pathA.map((x2) => x2.id)).toEqual([a.id, x.id, g.id])
    expect(r?.pathB.map((x2) => x2.id)).toEqual([b.id, y.id, g.id])
  })

  it('分类节点还能往上一级：碰头的是上一级节点', () => {
    const fam = group('Fam')
    const g1 = group('G1', fam.id)
    const g2 = group('G2', fam.id)
    const a = createLanguage({ name: 'A' })
    const b = createLanguage({ name: 'B' })
    a.groupId = g1.id
    b.groupId = g2.id
    const r = nearestCommonNode(project([a, b], [fam, g1, g2]), a.id, b.id)
    expect(r?.node).toEqual({ kind: 'group', id: fam.id })
    expect(r?.pathA.length).toBe(3)
  })

  it('一门是另一门的祖先：公共节点就是那门祖先', () => {
    const a = createLanguage({ name: 'A' })
    const mid = createLanguage({ name: 'M', parentId: a.id })
    const b = createLanguage({ name: 'B', parentId: mid.id })
    const p = project([a, mid, b], [])
    const r = nearestCommonNode(p, b.id, a.id)
    expect(r?.node).toEqual({ kind: 'language', id: a.id })
    expect(r?.pathA.map((x) => x.id)).toEqual([b.id, mid.id, a.id])
    expect(r?.pathB.map((x) => x.id)).toEqual([a.id])
    // 反过来问也是同一个节点
    expect(nearestCommonNode(p, a.id, b.id)?.node).toEqual({ kind: 'language', id: a.id })
  })

  it('八竿子打不着：返回 null', () => {
    const a = createLanguage({ name: 'A' })
    const b = createLanguage({ name: 'B' })
    expect(nearestCommonNode(project([a, b], []), a.id, b.id)).toBe(null)
    expect(nearestCommonNode(project([a, b], []), a.id, 'nope')).toBe(null)
  })

  it('语言写了所属节点、父语言又在别的节点下时按树里的摆法往上走', () => {
    const g1 = group('G1')
    const g2 = group('G2')
    const p = createLanguage({ name: 'P' })
    p.groupId = g1.id
    const child = createLanguage({ name: 'C', parentId: p.id })
    child.groupId = g2.id
    const proj = project([p, child], [g1, g2])
    // 树里 child 挂在 G2 下，不在 P 下
    expect(treePath(proj, { kind: 'language', id: child.id }).map((x) => x.id)).toEqual([
      child.id,
      g2.id
    ])
    expect(nearestCommonNode(proj, child.id, p.id)).toBe(null)
  })

  it('父语言跟自己同一个节点时跟着父语言走', () => {
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
