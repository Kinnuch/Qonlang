import type { SlotGenerator } from '$lib/core/model'

/** 构形的剪贴板：一个槽位的生成方式，或者一整套变体（槽位键 → 生成方式） */
export type MorphClip =
  | { kind: 'slot'; generator: SlotGenerator }
  | { kind: 'variant'; name: string; generators: Record<string, SlotGenerator> }

/** 写进系统剪贴板时带的记号：认出是千语集复制出来的构形 */
const MARK = 'qonlangMorphClip'

class MorphClipboard {
  /** 这个窗口里最近复制的（系统剪贴板读不到时用） */
  clip = $state<MorphClip | null>(null)

  copy(c: MorphClip): void {
    const plain = JSON.parse(JSON.stringify(c)) as MorphClip
    this.clip = plain
    void navigator.clipboard?.writeText(JSON.stringify({ [MARK]: 1, ...plain })).catch(() => {})
  }

  /** 系统剪贴板里是千语集复制出来的构形就用它（另一个窗口复制的也贴得上），不然用这个窗口记着的 */
  async read(): Promise<MorphClip | null> {
    try {
      const o = JSON.parse((await navigator.clipboard.readText()) || 'null')
      if (o && o[MARK] && (o.kind === 'slot' || o.kind === 'variant')) {
        delete o[MARK]
        return o as MorphClip
      }
    } catch {
      /* 剪贴板里不是构形 */
    }
    return this.clip
  }
}

export const morphClip = new MorphClipboard()
