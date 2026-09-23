<script lang="ts">
  /**
   * 从一长串东西里挑几个：选中的排成一个个圆框（点 × 去掉），下面的框输入即可搜，点结果加进来。
   * 「导出学习包」里挑一课的新词、例句、短语用它。
   */
  import { X } from '@lucide/svelte'
  import { t } from '$lib/i18n/index.svelte'

  export interface PickItem {
    id: string
    label: string
    /** 淡色的补充（释义、译文） */
    sub?: string
  }

  let {
    items,
    selected,
    onchange,
    dataFont = false
  }: {
    items: PickItem[]
    selected: string[]
    onchange: (ids: string[]) => void
    /** label 用语言数据字体显示 */
    dataFont?: boolean
  } = $props()

  const LIMIT = 30
  const LIST_MAX = 260
  let query = $state('')
  let open = $state(false)
  let input = $state<HTMLInputElement | null>(null)
  /** 结果列表按输入框的位置固定定位（滚动区里用绝对定位会把滚动区撑高），下面放不下就翻到上面 */
  let place = $state({ left: 0, top: 0, width: 0, up: false })
  function measure(): void {
    if (!input) return
    const r = input.getBoundingClientRect()
    const up = window.innerHeight - r.bottom < LIST_MAX + 8 && r.top > LIST_MAX + 8
    place = { left: r.left, top: up ? r.top - 2 : r.bottom + 2, width: r.width, up }
  }
  const byId = $derived(new Map(items.map((x) => [x.id, x])))
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const taken = new Set(selected)
    return items.filter(
      (x) =>
        !taken.has(x.id) &&
        (!q || x.label.toLowerCase().includes(q) || (x.sub ?? '').toLowerCase().includes(q))
    )
  })

  function add(id: string): void {
    onchange([...selected, id])
    query = ''
  }
</script>

<svelte:window onscrollcapture={() => open && measure()} onresize={() => open && measure()} />

<div class="picker">
  {#if selected.length}
    <div class="chips">
      {#each selected as id (id)}
        {@const x = byId.get(id)}
        {#if x}
          <span class="chip" title={x.sub}>
            <span class:data={dataFont}>{x.label}</span>
            <button
              class="x"
              aria-label={t('studyExport.picker.remove')}
              onclick={() => onchange(selected.filter((y) => y !== id))}><X size={12} /></button
            >
          </span>
        {/if}
      {/each}
    </div>
  {/if}
  <input
    bind:this={input}
    class="input"
    placeholder={t('studyExport.picker.search')}
    bind:value={query}
    onfocus={() => {
      measure()
      open = true
    }}
    onblur={() => setTimeout(() => (open = false), 150)}
  />
  {#if open}
    <ul
      class="results card"
      class:up={place.up}
      style:left="{place.left}px"
      style:top="{place.top}px"
      style:width="{place.width}px"
      style:max-height="{LIST_MAX}px"
    >
      {#each matches.slice(0, LIMIT) as x (x.id)}
        <li>
          <button onmousedown={(e) => e.preventDefault()} onclick={() => add(x.id)}>
            <span class:data={dataFont}>{x.label}</span>
            {#if x.sub}<span class="small muted">{x.sub}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="small muted none">{t('studyExport.picker.none')}</li>
      {/each}
      {#if matches.length > LIMIT}
        <li class="small muted none">
          {t('studyExport.picker.more', { n: matches.length - LIMIT })}
        </li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 4px 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-sunken);
    font-size: 13px;
  }
  .x {
    display: inline-grid;
    place-items: center;
    border: none;
    background: none;
    padding: 2px;
    color: var(--text-3);
    cursor: pointer;
  }
  .x:hover {
    color: var(--danger);
  }
  .results {
    position: fixed;
    z-index: 300;
    margin: 0;
    padding: 4px;
    list-style: none;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
  }
  .results.up {
    transform: translateY(-100%);
  }
  .results button {
    width: 100%;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    text-align: start;
    cursor: pointer;
  }
  .results button:hover {
    background: var(--bg-hover);
  }
  .none {
    padding: 4px 8px;
  }
</style>
