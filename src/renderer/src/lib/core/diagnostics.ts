/**
 * 「复制诊断信息」与「报告问题」里带上的那一段：版本、系统、界面语言、数据目录、开着的项目有多大、最近的报错。
 * 只写数量不写内容（项目名、词条一概不带）；数据目录把用户主目录换成 ~，免得贴到网上露出系统用户名。
 * 用英文写，GitHub 上谁都看得懂。
 */
export interface DiagnosticsInput {
  version: string
  platform: 'electron' | 'web'
  os?: string
  electron?: string
  locale: string
  userDataPath?: string | null
  home?: string | null
  /** 开着的项目：只要数量 */
  project?: {
    languages: number
    lexemes: number
    morphemes: number
    sentences: number
    phrases: number
    sizeKb: number
  } | null
  /** 最近的报错（新的在后），每条带时间 */
  errors?: { at: string; message: string }[]
}

/** 主目录开头的路径换成 ~（Windows 不分大小写，斜杠方向也不管） */
export function maskHome(path: string, home: string | null | undefined): string {
  if (!home) return path
  const norm = (s: string): string => s.replace(/\\/g, '/').toLowerCase()
  if (!norm(path).startsWith(norm(home))) return path
  return '~' + path.slice(home.length)
}

export function diagnosticsText(d: DiagnosticsInput): string {
  const lines = [`Qonlang ${d.version} (${d.platform})`]
  if (d.os) lines.push(`OS: ${d.os}${d.electron ? ` · Electron ${d.electron}` : ''}`)
  lines.push(`UI language: ${d.locale}`)
  if (d.userDataPath) lines.push(`Data folder: ${maskHome(d.userDataPath, d.home)}`)
  const p = d.project
  lines.push(
    p
      ? `Project: ${p.languages} languages, ${p.lexemes} entries, ${p.morphemes} morphemes, ${p.sentences} sentences, ${p.phrases} phrases, ${p.sizeKb} KB`
      : 'Project: none open'
  )
  const errors = (d.errors ?? []).slice(-5)
  if (errors.length) {
    lines.push('Recent errors:')
    for (const e of errors) lines.push(`- ${e.at} ${e.message.replace(/\s+/g, ' ').slice(0, 300)}`)
  }
  return lines.join('\n')
}

/** 报告问题：在 GitHub 新建一条，正文先放好诊断信息和要填的几项 */
export function issueUrl(diagnostics: string, labels: { what: string; steps: string }): string {
  const body = [
    `### ${labels.what}`,
    '',
    '',
    `### ${labels.steps}`,
    '',
    '1. ',
    '',
    '### Diagnostics',
    '',
    '```',
    diagnostics,
    '```'
  ].join('\n')
  return `https://github.com/Kinnuch/Qonlang/issues/new?body=${encodeURIComponent(body)}`
}
