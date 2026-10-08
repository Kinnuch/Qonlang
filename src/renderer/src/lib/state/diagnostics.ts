/**
 * 「复制诊断信息」「报告问题」：设置的「关于」、开始页底部、帮助菜单都用这一套。
 * 文字怎么拼见 lib/core/diagnostics.ts（只写数量，不带项目内容）。
 */
import { platform } from '$lib/platform'
import { i18n, t } from '$lib/i18n/index.svelte'
import { diagnosticsText, issueUrl } from '$lib/core/diagnostics'
import { projectState } from './project.svelte'
import { ui } from './ui.svelte'

export async function collectDiagnostics(): Promise<string> {
  const info = await platform.info()
  const p = projectState.project
  let sizeKb = 0
  if (p) {
    try {
      sizeKb = Math.round(JSON.stringify(p).length / 1024)
    } catch {
      sizeKb = 0
    }
  }
  return diagnosticsText({
    version: info.version,
    platform: info.platform,
    os: info.os,
    electron: info.electron,
    locale: i18n.locale,
    userDataPath: info.userDataPath,
    home: info.home,
    project: p
      ? {
          languages: p.languages.length,
          lexemes: p.lexemes.length,
          morphemes: p.morphemes.length,
          sentences: p.sentences.length,
          phrases: p.phrasebook.length,
          sizeKb
        }
      : null,
    errors: ui.recentErrors
  })
}

export async function copyDiagnostics(): Promise<void> {
  const text = await collectDiagnostics()
  try {
    await navigator.clipboard.writeText(text)
    ui.toast(t('feedback.copied'))
  } catch (e) {
    ui.error(t('feedback.copyFailed', { msg: (e as Error).message }))
  }
}

/** 在 GitHub 新建一条问题，正文里先放好诊断信息 */
export async function reportIssue(): Promise<void> {
  const url = issueUrl(await collectDiagnostics(), {
    what: t('feedback.issueWhat'),
    steps: t('feedback.issueSteps')
  })
  await platform.openExternal(url)
}
