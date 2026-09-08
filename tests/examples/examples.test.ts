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
    expect(p.languages).toHaveLength(1)
    expect(p.lexemes.length).toBeGreaterThan(20)
    expect(p.morphemes.some((m) => m.type === 'clitic')).toBe(true)
    const prog = parseRuleText(p.ruleSets[0].text)
    expect(prog.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const out = (w: string): string => runRules(prog, w).output
    expect(out('kaso¢lAr¢Ŭm')).toBe('kasolarum')
    expect(out('nöl¢dA')).toBe('nölde')
    expect(out('ilen¢lAr¢kA')).toBe('ilenlerke')
    expect(out('sör¢mA¢dU¢Ŭm')).toBe('sörmedüm')
    expect(out('kel¢dU¢sAn')).toBe('keldüsen')
    expect(out('teli¢Ŭm')).toBe('telim')
  })

  it('Tsahun loads with tones, two orthographies and no paradigms', () => {
    const p = load('Tsahun.laim.json')
    const L = p.languages[0]
    expect(L.prosody.type).toBe('tone')
    expect(L.prosody.tones).toHaveLength(5)
    expect(L.orthographies).toHaveLength(2)
    expect(p.paradigms).toEqual([])
    const prog = parseRuleText(L.orthographies[0].rulesToIpa)
    expect(runRules(prog, 'tsa55').output).toBe('t͡sa˥')
    expect(runRules(prog, 'ngo21').output).toBe('ŋo˨˩')
  })
})
