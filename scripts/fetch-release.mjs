// 把 GitHub Release 上 CI 打好的安装包拉到本地 dist/release/<tag>/。
// Windows 上打不了 macOS 包（electron-builder 只允许在 macOS 上构建 mac 目标），用这个拿 CI 的产物。
// 用法：npm run fetch:release              最新 Release
//       npm run fetch:release -- v0.3.0    指定 tag
//       npm run fetch:release -- v0.3.0 mac   只要 mac 的（或 win）
import { mkdirSync, createWriteStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const REPO = 'Kinnuch/Qonlang'
const [tagArg, only] = process.argv.slice(2)
const api = tagArg
  ? `https://api.github.com/repos/${REPO}/releases/tags/${tagArg}`
  : `https://api.github.com/repos/${REPO}/releases/latest`
const rel = await (await fetch(api, { headers: { 'User-Agent': 'qonlang-fetch' } })).json()
if (!rel.assets) {
  console.error('没找到 Release：', rel.message ?? api)
  process.exit(1)
}
const outDir = join('dist', 'release', rel.tag_name)
mkdirSync(outDir, { recursive: true })
const want = rel.assets.filter((a) =>
  only === 'mac' ? /-mac-/.test(a.name) : only === 'win' ? /setup\.exe$/.test(a.name) : true
)
for (const a of want) {
  const dest = join(outDir, a.name)
  if (existsSync(dest) && statSync(dest).size === a.size) {
    console.log('已存在，跳过', a.name)
    continue
  }
  process.stdout.write(`下载 ${a.name}（${(a.size / 1048576).toFixed(1)} MB）… `)
  const res = await fetch(a.browser_download_url, { headers: { 'User-Agent': 'qonlang-fetch' } })
  if (!res.ok || !res.body) {
    console.log(`失败 HTTP ${res.status}`)
    continue
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  console.log('完成')
}
console.log(`产物在 ${outDir}`)
