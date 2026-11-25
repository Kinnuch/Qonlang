import type { Project } from '$lib/core/model'

/** 只整理已经生成的自造文字；换行、连接控制符、原拼写与分词数据都不动。 */
export function scriptSpacing(project: Pick<Project, 'settings'>, output: string): string {
  return project.settings.scriptShowSpaces === false
    ? output.replace(/[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, '')
    : output
}
