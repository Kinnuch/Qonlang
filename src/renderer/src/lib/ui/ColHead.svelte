<script lang="ts">
  /**
   * 表头单元格：点标题按这一列排序（降序 ▼ → 升序 ▲ → 取消），
   * 右侧的漏斗打开筛选面板（全选 / 全不选 / 逐项勾）。
   * `children` 放列宽把手之类的附件。
   */
  import { tick, type Snippet } from 'svelte'
  import { newId } from '$lib/core/factory'
  import { pickFilterOption } from './colHeadFilter'
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
    extraFilterActive = false,
    onfilter,
    onjump,
    canjump,
    filterTools,
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
    extraFilterActive?: boolean
    onfilter?: (sel: Set<string> | null) => void
    /** 有此回调时，字母文字只负责跳转，勾选框才改变筛选。 */
    onjump?: (value: string) => void
    canjump?: (value: string) => boolean
    filterTools?: Snippet
    children?: Snippet
  } = $props()

  let open = $state(false)
  let query = $state('')
  let panel = $state<HTMLElement | null>(null)
  let btn = $state<HTMLElement | null>(null)
  let panelStyle = $state('')
  const panelId = `column-filter-${newId()}`

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const all = options ?? []
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all
  })
  const active = $derived(extraFilterActive || (selected !== null && selected !== undefined))

  function toggle(e: MouseEvent): void {
    e.stopPropagation()
    open = !open
    query = ''
    if (open && btn) {
      const r = btn.getBoundingClientRect()
      const width = Math.min(filterTools ? 410 : 240, window.innerWidth - 16)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
      panelStyle = `left:${left}px;top:${r.bottom + 4}px`
      void tick().then(() => panel?.querySelector<HTMLElement>('button, input')?.focus())
    }
  }
  function pick(v: string, on: boolean): void {
    onfilter?.(
      pickFilterOption(
        (options ?? []).map((o) => o.value),
        selected,
        v,
        on
      )
    )
  }
  function all(): void {
    onfilter?.(null)
  }
  function none(): void {
    onfilter?.(new Set())
  }
  const isOn = (v: string): boolean => !selected || selected.has(v)
  function jump(value: string): void {
    if (!onjump || canjump?.(value) === false) return
    open = false
    btn?.focus()
    onjump(value)
  }

  /**
   * 面板挪到 <body> 底下再定位：留在表头里时，外面的滚动容器、检视器会把它裁掉一截。
   */
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
      if (e.key === 'Escape') {
        e.preventDefault()
        open = false
        btn?.focus()
      }
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
      aria-label={`${label} · ${t('table.filterHint')}`}
      aria-expanded={open}
      aria-controls={panelId}
      onclick={toggle}><Filter size={11} /></button
    >
  {/if}
  {@render children?.()}
</div>

{#if open && options}
  <div
    id={panelId}
    class="panel card"
    class:with-tools={!!filterTools}
    use:toBody
    bind:this={panel}
    style={panelStyle}
    role="dialog"
    aria-label={`${label} · ${t('table.filterHint')}`}
  >
    <div class="row tools">
      <button class="btn ghost sm" onclick={all}>{t('table.selectAll')}</button>
      <button class="btn ghost sm" onclick={none}>{t('table.selectNone')}</button>
      {#if filterTools}<div class="filter-tools">{@render filterTools()}</div>{/if}
      <span class="grow"></span>
      <span class="small muted">{options.length}</span>
    </div>
    {#if options.length > 8}
      <input class="input sm" placeholder={t('common.search')} bind:value={query} />
    {/if}
    <div class="opts">
      {#each shown as o (o.value)}
        {#if onjump}
          <div class="opt jump-option">
            <label class="option-check">
              <input
                type="checkbox"
                data-filter-option={o.value}
                checked={isOn(o.value)}
                aria-label={t('lexicon.filterLetter', { value: o.label || '—' })}
                onchange={(e) => pick(o.value, e.currentTarget.checked)}
              />
            </label>
            <button
              class="option-jump grow"
              data-filter-jump={o.value}
              disabled={canjump?.(o.value) === false}
              aria-label={t('lexicon.jumpToLetter', { value: o.label || '—' })}
              title={canjump?.(o.value) === false
                ? t('lexicon.letterJumpUnavailable')
                : t('lexicon.jumpToLetter', { value: o.label || '—' })}
              onclick={() => jump(o.value)}>{o.label || '—'}</button
            >
            {#if o.count !== undefined}<span class="small muted">{o.count}</span>{/if}
          </div>
        {:else}
          <label class="opt">
            <input
              type="checkbox"
              data-filter-option={o.value}
              checked={isOn(o.value)}
              onchange={(e) => pick(o.value, (e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="grow">{o.label || '—'}</span>
            {#if o.count !== undefined}<span class="small muted">{o.count}</span>{/if}
          </label>
        {/if}
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
    text-align: start;
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
    /* 比检视器、面板都高：筛选面板不该被它们盖住 */
    z-index: 300;
    width: 240px;
    max-width: calc(100vw - 16px);
    max-height: 320px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    box-shadow: var(--shadow-lg);
    font-weight: normal;
    text-align: start;
  }
  .tools {
    gap: 4px;
    flex-wrap: wrap;
  }
  .panel.with-tools {
    width: 410px;
  }
  .filter-tools {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    max-width: 100%;
    min-width: 0;
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
  .jump-option {
    cursor: default;
  }
  .option-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 3px;
  }
  .option-check input {
    margin: 0;
  }
  .option-jump {
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
    padding: 3px 1px;
    cursor: pointer;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .option-jump:hover:not(:disabled) {
    color: var(--accent-text);
    text-decoration: underline;
  }
  .option-jump:disabled {
    color: var(--text-3);
    opacity: 0.55;
    cursor: default;
  }
  .option-jump:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-radius: 2px;
  }
  .input.sm {
    padding: 3px 8px;
    font-size: 12px;
  }
</style>
