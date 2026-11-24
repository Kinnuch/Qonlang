<script lang="ts">
  import type { Id, Project } from '$lib/core/model'
  import { createLexemeGraph } from '$lib/core/lexemeGraph'
  import { compareContext, compareGroups } from '$lib/core/compare'
  import { i18n, t } from '$lib/i18n/index.svelte'
  import LexemeCompare from './LexemeCompare.svelte'
  import LexemeGraphCanvas from './LexemeGraphCanvas.svelte'

  let {
    project,
    lexemeId,
    onselect,
    ondelete,
    mode = $bindable('graph')
  }: {
    project: Project
    lexemeId: Id
    onselect: (id: Id) => void
    ondelete?: (id: Id) => unknown
    mode?: 'graph' | 'compare'
  } = $props()

  const center = $derived(project.lexemes.find((word) => word.id === lexemeId))
  const langs = $derived(project.settings.glossLanguages)
  const fallbackLocale = $derived(i18n.custom?.base ?? i18n.locale)
  const model = $derived(createLexemeGraph(project, [i18n.locale, fallbackLocale, ...langs]))
  const groups = $derived(center ? compareGroups(compareContext(project, langs), center) : [])
  $effect(() => {
    if (mode === 'compare' && !groups.length) mode = 'graph'
  })
</script>

{#if !center}
  <p class="muted">{t('lexicon.noLanguage')}</p>
{:else if mode === 'compare' && groups.length}
  <LexemeCompare {project} {center} {groups} {onselect} onback={() => (mode = 'graph')} />
{:else}
  {#key JSON.stringify([project.meta.id, center.id])}
    <LexemeGraphCanvas
      {project}
      {model}
      {center}
      {onselect}
      {ondelete}
      compareCount={groups.length}
      oncompare={() => (mode = 'compare')}
    />
  {/key}
{/if}
