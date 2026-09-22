<script lang="ts">
  /** 文档里插入链接：先挑类型，再搜名字，选中就把 `[[…]]` 写进光标处。 */
  import { projectState } from '$lib/state/project.svelte'
  import { t, i18n } from '$lib/i18n/index.svelte'
  import {
    docLinkCandidates,
    formatDocLink,
    type DocLinkCandidate,
    type DocLinkKind
  } from '$lib/core/docLinks'
  import { Search, CornerDownLeft } from '@lucide/svelte'

  let { onpick, onclose }: { onpick: (text: string) => void; onclose: () => void } = $props()

  /** 类型按左侧模块的先后排 */
  const KINDS: DocLinkKind[] = [
    'lexeme',
    'morpheme',
    'language',
    'ruleSet',
    'paradigm',
    'script',
    'sentence',
    'phrase',
    'doc'
  ]
  /** 这几类用数据字体显示 */
  const DATA_KINDS = new Set<DocLinkKind>(['lexeme', 'morpheme', 'sentence', 'phrase'])

  const project = $derived(projectState.project!)
  let kind = $state<DocLinkKind>('lexeme')
  let query = $state('')
  let cursor = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)

  $effect(() => {
    queueMicrotask(() => inputEl?.focus())
  })

  const all = $derived(docLinkCandidates(project, kind))
  const list = $derived.by((): DocLinkCandidate[] => {
    const q = query.trim().toLowerCase()
    const rows = q
      ? all.filter((c) => `${c.name} ${c.sub} ${c.detail}`.toLowerCase().includes(q))
      : all
    return rows.slice(0, 50)
  })
  $effect(() => {
    if (cursor >= list.length) cursor = Math.max(0, list.length - 1)
  })

  function choose(c: DocLinkCandidate): void {
    onpick(formatDocLink(c.kind, c.name, c.sub, i18n.locale))
    onclose()
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      cursor = Math.min(list.length - 1, cursor + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      cursor = Math.max(0, cursor - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = list[cursor]
      if (c) choose(c)
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="picker card" role="dialog" aria-modal="true" aria-label={t('docs.insertLink')}>
  <div class="row head">
    <Search size={16} />
    <input
      bind:this={inputEl}
      class="q"
      placeholder={t('docs.linkSearch')}
      bind:value={query}
      onkeydown={onKey}
      oninput={() => (cursor = 0)}
    />
    <span class="kbd">Esc</span>
  </div>
  <div class="row kinds">
    {#each KINDS as k (k)}
      <button
        class="chip"
        class:active={kind === k}
        onclick={() => {
          kind = k
          cursor = 0
          inputEl?.focus()
        }}>{t(`docs.kinds.${k}`)}</button
      >
    {/each}
  </div>
  <ul class="list">
    {#each list as c, i (c.kind + c.name + c.sub)}
      <li>
        <button
          class="item"
          class:active={i === cursor}
          onmouseenter={() => (cursor = i)}
          onclick={() => choose(c)}
        >
          <span class="grow ellip"
            ><span class="ttl" class:data={DATA_KINDS.has(c.kind)}
              >{c.name}{#if c.sub}<span class="sep"> › </span>{c.sub}{/if}</span
            >{#if c.detail}<span class="sub">{c.detail}</span>{/if}</span
          >
          {#if i === cursor}<CornerDownLeft size={13} />{/if}
        </button>
      </li>
    {/each}
    {#if list.length === 0}<li class="none muted small">{t('common.none')}</li>{/if}
  </ul>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.18);
  }
  .picker {
    position: fixed;
    z-index: 81;
    left: 50%;
    top: 14vh;
    transform: translateX(-50%);
    width: min(560px, 90vw);
    max-height: 66vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .head {
    padding: 10px 14px;
    gap: 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text-3);
  }
  .q {
    flex: 1;
    border: 0;
    background: none;
    font: inherit;
    font-size: 15px;
    color: var(--text);
    outline: none;
  }
  .kbd {
    font-size: 11px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 5px;
  }
  .kinds {
    gap: 4px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .chip {
    border: 1px solid var(--border);
    background: none;
    color: var(--text-2);
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 12px;
    cursor: pointer;
  }
  .chip:hover {
    background: var(--bg-hover);
  }
  .chip.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow: auto;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: start;
    border: 0;
    background: none;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text);
    font: inherit;
  }
  .item.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ellip {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .ttl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ttl.data {
    font-family: var(--font-data);
  }
  .sep {
    color: var(--text-3);
  }
  .sub {
    font-size: 11px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    padding: 10px;
  }
</style>
