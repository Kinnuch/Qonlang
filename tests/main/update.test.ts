import { describe, expect, it } from 'vitest'
import {
  installerCandidates,
  isPrerelease,
  macBundleMovable,
  macBundlePath,
  macReplaceScript,
  newerThan,
  newestVersion,
  notesForLocale,
  parseLatestYml,
  pickInstaller,
  sha256FromDigest,
  versionFromReleaseUrl,
  versionsFromReleaseFeed,
  type ReleaseAsset
} from '../../src/main/update'

const HEX = 'c064d9827405bc09a27173dbaf35024db0e4e9d031893ffb9a52c22288107280'
const asset = (name: string, digest: string | null = `sha256:${HEX}`): ReleaseAsset => ({
  name,
  browser_download_url: `https://example.invalid/${name}`,
  size: 100,
  digest
})
const RELEASE = [
  asset('latest.yml'),
  asset('Qonlang-0.8.3-mac-arm64.dmg'),
  asset('Qonlang-0.8.3-mac-arm64.zip'),
  asset('Qonlang-0.8.3-mac-x64.dmg'),
  asset('Qonlang-0.8.3-mac-x64.zip'),
  asset('Qonlang-0.8.3-setup.exe'),
  asset('Qonlang-0.8.3-setup.exe.blockmap')
]

describe('pickInstaller', () => {
  it('Windows 挑 -setup.exe，不挑 blockmap', () => {
    const x = pickInstaller(RELEASE, { platform: 'win32', arch: 'x64' })
    expect(x?.name).toBe('Qonlang-0.8.3-setup.exe')
    expect(x?.auto).toBe(true)
    expect(x?.sha256).toBe(HEX)
  })
  it('macOS 能自己替换时按芯片挑 zip，自动装', () => {
    const arm = pickInstaller(RELEASE, { platform: 'darwin', arch: 'arm64', macSelfReplace: true })
    expect(arm?.name).toBe('Qonlang-0.8.3-mac-arm64.zip')
    expect(arm?.auto).toBe(true)
    const x64 = pickInstaller(RELEASE, { platform: 'darwin', arch: 'x64', macSelfReplace: true })
    expect(x64?.name).toBe('Qonlang-0.8.3-mac-x64.zip')
  })
  it('macOS 换不了（只读目录、从 dmg 运行）时挑 dmg，让用户自己拖', () => {
    const x = pickInstaller(RELEASE, { platform: 'darwin', arch: 'arm64', macSelfReplace: false })
    expect(x?.name).toBe('Qonlang-0.8.3-mac-arm64.dmg')
    expect(x?.auto).toBe(false)
  })
  it('Release 上还没有 zip（mac 的包没传完）时退回 dmg；都没有就是 null', () => {
    const noZip = RELEASE.filter((a) => !a.name!.endsWith('.zip'))
    expect(
      pickInstaller(noZip, { platform: 'darwin', arch: 'x64', macSelfReplace: true })?.name
    ).toBe('Qonlang-0.8.3-mac-x64.dmg')
    expect(
      pickInstaller([asset('Qonlang-0.8.3-setup.exe')], { platform: 'darwin', arch: 'x64' })
    ).toBeNull()
  })
  it('没有摘要或摘要不是 sha256 时不校验', () => {
    const x = pickInstaller([asset('Qonlang-0.8.3-setup.exe', null)], {
      platform: 'win32',
      arch: 'x64'
    })
    expect(x?.sha256).toBeNull()
    expect(sha256FromDigest('md5:abc')).toBeNull()
    expect(sha256FromDigest(`sha256:${HEX.toUpperCase()}`)).toBe(HEX)
  })
})

describe('newerThan', () => {
  it('按数字段比，本地版不比同号正式版新', () => {
    expect(newerThan('0.8.3', '0.8.2')).toBe(true)
    expect(newerThan('0.10.0', '0.9.9')).toBe(true)
    expect(newerThan('0.8.2', '0.8.2')).toBe(false)
    expect(newerThan('0.8.1', '0.8.1-local')).toBe(false)
    expect(newerThan('0.8.2', '0.8.1-local')).toBe(true)
  })
  it('测试版：比上一个正式版新、比同号正式版旧，测试版之间按序号', () => {
    expect(newerThan('1.0.0-beta.1', '0.12.4')).toBe(true)
    expect(newerThan('1.0.0', '1.0.0-beta.1')).toBe(true)
    expect(newerThan('1.0.0-beta.1', '1.0.0')).toBe(false)
    expect(newerThan('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true)
    expect(newerThan('1.0.0-beta.10', '1.0.0-beta.9')).toBe(true)
    expect(newerThan('1.0.0-beta10', '1.0.0-beta9')).toBe(true)
    expect(newerThan('1.0.0-rc.1', '1.0.0-beta.3')).toBe(true)
    expect(newerThan('1.0.0-beta.1', '1.0.0-beta.1')).toBe(false)
    expect(newerThan('1.0.1-beta.1', '1.0.0')).toBe(true)
  })
  it('哪些算测试版', () => {
    expect(isPrerelease('1.0.0-beta.1')).toBe(true)
    expect(isPrerelease('1.0.0')).toBe(false)
    expect(isPrerelease('0.12.4-local')).toBe(false)
  })
})

describe('测试版的检查更新', () => {
  it('从 Release 的 Atom 订阅里读出版本号，挑最新的', () => {
    const xml = [
      '<entry><link rel="alternate" type="text/html" href="https://github.com/Kinnuch/Qonlang/releases/tag/v1.0.0-beta.2"/></entry>',
      '<entry><link rel="alternate" type="text/html" href="https://github.com/Kinnuch/Qonlang/releases/tag/v1.0.0-beta.1"/></entry>',
      '<entry><link rel="alternate" type="text/html" href="https://github.com/Kinnuch/Qonlang/releases/tag/v0.12.4"/></entry>'
    ].join('')
    const vs = versionsFromReleaseFeed(xml)
    expect(vs).toEqual(['1.0.0-beta.2', '1.0.0-beta.1', '0.12.4'])
    expect(newestVersion(vs)).toBe('1.0.0-beta.2')
    expect(newestVersion([...vs, '1.0.0'])).toBe('1.0.0')
    expect(
      versionFromReleaseUrl('https://github.com/Kinnuch/Qonlang/releases/tag/v1.0.0-beta.1')
    ).toBe('1.0.0-beta.1')
  })
  it('更新说明按界面语言挑中文或英文那一段，没分段的原样给', () => {
    const body = ['## 中文', '', '- 新增漏斗', '', '## English', '', '- A funnel', ''].join('\n')
    expect(notesForLocale(body, 'zh')).toBe('- 新增漏斗')
    expect(notesForLocale(body, 'zh-Hant')).toBe('- 新增漏斗')
    expect(notesForLocale(body, 'fr')).toBe('- A funnel')
    expect(notesForLocale('**Full Changelog**: x', 'en')).toBe('**Full Changelog**: x')
  })
})

describe('macOS 应用包', () => {
  it('从可执行文件路径找到 .app', () => {
    expect(macBundlePath('/Applications/Qonlang.app/Contents/MacOS/Qonlang')).toBe(
      '/Applications/Qonlang.app'
    )
    expect(macBundlePath('/Users/a/Apps/千语集.app/Contents/MacOS/Qonlang')).toBe(
      '/Users/a/Apps/千语集.app'
    )
    expect(macBundlePath('/usr/local/bin/qonlang')).toBeNull()
  })
  it('从 dmg 或随机只读目录运行的换不了', () => {
    expect(macBundleMovable('/Applications/Qonlang.app')).toBe(true)
    expect(macBundleMovable('/Volumes/Qonlang 0.8.3/Qonlang.app')).toBe(false)
    expect(macBundleMovable('/private/var/folders/x/AppTranslocation/1234/d/Qonlang.app')).toBe(
      false
    )
  })
  it('替换脚本只在两边都是 .app 时动手，失败会把旧的挪回来', () => {
    const s = macReplaceScript()
    expect(s.startsWith('#!/bin/bash')).toBe(true)
    expect(s).toContain('case "$TARGET" in *.app)')
    expect(s).toContain('mv "$BACKUP" "$TARGET"')
    expect(s).toContain('xattr -dr com.apple.quarantine "$TARGET"')
  })
})

describe('不走接口的检查', () => {
  it('从 releases/latest 跳转地址里取版本号', () => {
    expect(versionFromReleaseUrl('https://github.com/Kinnuch/Qonlang/releases/tag/v0.9.2')).toBe(
      '0.9.2'
    )
    expect(versionFromReleaseUrl('https://github.com/Kinnuch/Qonlang/releases/tag/1.0.0')).toBe(
      '1.0.0'
    )
    expect(versionFromReleaseUrl('https://github.com/Kinnuch/Qonlang/releases')).toBeNull()
    expect(versionFromReleaseUrl('https://github.com/login?return_to=x')).toBeNull()
  })
  it('读 latest.yml 的版本与安装包', () => {
    const yml = [
      'version: 0.9.2',
      'files:',
      '  - url: Qonlang-0.9.2-setup.exe',
      '    sha512: b1xZvy8uJ14CzwVNioXsy5IGugar6fplifRbOgEBhgliY3+2momAwwQg4liYUm07f+dIlzPHRgqSEpZUS+r/lw==',
      '    size: 96215943',
      'path: Qonlang-0.9.2-setup.exe',
      "releaseDate: '2026-09-17T05:07:50.355Z'"
    ].join('\r\n')
    const r = parseLatestYml(yml)
    expect(r.version).toBe('0.9.2')
    expect(r.files).toEqual([
      {
        url: 'Qonlang-0.9.2-setup.exe',
        sha512:
          'b1xZvy8uJ14CzwVNioXsy5IGugar6fplifRbOgEBhgliY3+2momAwwQg4liYUm07f+dIlzPHRgqSEpZUS+r/lw==',
        size: 96215943
      }
    ])
  })
  it('按命名规则挑本机的安装包', () => {
    expect(installerCandidates('1.2.3', { platform: 'win32', arch: 'x64' })).toEqual([
      { name: 'Qonlang-1.2.3-setup.exe', auto: true }
    ])
    expect(
      installerCandidates('1.2.3', { platform: 'darwin', arch: 'arm64', macSelfReplace: true })
    ).toEqual([
      { name: 'Qonlang-1.2.3-mac-arm64.zip', auto: true },
      { name: 'Qonlang-1.2.3-mac-arm64.dmg', auto: false }
    ])
    expect(installerCandidates('1.2.3', { platform: 'darwin', arch: 'x64' })).toEqual([
      { name: 'Qonlang-1.2.3-mac-x64.dmg', auto: false }
    ])
  })
})
