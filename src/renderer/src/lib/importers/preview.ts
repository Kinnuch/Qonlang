/**
 * 导入样例：在项目的临时副本上试着导入，给检视器看「导入后会是什么样」，不动真正的项目。
 */
import type { Project } from '$lib/core/model'

/** 样例最多显示几条 */
export const PREVIEW_LIMIT = 8

/**
 * 临时副本：词类、维度各拷一份（导入会往里加），语言列表与设置换成浅拷贝（导入会往里加新语言、改默认语言），
 * 词条、语素、例句、短语、规则集、文档都从空的开始；其余只读着用。
 */
export function scratchProject(p: Project): Project {
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
  return {
    ...p,
    meta: { ...p.meta },
    settings: { ...p.settings },
    languages: [...p.languages],
    posList: clone(p.posList),
    categories: clone(p.categories),
    lexemes: [],
    morphemes: [],
    sentences: [],
    phrasebook: [],
    ruleSets: [],
    docs: []
  }
}
