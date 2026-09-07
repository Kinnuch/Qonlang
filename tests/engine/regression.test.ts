/**
 * 回归：用瑟乌丝林语 236 条规则跑音变姬自带的 Lexicon.txt，
 * 逐阶段快照必须与音变姬的 Output.txt 完全一致，逐条轨迹与 Debug.txt 一致。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseRuleText, runRules, fromYinbianji } from '$lib/engine/sca'

const dir = join(__dirname, '..', 'fixtures', 'theusrin')
const read = (f: string): string => readFileSync(join(dir, f), 'utf8')

const ruleText = read('Rule.txt')
const program = parseRuleText(fromYinbianji(read('Category.txt'), read('Replace.txt'), ruleText))
const lexicon = read('Lexicon.txt')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#'))

/** Debug.txt 的行号是「规则序号」（跳过空行与注释），这里换算成 Rule.txt 的行号 */
const ruleIndexToLine: number[] = []
ruleText.split(/\r?\n/).forEach((l, i) => {
  const t = l.trim()
  if (t && !t.startsWith('#')) ruleIndexToLine.push(i + 1)
})
// 规则文本前面拼了音类段落，行号要加偏移
const offset = fromYinbianji(read('Category.txt'), read('Replace.txt'), '').split('\n').length - 1

describe('Theusrin regression', () => {
  it('parses without errors', () => {
    expect(program.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(program.markers).toEqual(['PSkr', 'PTsr', 'ATsr', 'OTsr', 'Tsr', 'Orthography'])
  })

  it('stage snapshots match Output.txt', () => {
    const [header, ...rows] = read('Output.txt').trim().split(/\r?\n/)
    expect(header.split(' | ')).toEqual(program.markers)
    expect(rows).toHaveLength(lexicon.length)
    lexicon.forEach((word, i) => {
      const r = runRules(program, word)
      expect(r.stages.map((s) => s.form).join(' → ')).toBe(rows[i])
    })
  })

  it('per-rule trace matches Debug.txt', () => {
    const expected = read('Debug.txt')
      .trim()
      .split(/\r?\n/)
      .map((l) => {
        const m = /^(.*?) → (.*?) \(.*\) at (\d+) line$/.exec(l)!
        return [m[1], m[2], ruleIndexToLine[Number(m[3]) - 1] + offset]
      })
    const actual = lexicon.flatMap((w) => runRules(program, w).trace.map((t) => [t.before, t.after, t.line]))
    expect(actual).toEqual(expected)
  })
})
