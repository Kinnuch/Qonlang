/**
 * 项目文件格式的承诺：1.0 存下的项目文件，之后的每个版本都要能原样打开。
 * tests/fixtures/format-1.0/ 里是 1.0 存盘的原样文件（示例工程 Aelith、Tsahun，外加一份纯欣赏副本）。
 * 这几个文件以后不许改、不许重新生成：读不出来、读出来少了东西，就是格式不兼容了——
 * 该做的是在 serialize.ts 的 migrate 里补迁移，而不是改这里的文件或断言。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject, readProjectText, serializeProject } from '$lib/core/serialize'
import { isSealed } from '$lib/core/sealed'

const dir = join(__dirname, '..', 'fixtures', 'format-1.0')
const text = (name: string): string => readFileSync(join(dir, name), 'utf8')

/** 文件里出现的每一个 id（词条、义项、语素、规则、例句……不管嵌在多深） */
function idsOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) idsOf(v, out)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'id' && typeof v === 'string') out.add(v)
      else idsOf(v, out)
    }
  }
  return out
}

/** 顶层每个集合的条数 */
function counts(value: object): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value)) if (Array.isArray(v)) out[k] = v.length
  return out
}

describe.each(['Aelith', 'Tsahun'])('a project file saved by 1.0 (%s)', (name) => {
  const raw = text(`${name}.laim.json`)
  const json = JSON.parse(raw) as object

  it('opens with every collection and every id intact', () => {
    const p = parseProject(raw)
    const now = counts(p)
    for (const [k, n] of Object.entries(counts(json))) expect(now[k], k).toBe(n)
    const kept = idsOf(p)
    const lost = [...idsOf(json)].filter((id) => !kept.has(id))
    expect(lost).toEqual([])
  })

  it('saves and opens again without changing', () => {
    const p = parseProject(raw)
    expect(parseProject(serializeProject(p))).toEqual(p)
  })
})

describe('the frozen files', () => {
  it('still hold what they held in 1.0', () => {
    // 文件被人改过、重新生成过时这里先报出来
    const a = parseProject(text('Aelith.laim.json'))
    expect(a.languages).toHaveLength(3)
    expect(a.lexemes).toHaveLength(47)
    expect(a.morphemes).toHaveLength(27)
    expect(a.paradigms).toHaveLength(8)
    expect(a.sentences).toHaveLength(9)
    expect(a.lexemes.some((l) => l.lemma === 'kaso')).toBe(true)
    const t = parseProject(text('Tsahun.laim.json'))
    expect(t.languages.length).toBeGreaterThan(0)
    expect(t.lexemes.length).toBeGreaterThan(0)
  })

  it('a read-only copy saved by 1.0 still opens', async () => {
    const sealed = text('Tsahun.readonly.laim.json')
    expect(isSealed(sealed)).toBe(true)
    const p = parseProject(await readProjectText(sealed))
    expect(p.meta.readOnly).toBe(true)
    const plain = parseProject(text('Tsahun.laim.json'))
    expect(counts(p)).toEqual(counts(plain))
    expect([...idsOf(p)].sort()).toEqual([...idsOf(plain)].sort())
  })
})
