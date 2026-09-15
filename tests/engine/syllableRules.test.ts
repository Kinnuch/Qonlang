import { describe, it, expect } from 'vitest'
import {
  parseRuleText,
  runRules,
  parseStressText,
  formatStressText,
  parseFeatureLine,
  formatFeatureLine,
  escapeRuleText,
  type ParseOptions
} from '$lib/engine/sca'

const run = (rules: string, word: string, opts: ParseOptions = {}): string =>
  runRules(parseRuleText(rules, opts), word).output

const V = 'V=aeiou\nC=ptkbdgmnlrsh'
/** 起首只许单个辅音：ad.ma、ak.ka */
const SINGLE: ParseOptions = {
  syllables: {
    units: [],
    nuclei: [],
    consonants: [],
    onsets: [...'ptkbdgmnlrsh'],
    maxOnset: null,
    maxCoda: null
  }
}

describe('σ 音节边界', () => {
  it('_σ 是音节末（词末也算），σ_ 是音节首（词首也算）', () => {
    expect(run(`${V}\nd > t / _σ`, 'adma', SINGLE)).toBe('atma')
    expect(run(`${V}\nd > t / _σ`, 'adad')).toBe('adat')
    expect(run(`${V}\nd > t / _σ`, 'ada')).toBe('ada')
    expect(run(`${V}\nk > g / σ_`, 'kaka')).toBe('gaga')
    expect(run(`${V}\nk > g / σ_`, 'akka', SINGLE)).toBe('akga')
    // 不限起首时按最大起首：a.dma
    expect(run(`${V}\nd > t / _σ`, 'adma')).toBe('adma')
  })
  it('没有 σ 的地方照常跨过音节边界匹配', () => {
    expect(run(`${V}\nd > t / _σ\ntm > tn`, 'adma', SINGLE)).toBe('atna')
    expect(run(`${V}\na > e / _mσm`, 'amma', SINGLE)).toBe('emma')
  })
  it('多合字母是一个音，分隔符两边算音节边界', () => {
    expect(run(`${V}\nth|θ\nθ > s / σ_`, 'atha')).toBe('asa')
    expect(run(`${V}\na > e / _σ`, 'ka·ta')).toBe('ke·te')
  })
  it('按语言的起首表划音节', () => {
    const opts: ParseOptions = {
      syllables: {
        units: [],
        nuclei: ['a', 'e'],
        consonants: [],
        onsets: ['t', 'r', 'tr', 's'],
        maxOnset: null,
        maxCoda: null
      }
    }
    // astra：as.tra（st 不在起首表里）
    expect(run('s > h / _σ', 'astra', opts)).toBe('ahtra')
  })
  it('\\σ 是字母 σ 本身', () => {
    expect(run('\\σ > s', 'aσa')).toBe('asa')
    expect(escapeRuleText('σ')).toBe('\\σ')
  })
})

describe('重音规则', () => {
  it('位置：第几个、倒数第几个，单音节词落到自己身上', () => {
    expect(run(`${V}\nˈ = -2`, 'katalina')).toBe('kataˈlina')
    expect(run(`${V}\nˈ = 1`, 'katalina')).toBe('ˈkatalina')
    expect(run(`${V}\nˈ = -3`, 'ka')).toBe('ˈka')
    expect(run(`${V}\n' = -1`, 'kata')).toBe('kaˈta')
  })
  it('条件：音节核、环境、音节数，按顺序第一条对上的算', () => {
    const rules = `${V}\n{长}=aa ee\nˈ = * [áé] , (2) -1 {长} , (2) 1 , -2 / _CC , -3`
    expect(run(rules, 'kataa')).toBe('kaˈtaa')
    expect(run(rules, 'kata')).toBe('ˈkata')
    expect(run(rules, 'katalla', SINGLE)).toBe('kaˈtalla')
    expect(run(rules, 'katalana')).toBe('kaˈtalana')
    expect(run(rules, 'kátalana')).toBe('ˈkátalana')
  })
  it('分段：各段各算，主重音在指定的段，其余是次重音', () => {
    expect(run(`${V}\nˈ = 1 | · -1`, 'kata·lina')).toBe('ˌkata·ˈlina')
    expect(run(`${V}\nˈ = 1 | · 1`, 'kata·lina')).toBe('ˈkata·ˌlina')
    expect(run(`${V}\nˈ = 1`, 'kata·lina')).toBe('ˈkata·lina')
  })
  it('次重音规则不动主重音', () => {
    expect(run(`${V}\nˈ = -2\nˌ = (4+) 1`, 'katalina')).toBe('ˌkataˈlina')
    expect(run(`${V}\nˈ = 1\nˌ = 1`, 'katalina')).toBe('ˈkatalina')
  })
  it('重音记号跟着词走到后面的规则，规则照常跨过记号匹配', () => {
    expect(run(`${V}\nˈ = -2\nat > et\nt > d / V_V`, 'kata')).toBe('ˈkeda')
    expect(run(`${V}\nˈ = -1\nka > ga`, 'kaka')).toBe('gaˈga')
    // 换掉的那段里有重音记号：按原来的位置放回去
    expect(run(`${V}\nˈ = -1\nat > o`, 'kata')).toBe('koˈa')
  })
  it('规则里可以写 ˈ：重读音节里的元音、非重读元音', () => {
    const base = `${V}\nˈ = -2`
    expect(run(`${base}\nV > ə / σ(C)(C)_ - ˈ(C)(C)_`, 'katalina')).toBe('kətəˈlinə')
    expect(run(`${base}\na > aa / ˈ(C)(C)_`, 'kata')).toBe('ˈkaata')
    expect(run(`${base}\nˈ > `, 'kata')).toBe('kata')
  })
  it('增生不会因为隔着记号插两次', () => {
    expect(run(`${V}\nˈ = -1\n> ə / a_t`, 'ata')).toBe('aəˈta')
  })
  it('空的重音规则把重音去掉；测试台的阶段里带着重音', () => {
    expect(run(`${V}\nˈ = 1\nˈ =`, 'kata')).toBe('kata')
    const r = runRules(parseRuleText(`${V}\n-* A\nˈ = -1\n-* B\nt > d`), 'kata')
    expect(r.stages.map((s) => s.form)).toEqual(['kata', 'kaˈta'])
    expect(r.output).toBe('kaˈda')
    expect(r.trace[0]).toMatchObject({ kind: 'stress', target: 'ˈ', after: 'kaˈta' })
  })
  it('写错的重音规则报错', () => {
    const p = parseRuleText('ˈ = abc')
    expect(p.diagnostics[0].severity).toBe('error')
  })
  it('写法拆开再拼回去不变', () => {
    const text = '* [áé] , (2) -1 {长} , (3+) -2 V / _CC - #_ , -3 | · -1'
    const d = parseStressText(text)
    expect(d.errors).toEqual([])
    expect(d.clauses).toHaveLength(4)
    expect(d.clauses[2]).toMatchObject({
      count: 3,
      orMore: true,
      position: '-2',
      target: 'V',
      right: 'CC',
      exceptLeft: '#'
    })
    expect(formatStressText(d)).toBe(text)
  })
})

describe('特征', () => {
  const feat = '[+送气] = ph th kh\n[-送气] = p t k'
  it('环境里引用特征', () => {
    expect(run(`${feat}\na > e / [+送气]_#`, 'pha')).toBe('phe')
    expect(run(`${feat}\na > e / [+送气]_#`, 'pa')).toBe('pa')
  })
  it('只定义了一面时，另一面是「其余的音」', () => {
    expect(run('[+送气] = ph th kh\na > e / [-送气]_#', 'pha')).toBe('pha')
    expect(run('[+送气] = ph th kh\na > e / [-送气]_#', 'ma')).toBe('me')
  })
  it('目标、替换里按位置对应', () => {
    expect(run(`${feat}\n[+送气] > [-送气] / _a`, 'phathi')).toBe('pathi')
  })
  it('几个特征取交集', () => {
    const rules = '[+送气] = ph th kh bh\n[+浊] = b d g bh\na > e / [+送气 -浊]_'
    expect(run(rules, 'bha')).toBe('bha')
    expect(run(rules, 'pha')).toBe('phe')
  })
  it('从定义这一行起有效，后面可以重新定义', () => {
    const rules = '[+送气] = ph\na > e / [+送气]_\n[+送气] = th\no > u / [+送气]_'
    expect(run(rules, 'pha')).toBe('phe')
    expect(run(rules, 'tho')).toBe('thu')
    expect(run(rules, 'pho')).toBe('pho')
    const early = parseRuleText('a > e / [+送气]_\n[+送气] = ph')
    expect(early.diagnostics.some((d) => d.message.includes('[+送气]'))).toBe(true)
  })
  it('环境里的 [-送气]、[a-z] 不会被当成排除', () => {
    expect(run('[+送气] = ph\na > e / [-送气]_ - #_', 'mama')).toBe('meme')
    expect(run('o > u / [a-z]_ - #_', 'koo')).toBe('kuu')
  })
  it('特征行拆开、拼回', () => {
    expect(parseFeatureLine('[+送气] = ph th kh  ; 注')).toEqual({
      name: '送气',
      sign: '+',
      members: ['ph', 'th', 'kh']
    })
    expect(formatFeatureLine('-', '浊', ['p', 't'])).toBe('[-浊] = p t')
  })
})

describe('输出时保留音标符号', () => {
  it('keepUnits 里的内部符号不换回写法', () => {
    const p = parseRuleText('c > k', {
      replacements: [
        ['th', 'θ'],
        ['ts', 'ʦ']
      ]
    })
    expect(runRules(p, 'catsath').output).toBe('katsath')
    expect(runRules(p, 'catsath', { keepUnits: ['θ'] }).output).toBe('katsaθ')
  })
  it('规则列表里显示原来的写法（th），不是内部符号（θ）', () => {
    const p = parseRuleText(['th|θ', 'th > s / a_ , #_th - _i', 'th > t?d / _a'].join('\n'), {})
    const [r1, r2] = p.steps.filter((x) => x.kind === 'rule')
    expect(r1.kind === 'rule' && [r1.target, r1.contexts, r1.exceptions]).toEqual([
      'th',
      [
        { left: 'a', right: '' },
        { left: '#', right: 'th' }
      ],
      [{ left: '', right: 'i' }]
    ])
    expect(
      r2.kind === 'rule' && [r2.branches?.then.target, r2.branches?.otherwise.replacement]
    ).toEqual(['th', 'd'])
    expect(runRules(p, 'atha').output).toBe('asa')
  })
})
