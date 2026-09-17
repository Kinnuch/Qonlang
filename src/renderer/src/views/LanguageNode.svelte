<script lang="ts">
  /** 语言树的一个节点：语系 / 语族 / 语支节点，或者一门语言（带着它的历时阶段） */
  import type { Id } from '$lib/core/model'
  import type { TreeItem } from '$lib/core/languageTree'
  import { stageShort } from '$lib/core/languageTree'
  import { t } from '$lib/i18n/index.svelte'
  import LanguageNode from './LanguageNode.svelte'
  import { Plus, Network } from '@lucide/svelte'

  let {
    item,
    visible = null,
    selectedId,
    defaultId,
    onselect,
    onaddchild,
    depth = 0
  }: {
    item: TreeItem
    /** 顶栏搜索筛出来的可见节点（语言与分类节点的 id）；null 表示不筛 */
    visible?: Set<Id> | null
    selectedId: Id | null
    defaultId: Id | null
    onselect: (id: Id, kind: 'group' | 'language') => void
    onaddchild: (id: Id, kind: 'group' | 'language') => void
    depth?: number
  } = $props()

  const id = $derived(item.kind === 'group' ? item.group.id : item.language.id)
  const kids = $derived(
    item.children.filter(
      (c) => !visible || visible.has(c.kind === 'group' ? c.group.id : c.language.id)
    )
  )
</script>

<div class="node" style:--depth={depth}>
  <div
    class="card lang"
    class:group={item.kind === 'group'}
    class:selected={selectedId === id}
    role="button"
    tabindex="0"
    onclick={() => onselect(id, item.kind)}
    onkeydown={(e) => e.key === 'Enter' && onselect(id, item.kind)}
  >
    {#if item.kind === 'group'}
      {@const g = item.group}
      <span class="gicon"><Network size={15} /></span>
      <span class="badge level">{t(`languages.groupLevels.${g.level}`)}</span>
      <span class="name">{g.name || t('languages.untitledGroup')}</span>
      {#if g.abbr}<span class="badge">{g.abbr}</span>{/if}
    {:else}
      {@const l = item.language}
      <span class="dot" style:background={l.color}></span>
      <span class="name data">{l.name || t('app.untitledLanguage')}</span>
      {#if l.abbr}<span class="badge">{l.abbr}</span>{/if}
      {#if defaultId === l.id}<span class="badge accent">{t('languages.isDefault')}</span>{/if}
      {#if l.stages?.length}
        <span class="stages small muted" title={t('languages.stagesTitle')}
          >{#each l.stages as s, i (s.id)}{#if i}<span class="arrow">→</span>{/if}<span
              title={s.name}>{stageShort(s)}</span
            >{/each}</span
        >
      {/if}
    {/if}
    <span class="grow"></span>
    <button
      class="btn ghost icon sm addchild"
      title={item.kind === 'group' ? t('languages.addLanguageHere') : t('languages.addChild')}
      onclick={(e) => {
        e.stopPropagation()
        onaddchild(id, item.kind)
      }}><Plus size={14} /></button
    >
  </div>
  {#if kids.length}
    <div class="kids" class:in-group={item.kind === 'group'}>
      {#each kids as k (k.kind === 'group' ? 'g:' + k.group.id : k.language.id)}
        <LanguageNode
          {visible}
          item={k}
          {selectedId}
          {defaultId}
          {onselect}
          {onaddchild}
          depth={depth + 1}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .node {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lang {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    transition:
      border-color 0.12s,
      box-shadow 0.12s;
  }
  .lang:hover {
    border-color: var(--border-strong);
  }
  .lang.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  /* 分类节点：虚线框、底色浅一点，一眼跟语言分开 */
  .lang.group {
    border-style: dashed;
    background: var(--bg-sunken);
  }
  .gicon {
    display: inline-flex;
    color: var(--text-3);
    flex: none;
  }
  .level {
    font-size: 11px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }
  .name {
    font-weight: 500;
  }
  .stages {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  }
  .arrow {
    color: var(--text-3);
  }
  .addchild {
    opacity: 0;
  }
  .lang:hover .addchild {
    opacity: 1;
  }
  .kids {
    margin-left: 28px;
    padding-left: 12px;
    border-left: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .kids.in-group {
    border-left-style: dashed;
  }
</style>
