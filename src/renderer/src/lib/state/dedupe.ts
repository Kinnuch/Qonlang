/**
 * 语料查重的界面流程：自动合并只差出处的，其余弹窗问用户，最后提示结果。
 * 导入例句之后调用（传刚导入的 id），或用户在语料页手动触发（不传）。
 */
import type { Id, Project } from '$lib/core/model'
import { findDuplicateSentences, mergeSentences } from '$lib/core/sentenceDedup'
import { ui } from './ui.svelte'
import { t } from '$lib/i18n/index.svelte'

export async function dedupeSentences(
  project: Project,
  opts: { languageId?: Id | null; among?: Set<Id>; silent?: boolean } = {}
): Promise<number> {
  const pairs = findDuplicateSentences(project, opts)
  let merged = 0
  for (const p of pairs.filter((x) => x.auto)) {
    mergeSentences(project, p.keep, p.drop)
    merged++
  }
  const ask = pairs.filter((x) => !x.auto)
  if (ask.length) {
    const chosen = await ui.askMerge(ask)
    for (const p of chosen) {
      mergeSentences(project, p.keep, p.drop)
      merged++
    }
  }
  if (!opts.silent)
    ui.toast(merged ? t('corpus.dedup.merged', { n: merged }) : t('corpus.dedup.none'))
  return merged
}
