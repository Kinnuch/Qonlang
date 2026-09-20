<script lang="ts">
  /**
   * 收藏用的五角星：当勾选框使，收藏了就把中间填成黄色。
   * 词库列表左边那一格用它（平时淡，鼠标扫过才看得见），录入表单里也用同一个。
   */
  import { Star } from '@lucide/svelte'

  let {
    on,
    onchange,
    title,
    size = 14,
    label
  }: {
    on: boolean
    onchange: (next: boolean) => void
    title?: string
    size?: number
    /** 给了就在星星后面写一行字（录入表单里当勾选框用） */
    label?: string
  } = $props()
</script>

<button
  class="star"
  class:on
  class:labeled={label !== undefined}
  type="button"
  role="checkbox"
  aria-checked={on}
  aria-label={title ?? label}
  {title}
  onclick={(e) => {
    e.stopPropagation()
    onchange(!on)
  }}
>
  <!-- 中间不留空白：这里的空白文本节点会在列表里画出一个点来 -->
  <Star {size} />{#if label !== undefined}<span>{label}</span>{/if}
</button>

<style>
  .star {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
    line-height: 1;
  }
  .star.labeled {
    padding: 2px 6px 2px 4px;
    font: inherit;
    color: var(--text);
  }
  .star:hover {
    color: var(--warn);
  }
  .star.labeled:hover {
    background: var(--bg-hover);
  }
  /* 收藏了：描边跟着变，中间填满 */
  .star.on {
    color: var(--warn);
  }
  .star.on :global(svg) {
    fill: var(--warn);
  }
</style>
