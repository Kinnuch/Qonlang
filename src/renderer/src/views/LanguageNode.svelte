<script lang="ts">
  /** 语言树的一个节点：语系 / 语族 / 语支节点，或者一门语言（带着它的历时阶段） */
  import type { Id } from '$lib/core/model'
  import type { TreeItem, TreeRef } from '$lib/core/languageTree'
  import { stageShort } from '$lib/core/languageTree'
  import type { TreeDragProps } from '$lib/ui/treeDrag.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import LanguageNode from './LanguageNode.svelte'
  import { sectionCollapsed, toggleSection } from '$lib/ui/section.svelte'
  import { Plus, Network, GitCompare, ChevronDown, ChevronRight } from '@lucide/svelte'

  let {
    item,
    visible = null,
    selectedId,
    defaultId,
    compareIds = [],
    hlNodes = new Set<string>(),
    dragProps,
    onselect,
    onaddchild,
    oncompare,
    depth = 0,
    flush = false
  }: {
    item: TreeItem
    /** 顶栏搜索筛出来的可见节点（语言与分类节点的 id）；null 表示不筛 */
    visible?: Set<Id> | null
    selectedId: Id | null
    defaultId: Id | null
    /** 正在对比的两门语言 */
    compareIds?: Id[]
    /** 对比时两条路径上的节点 key（`l:id` / `g:id`），描虚线 */
    hlNodes?: Set<string>
    /** 拖动用的一组属性；不传就不能拖 */
    dragProps?: (ref: TreeRef) => TreeDragProps
    onselect: (id: Id, kind: 'group' | 'language', addToCompare: boolean) => void
    onaddchild: (id: Id, kind: 'group' | 'language') => void
    oncompare: (id: Id) => void
    depth?: number
    /** 分组的原始语：跟分组标题那一行对齐，不跟着里面的内容缩进 */
    flush?: boolean
  } = $props()

  const id = $derived(item.kind === 'group' ? item.group.id : item.language.id)
  const key = $derived((item.kind === 'group' ? 'g:' : 'l:') + id)
  const kids = $derived(
    item.children.filter(
      (c) => !visible || visible.has(c.kind === 'group' ? c.group.id : c.language.id)
    )
  )
  /** 分类节点收起 / 展开（记在本机） */
  const foldId = $derived(`langGroup:${id}`)
  const folded = $derived(item.kind === 'group' && sectionCollapsed(foldId))
  /** 收起时写有几门语言（含各级下面的） */
  const inside = $derived.by(() => {
    let n = 0
    const walk = (list: TreeItem[]): void => {
      for (const x of list) {
        if (x.kind === 'language') n++
        walk(x.children)
      }
    }
    walk(item.children)
    return n
  })
</script>

<div class="node" class:boxed={item.kind === 'group'} class:flush style:--depth={depth}>
  <div
    class="card lang"
    class:group={item.kind === 'group'}
    class:selected={selectedId === id}
    class:chain={hlNodes.has(key)}
    class:picked={compareIds.includes(id)}
    role="button"
    tabindex="0"
    {...dragProps?.({ kind: item.kind, id }) ?? {}}
    onclick={(e) => onselect(id, item.kind, e.ctrlKey || e.metaKey)}
    onkeydown={(e) => e.key === 'Enter' && onselect(id, item.kind, e.ctrlKey || e.metaKey)}
  >
    {#if item.kind === 'group'}
      {@const g = item.group}
      <button
        class="fold"
        title={folded ? t('languages.expandGroup') : t('languages.collapseGroup')}
        aria-expanded={!folded}
        onclick={(e) => {
          e.stopPropagation()
          toggleSection(foldId)
        }}
        >{#if folded}<ChevronRight size={14} />{:else}<ChevronDown size={14} />{/if}</button
      >
      <span class="gicon"><Network size={15} /></span>
      <span class="badge level">{t(`languages.groupLevels.${g.level}`)}</span>
      <span class="name">{g.name || t('languages.untitledGroup')}</span>
      {#if g.abbr}<span class="badge">{g.abbr}</span>{/if}
      {#if folded && inside}<span class="small muted"
          >{t('languages.groupInside', { n: inside })}</span
        >{/if}
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
    {#if item.kind === 'language'}
      <button
        class="btn ghost icon sm cmp"
        class:on={compareIds.includes(id)}
        title={t('languages.compare.toggle')}
        onclick={(e) => {
          e.stopPropagation()
          oncompare(id)
        }}><GitCompare size={14} /></button
      >
    {/if}
    <button
      class="btn ghost icon sm addchild"
      title={item.kind === 'group' ? t('languages.addLanguageHere') : t('languages.addChild')}
      onclick={(e) => {
        e.stopPropagation()
        onaddchild(id, item.kind)
      }}><Plus size={14} /></button
    >
  </div>
  {#if kids.length && !folded}
    <div class="kids" class:in-group={item.kind === 'group'}>
      {#each kids as k (k.kind === 'group' ? 'g:' + k.group.id : k.language.id)}
        <LanguageNode
          {visible}
          item={k}
          flush={item.kind === 'group' &&
            k.kind === 'language' &&
            k.language.id === item.group.protoLanguageId}
          {selectedId}
          {defaultId}
          {compareIds}
          {hlNodes}
          {dragProps}
          {onselect}
          {onaddchild}
          {oncompare}
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
  /* 分类节点：整块包起来，里面的语言、下一级节点都在这个框里 */
  .node.boxed {
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    padding: 6px;
    background: color-mix(in srgb, var(--bg-sunken) 55%, transparent);
  }
  .fold {
    display: inline-flex;
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-3);
    cursor: pointer;
  }
  .fold:hover {
    color: var(--text);
  }
  .lang {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    position: relative;
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
  /* 对比的两门语言到最近公共祖先的一串：虚线框，一闪一闪 */
  .lang.chain {
    border-color: var(--accent);
    border-style: dashed;
    animation: chain-blink 1.1s ease-in-out infinite;
  }
  .lang.picked {
    background: var(--accent-soft);
  }
  @keyframes chain-blink {
    50% {
      border-color: var(--border);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lang.chain {
      animation: none;
    }
  }
  /* 拖动：落到两张卡片中间时那一条边画一道线，放不下去的整个描红 */
  .lang[data-drop='before']::before,
  .lang[data-drop='after']::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    border-radius: 2px;
  }
  .lang[data-drop='before']::before {
    top: -4px;
  }
  .lang[data-drop='after']::after {
    bottom: -4px;
  }
  .lang[data-drop-bad] {
    outline: 1.5px dashed var(--danger);
    outline-offset: 1px;
  }
  .lang[data-drop-bad][data-drop='before']::before,
  .lang[data-drop-bad][data-drop='after']::after {
    background: var(--danger);
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
  .addchild,
  .cmp {
    opacity: 0;
  }
  .lang:hover .addchild,
  .lang:hover .cmp,
  .cmp.on {
    opacity: 1;
  }
  .cmp.on {
    color: var(--accent-text);
  }
  .kids {
    margin-left: 28px;
    padding-left: 12px;
    border-left: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  /* 分类节点里的东西往里缩一格（框本身已经圈住了，不再画那条竖线）；原始语除外，它跟标题对齐 */
  .kids.in-group {
    margin-left: 0;
    padding-left: 18px;
    border-left: 0;
  }
  .node.flush {
    margin-left: -18px;
  }
</style>
