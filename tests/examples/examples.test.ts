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
    // 例句都认得出来，只有故意没进词库的人名 Mira 留着「没有找到」
    expect(p.sentences.length).toBeGreaterThan(3)
    const open = p.sentences.flatMap((s) =>
      s.tokens.filter((t) => !t.confirmed).map((t) => t.surface)
    )
    expect(open).toEqual(['Mira'])
    // 作用于所有词的连读浊化：dovar 反推成 tovar
    const tovar = p.lexemes.find((l) => l.lemma === 'tovar')!
    const dovar = p.sentences.flatMap((s) => s.tokens).find((t) => t.surface === 'dovar')!
    expect(dovar.analyses[dovar.chosen].lexemeId).toBe(tovar.id)
    expect(p.paradigms.some((x) => x.appliesToAll)).toBe(true)
    // 复合词类与义项的词类、一个义项几个语域、基础变体改名、检视器模块
    const kara = p.lexemes.find((l) => l.lemma === 'kara')!
    expect(p.posList.find((x) => x.id === kara.posId)?.components).toHaveLength(2)
    expect(new Set(kara.senses.map((s) => s.posId)).size).toBe(2)
    expect(p.lexemes.some((l) => l.senses.some((s) => s.registers.length > 1))).toBe(true)
    expect(p.paradigms.find((x) => x.variants.length)?.baseVariantName).toBe('书面')
    expect(p.customFields.map((f) => f.name.zh)).toEqual(['文化注释', '刻文异体'])
    const kaso = p.lexemes.find((l) => l.lemma === 'kaso')!
    expect(Object.keys(kaso.custom ?? {})).toHaveLength(2)
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
    // 只有分不出来的同形词 hok33 留着没确认
    const open = p.sentences.flatMap((s) =>
      s.tokens.filter((t) => !t.confirmed).map((t) => t.surface)
    )
    expect(open).toEqual(['hok33'])
    // 同形词按这句的译文挑：「我学了」是 学，「房子是红的」是 红
    const pick = (text: string): string => {
      const s = p.sentences.find((x) => x.text === text)!
      const t = s.tokens.find((x) => x.surface === 'hok33')!
      const id = t.analyses[t.chosen].lexemeId
      return p.lexemes.find((l) => l.id === id)!.senses[0].definition.zh
    }
    expect(pick('ngo21 hok33 ta33')).toContain('学')
    expect(pick('wa55 hok33')).toBe('红')
    // 代词复数：@tui55 引用词条，带空格的形式在语料里并成一个词
    const ngo = p.lexemes.find((l) => l.lemma === 'ngo21')!
    expect(ngo.forms['复数'].surface).toBe('ngo21 tui55')
    expect(
      p.sentences.some((s) => s.tokens.some((t) => t.surface === 'ngo21 tui55' && t.confirmed))
    ).toBe(true)
    expect(p.customFields.find((f) => f.name.zh === '异体字')?.scriptId).toBe(syl.id)
    const prog = parseRuleText(L.orthographies[0].rulesToIpa)
    expect(runRules(prog, 'tsa55').output).toBe('t͡sa˥')
    expect(runRules(prog, 'ngo21').output).toBe('ŋo˨˩')
  })
})
