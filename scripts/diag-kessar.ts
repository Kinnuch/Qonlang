/**
 * 科飒尔文拼写的对照评测：拿语法书里每个词的拼写当标尺，
 * 看按《书写规则》整理出的算法能还原多少。
 * 用法：npm run diag:kessar [项目路径]
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import type { Project } from '$lib/core/model'
import { packWord } from '$lib/script/pack'

const file = process.argv[2] ?? join(__dirname, '..', 'examples', 'private', 'Theusrin.laim.json')
const project: Project = parseProject(readFileSync(file, 'utf8'))
const lang = project.languages.find((l) => l.name === '瑟乌丝林语')
if (!lang) throw new Error('没有瑟乌丝林语')
const script = lang.scripts[0]
if (!script) throw new Error('没有文字')

// ── 读音表：读音 → 优先级（本征音 / 二分音 优先于特征音） ──
const PRIORITY: Record<string, number> = { 本征音: 0, 二分音: 1, 特征音: 2, 符号: 3 }
const readings = new Map<string, number>()
for (const g of script.glyphs) {
  const rank = PRIORITY[g.category] ?? 4
  for (const v of g.value.split('/')) {
    const r = v.trim().toLowerCase()
    if (!r) continue
    const cur = readings.get(r)
    if (cur === undefined || rank < cur) readings.set(r, rank)
  }
}

// 特征音的读音是机械的 V / VC / CV，字形表里凡是这个形状的都算特征音；
// 类别标签不可靠（同一个字符常兼本征音与特征音），所以按形状判断。
// 元音-辅音表没有 h 这一列，辅音-元音表才有
const VC_C = ['m', 'n', 'p', 't', 'c', 'w', 'f', 's', 'th', 'r', 'l']
const CV_C = [...VC_C, 'h']
const FEATURE_V = ['a', 'e', 'i', 'o', 'u']
const featureReadings = new Set<string>(FEATURE_V)
const vcReadings = new Set<string>()
for (const v of FEATURE_V) {
  for (const c of VC_C) {
    featureReadings.add(v + c)
    vcReadings.add(v + c)
  }
  for (const c of CV_C) featureReadings.add(c + v)
}

const NUL = script.packing?.killer ?? '∅'
const spell = (w: string, isHead = false): string[] => packWord(lang, script, w, isHead)

// ── 对照语法书的拼写 ──
const pairs: { word: string; spell: string }[] = []
for (const s of project.sentences) {
  const line = s.extraLines.find((e) => e.label === '科飒尔文拼写')
  if (!line) continue
  const words = s.text.split(/\s+/)
  const spells = line.text.split('  ')
  if (words.length !== spells.length) continue
  for (let i = 0; i < words.length; i++)
    pairs.push({
      word: words[i].replace(/[.,!?；。，！？)）(（]/g, ''),
      spell: spells[i].replace(/[.,!?；。，！？)）(（]/g, '')
    })
}

const flat = (x: string): string => x.replace(/[-·]/g, '').toLowerCase()
let ok = 0
const bad: { word: string; want: string; got: string }[] = []
const missing = new Map<string, number>()
for (const p of pairs) {
  // 词内的中点分段各自拼写
  const parts = p.word.split(/[·-]/)
  const got = parts.map((x, k) => spell(x, k < parts.length - 1).join('-')).join('-')
  if (flat(got) === flat(p.spell)) ok++
  else if (bad.length < 40) bad.push({ word: p.word, want: p.spell, got })
  // 语法书拼出来、但我的读音表里没有的读音
  for (const unit of p.spell.split(/[-·]/))
    if (unit && unit !== NUL && !readings.has(unit.toLowerCase()))
      missing.set(unit, (missing.get(unit) ?? 0) + 1)
}
console.log(
  `对照 ${pairs.length} 个词，完全一致 ${ok}（${Math.round((ok / pairs.length) * 100)}%）`
)
console.log('\n不一致样例：')
for (const b of bad.slice(0, 25))
  console.log(`  ${b.word.padEnd(20)} 书：${b.want}\n${''.padEnd(22)} 我：${b.got}`)
const miss = [...missing].sort((a, b) => b[1] - a[1])
console.log(`\n语法书用到、但字形表里查不到的读音（${miss.length} 个）：`)
console.log(' ', miss.map(([r, n]) => `${r}×${n}`).join('  '))

// 逐词看：npm run diag:kessar -- <文件> <词1> <词2> …
for (const w of process.argv.slice(3)) {
  console.log(`\n[${w}]`)
  console.log('  拼写:', spell(w).join('-'))
}
