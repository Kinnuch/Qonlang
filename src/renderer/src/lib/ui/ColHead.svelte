<script lang="ts">
  /**
   * 表头单元格：点标题按这一列排序（降序 ▼ → 升序 ▲ → 取消），
   * 右侧的漏斗打开筛选面板（全选 / 全不选 / 逐项勾）。
   * `children` 放列宽把手之类的附件。
   */
  import type { Snippet } from 'svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { Filter, ChevronDown, ChevronUp } from '@lucide/svelte'

  export interface FilterOption {
    value: string
    label: string
    count?: number
  }

  let {
    label,
    sort = null,
    onsort,
    options,
    selected = null,
    onfilter,
    children
  }: {
    label: string
    /** 这一列当前的排序方向 */
    sort?: 'asc' | 'desc' | null
    onsort?: () => void
    /** 可筛选的取值；不给就没有漏斗 */
    options?: FilterOption[]
    /** 选中的取值集合；null 表示不筛 */
    selected?: Set<string> | null
    onfilter?: (sel: Set<string> | null) => void
    children?: Snippet
  } = $props()

  let open = $state(false)
  let query = $state('')
  let panel = $state<HTMLElement | null>(null)
  let btn = $state<HTMLElement | null>(null)
  let panelStyle = $state('')

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const all = options ?? []
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all
  })
  const active = $derived(selected !== null && selected !== undefined)

  function toggle(e: MouseEvent): void {
    e.stopPropagation()
    open = !open
    query = ''
    if (open && btn) {
      const r = btn.getBoundingClientRect()
      const left = Math.min(r.left, window.innerWidth - 260)
      panelStyle = `left:${left}px;top:${r.bottom + 4}px`
    }
  }
  function pick(v: string, on: boolean): void {
    const all = new Set((options ?? []).map((o) => o.value))
    const cur = new Set(selected ?? all)
    if (on) cur.add(v)
    else cur.delete(v)
    // 全都勾上等于不筛
    onfilter?.(cur.size === all.size ? null : cur)
  }
  function all(): void {
    onfilter?.(null)
  }
  function none(): void {
    onfilter?.(new Set())
  }
  const isOn = (v: string): boolean => !selected || selected.has(v)

  $effect(() => {
    if (!open) return
    const down = (e: PointerEvent): void => {
      const tg = e.target as Node
      if (panel && !panel.contains(tg) && btn && !btn.contains(tg)) open = false
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') open = false
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  })
</script>

<div class="head" class:sorted={!!sort} class:filtered={active}>
  <button class="title" onclick={() => onsort?.()} title={t('table.sortHint')}>
    <span>{label}</span>
    {#if sort === 'desc'}<ChevronDown size={12} />{:else if sort === 'asc'}<ChevronUp
        size={12}
      />{/if}
  </button>
  {#if options}
    <button
      class="funnel"
      class:on={active}
      bind:this={btn}
      title={t('table.filterHint')}
      onclick={toggle}><Filter size={11} /></button
    >
  {/if}
  {@render children?.()}
</div>

{#if open && options}
  <div class="panel card" bind:this={panel} style={panelStyle} role="dialog">
    <div class="row tools">
      <button class="btn ghost sm" onclick={all}>{t('table.selectAll')}</button>
      <button class="btn ghost sm" onclick={none}>{t('table.selectNone')}</button>
      <span class="grow"></span>
      <span class="small muted">{options.length}</span>
    </div>
    {#if options.length > 8}
      <input class="input sm" placeholder={t('common.search')} bind:value={query} />
    {/if}
    <div class="opts">
      {#each shown as o (o.value)}
        <label class="opt">
          <input
            type="checkbox"
            checked={isOn(o.value)}
            onchange={(e) => pick(o.value, (e.currentTarget as HTMLInputElement).checked)}
          />
          <span class="grow">{o.label || '—'}</span>
          {#if o.count !== undefined}<span class="small muted">{o.count}</span>{/if}
        </label>
      {:else}
        <span class="small muted">{t('common.noResults')}</span>
      {/each}
    </div>
  </div>
{/if}

<style>
  .head {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }
  .title:hover {
    color: var(--accent-text);
  }
  .sorted .title {
    color: var(--accent-text);
  }
  .funnel {
    display: inline-flex;
    border: 0;
    background: none;
    padding: 2px;
    border-radius: 4px;
    color: var(--text-3);
    cursor: pointer;
    opacity: 0.55;
  }
  .head:hover .funnel,
  .funnel.on {
    opacity: 1;
  }
  .funnel.on {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .panel {
    position: fixed;
    z-index: 80;
    width: 240px;
    max-height: 320px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    box-shadow: var(--shadow-lg);
    font-weight: normal;
    text-align: left;
  }
  .tools {
    gap: 4px;
  }
  .opts {
    overflow: auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 13px;
  }
  .opt:hover {
    background: var(--bg-hover);
  }
  .input.sm {
    padding: 3px 8px;
    font-size: 12px;
  }
</style>
