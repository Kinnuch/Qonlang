/**
 * 规则语法文档里「音节边界」「重音规则」「特征」「常见写法」各节的例子：文档怎么写，引擎就得这么跑。
 */
import { describe, it, expect } from 'vitest'
import { parseRuleText, runRules, type ParseOptions } from '$lib/engine/sca'

const V = 'V=aeiou\nC=ptkbdgmnlrsjh'
const run = (rules: string, word: string, opts: ParseOptions = {}): string => {
  const p = parseRuleText(`${V}\n${rules}`, opts)
  expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return runRules(p, word).output
}
/** 起首只许单个辅音 */
const SINGLE: ParseOptions = {
  syllables: {
    units: [],
    nuclei: [],
    consonants: [],
    onsets: [...'ptkbdgmnlrsjh'],
    maxOnset: null,
    maxCoda: null
  }
}

describe('文档：音节边界', () => {
  it('表里的例子', () => {
    expect(run('d > t / _σ', 'adma', SINGLE)).toBe('atma')
    expect(run('d > t / _σ', 'ad')).toBe('at')
    expect(run('k > g / σ_', 'kaka')).toBe('gaga')
    expect(run('V > Vː / _σ', 'kata')).toBe('kaːtaː')
    expect(run('> ə / Cσ_C', 'akta', SINGLE)).toBe('akəta')
    expect(run('s > h / _σC', 'asta', SINGLE)).toBe('ahta')
    expect(run('h > / σ_', 'haha')).toBe('aa')
    expect(run('a > e / σC_Cσ', 'katkat', SINGLE)).toBe('ketket')
  })
})

describe('文档：重音规则', () => {
  it('想要的重音', () => {
    expect(run('ˈ = 1', 'katala')).toBe('ˈkatala')
    expect(run('ˈ = -2', 'katala')).toBe('kaˈtala')
    const latin = '{长元音}=aː eː iː\nˈ = -2 {长元音} , -2 / _CC , -3'
    expect(run(latin, 'kataːla')).toBe('kaˈtaːla')
    expect(run(latin, 'katalla', SINGLE)).toBe('kaˈtalla')
    expect(run(latin, 'katala')).toBe('ˈkatala')
    expect(run('{长元音}=aː eː\nˈ = * {长元音} , 1', 'katalaːmeː')).toBe('kataˈlaːmeː')
    expect(run('ˈ = -* / _Cσ , -1', 'kantala', SINGLE)).toBe('ˈkantala')
    expect(run('ˈ = -* / _Cσ , -1', 'katala', SINGLE)).toBe('kataˈla')
    const marked = '{双元音}=ai au\nˈ = * [áéíóú] , (2) -1 {双元音} , (2) 1 , -3'
    expect(run(marked, 'katái')).toBe('kaˈtái')
    expect(run(marked, 'kasai')).toBe('kaˈsai')
    expect(run(marked, 'kasa')).toBe('ˈkasa')
    expect(run('ˈ = -2 , -1 | · -1', 'katala·mena')).toBe('ˌkaˈtala·ˈmena'.replace('ˌkaˈ', 'kaˌ'))
    expect(run('ˈ = -2\nˌ = (4+) 1', 'kataləna')).toBe('ˌkataˈləna')
  })
  it('规则里用重音', () => {
    expect(run('ˈ = -2\na > aː / ˈ(C)(C)_', 'katala')).toBe('kaˈtaːla')
    expect(run('ˈ = -2\nV > ə / σ(C)(C)_ - ˈ(C)(C)_', 'katala')).toBe('kəˈtalə')
    expect(run('ˈ = -2\nˈ > ', 'katala')).toBe('katala')
  })
})

describe('文档：特征', () => {
  it('表里的例子', () => {
    const def = '[+送气] = ph th kh\n[-送气] = p t k'
    expect(run(`${def}\na > e / [+送气]_#`, 'pha')).toBe('phe')
    expect(run(`${def}\n[+送气] > [-送气] / _C`, 'aphta')).toBe('apta')
    expect(run('[+浊] = b d g m n\n[+鼻] = m n\ni > / [+浊 -鼻]_#', 'abi')).toBe('ab')
    expect(run('[+浊] = b d g m n\n[+鼻] = m n\ni > / [+浊 -鼻]_#', 'ami')).toBe('ami')
  })
})

describe('文档：常见写法', () => {
  it('新加的几行', () => {
    expect(run('C > / _#', 'katak')).toBe('kata')
    expect(run('[bdg] > [ptk] / _σ', 'abda', SINGLE)).toBe('apda')
    expect(run('C1C2 > C2C2 / V_V', 'akta')).toBe('atta')
    expect(run('n > m / _[pbm]', 'anpa')).toBe('ampa')
    expect(run('{软腭}=k g\n{龈腭}=tʃ dʒ\n{软腭} > {龈腭} / _[ie]', 'kige')).toBe('tʃidʒe')
    expect(run('> j / i_V', 'ia')).toBe('ija')
    expect(run('sk > \\ / _#', 'task')).toBe('taks')
    expect(run('p > b?f / V_V', 'papa')).toBe('faba')
  })
})
