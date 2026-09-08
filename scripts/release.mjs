// 一键发布：检查工作区干净 → 用 package.json 的版本打 tag → 推 tag，GitHub Actions 随后在 Windows 与 macOS 打包并建 Release。
// 用法：npm run release            （tag = v<package.json 版本>）
//       npm run release -- 0.4.0   （先把版本改成 0.4.0 并提交，再打 tag）
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const sh = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim()
const run = (cmd) => execSync(cmd, { stdio: 'inherit' })

const wanted = process.argv[2]
const pkgPath = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

if (sh('git status --porcelain')) {
  console.error('工作区有未提交的改动，先提交再发布。')
  process.exit(1)
}
if (wanted && wanted !== pkg.version) {
  pkg.version = wanted
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  run('git add package.json')
  run(`git commit -m "Release ${wanted}"`)
}
const tag = `v${pkg.version}`
if (sh('git tag --list ' + tag)) {
  console.error(`tag ${tag} 已存在。改 package.json 的版本号或传新版本：npm run release -- 0.x.y`)
  process.exit(1)
}
run(`git tag -a ${tag} -m "Qonlang ${pkg.version}"`)
run('git push origin main')
run(`git push origin ${tag}`)
console.log(
  `已推送 ${tag}。到 https://github.com/Kinnuch/Qonlang/actions 看进度，完成后 Release 页会有 Windows 与 macOS 安装包。`
)
