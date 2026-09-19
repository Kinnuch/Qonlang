/** 小游戏的取词、拆字母、猜词判定、拼词与填字排盘 */
import { describe, it, expect } from 'vitest'
import { createProject, createLanguage, createLexeme } from '$lib/core/factory'
import { gameWords, makeRandom, firstVariant, shortMeaning } from '$lib/games/words'
import { alphabetUnits, splitLetters } from '$lib/games/letters'
import { judgeGuess, keyboardMarks, isWin } from '$lib/games/wordle'
import { makeSageRound, submitSage, sageDone } from '$lib/games/sage'
import { buildCrossword, checkCrossword } from '$lib/games/crossword'
import { crosswordHtml, numberMap } from '$lib/games/crosswordExport'

function setup() {
  const p = createProject({ name: '游戏', template: 'blank', appVersion: '0', uiLocale: 'zh' })
  const L = createLanguage({ name: '测试语' })
  L.alphabet = ['a', 'e', 'i', 'k', 'l', 'm', 'n', 'o', 's', 't', 'th', 'u']
  p.languages.push(L)
  const add = (lemma: string, def: string, tags: string[] = []): void => {
    const x = createLexeme(L.id, lemma)
    x.senses[0].definition = { zh: def }
    x.tags = tags
    p.lexemes.push(x)
  }
  add('kaso', '石头，岩石')
  add('thalin', '高的')
  add('miluk', '水')
  add('ten', '看')
  add('sale/sala', '走')
  add('ilo kan', '两个词', ['短语'])
  add('无释义的', '')
  p.lexemes[p.lexemes.length - 1].senses[0].definition = {}
  return { p, L }
}

describe('取词', () => {
  it('挑有写法有释义的词；异写取第一个、释义取第一小段', () => {
    const { p, L } = setup()
    const ws = gameWords(p, L.id)
    expect(ws.map((w) => w.word)).toEqual(['kaso', 'thalin', 'miluk', 'ten', 'sale', 'ilo kan'])
    expect(ws[0].gloss).toBe('石头')
    expect(firstVariant('a/b')).toBe('a')
    expect(shortMeaning('走，行走')).toBe('走')
  })

  it('只要单个词、按字母数筛', () => {
    const { p, L } = setup()
    const units = alphabetUnits(L)
    const ws = gameWords(p, L.id, { singleWord: true, minLen: 4, maxLen: 5 }, (w) =>
      splitLetters(w, units)
    )
    // thalin 是 th-a-l-i-n 五个字母；miluk 五个；kaso、sale 四个；ten 三个（太短）
    // 「ilo kan」带空格，singleWord 筛掉
    expect(ws.map((w) => w.word).sort()).toEqual(['kaso', 'miluk', 'sale', 'thalin'])
  })
})

describe('拆字母', () => {
  it('多字母的字母算一个（th）', () => {
    const { L } = setup()
    const units = alphabetUnits(L)
    expect(splitLetters('thalin', units)).toEqual(['th', 'a', 'l', 'i', 'n'])
    expect(splitLetters('kaso', units)).toEqual(['k', 'a', 's', 'o'])
  })
  it('字母表里没有的字符按一个码点算', () => {
    expect(splitLetters('kâm', ['k', 'm'])).toEqual(['k', 'â', 'm'])
  })
})

describe('猜词', () => {
  it('位置对记 hit、词里有记 near、其余 miss', () => {
    expect(judgeGuess(['k', 'a', 's', 'o'], ['k', 'o', 's', 'a'])).toEqual([
      'hit',
      'near',
      'hit',
      'near'
    ])
  })
  it('重复字母按剩下的个数算', () => {
    expect(judgeGuess(['a', 'b', 'a'], ['a', 'a', 'a'])).toEqual(['hit', 'miss', 'hit'])
  })
  it('全对就是赢；键盘上取最好的那次', () => {
    expect(isWin(['hit', 'hit'])).toBe(true)
    const kb = keyboardMarks([
      { letters: ['k', 'a'], marks: ['miss', 'near'] },
      { letters: ['a', 'k'], marks: ['hit', 'miss'] }
    ])
    expect(kb.get('a')).toBe('hit')
    expect(kb.get('k')).toBe('miss')
  })
})

describe('Sage 拼词', () => {
  it('字母池正好是那几个词的字母；拼对一个就划掉', () => {
    const { p, L } = setup()
    const units = alphabetUnits(L)
    const ws = gameWords(p, L.id, { singleWord: true }, (w) => splitLetters(w, units))
    const round = makeSageRound(ws, units, 3, makeRandom(7))
    expect(round.answers.length).toBe(3)
    const total = round.answers.reduce((n, a) => n + a.letters.length, 0)
    expect(round.pool.length).toBe(total)
    // 按第一条答案的字母，从池子里挑对应的下标
    const target = round.answers[0]
    const used = new Set<number>()
    const chosen = target.letters.map((l) => {
      const i = round.pool.findIndex((x, idx) => !used.has(idx) && x.letter === l)
      used.add(i)
      return i
    })
    expect(submitSage(round, chosen)).toBe(0)
    expect(round.answers[0].done).toBe(true)
    expect(round.pool.filter((x) => x.usedBy === 0).length).toBe(target.letters.length)
    expect(sageDone(round)).toBe(false)
  })
  it('拼错了不算', () => {
    const { p, L } = setup()
    const units = alphabetUnits(L)
    const ws = gameWords(p, L.id, { singleWord: true }, (w) => splitLetters(w, units))
    const round = makeSageRound(ws, units, 2, makeRandom(3))
    expect(submitSage(round, [0])).toBe(-1)
  })
})

describe('填字排盘', () => {
  it('放下的词都在盘面上、互相交叉，答案能对', () => {
    const { p, L } = setup()
    const units = alphabetUnits(L)
    const ws = gameWords(p, L.id, { singleWord: true, minLen: 3 }, (w) => splitLetters(w, units))
    const cw = buildCrossword(ws, units, { size: 11, count: 5, rand: makeRandom(11) })
    expect(cw.placed.length).toBeGreaterThanOrEqual(2)
    for (const pl of cw.placed) {
      pl.letters.forEach((l, i) => {
        const r = pl.row + (pl.dir === 'down' ? i : 0)
        const c = pl.col + (pl.dir === 'across' ? i : 0)
        expect(cw.grid[r][c]).toBe(l)
      })
    }
    expect(checkCrossword(cw, cw.grid)).toBe(true)
    const wrong = cw.grid.map((row) => [...row])
    const first = cw.placed[0]
    wrong[first.row][first.col] = 'x'
    expect(checkCrossword(cw, wrong)).toBe(false)
  })

  it('同一个种子出同一局', () => {
    const { p, L } = setup()
    const units = alphabetUnits(L)
    const ws = gameWords(p, L.id, { singleWord: true, minLen: 3 }, (w) => splitLetters(w, units))
    const a = buildCrossword(ws, units, { size: 11, count: 5, rand: makeRandom(42) })
    const b = buildCrossword(ws, units, { size: 11, count: 5, rand: makeRandom(42) })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('填字导出成单文件网页', () => {
  it('答案、提示、题号都在里面，别人打开就能玩', () => {
    const { p, L } = setup()
    const units = alphabetUnits(L)
    const ws = gameWords(p, L.id, { singleWord: true, minLen: 3 }, (w) => splitLetters(w, units))
    const cw = buildCrossword(ws, units, { size: 11, count: 5, rand: makeRandom(5) })
    const html = crosswordHtml(cw, { title: '测试填字', language: '测试语', project: '游戏' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    // 答案表：每个放下的词都能在里面找到
    const answer = JSON.stringify(cw.grid.map((row) => row.map((c) => c ?? '')))
    expect(html).toContain(answer)
    for (const pl of cw.placed) expect(html).toContain(pl.gloss)
    // 每个起点格都有题号
    expect(numberMap(cw).size).toBeGreaterThan(0)
    for (const [, n] of numberMap(cw)) expect(html).toContain(`<span class="n">${n}</span>`)
    // 提示里的尖括号要转义掉
    const nasty = crosswordHtml(cw, { title: '<b>x</b>', language: 'a', project: 'b' })
    expect(nasty).not.toContain('<b>x</b>')
  })
})
