// Release 页的说明：从中英两份更新日志里摘出这一版的那一段，按「## 中文」「## English」两段写出来。
// 软件里的更新提示按界面语言只显示其中一段（src/main/update.ts 的 notesForLocale）。
//   node scripts/release-notes.mjs 1.0.0-beta.1 > dist/release-notes.md
import { existsSync, readFileSync } from 'node:fs'

const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!version) {
  console.error('用法：node scripts/release-notes.mjs <版本号>')
  process.exit(1)
}

/** 「## 1.0.0-beta.1 · 2026-10-09」这一行之后、下一个「## 」之前的内容 */
function section(file) {
  const url = new URL(`../${file}`, import.meta.url)
  if (!existsSync(url)) return null
  const text = readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const head = new RegExp(`^##\\s+${esc}(\\s|$)`)
  const start = lines.findIndex((l) => head.test(l))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  if (end < 0) end = lines.length
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
}

const zh = section('CHANGELOG.md')
const en = section('CHANGELOG.en.md')
if (!zh && !en) {
  console.error(`两份更新日志里都找不到 ${version} 这一版`)
  process.exit(1)
}
const parts = []
if (zh) parts.push('## 中文', '', zh, '')
if (en) parts.push('## English', '', en, '')
process.stdout.write(parts.join('\n'))
