<script lang="ts">
  import { t } from '$lib/i18n/index.svelte'
  import type { Section } from '$lib/state/ui.svelte'

  let { section, inspectorTitle = $bindable('') }: { section: Section; inspectorTitle?: string } = $props()
  $effect(() => {
    inspectorTitle = ''
  })
</script>

<div class="ph">
  <h1>{t(`nav.${section}`)}</h1>
  <p class="muted">{t('placeholder.title')}</p>
  <p>{t(`placeholder.${section}`)}</p>
</div>

<style>
  .ph {
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 560px;
  }
</style>
