<script lang="ts">
  /**
   * 屈折形的表格 / 树形图：按构形的维度排（第一个维度作行、第二个作列，第三个起每种取值一张表）。
   * 每一格画成什么由外面给：显示模式是文字，录入模式是输入框。
   * 维度取值定义了 gloss 缩写的，表头、树上都写缩写（1SG、PL.OBL），全名放在悬浮提示里。
   */
  import type { Snippet } from 'svelte'
  import { ChevronDown, ChevronRight } from '@lucide/svelte'
  import type { LexemeSlot } from '$lib/engine/morph'
  import {
    cellKey,
    slotTables,
    slotTree,
    type LayoutDim,
    type SlotTreeNode
  } from '$lib/engine/morph/layout'

  let {
    dims,
    slots,
    layout,
    cell
  }: {
    dims: LayoutDim[]
    /** 这一套构形在这个词条里的全部槽位 */
    slots: LexemeSlot[]
    layout: 'table' | 'tree'
    /** 一格：没有对应槽位（被屏蔽了）时给 null */
    cell: Snippet<[LexemeSlot | null]>
  } = $props()

  const byKey = $derived(new Map(slots.map((s) => [s.slot.key, s])))
  const tables = $derived(layout === 'table' ? slotTables(dims) : [])
  const tree = $derived(layout === 'tree' ? slotTree(dims) : [])
  /**
   * 停用的槽位不占位置：整行、整列、整张表都没有槽位就不画。
   * 表格是按维度铺格子的，不筛的话停用的那一格会画成空的「—」
   */
  const shown = $derived.by(() =>
    tables
      .map((tb) => ({
        ...tb,
        rows: dims[0].values.filter((r) =>
          dims[1]
            ? dims[1].values.some((c) => byKey.has(cellKey(dims, r, c, tb.fixed)))
            : byKey.has(cellKey(dims, r, null, tb.fixed))
        ),
        cols: dims[1]
          ? dims[1].values.filter((c) =>
              dims[0].values.some((r) => byKey.has(cellKey(dims, r, c, tb.fixed)))
            )
          : []
      }))
      .filter((tb) => tb.rows.length)
  )
  /** 树形图同理：整支没有槽位就不画 */
  const prune = (nodes: SlotTreeNode[]): SlotTreeNode[] =>
    nodes
      .map((n) => (n.leaf ? n : { ...n, children: prune(n.children) }))
      .filter((n) => (n.leaf ? byKey.has(n.key) : n.children.length))
  const shownTree = $derived(prune(tree))
  /** 取值写什么：有 gloss 缩写就写缩写 */
  const short = (v: { name: string; abbr: string }): string => v.abbr || v.name
  /** 树的分叉点开 / 收起；槽位多（200 个以上）时默认收着，点开哪支画哪支 */
  let toggled = $state<Set<string>>(new Set())
  const big = $derived(slots.length > 200)
  const open = (key: string): boolean => (big ? toggled.has(key) : !toggled.has(key))
  function toggle(key: string): void {
    const next = new Set(toggled)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    toggled = next
  }
</script>

{#snippet branch(nodes: SlotTreeNode[])}
  <ul class="ftree">
    {#each nodes as n (n.key)}
      <li>
        {#if n.leaf}
          <div class="tleaf">
            <span class="tname" class:mono={!!n.abbr} title={n.label}>{n.abbr || n.label}</span>
            {@render cell(byKey.get(n.key) ?? null)}
          </div>
        {:else}
          <button class="tnode" onclick={() => toggle(n.key)}>
            {#if open(n.key)}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
            <span class:mono={!!n.abbr} title={n.label}>{n.abbr || n.label}</span>
          </button>
          {#if open(n.key)}{@render branch(n.children)}{/if}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#if layout === 'table'}
  <div class="ftables">
    {#each shown as tb (tb.key)}
      <div>
        {#if tb.caption}<div class="ftable-cap small">{tb.caption}</div>{/if}
        <div class="table-wrap">
          <table class="ftable">
            <thead>
              <tr>
                <th class="corner"
                  >{dims[0].name}{#if dims[1]}
                    ＼ {dims[1].name}{/if}</th
                >
                {#if dims[1]}
                  {#each tb.cols as c (c.id)}<th class:mono={!!c.abbr} title={c.name}>{short(c)}</th
                    >{/each}
                {:else}
                  <th></th>
                {/if}
              </tr>
            </thead>
            <tbody>
              {#each tb.rows as r (r.id)}
                <tr>
                  <th class:mono={!!r.abbr} title={r.name}>{short(r)}</th>
                  {#if dims[1]}
                    {#each tb.cols as c (c.id)}<td
                        >{@render cell(byKey.get(cellKey(dims, r, c, tb.fixed)) ?? null)}</td
                      >{/each}
                  {:else}
                    <td>{@render cell(byKey.get(cellKey(dims, r, null, tb.fixed)) ?? null)}</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="ftree-wrap">{@render branch(shownTree)}</div>
{/if}

<style>
  .ftables {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ftable-cap {
    font-weight: 600;
    margin-bottom: 3px;
  }
  .table-wrap {
    overflow-x: auto;
  }
  .ftable {
    border-collapse: collapse;
  }
  .ftable th,
  .ftable td {
    border: 1px solid var(--border);
    padding: 0;
    vertical-align: middle;
  }
  .ftable th {
    padding: 3px 8px;
    background: var(--bg-sunken);
    font-weight: 500;
    font-size: 12px;
    text-align: start;
    white-space: nowrap;
  }
  /* gloss 缩写：跟语料 gloss 行同一种字体 */
  .mono {
    font-family: var(--font-gloss);
    letter-spacing: 0.02em;
  }
  .ftable .corner {
    color: var(--text-3);
    font-size: 11px;
  }
  .ftable td {
    padding: 2px 6px;
  }
  /* 树形图：竖线连着各个分叉 */
  .ftree {
    list-style: none;
    margin: 0;
    padding: 0 0 0 10px;
  }
  .ftree li {
    position: relative;
    padding-inline-start: 16px;
  }
  .ftree li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-inline-start: 1px solid var(--border-strong);
  }
  .ftree li:last-child::before {
    bottom: auto;
    height: 14px;
  }
  .ftree li::after {
    content: '';
    position: absolute;
    left: 0;
    top: 14px;
    width: 12px;
    border-top: 1px solid var(--border-strong);
  }
  .tnode {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 2px 0;
    padding: 1px 9px 1px 5px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .tnode:hover {
    background: var(--bg-hover);
  }
  .tleaf {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
    min-height: 22px;
  }
  .tname {
    min-width: 60px;
  }
</style>
