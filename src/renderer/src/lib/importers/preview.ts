/**
 * 导入样例：在项目的临时副本上试着导入，给检视器看「导入后会是什么样」，不动真正的项目。
 */
import type { Lexeme, Morpheme, Project } from '$lib/core/model'

/** 样例最多显示几条 */
export const PREVIEW_LIMIT = 8

/**
 * 临时副本：词类、维度各拷一份（导入会往里加），语言列表、检视器模块与设置换成浅拷贝（导入会往里加新语言、新模块，改默认语言），
 * 词条、语素、例句、短语、规则集、文档都从空的开始；其余只读着用。
 */
export function scratchProject(p: Project): Project {
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
  return {
    ...p,
    meta: { ...p.meta },
    settings: { ...p.settings },
    // 方言列会往语言里加方言：每门语言浅拷一份，方言另拷
    languages: p.languages.map((l) => ({ ...l, dialects: [...l.dialects] })),
    posList: clone(p.posList),
    categories: clone(p.categories),
    customFields: [...(p.customFields ?? [])],
    lexemes: [],
    morphemes: [],
    sentences: [],
    phrasebook: [],
    ruleSets: [],
    docs: []
  }
}

/** 样例显示的几种东西 */
export type PreviewKind = 'lexemes' | 'morphemes' | 'records' | 'glyphs' | 'lines' | 'empty'

/** 一份样例数据：测试台按当前设置解析出来的结果也是这个形状 */
export interface PreviewData {
  /** 词条、语素要配一份临时项目（词类、维度的名字从这里找） */
  project?: Project
  lexemes?: Lexeme[]
  morphemes?: Morpheme[]
  records?: { rec: Record<string, string>; skip?: string }[]
  glyphs?: { char: string; value: string; name: string; skip?: boolean }[]
  lines?: string[]
}

/** 这份数据按哪种显示：哪一类有内容就算哪一类，都空就是「认不出来」 */
export function previewKind(d: PreviewData | null | undefined): PreviewKind {
  if (!d) return 'empty'
  if (d.lexemes?.length) return 'lexemes'
  if (d.morphemes?.length) return 'morphemes'
  if (d.records?.length) return 'records'
  if (d.glyphs?.length) return 'glyphs'
  if (d.lines?.some((l) => l.trim())) return 'lines'
  return 'empty'
}
