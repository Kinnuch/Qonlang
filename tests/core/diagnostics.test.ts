/**
 * 「复制诊断信息」「报告问题」：只写数量不写项目内容，用户目录换成 ~，报告的链接指向 GitHub 新建问题。
 */
import { describe, it, expect } from 'vitest'
import { diagnosticsText, issueUrl, maskHome } from '$lib/core/diagnostics'

describe('diagnostics', () => {
  it('masks the home folder whatever the slashes and case', () => {
    expect(maskHome('C:\\Users\\Ann\\AppData\\Roaming\\Qonlang', 'C:\\Users\\Ann')).toBe(
      '~\\AppData\\Roaming\\Qonlang'
    )
    expect(maskHome('c:/users/ann/AppData', 'C:\\Users\\Ann')).toBe('~/AppData')
    expect(maskHome('/home/ann/.config/Qonlang', '/home/ann')).toBe('~/.config/Qonlang')
    expect(maskHome('/opt/Qonlang', '/home/ann')).toBe('/opt/Qonlang')
    expect(maskHome('/opt/Qonlang', null)).toBe('/opt/Qonlang')
  })

  it('writes counts only, and the last five errors', () => {
    const text = diagnosticsText({
      version: '1.0.0-beta.1',
      platform: 'electron',
      os: 'win32 10.0.26200',
      electron: '39.0.0',
      locale: 'ja',
      userDataPath: '/home/ann/.config/Qonlang',
      home: '/home/ann',
      project: { languages: 3, lexemes: 47, morphemes: 27, sentences: 9, phrases: 5, sizeKb: 400 },
      errors: Array.from({ length: 7 }, (_, i) => ({ at: `t${i}`, message: `boom ${i}\n  at x` }))
    })
    expect(text).toContain('Qonlang 1.0.0-beta.1 (electron)')
    expect(text).toContain('OS: win32 10.0.26200 · Electron 39.0.0')
    expect(text).toContain('UI language: ja')
    expect(text).toContain('Data folder: ~/.config/Qonlang')
    expect(text).not.toContain('/home/ann')
    expect(text).toContain('3 languages, 47 entries, 27 morphemes, 9 sentences, 5 phrases, 400 KB')
    expect(text).not.toContain('boom 1')
    expect(text).toContain('- t2 boom 2 at x')
    expect(text).toContain('- t6 boom 6 at x')
  })

  it('says when no project is open', () => {
    const text = diagnosticsText({ version: '1.0.0', platform: 'web', locale: 'en' })
    expect(text).toContain('Project: none open')
    expect(text).not.toContain('Recent errors')
  })

  it('opens a new GitHub issue with the diagnostics in the body', () => {
    const url = issueUrl('Qonlang 1.0.0 (web)', { what: 'What went wrong', steps: 'Steps' })
    expect(url.startsWith('https://github.com/Kinnuch/Qonlang/issues/new?body=')).toBe(true)
    const body = decodeURIComponent(url.split('body=')[1])
    expect(body).toContain('### What went wrong')
    expect(body).toContain('### Steps')
    expect(body).toContain('```\nQonlang 1.0.0 (web)\n```')
  })
})
