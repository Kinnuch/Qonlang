<script lang="ts">
  /**
   * 把子内容渲染到检视器插槽（#inspector-slot）里。
   * 视图组件用它往右栏放编辑表单，而不必层层传 props。
   */
  import type { Snippet } from 'svelte'

  let { children, target = '#inspector-slot' }: { children: Snippet; target?: string } = $props()

  function portal(node: HTMLElement): { destroy(): void } {
    const host = document.querySelector(target)
    if (host) host.appendChild(node)
    return {
      destroy() {
        node.remove()
      }
    }
  }
</script>

<div use:portal class="portal">
  {@render children()}
</div>

<style>
  .portal {
    display: contents;
  }
</style>
