/**
 * 诊断脚本：拿一个项目文件跑一遍语料自动 gloss，报告哪些词认不出来。
 * 用法：npm run diag:gloss [项目路径] [语言名前缀]
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject } from '$lib/core/serialize'
import { analyzeToken, buildIndex, tokenize } from '$lib/engine/gloss'
import type { Project } from '$lib/core/model'

const file = process.argv[2] ?? join(__dirname, '..', 'examples', 'private', 'Theusrin.laim.json')
const langPrefix = process.argv[3] ?? ''
const project: Project = parseProject(readFileSync(file, 'utf8'))
const lang = project.languages.find((l) => l.name.startsWith(langPrefix)) ?? project.languages[0]
if (!lang) throw new Error('no language')
const idx = buildIndex(project, lang.id)
const boundaries = project.settings.morphemeBoundaries

let total = 0
let resolvedLexeme = 0
let resolvedMorph = 0
const misses = new Map<string, number>()
for (const s of project.sentences) {
  if (s.languageId !== lang.id) continue
  for (const w of tokenize(s.text)) {
    total++
    const cands = analyzeToken(idx, w, boundaries)
    const a = cands[0]
    if (a?.lexemeId) resolvedLexeme++
    else if (a?.morphs.some((m) => m.morphemeId)) resolvedMorph++
    else misses.set(w, (misses.get(w) ?? 0) + 1)
  }
}
const top = [...misses].sort((a, b) => b[1] - a[1]).slice(0, 60)
console.log(
  `语言 ${lang.name}：词形 ${total}，认出词条 ${resolvedLexeme}，只认出语素 ${resolvedMorph}，认不出 ${
    total - resolvedLexeme - resolvedMorph
  }`
)
console.log(
  '索引规模：词头',
  idx.lemma.size,
  '词干',
  idx.stems.size,
  '屈折形',
  idx.forms.size,
  '语素',
  idx.morphemes.size
)
console.log('最常见的认不出来的词：')
for (const [w, n] of top) console.log(' ', w, n)

// 逐词解释：npm run diag:gloss -- <文件> <语言> <词1> <词2> …
for (const w of process.argv.slice(4)) {
  const cands = analyzeToken(idx, w, boundaries)
  console.log(`\n[${w}] 候选 ${cands.length}`)
  for (const c of cands.slice(0, 4))
    console.log(
      '  lexeme=' + (c.lexemeId ? project.lexemes.find((l) => l.id === c.lexemeId)?.lemma : '-'),
      'slot=' + (c.slot ?? '-'),
      'morphs=' + c.morphs.map((m) => `${m.form}/${m.gloss}${m.morphemeId ? '*' : ''}`).join('-')
    )
}
