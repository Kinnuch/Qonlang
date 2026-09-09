/**
 * 反推：拿一个表层词找回它可能来自哪个词条。
 * 只用构形里写着的字面词缀做剥离，代价很小，不必把整本词典推导一遍。
 */
import type { Id, Project } from '$lib/core/model'
import { paradigmSlots } from './index'

export interface ParadigmAffix {
  form: string
  /** 槽位名，给悬浮卡说明用 */
  slot: string
}
export interface ParadigmAffixes {
  prefixes: ParadigmAffix[]
  suffixes: ParadigmAffix[]
}

const trim = (s: string): string => s.replace(/^[-=]+|[-=]+$/g, '').trim()

/** 收集这门语言的构形里出现过的前后缀（@语素 会展开成语素形式与音位变体） */
export function paradigmAffixes(project: Project, languageId: Id): ParadigmAffixes {
  const glossLangs = project.settings.glossLanguages
  const prefixes = new Map<string, string>()
  const suffixes = new Map<string, string>()
  const expand = (text: string): string[] => {
    const raw = text.trim()
    if (!raw) return []
    if (!raw.startsWith('@')) return [trim(raw)]
    const ref = raw.slice(1).trim()
    const m = project.morphemes.find(
      (x) =>
        x.languageId === languageId &&
        (x.form === ref || x.gloss === ref || trim(x.form) === trim(ref))
    )
    if (!m) return [trim(ref)]
    return [trim(m.form), ...m.allomorphs.map((a) => trim(a.form))]
  }
  for (const p of project.paradigms) {
    const labels = new Map<string, string>()
    for (const s of paradigmSlots(p, project.categories, glossLangs, true))
      labels.set(s.key, s.label)
    for (const [key, g] of Object.entries(p.generators)) {
      if (g.kind !== 'affix' && g.kind !== 'affix-sca') continue
      const slot = labels.get(key.split('#')[0]) ?? ''
      for (const f of expand(g.prefix ?? '')) if (f) prefixes.set(f.toLowerCase(), slot)
      for (const f of expand(g.suffix ?? '')) if (f) suffixes.set(f.toLowerCase(), slot)
    }
  }
  const sort = (m: Map<string, string>): ParadigmAffix[] =>
    [...m].map(([form, slot]) => ({ form, slot })).sort((a, b) => b.form.length - a.form.length)
  return { prefixes: sort(prefixes), suffixes: sort(suffixes) }
}

export interface ReverseHit {
  lexemeId: Id
  /** 剥掉的词缀 */
  affix: string
  slot: string
}

/**
 * 剥掉一个构形词缀后能对上词头或词干，就算命中。
 * `lookup` 由调用方给（一般是 gloss 索引），返回词条 id。
 */
export function reverseDerive(
  surface: string,
  affixes: ParadigmAffixes,
  lookup: (form: string) => Id | null
): ReverseHit | null {
  const n = surface.normalize('NFC').toLowerCase()
  for (const a of affixes.suffixes) {
    if (!a.form || !n.endsWith(a.form) || n.length <= a.form.length) continue
    const id = lookup(n.slice(0, n.length - a.form.length))
    if (id) return { lexemeId: id, affix: a.form, slot: a.slot }
  }
  for (const a of affixes.prefixes) {
    if (!a.form || !n.startsWith(a.form) || n.length <= a.form.length) continue
    const id = lookup(n.slice(a.form.length))
    if (id) return { lexemeId: id, affix: a.form, slot: a.slot }
  }
  return null
}
