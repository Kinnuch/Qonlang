/**
 * 示例工程的文档（关于这个示例、语法概要……）有中文和英文两份：项目文件里存中文，
 * 英文的放在 examples/docs-en.json（按示例、按中文标题对上）。界面不是中文时打开示例，换成英文那份；
 * 词库、语素这些示例数据本身不换。
 */
import type { Project } from './model'

export type ExampleDocsEn = Record<string, Record<string, { title: string; markdown: string }>>

/** 换好的份数；界面是中文（含繁体）时不换 */
export function localizeExampleDocs(
  project: Project,
  exampleId: string,
  en: ExampleDocsEn,
  locale: string
): number {
  if (locale.startsWith('zh')) return 0
  const map = en[exampleId] ?? {}
  let n = 0
  for (const d of project.docs) {
    const hit = map[d.title]
    if (!hit) continue
    d.title = hit.title
    d.markdown = hit.markdown
    n++
  }
  return n
}
