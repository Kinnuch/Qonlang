<script lang="ts">
  /** 标签输入：芯片 + 输入框，回车 / 逗号提交，退格删最后一个，带已有标签提示 */
  import { X } from '@lucide/svelte'
  import { sortable } from '$lib/ui/sortable.svelte'
  import { moveItem } from '$lib/core/move'
  import { badgeColorStyle } from '$lib/core/lexemeColors'
  import { t } from '$lib/i18n/index.svelte'
  import BadgeColorPicker from './BadgeColorPicker.svelte'

  let {
    tags = $bindable<string[]>([]),
    suggestions = [],
    placeholder = '',
    colorOf,
    oncolor,
    readOnly = false,
    onchange
  }: {
    tags?: string[]
    suggestions?: string[]
    placeholder?: string
    colorOf?: (tag: string) => string | undefined
    oncolor?: (tag: string, color: string | undefined) => void
    readOnly?: boolean
    /** 改完之后调用，带上现在的标签（没绑定 tags 时拿它写回去） */
    onchange?: (tags: string[]) => void
  } = $props()

  let text = $state('')
  let pendingColor = $state<string | undefined>(undefined)
  const listId = `tags-${Math.random().toString(36).slice(2, 8)}`
  function reorder(from: number, to: number): void {
    if (readOnly) return
    if (moveItem(tags, from, to)) onchange?.(tags)
  }

  function commit(): void {
    if (readOnly) return
    const parts = text
      .split(/[,，、;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length) {
      const added: string[] = []
      for (const p of parts)
        if (!tags.includes(p)) {
          tags.push(p)
          added.push(p)
        }
      if (pendingColor) for (const tag of added) oncolor?.(tag, pendingColor)
      onchange?.(tags)
      pendingColor = undefined
    }
    text = ''
  }
  function remove(i: number): void {
    if (readOnly) return
    tags.splice(i, 1)
    onchange?.(tags)
  }
  function leave(event: FocusEvent): void {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.contains(event.relatedTarget)
    )
      return
    commit()
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

<div class="tags input" onfocusout={leave}>
  {#each tags as tg, i (tg + i)}
    <span class="tag-token"
      ><span
        class="tagchip"
        style={badgeColorStyle(colorOf?.(tg))}
        data-lexicon-tag={oncolor ? tg : undefined}
        {...sortable(listId, i, reorder)}
        >{tg}<button
          type="button"
          aria-label={t('common.delete')}
          disabled={readOnly}
          onclick={() => remove(i)}><X size={11} /></button
        ></span
      >{#if oncolor}<BadgeColorPicker
          value={colorOf?.(tg)}
          label={t('badgeColors.tag', { name: tg })}
          {readOnly}
          dataKey={'tag:' + tg}
          onchange={(color) => oncolor?.(tg, color)}
        />{/if}</span
    >
  {/each}
  <input list={listId} bind:value={text} {placeholder} disabled={readOnly} onkeydown={onKey} />
  {#if oncolor}<BadgeColorPicker
      value={pendingColor}
      label={t('badgeColors.newTag')}
      {readOnly}
      dataKey="new-tag"
      onchange={(color) => (pendingColor = color)}
    />{/if}
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
  .tag-token {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .tagchip button {
    border: 0;
    background: none;
    padding: 2px;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: inherit;
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
