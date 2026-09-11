/**
 * 词类的小工具：复合词类（由几个词类组成）与义项自己的词类。
 * 词类的名字、缩写都是项目数据，这里只按 id 把它们串起来。
 */
import type { Id, Lexeme, PartOfSpeech, Project, Sense, StemSlot } from './model'
import { newId } from './factory'

type PosHost = Pick<Project, 'posList'>

export function findPos(project: PosHost, id: Id | null | undefined): PartOfSpeech | undefined {
  return id ? project.posList.find((p) => p.id === id) : undefined
}

/** 组成词类不少于两个的算复合词类 */
export function isCompoundPos(p: PartOfSpeech | undefined): boolean {
  return (p?.components?.length ?? 0) > 1
}

/** 复合词类拆成组成它的词类（找得到的、不重复）；普通词类就是它自己 */
export function posParts(project: PosHost, id: Id | null | undefined): PartOfSpeech[] {
  const p = findPos(project, id)
  if (!p) return []
  if (!isCompoundPos(p)) return [p]
  const out: PartOfSpeech[] = []
  for (const cid of p.components ?? []) {
    const c = findPos(project, cid)
    if (c && c !== p && !out.includes(c)) out.push(c)
  }
  return out.length ? out : [p]
}

/** 词条沾到的全部词类：词条自己的及其组成、合并时叠加的、各义项自己的 */
export function lexemePosIds(project: PosHost, l: Lexeme): Id[] {
  const ids = new Set<Id>()
  const add = (id: Id | null | undefined): void => {
    const p = findPos(project, id)
    if (!p) return
    ids.add(p.id)
    for (const c of posParts(project, p.id)) ids.add(c.id)
  }
  add(l.posId)
  for (const id of l.extraPosIds ?? []) add(id)
  for (const s of l.senses) add(s.posId)
  return [...ids]
}

/** 义项要单独标出来的词类：义项自己选了，而且跟词条的不一样 */
export function sensePos(project: PosHost, l: Lexeme, s: Sense): PartOfSpeech | undefined {
  return s.posId && s.posId !== l.posId ? findPos(project, s.posId) : undefined
}

/** 词类的名字：按语言顺序挑，都没有就随便一个，再没有就用缩写 */
export function posName(p: PartOfSpeech | undefined, langs: readonly string[] = []): string {
  if (!p) return ''
  for (const l of langs) if (p.name[l]?.trim()) return p.name[l].trim()
  return (
    Object.values(p.name)
      .find((x) => x?.trim())
      ?.trim() ?? p.abbr.trim()
  )
}

/** 词类显示成什么：有缩写用缩写，没有就用名字 */
export function posText(p: PartOfSpeech | undefined, langs: readonly string[] = []): string {
  if (!p) return ''
  return p.abbr.trim() || posName(p, langs)
}

/** 复合词类的默认名字与缩写：各组成词类的名字、缩写用斜杠连起来（有一个没缩写就不给缩写） */
export function compoundLabels(parts: PartOfSpeech[]): {
  name: Record<string, string>
  abbr: string
} {
  const langs = [
    ...new Set(parts.flatMap((p) => Object.keys(p.name).filter((k) => p.name[k]?.trim())))
  ]
  const name: Record<string, string> = {}
  for (const lang of langs) name[lang] = parts.map((p) => posName(p, [lang])).join('/')
  const abbr = parts.every((p) => p.abbr.trim()) ? parts.map((p) => p.abbr.trim()).join('/') : ''
  return { name, abbr }
}

/**
 * 由这几个词类组成的复合词类：组成一样（不管顺序）的已经有了就用它，没有就新建，名字、缩写用斜杠连起来。
 * 组成里有复合词类的先拆开；拆完只剩一个时就是那个词类本身。
 */
export function ensureCompoundPos(
  project: PosHost,
  ids: readonly Id[]
): { pos: PartOfSpeech; created: boolean } | null {
  const parts: PartOfSpeech[] = []
  for (const id of ids) for (const p of posParts(project, id)) if (!parts.includes(p)) parts.push(p)
  if (!parts.length) return null
  if (parts.length === 1) return { pos: parts[0], created: false }
  const key = (xs: PartOfSpeech[]): string =>
    xs
      .map((x) => x.id)
      .sort()
      .join('|')
  const want = key(parts)
  const found = project.posList.find(
    (p) => isCompoundPos(p) && key(posParts(project, p.id)) === want
  )
  if (found) return { pos: found, created: false }
  const pos: PartOfSpeech = {
    id: newId(),
    ...compoundLabels(parts),
    paradigmId: null,
    components: parts.map((p) => p.id)
  }
  project.posList.push(pos)
  return { pos, created: true }
}

/** 词类绑定的构形：自己没绑时看组成词类，第一个绑了的算 */
export function posParadigmId(project: PosHost, id: Id | null | undefined): Id | null {
  const p = findPos(project, id)
  if (!p) return null
  return p.paradigmId ?? posParts(project, p.id).find((c) => c.paradigmId)?.paradigmId ?? null
}

/** 词类的词干槽：复合词类自己没定义时，把组成词类的接起来 */
export function posStemSlotList(project: PosHost, id: Id | null | undefined): StemSlot[] {
  const p = findPos(project, id)
  if (!p) return []
  if (p.stemSlots?.length || !isCompoundPos(p)) return p.stemSlots ?? []
  return posParts(project, p.id).flatMap((c) => c.stemSlots ?? [])
}
