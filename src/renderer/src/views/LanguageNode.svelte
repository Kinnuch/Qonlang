<script lang="ts">
  import type { Id, Language } from '$lib/core/model'
  import { t } from '$lib/i18n/index.svelte'
  import LanguageNode from './LanguageNode.svelte'
  import { Plus } from '@lucide/svelte'

  let {
    language,
    children,
    selectedId,
    defaultId,
    onselect,
    onaddchild,
    depth = 0
  }: {
    language: Language
    children: Map<Id | null, Language[]>
    selectedId: Id | null
    defaultId: Id | null
    onselect: (id: Id) => void
    onaddchild: (id: Id) => void
    depth?: number
  } = $props()

  const kids = $derived(children.get(language.id) ?? [])
</script>

<div class="node" style:--depth={depth}>
  <div class="card lang" class:selected={selectedId === language.id} role="button" tabindex="0" onclick={() => onselect(language.id)} onkeydown={(e) => e.key === 'Enter' && onselect(language.id)}>
    <span class="dot" style:background={language.color}></span>
    <span class="name data">{language.name || t('app.untitledLanguage')}</span>
    {#if language.abbr}<span class="badge">{language.abbr}</span>{/if}
    {#if defaultId === language.id}<span class="badge accent">{t('languages.isDefault')}</span>{/if}
    <span class="grow"></span>
    <button
      class="btn ghost icon sm addchild"
      title={t('languages.addChild')}
      onclick={(e) => {
        e.stopPropagation()
        onaddchild(language.id)
      }}><Plus size={14} /></button
    >
  </div>
  {#if kids.length}
    <div class="kids">
      {#each kids as k (k.id)}
        <LanguageNode language={k} {children} {selectedId} {defaultId} {onselect} {onaddchild} depth={depth + 1} />
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
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }
  .name {
    font-weight: 500;
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
</style>
