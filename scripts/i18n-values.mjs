/**
 * i18n 文件的字符串值：定位、导出、替换。
 *   node scripts/i18n-values.mjs dump  <文件.ts> <出.json>        把每条文案导成 键 → 文字
 *   node scripts/i18n-values.mjs apply <文件.ts> <改动.json...>    把 键 → 文字 写回去（只换字面量，结构与注释不动）
 *   node scripts/i18n-values.mjs derive <源.ts> <值.json> <出.ts>  按源文件的结构生成另一种语言的文件
 * 三种都只动字符串字面量，键名、嵌套结构、注释原样保留——保证各语言文件结构一一对应（有自检测试）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , mode, tsPath, ...rest] = process.argv
let src = readFileSync(tsPath, 'utf8')
/**
 * 写成源码里的字面量。带撇号的用双引号包（prettier 就是这么排的，免得每次生成完还要再格式化一遍）。
 */
const quote = (s) => {
  const body = s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n')
  return s.includes("'") && !s.includes('"')
    ? '"' + body + '"'
    : "'" + body.replace(/'/g, "\\'") + "'"
}

/** 逐字符扫一遍，记下每个叶子键的值在源码里的位置 */
function index(code) {
  const out = new Map()
  const stack = []
  let i = 0
  const skipWs = () => {
    for (;;) {
      if (i >= code.length) return
      if (/\s/.test(code[i])) i++
      else if (code.startsWith('//', i)) {
        const nl = code.indexOf('\n', i)
        i = nl < 0 ? code.length : nl + 1
      } else if (code.startsWith('/*', i)) i = code.indexOf('*/', i) + 2
      else return
    }
  }
  const readString = () => {
    const q = code[i]
    const start = i
    i++
    while (i < code.length) {
      if (code[i] === '\\') i += 2
      else if (code[i] === q) break
      else i++
    }
    i++
    return { start, end: i }
  }
  while (i < code.length) {
    skipWs()
    if (i >= code.length) break
    const c = code[i]
    if (c === '}') {
      stack.pop()
      i++
      continue
    }
    if (c === '{' || c === ',') {
      i++
      continue
    }
    const m = /^([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:/.exec(code.slice(i, i + 200))
    if (!m) {
      i++
      continue
    }
    const key = m[1].replace(/^['"]|['"]$/g, '')
    i += m[0].length
    skipWs()
    if (code[i] === '{') {
      stack.push(key)
      i++
      continue
    }
    if (code[i] === "'" || code[i] === '"') {
      out.set([...stack, key].join('.'), readString())
      continue
    }
    if (code[i] === '[') {
      // 数组：逐项记成 key.0 / key.1
      i++
      let n = 0
      for (;;) {
        skipWs()
        if (i >= code.length || code[i] === ']') {
          i++
          break
        }
        if (code[i] === ',') {
          i++
          continue
        }
        if (code[i] === "'" || code[i] === '"') {
          out.set([...stack, key, String(n++)].join('.'), readString())
          continue
        }
        i++
      }
      continue
    }
    i++
  }
  return out
}

const pos = index(src)
/** 把源码里的字面量还原成真正的文字（去掉转义） */
const raw = (at) =>
  src
    .slice(at.start + 1, at.end - 1)
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')

if (mode === 'dump') {
  const out = {}
  for (const [k, at] of pos) out[k] = raw(at)
  writeFileSync(rest[0], JSON.stringify(out, null, 1) + '\n')
  console.log('导出', Object.keys(out).length, '条 →', rest[0])
} else if (mode === 'apply' || mode === 'derive') {
  const values = Object.assign(
    {},
    ...(mode === 'apply' ? rest : [rest[0]]).map((f) => JSON.parse(readFileSync(f, 'utf8')))
  )
  const missing = []
  const hits = []
  for (const [k, at] of pos) {
    const v = values[k]
    if (v === undefined) {
      // derive：这一条没给译文就留着源语言的，界面上仍然看得懂
      if (mode === 'derive') missing.push(k)
      continue
    }
    hits.push({ k, ...at, v })
  }
  if (mode === 'apply') for (const k of Object.keys(values)) if (!pos.has(k)) missing.push(k)
  hits.sort((a, b) => b.start - a.start)
  for (const h of hits) src = src.slice(0, h.start) + quote(h.v) + src.slice(h.end)
  const dest = mode === 'derive' ? rest[1] : tsPath
  writeFileSync(dest, src)
  console.log('换了', hits.length, '条；没对上', missing.length, missing.slice(0, 12).join(' '))
} else {
  console.error('用法见文件头')
  process.exit(1)
}
