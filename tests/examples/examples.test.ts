/**
 * 示例项目（examples/*.laim.json）必须能被当前版本读回，且其中的规则集给出预期结果。
 */
import { buildDrawnFont } from '$lib/script/drawnFont'
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import { compareContext, compareGroups, soundPathOfWord, wordPath } from '$lib/core/compare'
import { parseRuleText, runRules } from '$lib/engine/sca'
import { analyzeWord, languageParseOptions } from '$lib/engine/phon'
import { stressWord, transcribe } from '$lib/core/pronounce'
import { lexiconIssues } from '$lib/core/lexiconIssues'
import { lexemeStress, morphemeStress, stressForWord } from '$lib/core/stressInfo'
import { lexemeScript } from '$lib/script/render'
import { sentenceScriptText } from '$lib/script/lexiconScript'

const dir = join(__dirname, '..', '..', 'examples')
const load = (name: string) => parseProject(readFileSync(join(dir, name), 'utf8'))

describe.skipIf(!existsSync(join(dir, 'Aelith.laim.json')))('example projects', () => {
  it('Aelith loads and its vowel-harmony rules resolve suffix archiphonemes', () => {
    const p = load('Aelith.laim.json')
    // 祖语 + 现代语 + 姊妹语；词条、语素、构形都要够示范用
    expect(p.languages).toHaveLength(3)
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
      'paradigm',
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
    // 两个词连写再带格缀，没写分隔符也切得开
    const compound = p.sentences.flatMap((s) => s.tokens).find((t) => t.surface === 'ilenkasoda')!
    expect(compound.analyses[compound.chosen].morphs.map((m) => m.form)).toEqual(['ilen', 'kasoda'])
    expect(p.paradigms.some((x) => x.appliesToAll)).toBe(true)
    // 复合词类与义项的词类、一个义项几个语域、基础变体改名、检视器模块
    const kara = p.lexemes.find((l) => l.lemma === 'kara')!
    expect(p.posList.find((x) => x.id === kara.posId)?.components).toHaveLength(2)
    expect(new Set(kara.senses.map((s) => s.posId)).size).toBe(2)
    expect(p.lexemes.some((l) => l.senses.some((s) => s.registers.length > 1))).toBe(true)
    expect(p.paradigms.find((x) => x.variants.length)?.baseVariantName).toBe('书面')
    // 一个词类绑几个构形：「动词」默认变位法一，tur- 在词条里挑了变位法二（过去时 -tI）
    const verbPos = p.posList.find((x) => x.name.zh === '动词')!
    expect(verbPos.extraParadigmIds).toHaveLength(2)
    const surfaces = (lemma: string): string[] =>
      Object.values(p.lexemes.find((l) => l.lemma === lemma)!.forms).map((f) => f.surface)
    expect(p.lexemes.find((l) => l.lemma === 'tur-')!.paradigmId).toBe(verbPos.extraParadigmIds![0])
    expect(surfaces('tur-')).toContain('turtim')
    expect(surfaces('sör-')).toContain('sördüm')
    // 按条件换字母：与格 ¢{阴:g|k}A，阴性 sila / vene 用 g，阳性 kaso 用 k
    // 构形套构形 + 一个词条几个构形：sör- 另外加了「动名词」，-mAk 之后套进名词的格
    const sor = p.lexemes.find((l) => l.lemma === 'sör-')!
    expect(sor.extraParadigms).toHaveLength(1)
    expect(surfaces('sör-')).toEqual(expect.arrayContaining(['sörmek', 'sörmekde']))
    // 从构形生成的词条：词源是派生、来源与关系挂 sör-
    const sormek = p.lexemes.find((l) => l.lemma === 'sörmek')!
    expect(sormek.etymology).toMatchObject({
      type: 'derivation',
      sources: [{ kind: 'lexeme', id: sor.id }],
      notes: '动名词 · 主格'
    })
    expect(sormek.relations).toEqual([{ kind: 'derivation', lexemeId: sor.id }])
    // 手写的字形：有笔画，字符是私用区码位，能做成字体
    const runes = p.languages
      .flatMap((l) => l.scripts)
      .find((s) => s.glyphs.some((g) => g.drawing))!
    const drawn = runes.glyphs.find((g) => g.drawing)!
    expect(drawn.char.codePointAt(0)).toBeGreaterThanOrEqual(0xe000)
    expect(buildDrawnFont(runes, 'x')).not.toBeNull()
    expect(surfaces('sila')).toContain('silaga')
    expect(surfaces('sila')).not.toContain('silaka')
    expect(surfaces('vene')).toContain('venege')
    expect(surfaces('kaso')).toContain('kasoka')
    expect(p.customFields.map((f) => f.name.zh)).toEqual(['文化注释', '刻文异体'])
    // 维度按词类限定：「级与派生」只给形容词
    const degree = p.categories.find((c) => c.name.zh === '级与派生')!
    expect(degree.posIds).toHaveLength(1)
    expect(p.categories.find((c) => c.name.zh === '和谐类')?.posIds).toBeUndefined()
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
    // 祖语到现代语：两路规则与两个排除，推出来的就是词库里的现代形式
    const protoRs = p.ruleSets.find((r) => r.name === 'Proto → Aelith')!
    const proto = parseRuleText(protoRs.text)
    expect(proto.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const evolve = (w: string): string => runRules(proto, w).output
    expect(['kasu', 'nol', 'sor', 'teli', 'θura', 'metha', 'taku'].map(evolve)).toEqual([
      'kaso',
      'nöl',
      'sör',
      'teli',
      'tura',
      'mesa',
      'taku'
    ])
    const rules = proto.steps.filter((s) => s.kind === 'rule')
    expect(rules.some((r) => r.kind === 'rule' && r.branches)).toBe(true)
    expect(rules.some((r) => r.kind === 'rule' && r.exceptions.length === 2)).toBe(true)
  })

  it('Aelith：特征、重音规则、音节边界 σ，正字法转出来的音标带重音，缺释义的词条', () => {
    const p = load('Aelith.laim.json')
    const L = p.languages.find((l) => l.name === 'Aelith')!
    const rs = p.ruleSets.find((r) => r.name === '书面语 → 口语')!
    const prog = parseRuleText(rs.text, languageParseOptions(L, p))
    expect(prog.diagnostics).toEqual([])
    expect(prog.lines.filter((l) => l.kind === 'feature')).toHaveLength(3)
    expect(prog.hasStress).toBe(true)
    const run = (w: string) => runRules(prog, w)
    expect(run('biz').output).toBe('ˈbis')
    expect(run('sepe').output).toBe('ˈsepə')
    expect(run('sörmek').stages.map((x) => x.form)).toEqual(['ˈsörmek', 'ˈsörmək'])
    expect(run('kamsa').output).toBe('ˈkãmsa')
    expect(transcribe(L, L.orthographies[0], 'sörmek')).toBe('ˈsørmek')
    expect(analyzeWord(L, 'ˈsørmek').text).toBe('ˈsør.mek')
    // 对重音影响：测试台敲的词对上词条时带上词类与特殊重音——代词不重读，telikaso 重读 ka
    const bench = (w: string) => runRules(prog, w, { word: stressForWord(p, L.id, w) }).output
    expect(bench('biz')).toBe('bis')
    expect(bench('sen')).toBe('sən')
    expect(bench('telikaso')).toBe('təliˈkaso')
    const pron = (w: string) =>
      p.lexemes.find((x) => x.lemma === w)!.pronunciations[L.orthographies[0].id]?.ipa
    expect(pron('men')).toBe('men')
    expect(pron('telikaso')).toBe('teliˈkaso')
    expect(pron('sepe')).toBe('ˈsepe')
    expect(
      morphemeStress(
        p,
        p.morphemes.find((m) => m.form === '=mU')!
      )
    ).toEqual({ stress: 0 })
    // 姊妹语 Merun 的自定义重音规则
    const S = p.languages.find((l) => l.name === 'Merun')!
    expect(S.prosody.stressPosition).toBe('custom')
    expect(stressWord(S, 'hasta')).toBe('ˈhasta')
    expect(stressWord(S, 'hasu')).toBe('haˈsu')
    const hara = p.lexemes.find((l) => l.lemma === 'hara')!
    expect(stressWord(S, 'hara')).toBe('haˈra')
    expect(stressWord(S, 'hara', lexemeStress(p, hara))).toBe('ˈhara')
    // vesa 故意没写释义：词库底栏的问题统计里有它
    const vesa = p.lexemes.find((l) => l.lemma === 'vesa')!
    expect(lexiconIssues(p.lexemes).some((x) => x.lexemeId === vesa.id)).toBe(true)
  })

  it('Aelith 的姊妹语 Merun：同一个词根的同源词能在关系图里对比', () => {
    const p = load('Aelith.laim.json')
    const merunRs = p.ruleSets.find((r) => r.name === 'Proto → Merun')!
    const prog = parseRuleText(merunRs.text)
    expect(prog.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const merun = p.languages.find((l) => l.name === 'Merun')!
    const words = p.lexemes.filter((l) => l.languageId === merun.id)
    // 词库里的 Merun 词都是这套规则从祖语词根推出来的
    for (const w of words) {
      const src = w.etymology.sources[0]
      const root = p.morphemes.find((m) => src.kind === 'morpheme' && m.id === src.id)!
      expect(runRules(prog, root.form).output).toBe(w.lemma.replace(/-$/, ''))
    }
    const kaso = p.lexemes.find((l) => l.lemma === 'kaso')!
    const ctx = compareContext(p, p.settings.glossLanguages)
    const groups = compareGroups(ctx, kaso)
    const cognates = groups[0]
    expect(cognates.languageCount).toBeGreaterThan(1)
    expect(cognates.lexemes.map((l) => l.lemma)).toEqual(
      expect.arrayContaining(['kaso', 'hasu', 'kasolu', 'telikaso'])
    )
    const hasu = cognates.lexemes.find((l) => l.lemma === 'hasu')!
    const sound = soundPathOfWord(ctx, new Map(), hasu, wordPath(ctx, hasu, cognates.root.key))
    expect(sound?.path.ruleSetName).toBe('Proto → Merun')
    expect(sound?.path.matches).toBe(true)
    // 同一语言里由 kaso 派生、复合的词自成一组，构成各不相同
    const derived = groups.find((g) => g.root.key === `l:${kaso.id}`)!
    expect(derived.lexemes.map((l) => l.lemma).sort()).toEqual(['kasolu', 'telikaso'])
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
    // 罗马化里 ts、ng 是一个音：强调重叠取头两个音是 tsi，不是 ts
    const tsing = p.lexemes.find((l) => l.lemma === 'tsing55')!
    expect(tsing.forms['强调'].surface).toBe('tsitsing55')
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
    // 连读变调：35 后面还有音节读 33（软件里正字法规则带着这门语言的音类 C、V）
    const sandhi = parseRuleText(L.orthographies[0].rulesToIpa, {
      classes: languageParseOptions(L).classes
    })
    expect(runRules(sandhi, 'lun35').output).toBe('lun˧˥')
    expect(runRules(sandhi, 'lun35lun35').output).toBe('lun˧lun˧˥')
    // 按字号写的意音文字：词条的「字号」模块逐词写，没有字号的虚词照原文
    const logo = L.scripts.find((s) => s.name === 'Tsahun 刻符')!
    expect(logo.from).toMatch(/^custom:/)
    const first = p.sentences.find((s) => s.text === 'ngo21 kwe51 ta33 sip51')!
    expect(sentenceScriptText(p, L, logo, first)).toBe('⼰ ⼝ ta33 ⿂')
    expect(
      lexemeScript(
        L,
        logo,
        p.lexemes.find((l) => l.lemma === 'wa55')!
      )
    ).toBe('⼧ ⼈')
  })
})
