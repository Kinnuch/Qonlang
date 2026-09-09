<script lang="ts">
  /**
   * 点击展开的下拉菜单：点外部 / Esc 关闭；自动靠左或靠右对齐以免超出窗口。
   * 用法：<Menu label="导出" icon={Download}> <button onclick=…>…</button> </Menu>
   */
  import type { Component, Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'

  let {
    label,
    icon: Icon,
    children,
    primary = false,
    small = false,
    wide = false
  }: {
    label: string
    icon?: Component<{ size?: number }>
    children: Snippet
    primary?: boolean
    small?: boolean
    wide?: boolean
  } = $props()

  let open = $state(false)
  let alignLeft = $state(false)
  let root = $state<HTMLDivElement | null>(null)

  function toggle(): void {
    open = !open
    if (open && root) {
      const r = root.getBoundingClientRect()
      // 菜单默认右对齐；若按钮靠左（右对齐会伸出左边），改为左对齐
      alignLeft = r.left < 260
    }
  }
  $effect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (root && !root.contains(e.target as Node)) open = false
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') open = false
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

<div class="menu" bind:this={root}>
  <button class="btn" class:primary class:sm={small} class:active={open} onclick={toggle}>
    {#if Icon}<Icon size={small ? 14 : 16} />{/if}{label}<ChevronDown size={12} class="chev" />
  </button>
  {#if open}
    <div
      class="menu-list card"
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
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .menu-list :global(button) {
    text-align: left;
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
