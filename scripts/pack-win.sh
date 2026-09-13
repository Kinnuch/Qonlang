#!/usr/bin/env bash
# 手动打 Windows 免安装版（绕过 electron-builder 在某些机器上的目录改名 EPERM）。
# 产物：dist/win-unpacked/Qonlang.exe
# 前提：已 npm install；electron 二进制已在 node_modules/electron/dist。
set -euo pipefail
cd "$(dirname "$0")/.."
npx electron-vite build
# 输出目录可用环境变量覆盖：OUT=dist/other bash scripts/pack-win.sh
# PRODUCT_NAME 换掉包里的产品名（决定用户数据目录；验收增量更新时用另一个名字，免得碰到正在用的千语集）
OUT="${OUT:-dist/win-unpacked}"
rm -rf "$OUT" dist/app-stage
mkdir -p "$OUT" dist/app-stage/node_modules dist/app-stage/resources
cp -r node_modules/electron/dist/. "$OUT/"
cp -r out dist/app-stage/out
cp -r resources/. dist/app-stage/resources/
# 主进程运行时 require 的依赖（electron-vite 把 dependencies 留在包外），连同它们各自的依赖一起拷
node -e '
const fs = require("fs"), path = require("path")
const seen = new Set()
const walk = (n) => {
  if (seen.has(n)) return
  seen.add(n)
  const pj = require(path.resolve("node_modules", n, "package.json"))
  for (const d of Object.keys(pj.dependencies || {})) walk(d)
}
for (const n of ["@electron-toolkit/utils", "electron-updater"]) walk(n)
for (const n of seen)
  fs.cpSync(path.join("node_modules", n), path.join("dist/app-stage/node_modules", n), { recursive: true })
console.log("runtime deps: " + [...seen].join(" "))'
node -e '
const p = require("./package.json");
require("fs").writeFileSync("dist/app-stage/package.json", JSON.stringify({
  name: p.name, productName: process.env.PRODUCT_NAME || "Qonlang", version: p.version, description: p.description,
  main: p.main, author: "Kinnuch", license: "MIT", private: true }, null, 2));'
npx --yes @electron/asar pack dist/app-stage "$OUT/resources/app.asar"
rm -f "$OUT/resources/default_app.asar"
# 增量更新读这个文件（electron-builder 自己打包时会生成同样一份；--prepackaged 不会，所以这里写）
cat > "$OUT/resources/app-update.yml" <<'YML'
owner: Kinnuch
repo: Qonlang
provider: github
releaseType: release
updaterCacheDirName: qonlang-updater
YML
mv -f "$OUT/electron.exe" "$OUT/Qonlang.exe"
# 给 exe 写入图标与版本信息（rcedit 随 electron-winstaller 附带）
RCEDIT=node_modules/electron-winstaller/vendor/rcedit.exe
if [ -f "$RCEDIT" ]; then
  VER=$(node -p 'require("./package.json").version')
  "$RCEDIT" "$OUT/Qonlang.exe" --set-icon build/icon.ico --set-version-string ProductName Qonlang --set-version-string FileDescription "Qonlang 千语集" --set-version-string CompanyName Kinnuch --set-version-string LegalCopyright "MIT" --set-file-version "$VER" --set-product-version "$VER" || echo "rcedit failed (icon not embedded)"
fi
rm -rf dist/app-stage
echo "done: $OUT/Qonlang.exe"
