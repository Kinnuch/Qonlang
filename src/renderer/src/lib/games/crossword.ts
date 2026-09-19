/**
 * 填字：拿词库里的词排盘，提示用释义。
 * 排法是老一套的贪心——第一个词横着放中间，后面每个词都找一个能跟已放的词交叉的位置，
 * 交叉多、盘面紧凑的位置优先；放不下的词就不放。
 * 同一个种子出同一局（导出给别人玩、再打开时对得上）。
 */
import { splitLetters, sameLetter } from './letters'
import { shuffle, type GameWord } from './words'

export interface Placed {
  /** 题号（按行列顺序编的） */
  num: number
  word: string
  letters: string[]
  gloss: string
  row: number
  col: number
  dir: 'across' | 'down'
}

export interface Crossword {
  /** 盘面大小（已经裁到最小） */
  rows: number
  cols: number
  /** 每一格的字母；空格是 null */
  grid: (string | null)[][]
  placed: Placed[]
}

interface Cand {
  row: number
  col: number
  dir: 'across' | 'down'
  score: number
}

const MAX = 40

function fits(
  grid: (string | null)[][],
  letters: string[],
  row: number,
  col: number,
  dir: 'across' | 'down'
): number | null {
  const n = grid.length
  const m = grid[0].length
  const dr = dir === 'down' ? 1 : 0
  const dc = dir === 'across' ? 1 : 0
  const endR = row + dr * (letters.length - 1)
  const endC = col + dc * (letters.length - 1)
  if (row < 0 || col < 0 || endR >= n || endC >= m) return null
  // 词的两头必须是空的（不能跟别的词接成一长串）
  const beforeR = row - dr
  const beforeC = col - dc
  const afterR = endR + dr
  const afterC = endC + dc
  if (beforeR >= 0 && beforeC >= 0 && grid[beforeR][beforeC]) return null
  if (afterR < n && afterC < m && grid[afterR][afterC]) return null
  let cross = 0
  for (let i = 0; i < letters.length; i++) {
    const r = row + dr * i
    const c = col + dc * i
    const cur = grid[r][c]
    if (cur) {
      if (!sameLetter(cur, letters[i])) return null
      cross++
      continue
    }
    // 空格：旁边（垂直方向）不能贴着别的词，不然会读出两字母的假词
    const sideA = dir === 'across' ? [r - 1, c] : [r, c - 1]
    const sideB = dir === 'across' ? [r + 1, c] : [r, c + 1]
    for (const [sr, sc] of [sideA, sideB])
      if (sr >= 0 && sc >= 0 && sr < n && sc < m && grid[sr][sc]) return null
  }
  return cross
}

function put(
  grid: (string | null)[][],
  letters: string[],
  row: number,
  col: number,
  dir: 'across' | 'down'
): void {
  letters.forEach((l, i) => {
    grid[row + (dir === 'down' ? i : 0)][col + (dir === 'across' ? i : 0)] = l
  })
}

export function buildCrossword(
  words: readonly GameWord[],
  units: readonly string[],
  opts: { size?: number; count?: number; rand: () => number }
): Crossword {
  const size = Math.min(MAX, Math.max(7, opts.size ?? 13))
  const want = Math.max(3, opts.count ?? 10)
  const pool = shuffle(
    words.filter((w) => {
      const n = splitLetters(w.word, units).length
      return n >= 3 && n <= size
    }),
    opts.rand
  )
  const grid: (string | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null)
  )
  const placed: Omit<Placed, 'num'>[] = []
  for (const w of pool) {
    if (placed.length >= want) break
    const letters = splitLetters(w.word, units)
    if (placed.some((p) => p.word.toLocaleLowerCase() === w.word.toLocaleLowerCase())) continue
    if (!placed.length) {
      const row = Math.floor(size / 2)
      const col = Math.max(0, Math.floor((size - letters.length) / 2))
      if (fits(grid, letters, row, col, 'across') === null) continue
      put(grid, letters, row, col, 'across')
      placed.push({ word: w.word, letters, gloss: w.gloss, row, col, dir: 'across' })
      continue
    }
    // 跟已经放好的词交叉：同一个字母的地方试着放
    const cands: Cand[] = []
    for (const p of placed) {
      for (let i = 0; i < p.letters.length; i++) {
        for (let j = 0; j < letters.length; j++) {
          if (!sameLetter(p.letters[i], letters[j])) continue
          const dir = p.dir === 'across' ? 'down' : 'across'
          const row = p.dir === 'across' ? p.row - j : p.row + i
          const col = p.dir === 'across' ? p.col + i : p.col - j
          const cross = fits(grid, letters, row, col, dir)
          if (cross === null || cross === 0) continue
          // 交叉多、离盘面中间近的先用
          const mid = size / 2
          const dist = Math.abs(row - mid) + Math.abs(col - mid)
          cands.push({ row, col, dir, score: cross * 10 - dist })
        }
      }
    }
    if (!cands.length) continue
    cands.sort((a, b) => b.score - a.score)
    const best = cands[0]
    put(grid, letters, best.row, best.col, best.dir)
    placed.push({
      word: w.word,
      letters,
      gloss: w.gloss,
      row: best.row,
      col: best.col,
      dir: best.dir
    })
  }
  return trim(grid, placed)
}

/** 裁掉四周的空行空列，再按行列顺序编号 */
function trim(grid: (string | null)[][], placed: Omit<Placed, 'num'>[]): Crossword {
  let top = grid.length
  let left = grid[0].length
  let bottom = -1
  let right = -1
  grid.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell) return
      top = Math.min(top, r)
      left = Math.min(left, c)
      bottom = Math.max(bottom, r)
      right = Math.max(right, c)
    })
  )
  if (bottom < 0) return { rows: 0, cols: 0, grid: [], placed: [] }
  const out = grid.slice(top, bottom + 1).map((row) => row.slice(left, right + 1))
  const moved = placed.map((p) => ({ ...p, row: p.row - top, col: p.col - left }))
  // 编号：从上到下、从左到右，每个词的起点一个号（同一格起两个词共用一个号）
  const sorted = [...moved].sort((a, b) => a.row - b.row || a.col - b.col)
  const nums = new Map<string, number>()
  let n = 0
  const numbered: Placed[] = []
  for (const p of sorted) {
    const key = `${p.row},${p.col}`
    if (!nums.has(key)) nums.set(key, ++n)
    numbered.push({ ...p, num: nums.get(key)! })
  }
  return { rows: out.length, cols: out[0].length, grid: out, placed: numbered }
}

/** 填进去的答案对不对：每一格都跟答案一样（忽略大小写、空格算没填） */
export function checkCrossword(cw: Crossword, filled: (string | null)[][]): boolean {
  for (let r = 0; r < cw.rows; r++)
    for (let c = 0; c < cw.cols; c++) {
      const want = cw.grid[r][c]
      if (!want) continue
      const got = filled[r]?.[c]
      if (!got || !sameLetter(got, want)) return false
    }
  return true
}
