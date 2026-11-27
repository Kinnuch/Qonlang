<script lang="ts">
  import { List, GalleryHorizontal, Columns3 } from '@lucide/svelte'
  import { t } from '$lib/i18n/index.svelte'
  import type { RecordViewMode } from './recordViews'

  let { value, onchange }: { value: RecordViewMode; onchange: (mode: RecordViewMode) => void } =
    $props()
</script>

<div class="seg record-view-switcher" role="group" aria-label={t('recordViews.label')}>
  <button
    type="button"
    data-record-view="list"
    class:active={value === 'list'}
    aria-pressed={value === 'list'}
    title={t('recordViews.list')}
    aria-label={t('recordViews.list')}
    onclick={() => onchange('list')}><List size={16} /></button
  >
  <button
    type="button"
    data-record-view="gallery"
    class:active={value === 'gallery'}
    aria-pressed={value === 'gallery'}
    title={t('recordViews.gallery')}
    aria-label={t('recordViews.gallery')}
    onclick={() => onchange('gallery')}><GalleryHorizontal size={16} /></button
  >
  <button
    type="button"
    data-record-view="masonry"
    class:active={value === 'masonry'}
    aria-pressed={value === 'masonry'}
    title={t('recordViews.masonry')}
    aria-label={t('recordViews.masonry')}
    onclick={() => onchange('masonry')}><Columns3 size={16} /></button
  >
</div>

<style>
  .record-view-switcher {
    flex: none;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
  }
</style>
