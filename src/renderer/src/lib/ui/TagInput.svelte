<script lang="ts">
  /** 标签输入：芯片 + 输入框，回车 / 逗号提交，退格删最后一个，带已有标签提示 */
  import { X } from '@lucide/svelte'

  let {
    tags = $bindable<string[]>([]),
    suggestions = [],
    placeholder = '',
    onchange
  }: { tags?: string[]; suggestions?: string[]; placeholder?: string; onchange?: () => void } = $props()

  let text = $state('')
  const listId = `tags-${Math.random().toString(36).slice(2, 8)}`

  function commit(): void {
    const parts = text
      .split(/[,，、;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length) {
      for (const p of parts) if (!tags.includes(p)) tags.push(p)
      onchange?.()
    }
    text = ''
  }
  function remove(i: number): void {
    tags.splice(i, 1)
    onchange?.()
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !text && tags.length) {
      remove(tags.length - 1)
    }
  }
</script>

<div class="tags input">
  {#each tags as tg, i (tg + i)}
    <span class="tagchip">{tg}<button type="button" aria-label="remove" onclick={() => remove(i)}><X size={11} /></button></span>
  {/each}
  <input list={listId} bind:value={text} {placeholder} onkeydown={onKey} onblur={commit} />
  <datalist id={listId}>
    {#each suggestions.filter((s) => !tags.includes(s)) as s (s)}<option value={s}></option>{/each}
  </datalist>
</div>

<style>
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    padding: 4px 6px;
    min-height: 34px;
  }
  .tags:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .tagchip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 4px 1px 8px;
    border-radius: 999px;
    background: var(--bg-sunken);
    font-size: 12px;
  }
  .tagchip button {
    border: 0;
    background: none;
    padding: 2px;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--text-3);
    border-radius: 50%;
  }
  .tagchip button:hover {
    color: var(--danger);
  }
  input {
    flex: 1;
    min-width: 80px;
    border: 0;
    outline: none;
    background: transparent;
    padding: 2px;
  }
</style>
