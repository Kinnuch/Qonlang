/**
 * 规则文件导入：按选的格式把外部工具的文件转成千语集的规则文本。
 * 导入样例与测试台都走这一条，看到的跟真导入一致。
 */
import { fromLexicanter, fromSca2, fromYinbianji } from '$lib/engine/sca/importers'

export type RuleFile = { name: string; content: string }
export type RuleFormat = 'yinbianji' | 'lexicanter' | 'sca2' | 'plain'

/** 音变姬的文件按名字或内容分：音类、替换、词库（不要）、规则 */
export function yinbianjiPart(f: RuleFile): 'category' | 'replace' | 'lexicon' | 'rule' {
  const lower = f.name.toLowerCase()
  const body = f.content
  if (lower.includes('categor') || (!body.includes('>') && /^[A-Z]=/m.test(body))) return 'category'
  if (lower.includes('replace') || (!body.includes('>') && /^\S+\|\S+/m.test(body)))
    return 'replace'
  return lower.includes('lexicon') ? 'lexicon' : 'rule'
}

/** 按选的格式转成千语集的规则文本；音变姬是多个文件，其余只看第一个 */
export function convertRuleFiles(files: RuleFile[], format: RuleFormat): string {
  if (!files.length) return ''
  if (format === 'yinbianji') {
    const part = (k: string): string =>
      files
        .filter((f) => yinbianjiPart(f) === k)
        .map((f) => f.content + '\n')
        .join('')
    return fromYinbianji(part('category'), part('replace'), part('rule'))
  }
  const content = files[0].content
  return format === 'lexicanter'
    ? fromLexicanter(content)
    : format === 'sca2'
      ? fromSca2(content)
      : content
}
