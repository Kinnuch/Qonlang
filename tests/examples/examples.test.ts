/**
 * 示例项目（examples/*.laim.json）必须能被当前版本读回，且其中的规则集给出预期结果。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import { parseRuleText, runRules } from '$lib/engine/sca'

const dir = join(__dirname, '..', '..', 'examples')
const load = (name: string) => parseProject(readFileSync(join(dir, name), 'utf8'))

describe.skipIf(!existsSync(join(dir, 'Aelith.laim.json')))('example projects', () => {
  it('Aelith loads and its vowel-harmony rules resolve suffix archiphonemes', () => {
    const p = load('Aelith.laim.json')
    // 祖语 + 现代语；词条、语素、构形都要够示范用
    expect(p.languages).toHaveLength(2)
    expect(p.lexemes.length).toBeGreaterThan(20)
    expect(p.morphemes.some((m) => m.type === 'clitic')).toBe(true)
    expect(p.morphemes.some((m) => m.type === 'circumfix')).toBe(true)
    expect(p.paradigms.length).toBeGreaterThan(3)
    // 每一种流水线步骤都出现过一次
    const kinds = new Set(
      p.paradigms.flatMap((x) =>
        Object.values(x.generators).flatMap((g) =>
          g.kind === 'pipeline' ? g.steps.map((st) => st.kind) : []
        )
      )
    )
    expect([...kinds].sort()).toEqual([
      'adjust',
      'circumfix',
      'infix',
      'pattern',
      'prefix',
      'reduplication',
      'sca',
      'suffix'
    ])
    // 例句全部认得出来，打开就是做完的样子
    expect(p.sentences.length).toBeGreaterThan(3)
    expect(p.sentences.every((s) => s.tokens.length && s.tokens.every((t) => t.confirmed))).toBe(
      true
    )
    const rs = p.ruleSets.find((r) => r.name === '元音和谐')!
    const prog = parseRuleText(rs.text)
    expect(prog.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const out = (w: string): string => runRules(prog, w).output
    expect(out('kaso¢lAr¢Ŭm')).toBe('kasolarum')
    expect(out('nöl¢dA')).toBe('nölde')
    expect(out('ilen¢lAr¢kA')).toBe('ilenlerke')
    expect(out('sör¢mA¢dU¢Ŭm')).toBe('sörmedüm')
    expect(out('kel¢dU¢sAn')).toBe('keldüsen')
    expect(out('teli¢Ŭm')).toBe('telim')
  })

  it('Tsahun loads with tones, two orthographies, packing and reduplication', () => {
    const p = load('Tsahun.laim.json')
    const L = p.languages[0]
    expect(L.prosody.type).toBe('tone')
    expect(L.prosody.tones).toHaveLength(5)
    expect(L.orthographies).toHaveLength(2)
    // 音节文字：拼合打开，竖排打开
    const syl = L.scripts[0]
    expect(syl.packing?.enabled).toBe(true)
    expect(syl.vertical).toBe(true)
    // 重叠构形推出的复数在词条里
    const lun = p.lexemes.find((l) => l.lemma === 'lun35')!
    expect(lun.forms['复数'].surface).toBe('lun35lun35')
    expect(p.sentences.every((s) => s.tokens.every((t) => t.confirmed))).toBe(true)
    const prog = parseRuleText(L.orthographies[0].rulesToIpa)
    expect(runRules(prog, 'tsa55').output).toBe('t͡sa˥')
    expect(runRules(prog, 'ngo21').output).toBe('ŋo˨˩')
  })
})
