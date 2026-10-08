/**
 * 检查更新里不依赖 Electron 的部分：挑安装包、比版本号、macOS 替换应用的脚本。
 * 单独放一个文件，测试里能直接引用。
 */

/** GitHub Release 接口里的一个资产 */
export interface ReleaseAsset {
  name?: string
  browser_download_url?: string
  size?: number
  /** GitHub 给每个资产算的摘要，形如 `sha256:<hex>`；老的 Release 可能没有 */
  digest?: string | null
}

export interface Installer {
  url: string
  name: string
  size: number
  /** 下载完按它校验；接口没给就只能不校验 */
  sha256: string | null
  /** 接口问不到时退一步：Windows 安装包按 latest.yml 里的 sha512（base64）校验 */
  sha512?: string | null
  /** 下好之后能不能自动装好并重开（false：打开安装包让用户自己拖进去） */
  auto: boolean
}

export interface InstallerTarget {
  platform: string
  /** 本机芯片：Apple 芯片上用 Rosetta 跑 x64 版时也给 arm64，更新时顺手换成原生版 */
  arch: 'arm64' | 'x64'
  /** macOS：这份千语集能不能自己把新版本换进去（所在目录可写、不是从 dmg 或下载目录直接运行的） */
  macSelfReplace?: boolean
}

/** `sha256:ABC…` → 小写十六进制；不是这个格式就当没有 */
export function sha256FromDigest(digest: string | null | undefined): string | null {
  const m = /^sha256:([0-9a-f]{64})$/i.exec((digest ?? '').trim())
  return m ? m[1].toLowerCase() : null
}

/**
 * 从 Release 资产里挑本机的安装包。
 * Windows：-setup.exe（静默安装）。
 * macOS：能自己替换时挑 zip（解开就是 .app，换进去重开）；换不了或者没有 zip 时挑 dmg，打开让用户拖。
 * Linux：AppImage，打开所在目录。
 */
export function pickInstaller(assets: ReleaseAsset[], target: InstallerTarget): Installer | null {
  const usable = assets.filter((a) => a.name && a.browser_download_url)
  const find = (test: (lower: string) => boolean): ReleaseAsset | undefined =>
    usable.find((a) => test(a.name!.toLowerCase()))
  const make = (a: ReleaseAsset | undefined, auto: boolean): Installer | null =>
    a
      ? {
          url: a.browser_download_url!,
          name: a.name!,
          size: a.size ?? 0,
          sha256: sha256FromDigest(a.digest),
          auto
        }
      : null
  if (target.platform === 'win32')
    return make(
      find((n) => n.endsWith('-setup.exe')),
      true
    )
  if (target.platform === 'darwin') {
    const zip = find((n) => n.endsWith(`-mac-${target.arch}.zip`))
    if (zip && target.macSelfReplace) return make(zip, true)
    return make(
      find((n) => n.endsWith(`-mac-${target.arch}.dmg`)),
      false
    )
  }
  return make(
    find((n) => n.endsWith('.appimage')),
    false
  )
}

/**
 * 不走 GitHub 接口时用：github.com/…/releases/latest 跳转过去的地址里的版本号
 * （…/releases/tag/v0.9.2 → 0.9.2）。接口的匿名额度每个 IP 每小时只有 60 次，带 ETag 的 304 也照扣，
 * 几个人共用一个出口（代理、校园网）很快就用完；这个跳转不占额度。
 */
export function versionFromReleaseUrl(url: string): string | null {
  const m = /\/releases\/tag\/v?([^/?#]+)/.exec(url)
  if (!m) return null
  const v = decodeURIComponent(m[1]).trim()
  return /^\d+(\.\d+)*([.-][0-9A-Za-z.-]+)?$/.test(v) ? v : null
}

/** latest.yml 里的版本号与安装包（只认用得到的几项：url、sha512、size） */
export function parseLatestYml(text: string): {
  version: string | null
  files: { url: string; sha512: string | null; size: number }[]
} {
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1] ?? null
  const files: { url: string; sha512: string | null; size: number }[] = []
  let cur: { url: string; sha512: string | null; size: number } | null = null
  for (const line of text.split(/\r?\n/)) {
    const url = /^\s*-\s*url:\s*['"]?([^'"]+?)['"]?\s*$/.exec(line)
    if (url) {
      cur = { url: url[1], sha512: null, size: 0 }
      files.push(cur)
      continue
    }
    if (!cur || !/^\s{2,}/.test(line)) {
      if (!/^\s/.test(line)) cur = null
      continue
    }
    const sha = /^\s+sha512:\s*['"]?([^'"\s]+)/.exec(line)
    if (sha) cur.sha512 = sha[1]
    const size = /^\s+size:\s*(\d+)/.exec(line)
    if (size) cur.size = Number(size[1])
  }
  return { version, files }
}

/** 按 Release 的命名规则（electron-builder.yml 的 artifactName），本机该下哪几个文件，能自动装的排前面 */
export function installerCandidates(
  version: string,
  target: InstallerTarget
): { name: string; auto: boolean }[] {
  if (target.platform === 'win32') return [{ name: `Qonlang-${version}-setup.exe`, auto: true }]
  if (target.platform === 'darwin') {
    const dmg = { name: `Qonlang-${version}-mac-${target.arch}.dmg`, auto: false }
    return target.macSelfReplace
      ? [{ name: `Qonlang-${version}-mac-${target.arch}.zip`, auto: true }, dmg]
      : [dmg]
  }
  return [{ name: `Qonlang-${version}.AppImage`, auto: false }]
}

/**
 * 版本号拆成数字段与测试版标记：1.0.0-beta.2 → [1,0,0] + beta.2。
 * 本地打的包（0.8.1-local）不算测试版：跟同号的正式版一样大
 */
function splitVersion(v: string): { core: number[]; pre: string } {
  const [main, ...rest] = v.trim().replace(/^v/, '').split('+')[0].split('-')
  const pre = rest.join('-')
  return {
    core: main.split('.').map((x) => Number(x) || 0),
    pre: /^local\b/i.test(pre) ? '' : pre
  }
}

/** 测试版标记逐段比：数字按大小，字母按字典序；段内字母数字混写（beta10）也按自然顺序（beta9 < beta10） */
function comparePre(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const ca = pa[i].match(/\d+|\D+/g) ?? []
    const cb = pb[i].match(/\d+|\D+/g) ?? []
    for (let j = 0; j < Math.max(ca.length, cb.length); j++) {
      if (ca[j] === undefined) return -1
      if (cb[j] === undefined) return 1
      const na = /^\d+$/.test(ca[j])
      const nb = /^\d+$/.test(cb[j])
      if (na && nb) {
        const d = Number(ca[j]) - Number(cb[j])
        if (d) return d
      } else if (na !== nb) return na ? -1 : 1
      else if (ca[j] !== cb[j]) return ca[j] < cb[j] ? -1 : 1
    }
  }
  return 0
}

/**
 * 「0.6.1」这类版本号比大小。先比数字段；数字段一样时正式版比测试版新（1.0.0 > 1.0.0-beta.2 > 1.0.0-beta.1）。
 * 本地版不比同号正式版新（0.8.1-local 收不到 0.8.1 的提示，下一个正式版照样提示）
 */
export function newerThan(a: string, b: string): boolean {
  const va = splitVersion(a)
  const vb = splitVersion(b)
  for (let i = 0; i < Math.max(va.core.length, vb.core.length); i++) {
    const d = (va.core[i] ?? 0) - (vb.core[i] ?? 0)
    if (d) return d > 0
  }
  if (!va.pre || !vb.pre) return !va.pre && !!vb.pre
  return comparePre(va.pre, vb.pre) > 0
}

/** 测试版（1.0.0-beta.1 这类）：检查更新时连测试版一起看；本地版（-local）不算 */
export function isPrerelease(v: string): boolean {
  return !!splitVersion(v).pre
}

/** Release 的 Atom 订阅里出现的版本号（新的在前；含测试版）。不走接口，不占匿名额度 */
export function versionsFromReleaseFeed(xml: string): string[] {
  const out: string[] = []
  for (const m of xml.matchAll(/\/releases\/tag\/v?([^"'<>\s/?#]+)/g)) {
    const v = decodeURIComponent(m[1])
    if (/^\d+(\.\d+)*([.-][0-9A-Za-z.-]+)?$/.test(v) && !out.includes(v)) out.push(v)
  }
  return out
}

/** 一串版本号里最新的那个 */
export function newestVersion(versions: string[]): string | null {
  let best: string | null = null
  for (const v of versions) if (!best || newerThan(v, best)) best = v
  return best
}

/**
 * Release 说明里挑界面语言那一段：说明按「## 中文」「## English」分两段写（发布脚本从两份更新日志里摘的）；
 * 中文界面（含繁体）取中文段，其余取英文段；没分段的旧说明原样返回
 */
export function notesForLocale(body: string, locale: string): string {
  const zh = /^##\s*中文\s*$/m.exec(body)
  const en = /^##\s*English\s*$/m.exec(body)
  if (!zh || !en) return body.trim()
  const [first, second] = zh.index < en.index ? [zh, en] : [en, zh]
  const part = (m: RegExpExecArray): string =>
    m === first
      ? body.slice(m.index + m[0].length, second.index)
      : body.slice(m.index + m[0].length)
  return part(locale.startsWith('zh') ? zh : en).trim()
}

/** macOS 上正在运行的应用包：…/Qonlang.app/Contents/MacOS/Qonlang → …/Qonlang.app；不是应用包里的就返回 null */
export function macBundlePath(execPath: string): string | null {
  const parts = execPath.split('/')
  if (parts.length < 4) return null
  const [macos, contents] = [parts[parts.length - 2], parts[parts.length - 3]]
  const bundle = parts.slice(0, -3).join('/')
  return macos === 'MacOS' && contents === 'Contents' && bundle.endsWith('.app') ? bundle : null
}

/** 从 dmg 里、或者被系统挪到随机只读目录（App Translocation）里运行的：换不了 */
export function macBundleMovable(bundle: string): boolean {
  return !bundle.startsWith('/Volumes/') && !bundle.includes('/AppTranslocation/')
}

/**
 * macOS 替换应用的脚本（bash）。参数：旧进程 PID、解出来的新 .app、要替换的 .app、日志文件。
 * 等旧进程退出（最多一分钟）→ 旧的挪成同目录下隐藏的 .old → 新的挪进去（失败就把旧的挪回来）→
 * 去掉隔离属性 → 删掉 .old → 打开。每一步写进日志。
 * 没有签名做不了 Squirrel.Mac 那种更新，只能这样自己换；两个都是 .app 才动手，免得路径不对时误删。
 */
export function macReplaceScript(): string {
  return `#!/bin/bash
PID="$1"
NEW_APP="$2"
TARGET="$3"
LOG="$4"
exec >>"$LOG" 2>&1
echo "$(date '+%Y-%m-%d %H:%M:%S') replace $TARGET with $NEW_APP"
case "$TARGET" in *.app) ;; *) echo "target is not an app"; exit 1 ;; esac
case "$NEW_APP" in *.app) ;; *) echo "new app is not an app"; exit 1 ;; esac
if [ ! -d "$TARGET" ] || [ ! -d "$NEW_APP" ]; then echo "app missing"; exit 1; fi
BACKUP="$(dirname "$TARGET")/.$(basename "$TARGET").old"
n=0
while kill -0 "$PID" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -gt 300 ]; then echo "old app still running, give up"; exit 1; fi
  sleep 0.2
done
rm -rf "$BACKUP"
if ! mv "$TARGET" "$BACKUP"; then
  echo "cannot move the old app away"
  open "$TARGET"
  exit 1
fi
if ! mv "$NEW_APP" "$TARGET"; then
  echo "cannot move the new app in, restoring the old one"
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
  open "$TARGET"
  exit 1
fi
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
rm -rf "$BACKUP"
echo "done"
open "$TARGET"
`
}
