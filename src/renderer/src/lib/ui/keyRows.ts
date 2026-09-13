/**
 * 「名字 → 内容」对象（词条的词干、屈折形）在录入界面上一行一行地编辑：每行一个固定的 id，改了名字行还是那一行。
 *
 * 按名字认行的话，改名那一刻整行被拆掉重建，按 Tab 刚跳进这一行的下一个输入框，焦点就跟着没了；
 * 按位置认也靠不住——Svelte 的状态代理删掉一个键再加回来时，键的顺序不一定跟着变，
 * 同一个位置可能换成了别的词干，焦点所在的输入框就绑到别人身上。
 * 所以行的顺序也记在这里：还在的行留在原位，新出现的键接在最后。
 */
export interface KeyRow {
  id: number
  key: string
}

export class KeyRows {
  private rows: KeyRow[] = []
  private owner: unknown = null
  private seq = 0

  /** 按对象现在的键对齐（渲染时调）；owner 换了（换了一个词条）就从头来 */
  sync(owner: unknown, keys: readonly string[]): KeyRow[] {
    if (owner !== this.owner) {
      this.owner = owner
      this.rows = []
    }
    const present = new Set(keys)
    const kept = this.rows.filter((r) => present.has(r.key))
    const known = new Set(kept.map((r) => r.key))
    for (const k of keys)
      if (!known.has(k)) {
        kept.push({ id: ++this.seq, key: k })
        known.add(k)
      }
    this.rows = kept
    // 每次给新的对象：列表按 id 认行，内容变了才会跟着更新
    return kept.map((r) => ({ ...r }))
  }

  /** 这一行改了名字：id 和位置都不变 */
  rename(id: number, key: string): void {
    const r = this.rows.find((x) => x.id === id)
    if (r) r.key = key
  }
}

/** 给对象里的一个键改名；新名字是空的、没变或者已经有了就不改，返回 false */
export function renameObjectKey(
  obj: Record<string, unknown>,
  oldKey: string,
  newKey: string
): boolean {
  if (!newKey || oldKey === newKey || Object.keys(obj).includes(newKey)) return false
  const v = obj[oldKey]
  delete obj[oldKey]
  obj[newKey] = v
  return true
}
