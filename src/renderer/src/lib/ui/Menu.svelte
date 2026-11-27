<script lang="ts">
  /**
   * 点击展开的下拉菜单：点外部 / Esc 关闭；自动靠左或靠右对齐以免超出窗口。
   * 用法：<Menu label="导出" icon={Download}> <button onclick=…>…</button> </Menu>
   */
  import { tick, type Component, type Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'
  import { anchoredFloating } from './anchoredFloating'

  let {
    label,
    icon: Icon,
    children,
    primary = false,
    small = false,
    wide = false,
    tour = '',
    iconOnly = false,
    floating = false
  }: {
    label: string
    icon?: Component<{ size?: number }>
    children: Snippet
    primary?: boolean
    small?: boolean
    wide?: boolean
    /** 图文引导要圈这个菜单时给它一个记号（落成 data-tour） */
    tour?: string
    iconOnly?: boolean
    floating?: boolean
  } = $props()

  let open = $state(false)
  let alignLeft = $state(false)
  let root = $state<HTMLDivElement | null>(null)
  let panel = $state<HTMLDivElement | null>(null)
  function placeMenu(node: HTMLElement): ReturnType<typeof anchoredFloating> | undefined {
    return floating
      ? anchoredFloating(node, {
          anchor: root,
          width: wide ? 280 : 220,
          align: 'end',
          onAnchorHidden: () => (open = false)
        })
      : undefined
  }

  async function toggle(event: MouseEvent): Promise<void> {
    open = !open
    if (open && root) {
      const r = root.getBoundingClientRect()
      // 菜单默认右对齐；若按钮靠左（右对齐会伸出左边），改为左对齐
      alignLeft = r.left < 260
      if (floating && event.detail === 0) {
        await tick()
        panel?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus()
      }
    }
  }
  $effect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (root && !root.contains(e.target as Node) && !panel?.contains(e.target as Node))
        open = false
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        open = false
        if (floating) root?.querySelector('button')?.focus()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  })
  // 菜单里点了按钮就收起
  function onListClick(e: MouseEvent): void {
    const el = e.target as HTMLElement
    if (el.closest('button') && !el.closest('[data-keep-open]')) open = false
  }
</script>

<div class="menu" bind:this={root} data-tour={tour || null}>
  <button
    class="btn"
    class:primary
    class:sm={small}
    class:active={open}
    class:icon={iconOnly}
    title={iconOnly ? label : undefined}
    aria-label={label}
    aria-expanded={open}
    aria-haspopup="menu"
    onclick={toggle}
  >
    {#if Icon}<Icon size={small ? 14 : 16} />{/if}{#if !iconOnly}{label}<ChevronDown
        size={12}
        class="chev"
      />{/if}
  </button>
  {#if open}
    <div
      class="menu-list card"
      class:floating
      bind:this={panel}
      use:placeMenu
      class:left={alignLeft}
      class:wide
      role="menu"
      tabindex="-1"
      onclick={onListClick}
      onkeydown={() => {}}
    >
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
  }
  .menu-list {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 220px;
    padding: 4px;
    z-index: 30;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    animation: rise 0.12s ease-out;
  }
  .menu-list.left {
    right: auto;
    left: 0;
  }
  .menu-list.wide {
    min-width: 280px;
    max-height: 400px;
    overflow: auto;
  }
  .menu-list.floating {
    right: auto;
    min-width: 0;
    z-index: 400;
    overflow: auto;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .menu-list :global(button) {
    text-align: start;
    border: 0;
    background: transparent;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text);
    font: inherit;
  }
  .menu-list :global(button:hover) {
    background: var(--bg-hover);
  }
  .menu-list :global(label) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .menu-list :global(label:hover) {
    background: var(--bg-hover);
  }
  .btn.active {
    border-color: var(--accent);
  }
  .btn :global(.chev) {
    opacity: 0.6;
  }
</style>
