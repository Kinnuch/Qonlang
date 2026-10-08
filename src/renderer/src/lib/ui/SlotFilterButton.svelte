<script lang="ts">
  /**
   * 构形页槽位表头的漏斗：点开按启用 / 停用、按维度的取值筛槽位，
   * 筛出来的一批可以一下子全部启用或停用。筛选本身只影响显示，由页面记着（见 lib/ui/slotFilter.ts）。
   */
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { Filter } from '@lucide/svelte'
  import HelpDot from './HelpDot.svelte'
  import {
    NO_SLOT_FILTER,
    slotFilterActive,
    toggleSlotFilterValue,
    type SlotFilter,
    type SlotFilterDim
  } from './slotFilter'

  let {
    dims,
    filter,
    onchange,
    counts,
    shown,
    total,
    onbatch,
    glossLangs
  }: {
    dims: SlotFilterDim[]
    filter: SlotFilter
    onchange: (f: SlotFilter) => void
    /** 不算启用 / 停用时筛出来几格，其中启用的、停用的各几格 */
    counts: { all: number; on: number; off: number }
    /** 眼下列表里显示几格、这个构形一共几格 */
    shown: number
    total: number
    /** 把眼下显示的这些格全部启用（true）或停用（false） */
    onbatch: (on: boolean) => void
    glossLangs: string[]
  } = $props()

  let open = $state(false)
  let btn = $state<HTMLElement | null>(null)
  let panel = $state<HTMLElement | null>(null)
  let panelStyle = $state('')
  const active = $derived(slotFilterActive(filter))
  const states = $derived([
    { st: 'all' as const, n: counts.all },
    { st: 'on' as const, n: counts.on },
    { st: 'off' as const, n: counts.off }
  ])

  const W = 340
  /** 贴着漏斗放在下面；页面滚动、窗口缩放时跟着挪 */
  function place(): void {
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
    const top = r.bottom + 4
    panelStyle = `left:${left}px;top:${top}px;width:${W}px;max-height:${Math.max(160, window.innerHeight - top - 12)}px`
  }
  function toggle(e: MouseEvent): void {
    e.stopPropagation()
    open = !open
    if (open) place()
  }
  const valueName = (d: SlotFilterDim, id: string): { name: string; abbr: string } => {
    const v = d.category.values.find((x) => x.id === id)
    return { name: (v && (pickText(v.name, glossLangs) || v.abbr)) || '?', abbr: v?.abbr ?? '' }
  }
  const picked = (d: SlotFilterDim, id: string): boolean => !!filter.values[d.id]?.includes(id)

  /** 面板挪到 <body> 底下再定位：留在表头里会被外面的滚动区裁掉 */
  function toBody(node: HTMLElement): { destroy(): void } {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  $effect(() => {
    if (!open) return
    const down = (e: PointerEvent): void => {
      const tg = e.target as Node
      if (panel && !panel.contains(tg) && btn && !btn.contains(tg)) open = false
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') open = false
    }
    // 滚动不收起：筛完列表变短时滚动区会自己往回滚一下，收起的话点着点着面板就没了
    const follow = (): void => place()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  })
</script>

<button
  class="funnel"
  class:on={active}
  class:open
  bind:this={btn}
  title={t('paradigms.slotFilter.button')}
  aria-label={t('paradigms.slotFilter.button')}
  aria-expanded={open}
  onclick={toggle}><Filter size={13} /></button
>

{#if open}
  <div
    class="panel card"
    use:toBody
    bind:this={panel}
    style={panelStyle}
    role="dialog"
    aria-label={t('paradigms.slotFilter.button')}
  >
    <div class="row top">
      <b class="small">{t('paradigms.slotFilter.button')}</b>
      <HelpDot tip={t('paradigms.slotFilter.hint')} />
      <span class="grow"></span>
      {#if active}<button class="btn ghost sm" onclick={() => onchange(NO_SLOT_FILTER)}
          >{t('paradigms.clearFilter')}</button
        >{/if}
    </div>
    <div class="frow">
      <span class="flabel small muted">{t('paradigms.slotFilter.state')}</span>
      <div class="seg">
        {#each states as x (x.st)}
          <button
            class:active={filter.state === x.st}
            onclick={() => onchange({ ...filter, state: x.st })}
            >{t(`paradigms.slotFilter.${x.st}`)}<span class="n">{x.n}</span></button
          >
        {/each}
      </div>
    </div>
    {#each dims as d (d.id)}
      <div class="frow">
        <span class="flabel small muted" title={pickText(d.category.name, glossLangs)}
          >{pickText(d.category.name, glossLangs) || '?'}</span
        >
        <div class="vals">
          {#each d.valueIds as id (id)}
            {@const v = valueName(d, id)}
            <button
              class="vchip"
              class:on={picked(d, id)}
              aria-pressed={picked(d, id)}
              title={v.abbr && v.abbr !== v.name ? v.abbr : undefined}
              onclick={() => onchange(toggleSlotFilterValue(filter, d.id, id))}>{v.name}</button
            >
          {/each}
        </div>
      </div>
    {/each}
    <div class="row foot">
      <span class="small muted grow">{t('paradigms.slotFilter.shown', { n: shown, total })}</span>
      <button class="btn sm" disabled={!shown} onclick={() => onbatch(true)}
        >{t('paradigms.slotFilter.enableShown', { n: shown })}</button
      >
      <button class="btn sm" disabled={!shown} onclick={() => onbatch(false)}
        >{t('paradigms.slotFilter.disableShown', { n: shown })}</button
      >
    </div>
  </div>
{/if}

<style>
  .funnel {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: none;
    padding: 2px;
    border-radius: 4px;
    color: var(--text-3);
    cursor: pointer;
  }
  .funnel:hover,
  .funnel.open {
    color: var(--text);
    background: var(--bg-hover);
  }
  /* 筛着的时候：漏斗一直亮着，换到别的看法、收起面板都看得出来 */
  .funnel.on {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .panel {
    position: fixed;
    /* 比检视器、面板都高 */
    z-index: 300;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    overflow: auto;
    box-shadow: var(--shadow-lg);
    font-weight: normal;
    text-align: start;
    white-space: normal;
  }
  .top {
    gap: 4px;
    min-height: 26px;
  }
  .frow {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 8px;
    align-items: start;
  }
  .flabel {
    padding-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .seg {
    justify-self: start;
  }
  .seg .n {
    margin-inline-start: 4px;
    font-size: 11px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .seg button.active .n {
    color: inherit;
  }
  .vals {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .vchip {
    padding: 2px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
    color: var(--text-2);
    font: inherit;
    font-size: 12px;
    line-height: 1.5;
    cursor: pointer;
  }
  .vchip:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .vchip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .foot {
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
</style>
