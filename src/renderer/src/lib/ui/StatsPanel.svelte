<script lang="ts">
  /**
   * 通用统计面板：一排数字卡 + 若干柱状分布 + 若干可点的排行。
   * 词库 / 语素 / 语料三处共用；数据由各页面按自己的统计函数拼。
   */
  import type { Bucket } from '$lib/engine/stats'

  export interface Fact {
    label: string
    value: string | number
    /** 小字补充（比如占比） */
    sub?: string
  }
  export interface Group {
    title: string
    buckets: Bucket[]
    /** 点某一项（筛选 / 跳转） */
    onpick?: (key: string) => void
    /** 最多显示几项，多的折叠 */
    max?: number
  }
  export interface Ranking {
    title: string
    items: { id: string; label: string; n: number }[]
    onpick?: (id: string) => void
  }

  let {
    facts = [],
    groups = [],
    rankings = []
  }: { facts?: Fact[]; groups?: Group[]; rankings?: Ranking[] } = $props()

  let expanded = $state<Set<string>>(new Set())
  function toggle(title: string): void {
    const next = new Set(expanded)
    if (next.has(title)) next.delete(title)
    else next.add(title)
    expanded = next
  }
  const maxOf = (b: Bucket[]): number => Math.max(1, ...b.map((x) => x.n))

  /** 并排的统计块太矮时至少留这么高，免得长的那块只剩两三行可滚 */
  const MIN_BLOCK = 200
  /**
   * 同一行里并排的几块按矮的那块定高，高的那块里面滚动。
   * 宽度变了（换行方式跟着变）、数据或展开收起变了就重新量一遍。
   */
  function alignRows(
    node: HTMLElement,
    key: unknown
  ): { update(k: unknown): void; destroy(): void } {
    let frame = 0
    let width = -1
    const run = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const blocks = [...node.querySelectorAll<HTMLElement>(':scope > .group')]
        for (const b of blocks) b.style.height = ''
        const rows = new Map<number, HTMLElement[]>()
        for (const b of blocks) rows.set(b.offsetTop, [...(rows.get(b.offsetTop) ?? []), b])
        for (const list of rows.values()) {
          if (list.length < 2) continue
          // 量的是各块自己的高度（.cols 不拉伸）：按矮的定，太矮时放宽到 MIN_BLOCK（但不超过高的那块）
          const hs = list.map((b) => b.offsetHeight)
          const h = Math.max(Math.min(...hs), Math.min(MIN_BLOCK, Math.max(...hs)))
          for (const b of list) if (b.offsetHeight !== h) b.style.height = `${h}px`
        }
      })
    }
    const ro = new ResizeObserver(() => {
      if (node.clientWidth === width) return
      width = node.clientWidth
      run()
    })
    ro.observe(node)
    void key
    run()
    return {
      update: run,
      destroy() {
        ro.disconnect()
        cancelAnimationFrame(frame)
      }
    }
  }
</script>

{#if facts.length}
  <div class="facts">
    {#each facts as f (f.label)}
      <div class="fact card">
        <div class="val">{f.value}</div>
        <div class="lbl small muted">{f.label}</div>
        {#if f.sub}<div class="sub small muted">{f.sub}</div>{/if}
      </div>
    {/each}
  </div>
{/if}

<div class="cols" use:alignRows={[groups, rankings, expanded]}>
  {#each groups.filter((g) => g.buckets.length) as g (g.title)}
    {@const lim = g.max ?? 12}
    {@const open = expanded.has(g.title)}
    {@const shown = open ? g.buckets : g.buckets.slice(0, lim)}
    {@const top = maxOf(g.buckets)}
    <section class="group">
      <h3>{g.title} <span class="small muted">{g.buckets.length}</span></h3>
      <div class="bars">
        {#each shown as b (b.key)}
          <button
            class="bar-row"
            class:clickable={!!g.onpick}
            disabled={!g.onpick}
            onclick={() => g.onpick?.(b.key)}
          >
            <span class="bl" title={b.label}>{b.label}</span>
            <span class="track"><span class="fill" style:width="{(b.n / top) * 100}%"></span></span>
            <span class="bn small muted">{b.n}</span>
          </button>
        {/each}
      </div>
      {#if g.buckets.length > lim}
        <button class="btn ghost sm self" onclick={() => toggle(g.title)}
          >{open ? '−' : `+${g.buckets.length - lim}`}</button
        >
      {/if}
    </section>
  {/each}
  {#each rankings.filter((r) => r.items.length) as r (r.title)}
    <section class="group">
      <h3>{r.title}</h3>
      <div class="list">
        <table class="tbl small">
          <tbody>
            {#each r.items as it (it.id)}
              <tr
                class:clickable={!!r.onpick}
                role={r.onpick ? 'button' : undefined}
                tabindex={r.onpick ? 0 : undefined}
                onclick={() => r.onpick?.(it.id)}
                onkeydown={(e) => e.key === 'Enter' && r.onpick?.(it.id)}
              >
                <td class="data">{it.label}</td>
                <td class="muted num">{it.n}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/each}
</div>

<style>
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
    margin-bottom: 18px;
  }
  .fact {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .val {
    font-size: 22px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px 16px;
    align-items: start;
  }
  /* 每块统计一圈淡淡的圆边框，鼠标放上去这一块略微亮一点 */
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    border-radius: var(--radius);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .group:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .group h3 {
    margin: 0;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  /* 定了高的那块，列表在里面滚 */
  .bars,
  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .bar-row {
    display: grid;
    grid-template-columns: minmax(70px, 34%) 1fr 40px;
    align-items: center;
    gap: 8px;
    padding: 2px 4px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: default;
  }
  .bar-row.clickable {
    cursor: pointer;
  }
  .bar-row.clickable:hover {
    background: var(--bg-hover);
  }
  .bl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .track {
    height: 10px;
    background: var(--bg-sunken);
    border-radius: 5px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 5px;
    min-width: 2px;
  }
  .bn {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .self {
    align-self: flex-start;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.clickable:hover td {
    background: var(--bg-hover);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
