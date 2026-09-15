/**
 * 重音规则读成一句话（规则列表里一行显示用）：「2 个音节 倒数第 1 个（核是 {双元音}）」。
 */
import { t } from '$lib/i18n/index.svelte'
import type { StressClause } from '$lib/engine/sca'

export function describeClause(c: StressClause): string {
  const parts: string[] = []
  if (c.count !== null)
    parts.push(t(c.orMore ? 'stressRule.sumCountMore' : 'stressRule.sumCount', { n: c.count }))
  const where =
    c.position === 'first'
      ? t('stressRule.posFirst')
      : c.position === 'last'
        ? t('stressRule.posLast')
        : c.position > 0
          ? t('stressRule.sumFront', { n: c.position })
          : t('stressRule.sumBack', { n: -c.position })
  const cond: string[] = []
  if (c.target) cond.push(t('stressRule.sumNucleus', { x: c.target }))
  if (c.context.left || c.context.right)
    cond.push(t('stressRule.sumEnv', { x: `${c.context.left}_${c.context.right}` }))
  if (c.exception)
    cond.push(t('stressRule.sumExcept', { x: `${c.exception.left}_${c.exception.right}` }))
  parts.push(
    cond.length
      ? t('stressRule.sumWith', { where, cond: cond.join(t('stressRule.sumAnd')) })
      : where
  )
  return parts.join(' ')
}

export function describeSplit(split: string, head: number): string {
  if (!split) return ''
  return t(head > 0 ? 'stressRule.sumSplitFirst' : 'stressRule.sumSplitLast', { x: split })
}
